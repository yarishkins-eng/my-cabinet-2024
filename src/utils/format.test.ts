import { describe, expect, it } from 'vitest';

import { graceDays } from './format';

describe('graceDays — размер grace-бонуса = grace_until − end_date (не хардкод)', () => {
  it('2 дня при текущей настройке', () => {
    expect(graceDays('2026-06-27T10:00:00Z', '2026-06-25T10:00:00Z')).toBe(2);
  });

  it('едет за настройкой: 3 дня', () => {
    expect(graceDays('2026-06-28T10:00:00Z', '2026-06-25T10:00:00Z')).toBe(3);
  });

  it('едет за настройкой: 5 дней', () => {
    expect(graceDays('2026-06-30T00:00:00Z', '2026-06-25T00:00:00Z')).toBe(5);
  });

  it('fallback 2 при отсутствии дат (недостижимо в grace-состоянии)', () => {
    expect(graceDays(null, '2026-06-25T00:00:00Z')).toBe(2);
    expect(graceDays('2026-06-27T00:00:00Z', undefined)).toBe(2);
  });
});
