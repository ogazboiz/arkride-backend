import { RideCategory } from '../../rides/entities/ride.entity';

export const RIDE_REQUEST_PARSER = 'RIDE_REQUEST_PARSER';

/**
 * A booking intent successfully extracted from free text
 */
export interface ParsedRideIntent {
  ok: true;
  category: RideCategory;
  pickupText: string;
  dropoffText: string;
  confidence: number;
}

/**
 * The parser understood the message but cannot act on it yet.
 *
 * This is a first-class result, not an error: "book me a ride" is a perfectly
 * reasonable thing for a person to say to a chat bot, and the right response is
 * a follow-up question, not a stack trace.
 */
export interface ParseAmbiguity {
  ok: false;
  reason: string;
  missingFields: string[];
  question: string;
  partial: {
    category?: RideCategory;
    pickupText?: string;
    dropoffText?: string;
  };
}

export type ParseResult = ParsedRideIntent | ParseAmbiguity;

/**
 * RideRequestParser
 *
 * Turns "Book a car from FUTA to Market Square" into a structured intent.
 *
 * Behind an interface because the rule-based implementation shipped today is a
 * deliberate placeholder — a real NLP provider can replace it without any
 * caller knowing, as long as it returns the same discriminated result.
 */
export interface RideRequestParser {
  parse(rawText: string): Promise<ParseResult>;
}
