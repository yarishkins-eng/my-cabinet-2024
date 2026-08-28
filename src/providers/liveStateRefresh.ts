import type { QueryClient } from '@tanstack/react-query';

export const LIVE_STATE_QUERY_KEYS = [
  ['subscription'],
  ['subscriptions-list'],
  ['balance'],
  ['purchase-options'],
  ['device-first-open-checkout'],
  // 🔴 Скидка клиента. Это ОСНОВНОЙ путь обновления для мини-приложения, живущего в вебвью
  // часами: возврат вкладки из фона и переподключение сокета. Жест «потянуть вниз» чинили
  // отдельно, а сюда забыли — нашёл критик полноты волны 2. Без этих двух сгоревшее
  // предложение продолжает предлагаться, а забранная скидка не появляется.
  ['promo-offers'],
  ['active-discount'],
] as const;

/**
 * WebSocket events are best-effort. When a tab comes back from the background
 * or its socket reconnects, fetch authoritative state instead of assuming an
 * event replay. This is a read-only refresh; it never retries a payment.
 */
export function invalidateLiveStateQueries(
  queryClient: Pick<QueryClient, 'invalidateQueries'>,
): void {
  for (const queryKey of LIVE_STATE_QUERY_KEYS) {
    void queryClient.invalidateQueries({ queryKey: [...queryKey] });
  }
}
