import { afterEach, describe, expect, it } from 'vitest';
import { formatMoscowDate } from './moscowDate';

const originalTimeZone = process.env.TZ;
afterEach(() => {
  process.env.TZ = originalTimeZone;
});

describe('AP-4 explicit Moscow display dates', () => {
  it.each(['UTC', 'America/Los_Angeles', 'Asia/Tokyo'])(
    'keeps the Moscow calendar date on a phone in %s',
    (zone) => {
      process.env.TZ = zone;
      expect(formatMoscowDate('2026-10-14T22:30:00Z', 'ru')).toBe('15 окт. 2026 (МСК)');
      expect(formatMoscowDate('2026-10-14T22:30:00Z', 'en')).toBe('Oct 15, 2026 (MSK)');
    },
  );

  it('respects a timestamp offset and shows Moscow time with custom display options', () => {
    expect(
      formatMoscowDate('2026-10-15T00:30:00+02:00', 'ru', {
        day: '2-digit',
        month: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
      }),
    ).toBe('15.10, 01:30 (МСК)');
  });

  it.each([null, undefined, '', 'not-a-date', '2026-99-99T25:70:00Z'])(
    'invalid date %s has no fabricated display deadline',
    (value) => {
      expect(formatMoscowDate(value, 'ru')).toBeNull();
    },
  );
});
