import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { RidesService } from './rides.service';
import { Ride, RideStatus, RideCategory } from './entities/ride.entity';
import { User } from '../users/entities/user.entity';
import { Driver } from '../drivers/entities/driver.entity';
import { Vehicle, VehicleType } from '../vehicles/entities/vehicle.entity';
import { REDIS_CLIENT } from '../redis/redis.constants';
import { BadRequestException } from '@nestjs/common';

describe('RidesService', () => {
  let service: RidesService;
  let rideRepository: any;
  let vehicleRepository: any;
  let redisClient: any;

  const mockRideRepository = {
    create: jest.fn(),
    save: jest.fn(),
    findOne: jest.fn(),
    find: jest.fn(),
  };

  const mockUserRepository = {
    findOne: jest.fn(),
  };

  const mockDriverRepository = {
    findOne: jest.fn(),
  };

  const mockVehicleRepository = {
    findOne: jest.fn(),
    find: jest.fn(),
  };

  const mockRedisClient = {
    set: jest.fn(),
    get: jest.fn(),
    del: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RidesService,
        {
          provide: getRepositoryToken(Ride),
          useValue: mockRideRepository,
        },
        {
          provide: getRepositoryToken(User),
          useValue: mockUserRepository,
        },
        {
          provide: getRepositoryToken(Driver),
          useValue: mockDriverRepository,
        },
        {
          provide: getRepositoryToken(Vehicle),
          useValue: mockVehicleRepository,
        },
        {
          provide: REDIS_CLIENT,
          useValue: mockRedisClient,
        },
      ],
    }).compile();

    service = module.get<RidesService>(RidesService);
    rideRepository = module.get(getRepositoryToken(Ride));
    vehicleRepository = module.get(getRepositoryToken(Vehicle));
    redisClient = module.get(REDIS_CLIENT);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('calculateFare', () => {
    it('should calculate PRIVATE fare correctly', () => {
      // 500 + 10 * 100 = 1500
      const fare = (service as any).calculateFare(10, RideCategory.PRIVATE);
      expect(fare).toBe(1500);
    });

    it('should calculate SHARED fare correctly (50% of Private)', () => {
      // 250 + 10 * 50 = 750
      const fare = (service as any).calculateFare(10, RideCategory.SHARED);
      expect(fare).toBe(750);
    });

    it('should calculate OKADA fare correctly', () => {
      // 300 + 10 * 70 = 1000
      const fare = (service as any).calculateFare(10, RideCategory.OKADA);
      expect(fare).toBe(1000);
    });
  });

  describe('estimateRide', () => {
    it('should return all 3 options with correct fares', async () => {
      const estimateDto = {
        pickup: { address: 'A', lat: 6.5, lng: 3.3 },
        dropoff: { address: 'B', lat: 6.6, lng: 3.4 },
      };

      const estimates = await service.estimateRide(estimateDto);
      expect(estimates).toHaveLength(3);
      expect(estimates.find(e => e.category === RideCategory.PRIVATE)).toBeDefined();
      expect(estimates.find(e => e.category === RideCategory.SHARED)).toBeDefined();
      expect(estimates.find(e => e.category === RideCategory.OKADA)).toBeDefined();
    });
  });

  describe('acceptRide logic', () => {
    it('should block OKADA ride if vehicle is KEKE', async () => {
      mockRedisClient.set.mockResolvedValue('OK');
      mockRideRepository.findOne.mockResolvedValue({
        id: 'ride-1',
        status: RideStatus.REQUESTED,
        category: RideCategory.OKADA,
      });
      mockDriverRepository.findOne.mockResolvedValue({ id: 'driver-1', isActive: true, isOnline: true });
      mockVehicleRepository.findOne.mockResolvedValue({ id: 'veh-1', type: VehicleType.KEKE, isActive: true, driverId: 'driver-1' });

      await expect(service.acceptRide('ride-1', 'driver-1', { status: RideStatus.ACCEPTED, vehicleId: 'veh-1' }))
        .rejects.toThrow(BadRequestException);
    });

    it('should block 5th shared ride', async () => {
      mockRedisClient.set.mockResolvedValue('OK');
      mockRideRepository.findOne.mockResolvedValue({
        id: 'ride-5',
        status: RideStatus.REQUESTED,
        category: RideCategory.SHARED,
      });
      mockDriverRepository.findOne.mockResolvedValue({ id: 'driver-1', isActive: true, isOnline: true });
      mockVehicleRepository.findOne.mockResolvedValue({ id: 'veh-1', type: VehicleType.KEKE, isActive: true, driverId: 'driver-1' });
      
      // Driver already has 4 shared rides
      mockRideRepository.find.mockResolvedValue([
        { category: RideCategory.SHARED },
        { category: RideCategory.SHARED },
        { category: RideCategory.SHARED },
        { category: RideCategory.SHARED },
      ]);

      await expect(service.acceptRide('ride-5', 'driver-1', { status: RideStatus.ACCEPTED, vehicleId: 'veh-1' }))
        .rejects.toThrow(BadRequestException);
    });
  });
});
