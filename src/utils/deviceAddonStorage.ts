const PREFIX = 'device_addon_v1';
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

export interface DeviceAddonRetryPayload {
  user_id: number;
  intent_id?: string;
  subscription_id: number;
  devices_to_add: number;
  quote_token?: string;
  idempotency_key: string;
  expected_amount_kopeks?: number;
  payment_method?: 'platega';
  payment_option?: string;
  created_at: number;
}

export class DeviceAddonStorageUnavailableError extends Error {
  constructor() {
    super('Device add-on recovery storage is unavailable');
  }
}

export class DeviceAddonPendingRetryError extends Error {
  constructor() {
    super('A different unresolved device add-on request already exists');
  }
}

function key(kind: 'intent' | 'topup', userId: number, scope: string) {
  return `${PREFIX}:${kind}:${userId}:${scope}`;
}

function makeIdempotencyKey() {
  if (typeof crypto?.randomUUID === 'function') return crypto.randomUUID();
  return `${Date.now()}-${Math.random()}`;
}

function parse(raw: string | null): DeviceAddonRetryPayload | null {
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object') return null;
    const row = value as Record<string, unknown>;
    if (
      typeof row.user_id !== 'number' ||
      typeof row.subscription_id !== 'number' ||
      typeof row.devices_to_add !== 'number' ||
      typeof row.idempotency_key !== 'string' ||
      typeof row.created_at !== 'number' ||
      Date.now() - row.created_at > MAX_AGE_MS
    ) {
      return null;
    }
    return row as unknown as DeviceAddonRetryPayload;
  } catch {
    return null;
  }
}

function read(storageKey: string, userId: number): DeviceAddonRetryPayload | null {
  try {
    const value = parse(localStorage.getItem(storageKey));
    if (!value || value.user_id !== userId) return null;
    return value;
  } catch {
    throw new DeviceAddonStorageUnavailableError();
  }
}

function write(storageKey: string, payload: DeviceAddonRetryPayload): DeviceAddonRetryPayload {
  try {
    localStorage.setItem(storageKey, JSON.stringify(payload));
    return payload;
  } catch {
    throw new DeviceAddonStorageUnavailableError();
  }
}

export function getOrCreateIntentRetry(
  userId: number,
  subscriptionId: number,
  devicesToAdd: number,
  quoteToken: string,
): DeviceAddonRetryPayload {
  const storageKey = key('intent', userId, String(subscriptionId));
  const existing = read(storageKey, userId);
  if (existing) {
    if (existing.subscription_id === subscriptionId && existing.devices_to_add === devicesToAdd) {
      return existing;
    }
    throw new DeviceAddonPendingRetryError();
  }
  return write(storageKey, {
    user_id: userId,
    subscription_id: subscriptionId,
    devices_to_add: devicesToAdd,
    quote_token: quoteToken,
    idempotency_key: makeIdempotencyKey(),
    created_at: Date.now(),
  });
}

export function getIntentRetry(
  userId: number,
  subscriptionId: number,
): DeviceAddonRetryPayload | null {
  const value = read(key('intent', userId, String(subscriptionId)), userId);
  return value?.subscription_id === subscriptionId ? value : null;
}

/**
 * Once the server has accepted the intent POST, retain its public id beside the
 * original idempotency key. A later lost top-up response can then resume the
 * exact intent instead of creating a second one from the entry route.
 */
export function bindIntentRetry(
  userId: number,
  subscriptionId: number,
  intentId: string,
): DeviceAddonRetryPayload {
  const storageKey = key('intent', userId, String(subscriptionId));
  const existing = read(storageKey, userId);
  if (!existing || existing.subscription_id !== subscriptionId) {
    throw new DeviceAddonStorageUnavailableError();
  }
  return write(storageKey, { ...existing, intent_id: intentId });
}

export function clearIntentRetry(userId: number, subscriptionId: number) {
  try {
    localStorage.removeItem(key('intent', userId, String(subscriptionId)));
  } catch {
    // The durable intent is already available by its server route. Never make a
    // completed server action look failed because browser cleanup was refused.
  }
}

/**
 * Remove a bound retry whose durable intent has definitively disappeared.
 * The owned intent route does not carry its subscription id, so recovery must
 * resolve that scope from the exact user-bound local record before returning
 * to the quote screen.
 */
export function clearMissingIntentRetry(
  userId: number,
  intentId: string,
): DeviceAddonRetryPayload | null {
  const prefix = `${PREFIX}:intent:${userId}:`;
  try {
    for (let index = 0; index < localStorage.length; index += 1) {
      const storageKey = localStorage.key(index);
      if (!storageKey?.startsWith(prefix)) continue;
      const value = read(storageKey, userId);
      if (value?.intent_id !== intentId) continue;
      localStorage.removeItem(storageKey);
      return value;
    }
  } catch {
    return null;
  }
  return null;
}

export function getOrCreateTopupRetry(
  userId: number,
  intentId: string,
  immutable: Pick<
    DeviceAddonRetryPayload,
    | 'subscription_id'
    | 'devices_to_add'
    | 'expected_amount_kopeks'
    | 'payment_method'
    | 'payment_option'
  >,
): DeviceAddonRetryPayload {
  const storageKey = key('topup', userId, intentId);
  const existing = read(storageKey, userId);
  if (existing) return existing;
  return write(storageKey, {
    user_id: userId,
    intent_id: intentId,
    idempotency_key: makeIdempotencyKey(),
    created_at: Date.now(),
    ...immutable,
  });
}

export function clearTopupRetry(userId: number, intentId: string) {
  try {
    localStorage.removeItem(key('topup', userId, intentId));
  } catch {
    // See clearIntentRetry: the durable server state remains authoritative.
  }
}
