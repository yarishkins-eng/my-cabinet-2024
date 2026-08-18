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

/**
 * 🔴 Пункт 4.11б. Сервер отвечает на «есть ли открытый заказ?» не пустотой, а ОШИБКОЙ 404
 * (`bot-code/app/cabinet/routes/device_first.py:396-397`). А react-query при неудачном
 * перезапросе сохраняет последний удачный ответ — поэтому после отмены заказа Главная
 * продолжала рисовать его из протухших данных. Владелец поймал это живой проверкой.
 *
 * Отличать «заказа нет» надо строго по каноническому коду, а НЕ по статусу 404:
 * - тем же 404 отвечает `get_current_cabinet_user`, и `detail` там СТРОКА, а не объект
 *   (`bot-code/app/cabinet/dependencies.py:88-92`) — такой ответ сюда попасть не должен;
 * - 404 может прийти и от прокси в момент выкладки.
 *
 * Всё остальное (обрыв связи, 5xx, таймаут) обязано пробрасываться дальше: карточка на
 * Главной — вход к живому заказу, и прятать его из-за моргнувшей сети нельзя.
 */
export function isNoOpenCheckoutError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const response = (error as { response?: { data?: { detail?: unknown } } }).response;
  const detail = response?.data?.detail;
  if (!detail || typeof detail !== 'object') return false;
  return (detail as { code?: unknown }).code === 'no_open_checkout';
}

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
