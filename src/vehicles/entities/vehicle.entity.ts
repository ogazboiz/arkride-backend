import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  OneToMany,
  JoinColumn,
} from 'typeorm';
import { Driver } from '../../drivers/entities/driver.entity';
import { Ride } from '../../rides/entities/ride.entity';

export enum VehicleType {
  KEKE = 'keke',
  BIKE = 'bike',
  CAR = 'car',
  COURIER = 'courier',
}

@Entity('vehicles')
export class Vehicle {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  driverId: string;

  @ManyToOne(() => Driver, (driver) => driver.vehicles, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'driverId' })
  driver: Driver;

  @Column({
    type: 'enum',
    enum: VehicleType,
  })
  type: VehicleType;

  @Column({ unique: true })
  plateNumber: string;

  @Column()
  color: string;

  @Column()
  model: string;

  @Column({ type: 'int' })
  year: number;

  @Column({ type: 'boolean', default: true })
  isActive: boolean;

  // Relationship: One vehicle can be used for many rides
  @OneToMany(() => Ride, (ride) => ride.vehicle)
  rides: Ride[];

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
