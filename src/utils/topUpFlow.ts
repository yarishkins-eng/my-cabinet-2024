import type { PaymentMethod } from '../types';

/**
 * Keep the first top-up step focused: with one available provider there is
 * nothing for the customer to choose, so open its amount screen directly.
 */
export function getTopUpDestination(paymentMethods?: PaymentMethod[]): string | null {
  const availableMethods = paymentMethods?.filter((method) => method.is_available) ?? [];

  if (availableMethods.length === 0) return null;
  if (availableMethods.length === 1) {
    return `/balance/top-up/${encodeURIComponent(availableMethods[0].id)}`;
  }

  return '/balance/top-up';
}
