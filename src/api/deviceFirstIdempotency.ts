export interface IntentStorage {
  getItem(name: string): string | null;
  setItem(name: string, value: string): void;
  removeItem(name: string): void;
}

interface IterableIntentStorage extends IntentStorage {
  readonly length: number;
  key(index: number): string | null;
}

export const intentStorageKey = (intent: string) => `device-first:intent:${intent}`;

export function clearIntentKey(storage: IntentStorage, intent: string): void {
  storage.removeItem(intentStorageKey(intent));
}

/**
 * Forget locally cached create intents only after the user deliberately starts
 * over, or after the server proves that the conflicting checkout disappeared.
 * Keeping other idempotency keys protects payment/confirmation retries.
 */
export function clearCreateIntentKeys(storage: IterableIntentStorage): void {
  const prefix = intentStorageKey('create:');
  const names: string[] = [];
  for (let index = 0; index < storage.length; index += 1) {
    const name = storage.key(index);
    if (name?.startsWith(prefix)) names.push(name);
  }
  names.forEach((name) => storage.removeItem(name));
}

/**
 * The one pay-time intent. It embeds the optimistic price token on purpose:
 * after a server `reprice_required` the same selection with the refreshed
 * price is a NEW intent (hence a new idempotency key), so the retry can never
 * collide with the stored request hash of the stale attempt. The wallet
 * funding mode has no provider method; its empty method slot keeps the shape
 * identical for both funding modes.
 */
export const payIntentName = (request: {
  period_days: number;
  selected_device_limit: number;
  funding_mode: 'wallet' | 'platega';
  method_key: string | null;
  expected_tariff_total_kopeks: number;
}): string =>
  `pay:${request.period_days}:${request.selected_device_limit}:${request.funding_mode}:${
    request.method_key ?? ''
  }:${request.expected_tariff_total_kopeks}`;

export function getOrCreateIntentKey(
  storage: IntentStorage,
  intent: string,
  create: () => string,
): string {
  const name = intentStorageKey(intent);
  const existing = storage.getItem(name);
  if (existing) return existing;
  const created = create();
  storage.setItem(name, created);
  return created;
}
