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
