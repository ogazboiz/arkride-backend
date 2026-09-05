import { parseAdminEmails } from './admin-bootstrap.service';

describe('parseAdminEmails', () => {
  it('splits and trims a comma-separated list', () => {
    expect(parseAdminEmails('a@x.com, b@y.com')).toEqual([
      'a@x.com',
      'b@y.com',
    ]);
  });

  it('lower-cases, so a capitalised entry still matches', () => {
    // Email comparison is case-insensitive in practice, and an entry that
    // silently fails to match is a miserable thing to debug.
    expect(parseAdminEmails('Ops@Arkride.COM')).toEqual(['ops@arkride.com']);
  });

  it('drops entries that are not emails', () => {
    expect(parseAdminEmails('a@x.com,,   ,notanemail')).toEqual(['a@x.com']);
  });

  it('returns nothing when unset', () => {
    expect(parseAdminEmails(undefined)).toEqual([]);
    expect(parseAdminEmails('')).toEqual([]);
  });
});
