import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtModule } from '@nestjs/jwt';
import { DriversService } from './drivers.service';
import { DriversController } from './drivers.controller';
import { Driver } from './entities/driver.entity';
import { Vehicle } from '../vehicles/entities/vehicle.entity';
import { TokenModule } from '../auth/token.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Driver, Vehicle]),
    // Drivers issue the same access + refresh sessions riders do.
    TokenModule,
    // JwtModule arrives with TokenModule — see AuthModule for why it is not
    // registered a second time here.
  ],
  controllers: [DriversController],
  providers: [DriversService],
  exports: [DriversService],
})
export class DriversModule {}
