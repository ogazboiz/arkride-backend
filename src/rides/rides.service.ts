import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ForbiddenException,
  Inject,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In, Not } from 'typeorm';
import { Redis } from 'ioredis';
import { Ride, RideStatus, RideCategory } from './entities/ride.entity';
import { User } from '../users/entities/user.entity';
import { Driver } from '../drivers/entities/driver.entity';
import { Vehicle, VehicleType } from '../vehicles/entities/vehicle.entity';
import { CreateRideDto } from './dto/create-ride.dto';
import { CancelRideDto } from './dto/cancel-ride.dto';
import { UpdateRideStatusDto } from './dto/update-ride-status.dto';
import { EstimateRideDto, RideOptionDto } from './dto/estimate-ride.dto';
import { REDIS_CLIENT, RIDE_LOCK_PREFIX, USER_RIDE_IDEMPOTENCY_PREFIX } from '../redis/redis.constants';

/**
 * RidesService
 * 
 * Purpose: Handle all ride operations with concurrency protection.
 * 
 * Security & Speed Features:
 * 1. Redis Distributed Locking: Prevents multiple drivers from accepting the same ride.
 * 2. Idempotency: Prevents users from accidentally double-booking rides.
 * 3. Atomic Updates: Ensures data consistency under heavy load.
 */
@Injectable()
export class RidesService {
  constructor(
    @InjectRepository(Ride)
    private readonly rideRepository: Repository<Ride>,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(Driver)
    private readonly driverRepository: Repository<Driver>,
    @InjectRepository(Vehicle)
    private readonly vehicleRepository: Repository<Vehicle>,

    // Inject our high-speed Redis client
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
  ) {}

  /**
   * Get price estimates for all ride categories
   */
  async estimateRide(estimateDto: EstimateRideDto): Promise<RideOptionDto[]> {
    const { pickup, dropoff } = estimateDto;
    const distance = this.calculateDistance(pickup.lat, pickup.lng, dropoff.lat, dropoff.lng);

    return [
      {
        category: RideCategory.PRIVATE,
        displayName: 'Whole Keke',
        estimatedFare: this.calculateFare(distance, RideCategory.PRIVATE),
        distanceKm: distance,
        description: 'Private ride for yourself (1-3 people)',
      },
      {
        category: RideCategory.SHARED,
        displayName: 'Shared Keke',
        estimatedFare: this.calculateFare(distance, RideCategory.SHARED),
        distanceKm: distance,
        description: 'Share with others and pay half price',
      },
      {
        category: RideCategory.OKADA,
        displayName: 'Okada',
        estimatedFare: this.calculateFare(distance, RideCategory.OKADA),
        distanceKm: distance,
        description: 'Fast motorcycle ride for one person',
      },
    ];
  }

  /**
   * Create a new ride request
   * 
   * Speed Fix: Uses Redis Idempotency to prevent double-booking
   */
  async createRide(createRideDto: CreateRideDto): Promise<Ride> {
    const { userId, pickup, dropoff, category } = createRideDto;

    // STEP 1: Prevention of Double-Booking (Idempotency)
    // We create a unique key for this user's request
    // If they click 'Book' twice within 30 seconds, the second request will be blocked
    const idempotencyKey = `${USER_RIDE_IDEMPOTENCY_PREFIX}${userId}:${pickup.lat}:${pickup.lng}`;
    
    // Attempt to set a 'lock' for 30 seconds
    // 'NX' means "Only set if it doesn't exist"
    // 'EX' means "Expire after 30 seconds"
    const isDuplicate = await this.redis.set(idempotencyKey, 'locked', 'EX', 30, 'NX');

    if (!isDuplicate) {
      throw new BadRequestException(
        'A similar ride request is already being processed. Please wait 30 seconds.',
      );
    }

    try {
      // Verify that the user exists
      const user = await this.userRepository.findOne({ where: { id: userId } });
      if (!user) throw new NotFoundException('User not found');
      if (user.isBlocked) throw new ForbiddenException('Your account has been blocked');

      const distance = this.calculateDistance(pickup.lat, pickup.lng, dropoff.lat, dropoff.lng);
      const estimatedFare = this.calculateFare(distance, category);

      const ride = this.rideRepository.create({
        ...createRideDto,
        distanceKm: distance,
        estimatedFare: estimatedFare,
        status: RideStatus.REQUESTED,
        requestedAt: new Date(),
      });

      return await this.rideRepository.save(ride);
    } catch (error) {
      // If something fails, remove the idempotency lock so user can try again immediately
      await this.redis.del(idempotencyKey);
      throw error;
    }
  }

  /**
   * Driver accepts a ride request
   * 
   * Reliability Fix: Uses Redis Distributed Locking
   * This handles the case where 2+ drivers click "Accept" at the same millisecond.
   */
  async acceptRide(
    rideId: string,
    driverId: string,
    updateDto: UpdateRideStatusDto,
  ): Promise<Ride> {
    // STEP 1: Grab the "Talking Stick" (Redis Lock)
    const lockKey = `${RIDE_LOCK_PREFIX}${rideId}`;
    const lockAcquired = await this.redis.set(lockKey, driverId, 'EX', 10, 'NX');

    if (!lockAcquired) {
      throw new BadRequestException(
        'This ride is currently being processed by another driver. Please try another one.',
      );
    }

    try {
      // STEP 2: Standard Validations
      const ride = await this.findOne(rideId);
      if (ride.status !== RideStatus.REQUESTED) {
        throw new BadRequestException('This ride has already been taken.');
      }

      const driver = await this.driverRepository.findOne({ where: { id: driverId } });
      if (!driver || !driver.isActive || !driver.isOnline) {
        throw new ForbiddenException('Driver account is invalid or offline');
      }

      const vehicle = await this.vehicleRepository.findOne({ where: { id: updateDto.vehicleId } });
      if (!vehicle || vehicle.driverId !== driverId || !vehicle.isActive) {
        throw new BadRequestException('Vehicle is invalid or does not belong to you');
      }

      // STEP 3: Category and Concurrency Validations
      
      // 3a. Vehicle Type Matching
      if (ride.category === RideCategory.OKADA && vehicle.type !== VehicleType.BIKE) {
        throw new BadRequestException('Okada rides require a Bike vehicle type');
      }
      if ((ride.category === RideCategory.PRIVATE || ride.category === RideCategory.SHARED) && 
          vehicle.type !== VehicleType.KEKE) {
        throw new BadRequestException('Keke rides require a Keke vehicle type');
      }

      // 3b. Active Ride Limits
      const activeRides = await this.rideRepository.find({
        where: {
          driverId: driverId,
          status: In([RideStatus.ACCEPTED, RideStatus.ARRIVED, RideStatus.IN_PROGRESS]),
        },
      });

      // If already on a Private or Okada ride, can't take anything else
      const hasExclusiveRide = activeRides.some(r => r.category === RideCategory.PRIVATE || r.category === RideCategory.OKADA);
      if (hasExclusiveRide) {
        throw new BadRequestException('You are currently on an exclusive ride and cannot accept more.');
      }

      // If new ride is Private or Okada, driver must have 0 active rides
      if ((ride.category === RideCategory.PRIVATE || ride.category === RideCategory.OKADA) && activeRides.length > 0) {
        throw new BadRequestException('Private and Okada rides require you to have no other active rides.');
      }

      // If new ride is Shared, must not exceed max 4 shared rides
      if (ride.category === RideCategory.SHARED) {
        if (activeRides.length >= 4) {
          throw new BadRequestException('You have reached the maximum of 4 active shared rides.');
        }
      }

      // STEP 4: Atomic Database Update
      ride.driverId = driverId;
      ride.vehicleId = updateDto?.vehicleId as string;
      ride.status = RideStatus.ACCEPTED;
      ride.acceptedAt = new Date();

      const savedRide = await this.rideRepository.save(ride);
      
      // LOG: Success!
      console.log(`✅ Ride ${rideId} (${ride.category}) successfully assigned to Driver ${driverId}`);
      
      return savedRide;
    } finally {
      // STEP 5: Always release the lock so the system stays clean
      await this.redis.del(lockKey);
    }
  }

  // --- REST OF THE METHODS (Unchanged but documented) ---

  async findAll(): Promise<Ride[]> {
    return await this.rideRepository.find({
      relations: ['user', 'driver', 'vehicle'],
      order: { createdAt: 'DESC' },
    });
  }

  async findOne(id: string): Promise<Ride> {
    const ride = await this.rideRepository.findOne({
      where: { id },
      relations: ['user', 'driver', 'driver.location', 'vehicle'],
    });
    if (!ride) throw new NotFoundException('Ride not found');
    return ride;
  }

  async findByUserId(userId: string): Promise<Ride[]> {
    return await this.rideRepository.find({
      where: { userId },
      relations: ['driver', 'vehicle'],
      order: { createdAt: 'DESC' },
    });
  }

  async findByDriverId(driverId: string): Promise<Ride[]> {
    return await this.rideRepository.find({
      where: { driverId },
      relations: ['user', 'vehicle'],
      order: { createdAt: 'DESC' },
    });
  }

  /**
   * Filter available rides based on driver's vehicle types
   */
  async findAvailableRides(driverId: string): Promise<Ride[]> {
    const vehicles = await this.vehicleRepository.find({
      where: { driverId, isActive: true },
    });

    if (vehicles.length === 0) return [];

    const allowedCategories: RideCategory[] = [];
    if (vehicles.some(v => v.type === VehicleType.KEKE)) {
      allowedCategories.push(RideCategory.PRIVATE, RideCategory.SHARED);
    }
    if (vehicles.some(v => v.type === VehicleType.BIKE)) {
      allowedCategories.push(RideCategory.OKADA);
    }

    if (allowedCategories.length === 0) return [];

    return await this.rideRepository.find({
      where: { 
        status: RideStatus.REQUESTED,
        category: In(allowedCategories),
      },
      relations: ['user'],
      order: { requestedAt: 'ASC' },
    });
  }

  async markArrived(rideId: string, driverId: string): Promise<Ride> {
    const ride = await this.findOne(rideId);
    if (ride.driverId !== driverId) throw new ForbiddenException('Access denied');
    if (ride.status !== RideStatus.ACCEPTED) throw new BadRequestException('Invalid state');
    ride.status = RideStatus.ARRIVED;
    return await this.rideRepository.save(ride);
  }

  async startRide(rideId: string, driverId: string): Promise<Ride> {
    const ride = await this.findOne(rideId);
    if (ride.driverId !== driverId) throw new ForbiddenException('Access denied');
    if (ride.status !== RideStatus.ARRIVED) throw new BadRequestException('Invalid state');
    ride.status = RideStatus.IN_PROGRESS;
    ride.startedAt = new Date();
    return await this.rideRepository.save(ride);
  }

  async completeRide(rideId: string, driverId: string): Promise<Ride> {
    const ride = await this.findOne(rideId);
    if (ride.driverId !== driverId) throw new ForbiddenException('Access denied');
    if (ride.status !== RideStatus.IN_PROGRESS) throw new BadRequestException('Invalid state');
    
    ride.finalFare = ride.estimatedFare;
    ride.status = RideStatus.COMPLETED;
    ride.completedAt = new Date();
    
    const savedRide = await this.rideRepository.save(ride);

    // Update driver's wallet and trip count
    const driver = await this.driverRepository.findOne({ where: { id: driverId } });
    if (driver) {
      driver.walletBalance = Number(driver.walletBalance || 0) + Number(ride.finalFare || 0);
      driver.totalCompletedRides = (driver.totalCompletedRides || 0) + 1;
      await this.driverRepository.save(driver);
      console.log(`💰 Updated Driver ${driverId} wallet: +₦${ride.finalFare}. New balance: ₦${driver.walletBalance}`);
    }

    return savedRide;
  }

  async cancelRide(rideId: string, cancelDto: CancelRideDto, userId?: string, driverId?: string): Promise<Ride> {
    const ride = await this.findOne(rideId);
    if (ride.status === RideStatus.COMPLETED) throw new BadRequestException('Completed');
    if (userId && (ride.userId !== userId || ride.status === RideStatus.IN_PROGRESS)) throw new ForbiddenException('Denied');
    if (driverId && (ride.driverId !== driverId || !cancelDto.cancellationReason)) throw new ForbiddenException('Denied');
    ride.status = RideStatus.CANCELLED;
    ride.cancellationReason = cancelDto.cancellationReason || 'Cancelled by user';
    return await this.rideRepository.save(ride);
  }

  private calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371;
    const dLat = this.degreesToRadians(lat2 - lat1);
    const dLon = this.degreesToRadians(lon2 - lon1);
    const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(this.degreesToRadians(lat1)) * Math.cos(this.degreesToRadians(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return Math.round(R * c * 100) / 100;
  }

  /**
   * Calculate fare based on category
   * 
   * Pricing Rules:
   * - PRIVATE: 500 base + 100/km
   * - SHARED: 250 base + 50/km (50% of Private)
   * - OKADA: 300 base + 70/km
   */
  private calculateFare(distance: number, category: RideCategory): number {
    let base = 500;
    let perKm = 100;

    switch (category) {
      case RideCategory.SHARED:
        base = 250;
        perKm = 50;
        break;
      case RideCategory.OKADA:
        base = 300;
        perKm = 70;
        break;
      case RideCategory.PRIVATE:
      default:
        base = 500;
        perKm = 100;
        break;
    }

    return Math.round((base + distance * perKm) * 100) / 100;
  }

  private degreesToRadians(degrees: number): number {
    return degrees * (Math.PI / 180);
  }
}
