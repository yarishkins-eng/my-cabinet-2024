import { describe, expect, it } from 'vitest';
import { closedCartCopy, operatorReviewCopy } from './deviceFirstMoney';

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

describe('closedCartCopy — мина F', () => {
  it('закрытая брошенная корзина получает предупреждение про живую ссылку', () => {
    expect(closedCartCopy('cancelled_by_user_after_invoice', 'no_money')).toEqual({
      titleKey: 'deviceFirst.abandonedCartTitle',
      textKey: 'deviceFirst.abandonedCartText',
    });
  });

  it('без поля от бэкенда экран деградирует в обычный текст, а не врёт про деньги', () => {
    // Кабинет выкладывается ПЕРВЫМ, поэтому какое-то время поля не будет вовсе.
    expect(closedCartCopy('cancelled_by_user_after_invoice', undefined)).toBeNull();
    expect(closedCartCopy('cancelled_by_user_after_invoice', null)).toBeNull();
  });

  it('если деньги всё-таки пришли, «не списали» не говорится', () => {
    expect(closedCartCopy('cancelled_by_user_after_invoice', 'money_in_flight')).toBeNull();
    expect(closedCartCopy('cancelled_by_user_after_invoice', 'unknown')).toBeNull();
  });

  it('отмену объявила сама Platega — ссылка мертва, предупреждать не о чем', () => {
    expect(closedCartCopy('provider_terminal:canceled', 'no_money')).toBeNull();
    expect(closedCartCopy('checkout_expired', 'no_money')).toBeNull();
    expect(closedCartCopy(null, 'no_money')).toBeNull();
  });
});

describe('closedCartCopy — поздняя оплата закрытого заказа', () => {
  it('деньги пришли после закрытия — говорим про баланс, а не «цена изменилась»', () => {
    expect(closedCartCopy('late_paid_wallet_credit', 'money_in_flight')).toEqual({
      titleKey: 'deviceFirst.lateCreditTitle',
      textKey: 'deviceFirst.lateCreditText',
    });
  });

  it('без факта денег от бэкенда про баланс не утверждаем ничего', () => {
    expect(closedCartCopy('late_paid_wallet_credit', undefined)).toBeNull();
    expect(closedCartCopy('late_paid_wallet_credit', 'unknown')).toBeNull();
    expect(closedCartCopy('late_paid_wallet_credit', 'no_money')).toBeNull();
  });
});
