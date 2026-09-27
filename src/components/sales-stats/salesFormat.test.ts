import { describe, expect, it } from 'vitest';

import { formatChange, formatMskRange, percentChange } from './salesFormat';

const until = (time: string) => `до ${time}`;
const NOW = '2026-09-27T08:52:45.537536Z';

describe('formatMskRange — окно в сутках по Москве', () => {
  it('prints a whole Moscow day as one date', () => {
    expect(
      formatMskRange('2026-09-25T21:00:00Z', '2026-09-26T21:00:00Z', 'ru-RU', NOW, until),
    ).toBe('26 сентября');
  });

  it('prints days of one month as a short range and marks a window that ends mid-day', () => {
    expect(
      formatMskRange('2026-07-31T21:00:00Z', '2026-08-27T08:52:00Z', 'ru-RU', NOW, until),
    ).toBe('1–27 августа до 11:52');
    // без `until` час не печатается: у текущего окна он уже стоит в «данные на»
    expect(formatMskRange('2026-08-31T21:00:00Z', '2026-09-27T08:52:00Z', 'ru-RU', NOW)).toBe(
      '1–27 сентября',
    );
  });

  it('prints a month that ends at Moscow midnight without an hour', () => {
    expect(
      formatMskRange('2026-07-31T21:00:00Z', '2026-08-31T21:00:00Z', 'ru-RU', NOW, until),
    ).toBe('1–31 августа');
  });

  it('prints a range across months with both dates', () => {
    expect(
      formatMskRange('2026-08-04T21:00:00Z', '2026-09-01T21:00:00Z', 'ru-RU', NOW, until),
    ).toBe('5 августа – 1 сентября');
  });

  it('does not go backwards on an empty window', () => {
    expect(
      formatMskRange('2026-10-01T00:00:00Z', '2026-10-01T00:00:00Z', 'ru-RU', NOW, until),
    ).toBe('1 октября');
  });

  it('prints the year when the window is not in this year or crosses New Year', () => {
    // «Свой» за прошлогодний сентябрь не должен выглядеть как этот сентябрь (ревью C1-3, C6-6)
    expect(
      formatMskRange('2025-08-31T21:00:00Z', '2025-09-30T21:00:00Z', 'ru-RU', NOW, until),
    ).toBe('1–30 сентября 2025 г.');
    expect(
      formatMskRange(
        '2026-12-24T21:00:00Z',
        '2027-01-03T21:00:00Z',
        'ru-RU',
        '2027-01-10T09:00:00Z',
        until,
      ),
    ).toBe('25 декабря 2026 г. – 3 января 2027 г.');
  });

  it('does not add «до 00:00» in Farsi, whose digits are not Latin', () => {
    const label = formatMskRange(
      '2026-09-24T21:00:00Z',
      '2026-09-25T21:00:00Z',
      'fa-IR',
      NOW,
      until,
    );
    expect(label).not.toContain('до');
  });
});

describe('percentChange — процент только там, где он честен', () => {
  it('compares with a real previous amount', () => {
    expect(percentChange(1000000, 800000, true)).toBe(25);
    expect(percentChange(400000, 800000, true)).toBe(-50);
  });

  it('gives no percent without money before or when the previous window started before the first money', () => {
    expect(percentChange(164700, 0, false)).toBeNull();
    expect(percentChange(164700, 0, true)).toBeNull();
    expect(percentChange(164700, 763399, false)).toBeNull();
    expect(percentChange(164700, null, true)).toBeNull();
  });

  it('gives no percent on a tiny base: 1 October morning is not «↑ 700 %»', () => {
    expect(percentChange(80000, 10000, true)).toBeNull();
    expect(percentChange(80000, 99999, true)).toBeNull();
    expect(percentChange(200000, 100000, true)).toBe(100);
  });

  it('prints a fall of less than half a percent as a plain zero', () => {
    const change = percentChange(1000000 - 4000, 1000000, true);
    expect(Object.is(change, 0)).toBe(true);
    expect(formatChange(change as number, 'ru-RU')).toBe('0 %');
    expect(formatChange(25, 'ru-RU')).toBe('↑ 25 %');
    expect(formatChange(-5, 'ru-RU')).toBe('↓ 5 %');
  });
});
