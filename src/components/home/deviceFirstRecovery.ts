/**
 * Решение о recovery-карточке незавершённого Device-First заказа на Главной.
 *
 * Разделяет два принципиально разных состояния:
 * - витринный черновик (`draft`): заказ записан при просмотре тарифов, попытки оплаты
 *   не было, денег нет. Такой черновик НЕ должен конкурировать с предложением триала —
 *   он невидим, пока показан триал, и всегда подписан честно («Незавершённый заказ»),
 *   а не «Настраиваем VPN» (настраивать ещё нечего);
 * - реальный счёт / provisioning (`awaiting_payment`, `operator_review`, `processing`):
 *   деньги или выдача уже в полёте — карточка остаётся видимой всегда.
 */

export type DeviceFirstRecoveryVariant = 'operator' | 'awaiting_payment' | 'draft' | 'processing';

export function deviceFirstRecoveryVariant(uiState: string): DeviceFirstRecoveryVariant {
  if (uiState === 'operator_review') return 'operator';
  if (uiState === 'awaiting_payment') return 'awaiting_payment';
  if (uiState === 'configuration' || uiState === 'confirmation') return 'draft';
  return 'processing';
}

/**
 * Витринный черновик прячем только тогда, когда на экране реально показано
 * предложение триала: в этой паре триал — осознанный бесплатный выбор, а черновик —
 * случайный след просмотра цен. Если триал недоступен, черновик остаётся как
 * честно подписанный путь продолжить покупку.
 */
export function shouldHideRecoveryCard(
  variant: DeviceFirstRecoveryVariant,
  trialOfferVisible: boolean,
): boolean {
  return variant === 'draft' && trialOfferVisible;
}

/**
 * Деньги или выдача уже в полёте: рядом с «проверяем оплату» нельзя показывать
 * триал-CTA — он вёл бы в тупиковый экран ожидания. Блок «нет подписки» в этих
 * состояниях гасится целиком; draft и неоплаченный счёт его не гасят (осознанный
 * выбор, который сервер явно разрешает на /trial).
 */
export function isMoneyInFlightRecovery(variant: DeviceFirstRecoveryVariant | null): boolean {
  return variant === 'processing' || variant === 'operator';
}
