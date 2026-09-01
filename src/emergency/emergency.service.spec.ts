import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { EmergencyService } from './emergency.service';
import { RideStatus } from '../rides/entities/ride.entity';
import { EmergencyTriggeredBy } from './entities/emergency-incident.entity';
import { RIDE_EVENTS } from '../websocket/events/ride-events.constants';
import { Role } from '../common/enums/role.enum';

describe('EmergencyService', () => {
  let service: EmergencyService;
  let incidentRepository: any;
  let rideRepository: any;
  let driverLocationsService: any;
  let webhookService: any;
  let eventEmitter: any;

  const RIDE = {
    id: 'ride-1',
    userId: 'user-1',
    driverId: 'driver-1',
    status: RideStatus.IN_PROGRESS,
    pickup: { address: 'FUTA', lat: 7.3, lng: 5.13 },
    dropoff: { address: 'Market Square', lat: 7.25, lng: 5.19 },
  };

  beforeEach(() => {
    incidentRepository = {
      create: jest.fn().mockImplementation((data) => data),
      save: jest.fn().mockImplementation(async (data) => ({
        id: 'incident-1',
        createdAt: new Date(),
        ...data,
      })),
      find: jest.fn().mockResolvedValue([]),
      findOne: jest.fn(),
    };

    rideRepository = { findOne: jest.fn().mockResolvedValue({ ...RIDE }) };

    driverLocationsService = {
      findByDriverId: jest.fn().mockResolvedValue({ latitude: 7.28, longitude: 5.16 }),
    };

    webhookService = { dispatchEmergency: jest.fn().mockResolvedValue(undefined) };
    eventEmitter = { emit: jest.fn() };

    service = new EmergencyService(
      incidentRepository,
      rideRepository,
      driverLocationsService,
      webhookService,
      eventEmitter,
    );
  });

  it('records the incident, broadcasts it, and queues the webhooks', async () => {
    const incident = await service.trigger(
      { rideId: 'ride-1' },
      'user-1',
      Role.USER,
    );

    expect(incident.id).toBe('incident-1');
    expect(incident.triggeredBy).toBe(EmergencyTriggeredBy.RIDER);
    expect(eventEmitter.emit).toHaveBeenCalledWith(
      RIDE_EVENTS.EMERGENCY_TRIGGERED,
      expect.objectContaining({ rideId: 'ride-1' }),
    );
    expect(webhookService.dispatchEmergency).toHaveBeenCalled();
  });

  it('records a driver-raised SOS as coming from the driver', async () => {
    const incident = await service.trigger(
      { rideId: 'ride-1' },
      'driver-1',
      Role.DRIVER,
    );

    expect(incident.triggeredBy).toBe(EmergencyTriggeredBy.DRIVER);
  });

  it('rejects an SOS when the ride is not in progress', async () => {
    rideRepository.findOne.mockResolvedValue({
      ...RIDE,
      status: RideStatus.ACCEPTED,
    });

    await expect(
      service.trigger({ rideId: 'ride-1' }, 'user-1', Role.USER),
    ).rejects.toThrow(BadRequestException);

    expect(webhookService.dispatchEmergency).not.toHaveBeenCalled();
  });

  it('rejects an SOS from someone not on the ride', async () => {
    await expect(
      service.trigger({ rideId: 'ride-1' }, 'stranger', Role.USER),
    ).rejects.toThrow(ForbiddenException);
  });

  it('prefers coordinates sent by the device', async () => {
    const incident = await service.trigger(
      { rideId: 'ride-1', lat: 7.4, lng: 5.2 },
      'user-1',
      Role.USER,
    );

    expect(incident.location).toEqual({ lat: 7.4, lng: 5.2 });
    expect(driverLocationsService.findByDriverId).not.toHaveBeenCalled();
  });

  it("falls back to the driver's last known position", async () => {
    const incident = await service.trigger(
      { rideId: 'ride-1' },
      'user-1',
      Role.USER,
    );

    expect(incident.location).toEqual({ lat: 7.28, lng: 5.16 });
  });

  /**
   * The whole point of the SOS path: a degraded dependency must never turn a
   * real emergency into a failed request.
   */
  it('still raises the alarm when the location lookup fails', async () => {
    driverLocationsService.findByDriverId.mockRejectedValue(
      new Error('Redis unavailable'),
    );

    const incident = await service.trigger(
      { rideId: 'ride-1' },
      'user-1',
      Role.USER,
    );

    expect(incident.id).toBe('incident-1');
    expect(incident.location).toEqual(RIDE.pickup);
    expect(webhookService.dispatchEmergency).toHaveBeenCalled();
  });
});
