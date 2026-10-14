import { describe, expect, it } from 'vitest';
import { formatCheckoutMoney, personalDiscount } from './checkoutDiscount';

const offer = (percent: number) => ({
  discount_percent: percent,
  source: 'trial_discount',
  expires_at: null,
});

describe('AP-4 exact RUB receipt formatter', () => {
  it.each([
    [13450, '134,50 ₽'],
    [-1505, '−15,05 ₽'],
    [0, '0 ₽'],
  ])('kopeks %s render as %s', (amount, expected) => {
    expect(formatCheckoutMoney(amount as number)).toBe(expected);
  });
});

describe('AP-4 exact personal discount metadata', () => {
  // Fixed outcomes are from the server's quote examples, not recomputed by a test copy of the helper.
  it.each([
    ['legacy ten percent with whole-RUB floor', 13400, 1500, 10, 14900],
    ['group then personal; group is already excluded from subtotal', 12700, 1455, 10, 14155],
    ['multiple devices and prorated kopeks', 26000, 2911, 10, 28911],
    ['legacy percent above the new campaign ceiling', 10200, 4700, 31, 14900],
    ['legacy ninety-nine percent with minimum-one-RUB floor', 100, 14800, 99, 14900],
    ['small quote without the RUB floor', 75, 24, 25, 99],
    ['floor amount is not the nominal ratio', 100, 50, 10, 150],
  ])('%s', (_label, net, amount, percent, before) => {
    expect(personalDiscount(net as number, amount as number, offer(percent as number))).toEqual({
      before,
      amount,
      percent,
    });
  });

  it.each([undefined, null])('retains exact money when the offer is %s', (metadata) => {
    expect(personalDiscount(13400, 1500, metadata)).toEqual({
      before: 14900,
      amount: 1500,
      percent: null,
    });
  });

  it.each([0, -1, 100, 101, 10.5, Number.NaN, Number.POSITIVE_INFINITY, 30])(
    'does not invent a nominal percentage from invalid or mismatched %s',
    (percent) => {
      expect(personalDiscount(13400, 1500, offer(percent))).toEqual({
        before: 14900,
        amount: 1500,
        percent: null,
      });
    },
  );

  it('uses applied metadata even after its deadline; a receipt is a historical fact', () => {
    expect(
      personalDiscount(13400, 1500, { ...offer(10), expires_at: '2000-01-01T00:00:00Z' }),
    ).toEqual({ before: 14900, amount: 1500, percent: 10 });
  });

  it('rejects a fractional nominal even when its floor would exactly reproduce the quote', () => {
    expect(personalDiscount(13300, 1600, offer(10.5))).toEqual({
      before: 14900,
      amount: 1600,
      percent: null,
    });
  });

  it('does not attach a matching percent when the server minimum would give a different net', () => {
    expect(personalDiscount(75, 25, offer(25))).toEqual({ before: 100, amount: 25, percent: null });
  });

  it('keeps valid exact money but refuses unsafe nominal multiplication', () => {
    const net = Number.MAX_SAFE_INTEGER - 1;
    expect(personalDiscount(net, 1, offer(10))).toEqual({
      before: Number.MAX_SAFE_INTEGER,
      amount: 1,
      percent: null,
    });
  });

  it.each([
    [0, 1500],
    [-1, 1500],
    [Number.NaN, 1500],
    [Number.POSITIVE_INFINITY, 1500],
    [13400.5, 1500],
    [Number.MAX_SAFE_INTEGER + 1, 1500],
    [null, 1500],
    [undefined, 1500],
    [13400, 0],
    [13400, -1],
    [13400, Number.NaN],
    [13400, Number.POSITIVE_INFINITY],
    [13400, 1500.5],
    [13400, undefined],
    [13400, Number.MAX_SAFE_INTEGER + 1],
    [Number.MAX_SAFE_INTEGER, 1],
  ])('returns no personal discount for unusable net=%s amount=%s', (net, amount) => {
    expect(personalDiscount(net, amount, offer(10))).toBeNull();
  });
});
