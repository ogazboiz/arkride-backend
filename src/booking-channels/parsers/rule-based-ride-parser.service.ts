import { Injectable } from '@nestjs/common';
import { RideCategory } from '../../rides/entities/ride.entity';
import {
  RideRequestParser,
  ParseResult,
} from './ride-request-parser.interface';

/**
 * RuleBasedRideParser
 *
 * A deterministic parser for booking messages arriving from WhatsApp or a voice
 * transcript. No model, no vendor, no network call — just synonyms and a
 * "from X to Y" pattern.
 *
 * Deliberate design rule: a MISSING vehicle category is always an ambiguity,
 * never a default. Fares differ by a factor of four between a shared keke and a
 * car, so silently guessing would mean quoting someone a price they never asked
 * for. "keke" without a shared/whole qualifier does default to PRIVATE, which
 * is low risk because both keke fares are close and private is the common case.
 */
@Injectable()
export class RuleBasedRideParser implements RideRequestParser {
  /**
   * Longest phrases first — "shared keke" must win over the bare "keke".
   */
  private readonly categoryKeywords: Array<[string, RideCategory]> = [
    ['shared keke', RideCategory.SHARED],
    ['share keke', RideCategory.SHARED],
    ['shared ride', RideCategory.SHARED],
    ['whole keke', RideCategory.PRIVATE],
    ['private keke', RideCategory.PRIVATE],
    ['keke napep', RideCategory.PRIVATE],
    ['tricycle', RideCategory.PRIVATE],
    ['keke', RideCategory.PRIVATE],
    ['okada', RideCategory.OKADA],
    ['motorcycle', RideCategory.OKADA],
    ['motorbike', RideCategory.OKADA],
    ['bike', RideCategory.OKADA],
    ['taxi', RideCategory.CAR],
    ['cab', RideCategory.CAR],
    ['car', RideCategory.CAR],
  ];

  async parse(rawText: string): Promise<ParseResult> {
    const text = (rawText || '').toLowerCase().trim();

    const category = this.extractCategory(text);
    const { pickupText, dropoffText } = this.extractRoute(text);

    const missingFields: string[] = [];
    if (!category) missingFields.push('category');
    if (!pickupText) missingFields.push('pickup');
    if (!dropoffText) missingFields.push('dropoff');

    if (missingFields.length > 0) {
      return {
        ok: false,
        reason: `Could not determine: ${missingFields.join(', ')}`,
        missingFields,
        question: this.buildQuestion(missingFields),
        partial: {
          ...(category ? { category } : {}),
          ...(pickupText ? { pickupText } : {}),
          ...(dropoffText ? { dropoffText } : {}),
        },
      };
    }

    return {
      ok: true,
      category: category!,
      pickupText: pickupText!,
      dropoffText: dropoffText!,
      // Rule-based matching is either confident or it fails outright, so this
      // is a fixed marker rather than a real score. A model-backed parser
      // would return a meaningful value here.
      confidence: 1,
    };
  }

  private extractCategory(text: string): RideCategory | null {
    for (const [keyword, category] of this.categoryKeywords) {
      if (text.includes(keyword)) return category;
    }
    return null;
  }

  /**
   * Pull an origin and destination out of the sentence.
   *
   * Handles the two shapes people actually type:
   *   "book a car from FUTA to Market Square"
   *   "car to Market Square"                   (origin implied — current location)
   */
  private extractRoute(text: string): {
    pickupText: string | null;
    dropoffText: string | null;
  } {
    const fromTo = text.match(/\bfrom\s+(.+?)\s+to\s+(.+?)$/i);
    if (fromTo) {
      return {
        pickupText: this.clean(fromTo[1]),
        dropoffText: this.clean(fromTo[2]),
      };
    }

    // Destination only. Pickup stays null so the caller is asked for it,
    // rather than us inventing a location the rider never gave.
    const toOnly = text.match(/\bto\s+(.+?)$/i);
    if (toOnly) {
      return { pickupText: null, dropoffText: this.clean(toOnly[1]) };
    }

    return { pickupText: null, dropoffText: null };
  }

  /**
   * Trim trailing politeness and punctuation that would otherwise end up
   * inside a place name ("Market Square please" -> "Market Square").
   */
  private clean(value: string): string | null {
    const cleaned = value
      .replace(/\b(please|abeg|now|asap|thanks|thank you)\b/gi, '')
      .replace(/[.,!?]+$/g, '')
      .trim();

    return cleaned.length > 0 ? cleaned : null;
  }

  private buildQuestion(missingFields: string[]): string {
    if (missingFields.includes('category')) {
      return 'Which ride would you like — Whole Keke, Shared Keke, Okada, or Car?';
    }
    if (missingFields.includes('pickup') && missingFields.includes('dropoff')) {
      return 'Where are you starting from, and where are you going?';
    }
    if (missingFields.includes('pickup')) {
      return 'Where should the driver pick you up?';
    }
    return 'Where would you like to go?';
  }
}
