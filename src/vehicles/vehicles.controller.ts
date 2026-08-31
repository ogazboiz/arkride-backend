import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { VehiclesService } from './vehicles.service';
import { CreateVehicleDto } from './dto/create-vehicle.dto';
import { UpdateVehicleDto } from './dto/update-vehicle.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import {
  ApiBearerAuth,
  ApiBody,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';

@ApiTags('Vehicles')
@Controller('api/v1/vehicles')
export class VehiclesController {
  constructor(private readonly vehiclesService: VehiclesService) {}

  @Post()
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.CREATED)
  @ApiBearerAuth('bearer')
  @ApiOperation({ summary: 'Create vehicle for a driver' })
  @ApiBody({ type: CreateVehicleDto })
  @ApiOkResponse({ description: 'Vehicle created successfully.' })
  async create(@Body() createVehicleDto: CreateVehicleDto) {
    const vehicle = await this.vehiclesService.create(createVehicleDto);
    return {
      message: 'Vehicle created successfully',
      vehicle,
    };
  }

  @Get()
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('bearer')
  @ApiOperation({ summary: 'List all vehicles' })
  @ApiOkResponse({ description: 'Vehicles fetched successfully.' })
  async findAll() {
    const vehicles = await this.vehiclesService.findAll();
    return {
      count: vehicles.length,
      vehicles,
    };
  }

  // Move specific routes BEFORE :id route
  @Get('driver/:driverId')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('bearer')
  @ApiOperation({ summary: 'List vehicles for a driver' })
  @ApiParam({ name: 'driverId', description: 'Driver UUID' })
  @ApiOkResponse({ description: 'Driver vehicles fetched successfully.' })
  async findByDriverId(@Param('driverId') driverId: string) {
    const vehicles = await this.vehiclesService.findByDriverId(driverId);
    return {
      count: vehicles.length,
      vehicles,
    };
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('bearer')
  @ApiOperation({ summary: 'Get vehicle by ID' })
  @ApiParam({ name: 'id', description: 'Vehicle UUID' })
  @ApiOkResponse({ description: 'Vehicle fetched successfully.' })
  async findOne(@Param('id') id: string) {
    return await this.vehiclesService.findOne(id);
  }

  // Move activate/deactivate routes BEFORE :id PATCH route
  @Patch(':id/deactivate')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('bearer')
  @ApiOperation({ summary: 'Deactivate a vehicle' })
  @ApiParam({ name: 'id', description: 'Vehicle UUID' })
  @ApiOkResponse({ description: 'Vehicle deactivated successfully.' })
  async deactivate(@Param('id') id: string) {
    const vehicle = await this.vehiclesService.deactivate(id);
    return {
      message: 'Vehicle deactivated successfully',
      vehicle,
    };
  }

  @Patch(':id/activate')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('bearer')
  @ApiOperation({ summary: 'Activate a vehicle' })
  @ApiParam({ name: 'id', description: 'Vehicle UUID' })
  @ApiOkResponse({ description: 'Vehicle activated successfully.' })
  async activate(@Param('id') id: string) {
    const vehicle = await this.vehiclesService.activate(id);
    return {
      message: 'Vehicle activated successfully',
      vehicle,
    };
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth('bearer')
  @ApiOperation({ summary: 'Update vehicle details' })
  @ApiParam({ name: 'id', description: 'Vehicle UUID' })
  @ApiBody({ type: UpdateVehicleDto })
  @ApiOkResponse({ description: 'Vehicle updated successfully.' })
  async update(
    @Param('id') id: string,
    @Body() updateVehicleDto: UpdateVehicleDto,
  ) {
    const vehicle = await this.vehiclesService.update(id, updateVehicleDto);
    return {
      message: 'Vehicle updated successfully',
      vehicle,
    };
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBearerAuth('bearer')
  @ApiOperation({ summary: 'Delete a vehicle' })
  @ApiParam({ name: 'id', description: 'Vehicle UUID' })
  @ApiNoContentResponse({ description: 'Vehicle deleted successfully.' })
  async remove(@Param('id') id: string) {
    await this.vehiclesService.remove(id);
    return {
        message: 'Vehicle deleted successfully'
    }
  }
}
