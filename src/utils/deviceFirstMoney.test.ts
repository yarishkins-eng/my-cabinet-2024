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

  // 🔴 ПЕРЕПИСАН 25.08.2026 (этап AR). Прежний сторож назывался «отмену объявила сама Platega —
  // ссылка мертва, предупреждать не о чем» и требовал `toBeNull()`. Название кодировало НЕВЕРНЫЙ
  // факт: ссылка не мертва. Бот в этой же ветке предупреждает «не платите по ней»
  // (`bot-code/app/handlers/subscription/device_first.py`, ветка `provider_terminal`), а в боте
  // есть работающая ветка возврата поздних денег на баланс — то есть по таким ссылкам платят.
  // Прежний сторож закреплял молчание, стоившее нам 22 покупателей из 31 отменённого заказа.
  it('счёт закрыл провайдер — предупреждаем про живую ссылку', () => {
    expect(closedCartCopy('provider_terminal:canceled', 'unknown')).toEqual({
      titleKey: 'deviceFirst.providerClosedTitle',
      textKey: 'deviceFirst.providerClosedText',
    });
  });

  // 🔴 Главный сторож этапа. `unknown` — ЕДИНСТВЕННОЕ, что сервер отвечает на эту причину:
  // `provider_terminal:*` не входит в `_NO_MONEY_TERMINAL_REASONS`, а замер боевой базы
  // 25.08.2026 дал `unknown` у всех 22 таких заказов. Ветка, написанная в домашнем стиле
  // («гард по `no_money`»), вернула бы `null` на боевом ВСЕГДА — правка была бы, эффекта нет.
  // Поэтому проверяем ВСЕ значения поля: ветка обязана говорить независимо от него.
  it.each([undefined, null, 'unknown', 'no_money', 'money_in_flight'])(
    'говорит про закрытый счёт при money_state=%s — денежного гейта тут быть не должно',
    (state) => {
      expect(closedCartCopy('provider_terminal:canceled', state)).toEqual({
        titleKey: 'deviceFirst.providerClosedTitle',
        textKey: 'deviceFirst.providerClosedText',
      });
    },
  );

  // 🔴 Двоеточие в `provider_terminal:` несущее. `post_paid_provider_terminal:*` — ДРУГАЯ причина
  // (платёж был и отозван), `provider_terminal_identity_mismatch` и
  // `provider_terminal_status_regressed` — это `operator_review`, где деньги могут быть удержаны.
  // Поиск через `includes` вместо `startsWith` увёл бы их всех в текст «мы ничего не списывали».
  it.each([
    'post_paid_provider_terminal:canceled',
    'provider_terminal_identity_mismatch',
    'provider_terminal_status_regressed',
  ])('причина %s НЕ считается закрытием счёта провайдером', (reason) => {
    expect(closedCartCopy(reason, 'unknown')).toBeNull();
  });

  it('на остальные причины экран по-прежнему молчит и берёт свой обычный текст', () => {
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

describe('closedCartCopy — заказ закрыл оператор (пункт 4.4)', () => {
  it('заплатившему клиенту НЕ говорим «деньги не списаны»', () => {
    // 🔴 Главный сторож этой ветки. Без неё экран уходил в резервный текст
    // `deviceFirst.refreshText` — «Данные подписки или цена изменились. Создайте новый
    // расчёт — деньги без подтверждения не списаны». Обе половины ложны, и вторая
    // ложна тому, у кого деньги как раз удержаны.
    const copy = closedCartCopy('cancelled_by_operator_review', 'money_in_flight');
    expect(copy).not.toBeNull();
    expect(copy?.textKey).toBe('deviceFirst.operatorClosedMoneyText');
    expect(copy?.titleKey).toBe('deviceFirst.operatorClosedTitle');
  });

  it('когда денег не было — говорим об этом прямо', () => {
    expect(closedCartCopy('cancelled_by_operator_review', 'no_money')).toEqual({
      titleKey: 'deviceFirst.operatorClosedTitle',
      textKey: 'deviceFirst.operatorClosedNoMoneyText',
    });
  });

  it('при неизвестном исходе про деньги ничего не утверждаем', () => {
    // `unknown` и отсутствие поля обязаны вести в осторожный текст, а не в «не списаны».
    for (const state of ['unknown', undefined, null] as const) {
      expect(closedCartCopy('cancelled_by_operator_review', state)?.textKey).toBe(
        'deviceFirst.operatorClosedMoneyText',
      );
    }
  });
});
