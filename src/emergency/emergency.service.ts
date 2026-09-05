import {
  Injectable,
  Logger,
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  EmergencyIncident,
  EmergencyStatus,
  EmergencyTriggeredBy,
} from './entities/emergency-incident.entity';
import { Ride, RideStatus } from '../rides/entities/ride.entity';
import { DriverLocationsService } from '../driver-locations/driver-locations.service';
import { WebhookService } from '../common/services/webhook.service';
import { RIDE_EVENTS } from '../websocket/events/ride-events.constants';
import { Role } from '../common/enums/role.enum';
import { TriggerEmergencyDto, ResolveEmergencyDto } from './dto/emergency.dto';

/**
 * EmergencyService
 *
 * Purpose: The in-ride SOS. One button, three outcomes, in this order:
 *
 *   1. Persist the incident        (must succeed — this is the record)
 *   2. Broadcast over websocket    (best effort — instant, in-app)
 *   3. Queue outbound webhooks     (durable — retried until delivered)
 *
 * Steps 2 and 3 are deliberately separate mechanisms rather than one pipeline:
 * an in-app alert is worthless if it arrives late, and an external safety
 * partner integration is worthless if it can be dropped. Different guarantees,
 * different transports.
 *
 * Nothing after step 1 is allowed to throw the request away — a failure to
 * locate the driver or reach a partner must not turn a real emergency into a
 * 500 for the person pressing the button.
 */
@Injectable()
export class EmergencyService {
  private readonly logger = new Logger(EmergencyService.name);

  constructor(
    @InjectRepository(EmergencyIncident)
    private readonly incidentRepository: Repository<EmergencyIncident>,
    @InjectRepository(Ride)
    private readonly rideRepository: Repository<Ride>,
    private readonly driverLocationsService: DriverLocationsService,
    private readonly webhookService: WebhookService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  /**
   * Raise an SOS. Only valid while a ride is actually in progress, and only
   * for the two people in the vehicle.
   */
  async trigger(
    dto: TriggerEmergencyDto,
    requesterId: string,
    role: Role,
  ): Promise<EmergencyIncident> {
    const ride = await this.rideRepository.findOne({
      where: { id: dto.rideId },
    });

    if (!ride) throw new NotFoundException('Ride not found');

    if (ride.status !== RideStatus.IN_PROGRESS) {
      throw new BadRequestException(
        'SOS is only available while a ride is in progress',
      );
    }

    const isRider = ride.userId === requesterId;
    const isDriver = ride.driverId === requesterId;

    if (!isRider && !isDriver) {
      throw new ForbiddenException('You are not a party to this ride');
    }

    const location = await this.resolveLocation(ride, dto);

    // STEP 1: the record. Everything else is notification.
    const incident = await this.incidentRepository.save(
      this.incidentRepository.create({
        rideId: ride.id,
        triggeredBy: isDriver
          ? EmergencyTriggeredBy.DRIVER
          : EmergencyTriggeredBy.RIDER,
        triggeredById: requesterId,
        location,
        note: dto.note ?? null,
        status: EmergencyStatus.ACTIVE,
      }),
    );

    this.logger.error(
      `🚨 SOS raised on ride ${ride.id} by ${incident.triggeredBy} ${requesterId} (incident ${incident.id})`,
    );

    const payload = {
      incidentId: incident.id,
      rideId: ride.id,
      triggeredBy: incident.triggeredBy,
      triggeredById: requesterId,
      location,
      createdAt: incident.createdAt,
      // Named so the gateway can alert each party directly rather than
      // relying on them having joined the ride room
      userId: ride.userId,
      driverId: ride.driverId,
    };

    // STEP 2: instant in-app alert to both parties and the ops room
    this.eventEmitter.emit(RIDE_EVENTS.EMERGENCY_TRIGGERED, payload);

    // STEP 3: durable outbound notification to external safety partners
    await this.webhookService.dispatchEmergency({
      ...payload,
      pickup: ride.pickup,
      dropoff: ride.dropoff,
      driverId: ride.driverId,
      userId: ride.userId,
    });

    return incident;
  }

  /**
   * Best known position: what the caller sent, else the driver's last GPS ping,
   * else the pickup point. Never throws — a missing location must not block an
   * alert.
   */
  private async resolveLocation(ride: Ride, dto: TriggerEmergencyDto) {
    if (dto.lat != null && dto.lng != null) {
      return { lat: dto.lat, lng: dto.lng };
    }

    if (ride.driverId) {
      try {
        const position = await this.driverLocationsService.findByDriverId(
          ride.driverId,
        );
        return { lat: position.latitude, lng: position.longitude };
      } catch (error) {
        this.logger.warn(
          `Could not resolve live location for driver ${ride.driverId} during SOS: ${error?.message}`,
        );
      }
    }

    return ride.pickup ? { ...ride.pickup } : null;
  }

  /**
   * The two parties on a ride, for the controller's authorization check.
   *
   * Deliberately a projection: the caller has not been authorized yet at the
   * point this runs, so it must not load anything it would be wrong to show.
   */
  async findRideForAuthorization(
    rideId: string,
  ): Promise<{ userId: string; driverId: string | null } | null> {
    const ride = await this.rideRepository.findOne({
      where: { id: rideId },
      select: { userId: true, driverId: true },
    });
    return ride ? { userId: ride.userId, driverId: ride.driverId } : null;
  }

  async findByRideId(rideId: string): Promise<EmergencyIncident[]> {
    return await this.incidentRepository.find({
      where: { rideId },
      order: { createdAt: 'DESC' },
    });
  }

  async findAll(status?: EmergencyStatus): Promise<EmergencyIncident[]> {
    return await this.incidentRepository.find({
      where: status ? { status } : {},
      relations: ['ride'],
      order: { createdAt: 'DESC' },
    });
  }

  async resolve(
    incidentId: string,
    dto: ResolveEmergencyDto,
  ): Promise<EmergencyIncident> {
    const incident = await this.incidentRepository.findOne({
      where: { id: incidentId },
    });

    if (!incident) throw new NotFoundException('Incident not found');

    incident.status = dto.status ?? EmergencyStatus.RESOLVED;
    incident.resolutionNote = dto.resolutionNote ?? null;
    incident.resolvedAt = new Date();

    return await this.incidentRepository.save(incident);
  }
}
