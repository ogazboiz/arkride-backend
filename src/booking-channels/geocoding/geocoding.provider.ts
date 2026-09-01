import { Injectable, Logger } from '@nestjs/common';
import { Location } from '../../rides/entities/ride.entity';

export const GEOCODING_PROVIDER = 'GEOCODING_PROVIDER';

/**
 * Turns a place name into coordinates.
 */
export interface GeocodingProvider {
  geocode(placeName: string): Promise<Location | null>;
}

/**
 * LandmarkGeocodingProvider
 *
 * ⚠️  SCOPE BOUNDARY — READ BEFORE RELYING ON THIS.
 *
 * There is no real geocoding integration anywhere in this codebase, and ride
 * creation needs actual coordinates. This is a seeded lookup table of a handful
 * of landmarks so the chat and voice flows are demonstrable end to end. It will
 * return null for anywhere not on this list.
 *
 * The supported path for production is for the CALLER to send resolved
 * coordinates (a WhatsApp location pin, or an IVR "pick a saved address" menu),
 * which the booking service prefers over this whenever they are present.
 * Wiring a real Maps/Mapbox client here is a separate piece of work.
 */
@Injectable()
export class LandmarkGeocodingProvider implements GeocodingProvider {
  private readonly logger = new Logger(LandmarkGeocodingProvider.name);

  private readonly landmarks: Record<string, Location> = {
    futa: {
      address: 'Federal University of Technology, Akure',
      lat: 7.3008,
      lng: 5.1352,
    },
    'market square': {
      address: 'Market Square, Akure',
      lat: 7.2526,
      lng: 5.1931,
    },
    'akure airport': {
      address: 'Akure Airport, Ondo State',
      lat: 7.2467,
      lng: 5.3011,
    },
    'oja oba': { address: 'Oja Oba Market, Akure', lat: 7.2508, lng: 5.1948 },
    shoprite: { address: 'Shoprite, Akure Mall', lat: 7.2465, lng: 5.1943 },
    ikeja: { address: 'Ikeja, Lagos', lat: 6.6018, lng: 3.3515 },
  };

  async geocode(placeName: string): Promise<Location | null> {
    const needle = (placeName || '').toLowerCase().trim();

    const key = Object.keys(this.landmarks).find(
      (landmark) => needle.includes(landmark) || landmark.includes(needle),
    );

    if (!key) {
      this.logger.warn(
        `No landmark match for "${placeName}" — caller must supply coordinates.`,
      );
      return null;
    }

    return this.landmarks[key];
  }
}
