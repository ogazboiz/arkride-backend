import {
  Injectable,
  BadRequestException,
  NotFoundException,
  ConflictException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Vehicle } from './entities/vehicle.entity';
import { Driver } from '../drivers/entities/driver.entity';
import { CreateVehicleDto } from './dto/create-vehicle.dto';
import { UpdateVehicleDto } from './dto/update-vehicle.dto';

@Injectable()
export class VehiclesService {
  constructor(
    @InjectRepository(Vehicle)
    private readonly vehicleRepository: Repository<Vehicle>,
    @InjectRepository(Driver)
    private readonly driverRepository: Repository<Driver>,
  ) {}

  /**
   * `driverId` is REQUIRED here even though it is optional on the DTO.
   *
   * The controller resolves the real owner from the access token and passes it
   * in; typing the parameter this way makes it impossible to reach this method
   * with a client-chosen owner, or with none at all.
   */
  async create(
    createVehicleDto: CreateVehicleDto & { driverId: string },
  ): Promise<Vehicle> {
    // Check if driver exists
    const driver = await this.driverRepository.findOne({
      where: { id: createVehicleDto.driverId },
    });

    if (!driver) {
      throw new NotFoundException('Driver not found');
    }

    // Check if driver is active
    if (!driver.isActive) {
      throw new BadRequestException('Driver account is inactive');
    }

    // Check if plate number already exists
    const existingVehicle = await this.vehicleRepository.findOne({
      where: { plateNumber: createVehicleDto.plateNumber },
    });

    if (existingVehicle) {
      throw new ConflictException('Vehicle with this plate number already exists');
    }

    // Create vehicle
    const vehicle = this.vehicleRepository.create(createVehicleDto);
    const savedVehicle = await this.vehicleRepository.save(vehicle);

    // Fetch again with relation for complete response
    return this.findOne(savedVehicle.id);
  }

  async findAll(): Promise<Vehicle[]> {
    const vehicles = await this.vehicleRepository.find({
      relations: ['driver'],
      order: { createdAt: 'DESC' },
    });
    return vehicles.map((vehicle) => this.sanitizeVehicle(vehicle));
  }

  async findOne(id: string): Promise<Vehicle> {
    const vehicle = await this.vehicleRepository.findOne({
      where: { id },
      relations: ['driver'],
    });

    if (!vehicle) {
      throw new NotFoundException('Vehicle not found');
    }

    return this.sanitizeVehicle(vehicle);
  }

  async findByDriverId(driverId: string): Promise<Vehicle[]> {
    // Check if driver exists
    const driver = await this.driverRepository.findOne({
      where: { id: driverId },
    });

    if (!driver) {
      throw new NotFoundException('Driver not found');
    }

    const vehicles = await this.vehicleRepository.find({
      where: { driverId },
      relations: ['driver'],
      order: { createdAt: 'DESC' },
    });

    return vehicles.map((vehicle) => this.sanitizeVehicle(vehicle));
  }

  async update(id: string, updateVehicleDto: UpdateVehicleDto): Promise<Vehicle> {
    const vehicle = await this.vehicleRepository.findOne({
      where: { id },
      relations: ['driver'],
    });

    if (!vehicle) {
      throw new NotFoundException('Vehicle not found');
    }

    // Check if plate number is being updated and if it already exists
    if (
      updateVehicleDto.plateNumber &&
      updateVehicleDto.plateNumber !== vehicle.plateNumber
    ) {
      const existingVehicle = await this.vehicleRepository.findOne({
        where: { plateNumber: updateVehicleDto.plateNumber },
      });

      if (existingVehicle) {
        throw new ConflictException('Vehicle with this plate number already exists');
      }
    }

    // Update vehicle
    Object.assign(vehicle, updateVehicleDto);
    const updatedVehicle = await this.vehicleRepository.save(vehicle);

    return this.sanitizeVehicle(updatedVehicle);
  }

  async remove(id: string): Promise<void> {
    const vehicle = await this.vehicleRepository.findOne({ where: { id } });

    if (!vehicle) {
      throw new NotFoundException('Vehicle not found');
    }

    await this.vehicleRepository.remove(vehicle);
  }

  async deactivate(id: string): Promise<Vehicle> {
    const vehicle = await this.vehicleRepository.findOne({
      where: { id },
      relations: ['driver'],
    });

    if (!vehicle) {
      throw new NotFoundException('Vehicle not found');
    }

    vehicle.isActive = false;
    const updatedVehicle = await this.vehicleRepository.save(vehicle);
    return this.sanitizeVehicle(updatedVehicle);
  }

  async activate(id: string): Promise<Vehicle> {
    const vehicle = await this.vehicleRepository.findOne({
      where: { id },
      relations: ['driver'],
    });

    if (!vehicle) {
      throw new NotFoundException('Vehicle not found');
    }

    vehicle.isActive = true;
    const updatedVehicle = await this.vehicleRepository.save(vehicle);
    return this.sanitizeVehicle(updatedVehicle);
  }

  /**
   * Strip the driver's credential before a vehicle leaves the service.
   *
   * Returns a COPY. The previous version assigned over `vehicle.driver` in
   * place, which mutates the caller's object — and when the same managed
   * entity is reachable from two places (a ride eagerly loading
   * `vehicle.driver`, say), redacting it for one response silently redacts it
   * for the other.
   */
  private sanitizeVehicle(vehicle: Vehicle): Vehicle {
    if (!vehicle.driver) return vehicle;
    const { password, otpCode, otpExpiry, ...sanitizedDriver } = vehicle.driver;
    // The cast is deliberate and narrow: the returned object is intentionally
    // NOT a complete Driver — the three credential fields are gone, which is
    // the entire point — but the response type stays Vehicle for callers.
    return { ...vehicle, driver: sanitizedDriver as unknown as Driver };
  }
}
