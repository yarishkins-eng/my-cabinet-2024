import { describe, expect, it } from 'vitest';
import { operatorReviewCopy } from './deviceFirstMoney';

describe('operatorReviewCopy', () => {
  it('tells an unpaid customer the truth instead of claiming a payment', () => {
    expect(operatorReviewCopy('no_money')).toEqual({
      titleKey: 'deviceFirst.reviewUnpaidTitle',
      textKey: 'deviceFirst.reviewUnpaidText',
    });
  });

  it('keeps the warning against paying twice where money really is in flight', () => {
    expect(operatorReviewCopy('money_in_flight')).toEqual({
      titleKey: 'deviceFirst.paymentMismatchTitle',
      textKey: 'deviceFirst.paymentMismatchText',
    });
  });

  // Бэкенд без пункта 4.2б поля не пришлёт вовсе. Утверждать в этот момент нельзя ни
  // списание, ни его отсутствие — иначе в окне выкладки соврём ещё раз.
  it.each([undefined, null, 'unknown', 'anything_else'])(
    'claims nothing in either direction for %s',
    (state) => {
      expect(operatorReviewCopy(state)).toEqual({
        titleKey: 'deviceFirst.reviewUnknownTitle',
        textKey: 'deviceFirst.reviewUnknownText',
      });
    },
  );
});
