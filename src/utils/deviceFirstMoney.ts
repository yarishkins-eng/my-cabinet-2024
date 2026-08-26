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
  // Пункт 4.4. Заказ закрыл оператор кнопкой разбора. Без этой ветки экран уходил в
  // резервный текст «Данные подписки или цена изменились — деньги без подтверждения не
  // списаны»: неправда дважды, и второй раз — тому, у кого деньги как раз списали.
  // Утверждать про деньги можно только по факту от бэкенда, поэтому веток две, и обе
  // молчат о том, чего не знают: закрыть заказ оператор может и без возврата.
  if (terminalReason === 'cancelled_by_operator_review') {
    return moneyState === 'no_money'
      ? {
          titleKey: 'deviceFirst.operatorClosedTitle',
          textKey: 'deviceFirst.operatorClosedNoMoneyText',
        }
      : {
          titleKey: 'deviceFirst.operatorClosedTitle',
          textKey: 'deviceFirst.operatorClosedMoneyText',
        };
  }
  // 🔴 Мина AR. Счёт закрыл САМ провайдер — на боевом это 22 из 31 отменённого заказа, то есть
  // главный способ потерять покупателя. До этой ветки экран возвращал `null`, а человека молча
  // отматывало на выбор срока: ни слова о том, что оплата не прошла и что старая ссылка опасна.
  // ⛔ Про `money_state` здесь НЕ спрашиваем, и это не забывчивость. Ровно так же устроена
  // ботовая половина (`bot-code/app/handlers/subscription/device_first.py`, ветка
  // `provider_terminal`): там `money_state` для этой причины даже не вычисляется. Два экрана
  // про одно состояние обязаны сходиться — это требование пункта 4.2б.
  // Гард по `no_money` не сработал бы вовсе: сервер на `provider_terminal:*` отвечает `unknown`
  // (`device_first_checkout_service.py`, набор `_NO_MONEY_TERMINAL_REASONS` этой причины не
  // содержит). Замер боевой базы 25.08.2026: у всех 22 таких заказов нет ни списания, ни
  // зачисленной попытки — `unknown` во всех двадцати двух.
  // Текст при этом не утверждает про деньги НИЧЕГО: он предупреждает про живую ссылку и
  // описывает уже работающую ветку возврата поздних денег на баланс.
  if (terminalReason?.startsWith('provider_terminal:')) {
    return {
      titleKey: 'deviceFirst.providerClosedTitle',
      textKey: 'deviceFirst.providerClosedText',
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
