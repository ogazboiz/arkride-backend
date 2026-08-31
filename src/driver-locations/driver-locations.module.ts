import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DriverLocationsService } from './driver-locations.service';
import { DriverLocationsController } from './driver-locations.controller';
import { DriverLocation } from './entities/driver-location.entity';
import { Driver } from '../drivers/entities/driver.entity';

/**
 * DriverLocationsModule
 * 
 * Purpose: Bundle all driver location functionality together
 * 
 * What this module does:
 * 1. Registers DriverLocation and Driver entities with TypeORM
 * 2. Makes DriverLocationsService available
 * 3. Creates HTTP endpoints via DriverLocationsController
 * 4. Exports service so other modules can use it
 * 
 * How NestJS modules work:
 * - imports: Other modules we depend on (TypeORM)
 * - controllers: HTTP route handlers
 * - providers: Services (business logic)
 * - exports: Services other modules can use
 * 
 * TypeOrmModule.forFeature([...]):
 * This tells TypeORM: "These entities belong to this module"
 * It creates repositories for DriverLocation and Driver
 * We can then inject these repositories into the service
 */
@Module({
  imports: [
    /**
     * Register entities with TypeORM
     * 
     * We still keep Driver entity here to verify driver status in the DB
     * DriverLocation entity is kept for schema generation but the service
     * now primarily uses Redis for real-time tracking.
     */
    TypeOrmModule.forFeature([DriverLocation, Driver]),
  ],

  /**
   * Controllers handle HTTP requests
   * 
   * DriverLocationsController creates these routes:
   * - POST /api/v1/driver-locations
   * - GET /api/v1/driver-locations/driver/:driverId
   * - GET /api/v1/driver-locations/nearby
   */
  controllers: [DriverLocationsController],

  /**
   * Providers are services (business logic)
   * 
   * DriverLocationsService contains:
   * - updateLocation()
   * - findByDriverId()
   * - findNearbyDrivers()
   * - calculateDistance()
   */
  providers: [DriverLocationsService],

  /**
   * Export service so other modules can use it
   * 
   * Example usage in RidesModule:
   * 
   * import { DriverLocationsService } from '../driver-locations/...';
   * 
   * async createRide(dto) {
   *   // Find nearby drivers
   *   const nearbyDrivers = await this.driverLocationsService
   *     .findNearbyDrivers(dto.pickup.lat, dto.pickup.lng, 50);
   *   
   *   // Send notification to nearby drivers
   *   await this.notifyDrivers(nearbyDrivers);
   * }
   */
  exports: [DriverLocationsService],
})
export class DriverLocationsModule {}
