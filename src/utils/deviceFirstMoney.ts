/**
 * Что говорить клиенту про его деньги на экране разбора заказа (пункт 4.2б).
 *
 * До этого пункта все 20+ причин разбора показывали один текст — «Платёж требует ручной
 * проверки, не оплачивайте». Четыре из причин означают, что денег не было вовсе: человек
 * не заплатил по счёту, а мы утверждали обратное и запрещали ему платить.
 *
 * Решение принимает БЭКЕНД и присылает готовым (`money_state`): фронт не видит ни попыток
 * оплаты, ни списаний, и ветка «по `terminal_reason`» здесь при поздней оплате сказала бы
 * «денег не было» ровно тогда, когда деньги у нас.
 *
 * 🔴 Ни один текст не зовёт оформить заказ заново: запрет живёт в коде бота
 * (`operator_hold`), и триал закрыт тем же замком. Снимают его мина F и пункт 4.4.
 */
export type DeviceFirstMoneyState = 'no_money' | 'money_in_flight' | 'unknown';

export interface OperatorReviewCopy {
  titleKey: string;
  textKey: string;
}

export function operatorReviewCopy(moneyState: string | null | undefined): OperatorReviewCopy {
  if (moneyState === 'no_money') {
    return {
      titleKey: 'deviceFirst.reviewUnpaidTitle',
      textKey: 'deviceFirst.reviewUnpaidText',
    };
  }
  if (moneyState === 'money_in_flight') {
    return {
      titleKey: 'deviceFirst.paymentMismatchTitle',
      textKey: 'deviceFirst.paymentMismatchText',
    };
  }
  // Сюда же попадает старый бэкенд без поля: утверждать нельзя ни списание, ни его
  // отсутствие, поэтому текст не говорит про деньги ничего.
  return {
    titleKey: 'deviceFirst.reviewUnknownTitle',
    textKey: 'deviceFirst.reviewUnknownText',
  };
}

/**
 * Мина F: брошенная корзина закрывается сама, и предупреждение про живую ссылку обязано
 * переехать вместе с ней.
 *
 * Раньше такой заказ висел в разборе, где про старую ссылку предупреждали оба экрана. Теперь
 * он `cancelled`, покупка снова открыта — и человек может оформить новый заказ, пока прежняя
 * ссылка Platega ещё принимает деньги. Оплатит её — сумма один раз ляжет на баланс, а
 * подписки по тому заказу не будет.
 *
 * 🔴 Возвращаем `null`, если бэкенд не прислал `money_state` или деньги всё-таки пришли:
 * без поля (старый бэкенд, выкладка кабинета идёт первой) экран обязан деградировать в
 * нейтральный текст, а не утверждать «не списали» вслепую — это ровно ошибка пункта 4.2б.
 */
export function closedCartCopy(
  terminalReason: string | null | undefined,
  moneyState: string | null | undefined,
): OperatorReviewCopy | null {
  // Поздняя оплата закрытого заказа — единственный случай, когда деньги ЕСТЬ, и до этой
  // ветки экран показывал ему общий текст «цена изменилась, деньги не списаны»: неправда
  // сразу в двух местах, ровно тому человеку, у которого деньги только что списали.
  // Причина ставится в момент зачисления на баланс, но утверждаем это только вместе с
  // фактом денег от бэкенда, а не по одной причине.
  if (terminalReason === 'late_paid_wallet_credit' && moneyState === 'money_in_flight') {
    return {
      titleKey: 'deviceFirst.lateCreditTitle',
      textKey: 'deviceFirst.lateCreditText',
    };
  }
  if (terminalReason !== 'cancelled_by_user_after_invoice' || moneyState !== 'no_money') {
    return null;
  }
  return {
    titleKey: 'deviceFirst.abandonedCartTitle',
    textKey: 'deviceFirst.abandonedCartText',
  };
}
