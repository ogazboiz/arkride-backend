import {
  Injectable,
  Inject,
  Logger,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../users/entities/user.entity';
import { Role } from '../common/enums/role.enum';
import { RidesService } from '../rides/rides.service';
import { Location } from '../rides/entities/ride.entity';
import { ParseAndBookDto } from './dto/parse-and-book.dto';
import { RIDE_REQUEST_PARSER } from './parsers/ride-request-parser.interface';
import { GEOCODING_PROVIDER } from './geocoding/geocoding.provider';
import type { RideRequestParser } from './parsers/ride-request-parser.interface';
import type { GeocodingProvider } from './geocoding/geocoding.provider';

/**
 * BookingChannelsService
 *
 * Purpose: The omnichannel front door. A WhatsApp agent or voice IVR sends the
 * words a person actually said; this turns them into a real ride.
 *
 * The important architectural property: it does NOT book rides itself. It
 * resolves an intent and then calls RidesService.createRide() — the exact same
 * method the mobile app uses. Every fare rule, idempotency lock and validation
 * therefore applies identically no matter which channel a ride came from, and
 * there is no second booking path to keep in sync.
 */
@Injectable()
export class BookingChannelsService {
  private readonly logger = new Logger(BookingChannelsService.name);

  constructor(
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    private readonly ridesService: RidesService,
    @Inject(RIDE_REQUEST_PARSER)
    private readonly parser: RideRequestParser,
    @Inject(GEOCODING_PROVIDER)
    private readonly geocoder: GeocodingProvider,
  ) {}

  async parseAndBook(dto: ParseAndBookDto) {
    const parsed = await this.parser.parse(dto.rawText);

    // Not an error — the agent needs to go back and ask the caller something
    if (!parsed.ok) {
      return {
        status: 'clarification_needed' as const,
        message: parsed.question,
        missingFields: parsed.missingFields,
        understood: parsed.partial,
      };
    }

    // Coordinates the caller already resolved always win over our lookup
    const pickup = dto.pickup ?? (await this.resolvePlace(parsed.pickupText));
    const dropoff =
      dto.dropoff ?? (await this.resolvePlace(parsed.dropoffText));

    const unresolved: string[] = [];
    if (!pickup) unresolved.push(parsed.pickupText);
    if (!dropoff) unresolved.push(parsed.dropoffText);

    if (unresolved.length > 0) {
      return {
        status: 'clarification_needed' as const,
        message: `I could not find ${unresolved.join(' or ')}. Could you share the location, or give a nearby landmark?`,
        missingFields: [
          ...(!pickup ? ['pickup'] : []),
          ...(!dropoff ? ['dropoff'] : []),
        ],
        understood: {
          category: parsed.category,
          pickupText: parsed.pickupText,
          dropoffText: parsed.dropoffText,
        },
      };
    }

    const user = await this.resolveRider(dto.callerPhone);

    const ride = await this.ridesService.createRide({
      userId: user.id,
      pickup: pickup!,
      dropoff: dropoff!,
      category: parsed.category,
      originChannel: dto.channel,
    });

    this.logger.log(
      `💬 Booked ride ${ride.id} (${parsed.category}) from ${dto.channel} for user ${user.id}`,
    );

    return {
      status: 'booked' as const,
      message: `Your ${parsed.category} ride from ${pickup!.address} to ${dropoff!.address} has been requested.`,
      understood: {
        category: parsed.category,
        pickupText: parsed.pickupText,
        dropoffText: parsed.dropoffText,
      },
      ride,
    };
  }

  /**
   * Turn a place name into coordinates. Returns null when unknown so the
   * caller can ask, rather than booking a ride to the wrong place.
   */
  private async resolvePlace(placeName: string): Promise<Location | null> {
    return await this.geocoder.geocode(placeName);
  }

  /**
   * Find the rider behind a phone number, creating a lightweight account if
   * this is their first contact.
   *
   * A real WhatsApp number or an inbound call is itself a reasonable identity
   * signal, so the account is created unverified rather than turning a first
   * time caller away. They verify later through the normal auth flow; until
   * then isVerified stays false and every check that depends on it still applies.
   */
  private async resolveRider(callerPhone?: string): Promise<User> {
    if (!callerPhone) {
      throw new BadRequestException(
        'callerPhone is required to identify the rider on this channel',
      );
    }

    const existing = await this.userRepository.findOne({
      where: { phone: callerPhone },
    });

    if (existing) return existing;

    const created = await this.userRepository.save(
      this.userRepository.create({
        name: `Guest ${callerPhone.slice(-4)}`,
        // Placeholder address: the schema requires a unique email, and these
        // riders have not given one. Replaced when they complete signup.
        email: `${callerPhone.replace(/\D/g, '')}@guest.arkrides.local`,
        phone: callerPhone,
        password: null,
        provider: 'omnichannel',
        isVerified: false,
        role: Role.USER,
      }),
    );

    this.logger.log(
      `👤 Created guest rider ${created.id} for inbound number ending ${callerPhone.slice(-4)}`,
    );

    return created;
  }
}
