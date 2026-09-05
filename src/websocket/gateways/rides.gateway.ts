import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
  OnGatewayConnection,
  OnGatewayDisconnect,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Server, Socket } from 'socket.io';
import { AuthResolverService } from '../../auth/services/auth-resolver.service';
import { Role } from '../../common/enums/role.enum';
import { Vehicle } from '../../vehicles/entities/vehicle.entity';
import { getAllowedCategoriesForVehicleTypes } from '../../rides/utils/category-matching.util';
import {
  RIDE_EVENTS,
  WS_EVENTS,
  WS_CLIENT_EVENTS,
  ROOMS,
} from '../events/ride-events.constants';
// Type-only: these are interfaces used in decorated method signatures, which
// isolatedModules + emitDecoratorMetadata requires be imported as types.
import type {
  RideStateEvent,
  RideCompletedEvent,
  DriverLocationEvent,
  EmergencyEvent,
} from '../events/ride-events.constants';
import { requireJwtSecret } from '../../config/jwt.config';
import { corsOptions } from '../../config/cors.config';
import { Ride } from '../../rides/entities/ride.entity';
import { isPartyToRide } from '../../common/utils/ownership.util';

/**
 * RidesGateway
 *
 * Purpose: Push ride state to both sides of a trip the instant it changes, so
 * the rider and driver apps stay in lockstep without polling.
 *
 * Design notes worth keeping in mind before changing this file:
 *
 * 1. It is PUSH-ONLY. Clients cannot mutate ride state over the socket — every
 *    lifecycle transition stays on the authenticated REST endpoints, where the
 *    role guards, DTO validation and Redis locks already live. Accepting a ride
 *    over a socket message would mean reimplementing all of that a second time.
 *
 * 2. It never imports RidesService. Services emit EventEmitter2 events and this
 *    gateway listens. That indirection is the only reason there is no circular
 *    dependency between the domain layer and the transport layer.
 *
 * 3. Auth happens in handleConnection, not through @UseGuards. JwtAuthGuard and
 *    RolesGuard both call context.switchToHttp() and cannot work here, and
 *    guards do not reliably run for the initial handshake anyway.
 */
@WebSocketGateway({
  namespace: '/rides',
  // Socket.IO negotiates its own CORS — app.enableCors() in main.ts is
  // Express-level only and does NOT cover this handshake, which is why this
  // has to be stated separately.
  //
  // It used to be `{ origin: true, credentials: true }`: reflect ANY origin,
  // with credentials. Both policies now read the same CORS_ORIGINS allowlist,
  // so they cannot drift apart again.
  cors: corsOptions(),
})
export class RidesGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(RidesGateway.name);

  @WebSocketServer()
  server: Server;

  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly authResolver: AuthResolverService,
    @InjectRepository(Vehicle)
    private readonly vehicleRepository: Repository<Vehicle>,
    // Needed to answer "is this socket allowed in this ride's room?".
    @InjectRepository(Ride)
    private readonly rideRepository: Repository<Ride>,
  ) {}

  // ==================== CONNECTION LIFECYCLE ====================

  /**
   * Authenticate the handshake, then place the socket in its rooms.
   *
   * Clients connect with:
   *   io('http://host/rides', { auth: { token: '<jwt>' } })
   */
  async handleConnection(client: Socket): Promise<void> {
    try {
      const token = this.extractToken(client);

      if (!token) {
        return this.rejectConnection(client, 'Missing authentication token');
      }

      const payload = await this.jwtService.verifyAsync(token, {
        secret:
          requireJwtSecret(this.configService),
      });

      const principal = await this.authResolver.resolvePrincipal(payload);
      client.data.principal = principal;

      if (principal.role === Role.DRIVER) {
        await this.joinDriverRooms(client, principal.id);
      } else {
        await client.join(ROOMS.user(principal.id));
      }

      this.logger.log(
        `🔌 Socket connected: ${principal.role} ${principal.id} (${client.id})`,
      );
    } catch (error) {
      this.rejectConnection(client, error?.message || 'Authentication failed');
    }
  }

  handleDisconnect(client: Socket): void {
    const principal = client.data?.principal;
    if (principal) {
      this.logger.log(
        `🔌 Socket disconnected: ${principal.role} ${principal.id} (${client.id})`,
      );
    }
  }

  /**
   * A driver listens on their own room plus a broadcast room for every ride
   * category their vehicles qualify for, so new requests reach exactly the
   * drivers who could actually serve them.
   */
  private async joinDriverRooms(
    client: Socket,
    driverId: string,
  ): Promise<void> {
    await client.join(ROOMS.driver(driverId));

    const vehicles = await this.vehicleRepository.find({
      where: { driverId, isActive: true },
    });

    const categories = getAllowedCategoriesForVehicleTypes(
      vehicles.map((vehicle) => vehicle.type),
    );

    for (const category of categories) {
      await client.join(ROOMS.availableRides(category));
    }
  }

  private extractToken(client: Socket): string | null {
    const fromAuth = client.handshake?.auth?.token;
    if (fromAuth) return String(fromAuth).replace(/^Bearer\s+/i, '');

    // Fallback for clients that can only set headers
    const header = client.handshake?.headers?.authorization;
    if (header) return String(header).replace(/^Bearer\s+/i, '');

    return null;
  }

  private rejectConnection(client: Socket, reason: string): void {
    this.logger.warn(`🚫 Socket rejected (${client.id}): ${reason}`);
    client.emit(WS_EVENTS.AUTH_ERROR, { message: reason });
    client.disconnect(true);
  }

  // ==================== CLIENT MESSAGES ====================

  /**
   * Subscribe to one ride's updates. Used by the rider after booking, and by
   * either app after a reconnect.
   *
   * Membership is authorised against the ride the socket claims: a driver may
   * only join a ride assigned to them, a rider only their own.
   *
   * That paragraph was already written here — but nothing implemented it. The
   * handler joined whatever room it was handed, so any authenticated socket
   * could `join:ride` with any UUID and receive that trip's live driver GPS,
   * the rider's name/email/phone, the fare breakdown, and its SOS alerts.
   * A comment is not an access control.
   */
  @SubscribeMessage(WS_CLIENT_EVENTS.JOIN_RIDE)
  async handleJoinRide(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { rideId?: string },
  ) {
    const rideId = body?.rideId;
    if (!rideId) {
      return { status: 'error', message: 'rideId is required' };
    }

    const principal = client.data?.principal;
    if (!principal) {
      // Should be unreachable: handleConnection rejects unauthenticated
      // sockets. Belt and braces, because the cost of being wrong here is
      // someone else's live location.
      return { status: 'error', message: 'Not authenticated' };
    }

    const ride = await this.rideRepository.findOne({
      where: { id: rideId },
      select: { id: true, userId: true, driverId: true },
    });

    if (!ride) {
      return { status: 'error', message: 'Ride not found' };
    }

    if (!isPartyToRide(principal, ride)) {
      this.logger.warn({
        message: 'Socket refused entry to a ride room',
        socketId: client.id,
        principalId: principal.id,
        principalRole: principal.role,
        rideId,
      });
      return { status: 'error', message: 'You are not part of this ride' };
    }

    await client.join(ROOMS.ride(rideId));
    return { status: 'joined', rideId };
  }

  @SubscribeMessage(WS_CLIENT_EVENTS.LEAVE_RIDE)
  async handleLeaveRide(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { rideId?: string },
  ) {
    const rideId = body?.rideId;
    if (!rideId) {
      return { status: 'error', message: 'rideId is required' };
    }

    await client.leave(ROOMS.ride(rideId));
    return { status: 'left', rideId };
  }

  // ==================== DOMAIN EVENT FAN-OUT ====================

  /**
   * A rider booked. Wake every driver who could serve this category.
   */
  @OnEvent(RIDE_EVENTS.REQUESTED)
  handleRideRequested({ ride }: RideStateEvent): void {
    // Put the rider in the ride room immediately, so everything that follows
    // reaches them whether or not their app ever sends join:ride.
    this.joinPartiesToRideRoom(ride);

    this.server
      .to(ROOMS.availableRides(ride.category))
      .emit(WS_EVENTS.RIDE_REQUESTED, { ride });

    this.server
      .to(ROOMS.user(ride.userId))
      .emit(WS_EVENTS.RIDE_REQUESTED, { ride });
  }

  /**
   * A driver accepted. Pull them into the ride room, tell the rider who is
   * coming, and tell every other driver the job is gone.
   */
  @OnEvent(RIDE_EVENTS.ACCEPTED)
  handleRideAccepted({ ride }: RideStateEvent): void {
    this.joinPartiesToRideRoom(ride);

    this.server.to(ROOMS.ride(ride.id)).emit(WS_EVENTS.RIDE_ACCEPTED, { ride });
    this.server
      .to(ROOMS.user(ride.userId))
      .emit(WS_EVENTS.RIDE_ACCEPTED, { ride });

    // Everyone else can drop it from their available list
    this.server
      .to(ROOMS.availableRides(ride.category))
      .emit(WS_EVENTS.RIDE_TAKEN, { rideId: ride.id });
  }

  /**
   * Move both parties' existing sockets into the ride room.
   *
   * Ride-room membership has to be something the server guarantees, not
   * something the client remembers to ask for: a rider who never sent
   * join:ride would otherwise silently miss live driver positions and the
   * acknowledgement of their own SOS.
   */
  private joinPartiesToRideRoom(ride: {
    id: string;
    userId: string;
    driverId?: string | null;
  }): void {
    const room = ROOMS.ride(ride.id);

    this.server.in(ROOMS.user(ride.userId)).socketsJoin(room);

    if (ride.driverId) {
      this.server.in(ROOMS.driver(ride.driverId)).socketsJoin(room);
    }
  }

  @OnEvent(RIDE_EVENTS.ARRIVED)
  handleRideArrived({ ride }: RideStateEvent): void {
    this.broadcastToRide(ride.id, ride.userId, WS_EVENTS.RIDE_ARRIVED, {
      ride,
    });
  }

  @OnEvent(RIDE_EVENTS.STARTED)
  handleRideStarted({ ride }: RideStateEvent): void {
    this.broadcastToRide(ride.id, ride.userId, WS_EVENTS.RIDE_STARTED, {
      ride,
    });
  }

  /**
   * Completion carries the revenue split, so both apps can show the money
   * breakdown without a follow-up request.
   */
  @OnEvent(RIDE_EVENTS.COMPLETED)
  handleRideCompleted({ ride, split }: RideCompletedEvent): void {
    this.broadcastToRide(ride.id, ride.userId, WS_EVENTS.RIDE_COMPLETED, {
      ride,
      split,
    });
  }

  @OnEvent(RIDE_EVENTS.CANCELLED)
  handleRideCancelled({ ride }: RideStateEvent): void {
    this.broadcastToRide(ride.id, ride.userId, WS_EVENTS.RIDE_CANCELLED, {
      ride,
    });
  }

  /**
   * Live driver position, only for drivers currently on a ride.
   */
  @OnEvent(RIDE_EVENTS.DRIVER_LOCATION_UPDATED)
  handleDriverLocation(event: DriverLocationEvent): void {
    this.server
      .to(ROOMS.ride(event.rideId))
      .emit(WS_EVENTS.DRIVER_LOCATION, event);
  }

  /**
   * SOS. Goes to both parties and to the ops room simultaneously.
   *
   * This one is addressed redundantly — ride room, both personal rooms, and
   * ops — on purpose. Every other event can tolerate a client missing it and
   * catching up on the next one; a panic alert cannot.
   */
  @OnEvent(RIDE_EVENTS.EMERGENCY_TRIGGERED)
  handleEmergency(event: EmergencyEvent): void {
    const rooms = [ROOMS.ride(event.rideId), ROOMS.opsEmergency()];

    if (event.userId) rooms.push(ROOMS.user(event.userId));
    if (event.driverId) rooms.push(ROOMS.driver(event.driverId));

    // socket.io de-duplicates across rooms, so a client in two of these
    // still receives the alert exactly once.
    this.server.to(rooms).emit(WS_EVENTS.SOS_TRIGGERED, event);
  }

  /**
   * Ride rooms are joined on demand, so a rider who has not called join:ride
   * yet would otherwise miss updates. Sending to their personal room as well
   * makes delivery reliable regardless of when the app subscribed.
   */
  private broadcastToRide(
    rideId: string,
    userId: string,
    event: string,
    payload: any,
  ): void {
    this.server.to(ROOMS.ride(rideId)).emit(event, payload);
    this.server.to(ROOMS.user(userId)).emit(event, payload);
  }
}
