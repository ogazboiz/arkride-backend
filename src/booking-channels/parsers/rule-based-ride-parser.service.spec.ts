import { RuleBasedRideParser } from './rule-based-ride-parser.service';
import { RideCategory } from '../../rides/entities/ride.entity';

describe('RuleBasedRideParser', () => {
  let parser: RuleBasedRideParser;

  beforeEach(() => {
    parser = new RuleBasedRideParser();
  });

  it('parses the canonical booking sentence', async () => {
    const result = await parser.parse('Book a car from FUTA to Market Square');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.category).toBe(RideCategory.CAR);
      expect(result.pickupText).toBe('futa');
      expect(result.dropoffText).toBe('market square');
    }
  });

  it('distinguishes a shared keke from a whole one', async () => {
    const shared = await parser.parse('shared keke from FUTA to Oja Oba');
    const whole = await parser.parse('whole keke from FUTA to Oja Oba');

    expect(shared.ok && shared.category).toBe(RideCategory.SHARED);
    expect(whole.ok && whole.category).toBe(RideCategory.PRIVATE);
  });

  it('maps okada synonyms to the motorcycle category', async () => {
    for (const phrase of ['okada', 'bike', 'motorcycle']) {
      const result = await parser.parse(`${phrase} from FUTA to Shoprite`);
      expect(result.ok && result.category).toBe(RideCategory.OKADA);
    }
  });

  it('never guesses a category when none was given', async () => {
    const result = await parser.parse('from FUTA to Market Square');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.missingFields).toContain('category');
      expect(result.question).toMatch(/which ride/i);
    }
  });

  it('asks for a pickup when only a destination was given', async () => {
    const result = await parser.parse('I need a car to Market Square');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.missingFields).toEqual(['pickup']);
      expect(result.partial.category).toBe(RideCategory.CAR);
      expect(result.partial.dropoffText).toBe('market square');
    }
  });

  it('asks for everything when the message says nothing useful', async () => {
    const result = await parser.parse('Book me a ride');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.missingFields).toEqual(
        expect.arrayContaining(['category', 'pickup', 'dropoff']),
      );
    }
  });

  it('strips trailing politeness from place names', async () => {
    const result = await parser.parse('car from FUTA to Market Square please');

    expect(result.ok && result.dropoffText).toBe('market square');
  });
});
