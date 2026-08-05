import { describe, expect, it } from 'vitest';
import {
  clearCreateIntentKeys,
  getOrCreateIntentKey,
  intentStorageKey,
  payIntentName,
  type IntentStorage,
} from './deviceFirstIdempotency';

class MemoryStorage implements IntentStorage {
  values = new Map<string, string>();
  getItem(name: string) {
    return this.values.get(name) ?? null;
  }
  setItem(name: string, value: string) {
    this.values.set(name, value);
  }
  removeItem(name: string) {
    this.values.delete(name);
  }
  get length() {
    return this.values.size;
  }
  key(index: number) {
    return [...this.values.keys()][index] ?? null;
  }
}

describe('device-first intent idempotency', () => {
  it('reuses the same key until the canonical response clears it', () => {
    const storage = new MemoryStorage();
    let sequence = 0;
    const create = () => `key-${++sequence}`;

    expect(getOrCreateIntentKey(storage, 'confirm:42', create)).toBe('key-1');
    expect(getOrCreateIntentKey(storage, 'confirm:42', create)).toBe('key-1');

    storage.removeItem(intentStorageKey('confirm:42'));
    expect(getOrCreateIntentKey(storage, 'confirm:42', create)).toBe('key-2');
  });

  it('keeps separate keys for distinct user intents', () => {
    const storage = new MemoryStorage();
    expect(getOrCreateIntentKey(storage, 'arm:1', () => 'arm-key')).toBe('arm-key');
    expect(getOrCreateIntentKey(storage, 'cancel:1', () => 'cancel-key')).toBe('cancel-key');
  });

  it('forgets only create keys when an owner deliberately starts a new quote', () => {
    const storage = new MemoryStorage();
    storage.setItem(intentStorageKey('create:30:2'), 'old-create');
    storage.setItem(intentStorageKey('create:365:4'), 'other-create');
    storage.setItem(intentStorageKey('confirm:checkout-1'), 'confirm-key');
    storage.setItem(intentStorageKey('payment:checkout-1:sbp'), 'payment-key');

    clearCreateIntentKeys(storage);

    expect(storage.getItem(intentStorageKey('create:30:2'))).toBeNull();
    expect(storage.getItem(intentStorageKey('create:365:4'))).toBeNull();
    expect(storage.getItem(intentStorageKey('confirm:checkout-1'))).toBe('confirm-key');
    expect(storage.getItem(intentStorageKey('payment:checkout-1:sbp'))).toBe('payment-key');
  });

  it('embeds the optimistic price in the pay intent so a reprice becomes a new intent', () => {
    const base = {
      period_days: 30,
      selected_device_limit: 2,
      funding_mode: 'platega' as const,
      method_key: 'sbp',
      expected_tariff_total_kopeks: 45000,
    };

    expect(payIntentName(base)).toBe('pay:30:2:platega:sbp:45000');
    // After reprice_required the same selection with the refreshed price is a
    // different intent, hence a different idempotency key: the retry can never
    // hit a stored request-hash conflict.
    expect(payIntentName({ ...base, expected_tariff_total_kopeks: 46000 })).not.toBe(
      payIntentName(base),
    );
    expect(payIntentName({ ...base, funding_mode: 'wallet' as const, method_key: null })).toBe(
      'pay:30:2:wallet::45000',
    );
    expect(payIntentName({ ...base, method_key: 'cards_ru' })).not.toBe(payIntentName(base));
    expect(payIntentName({ ...base, selected_device_limit: 4 })).not.toBe(payIntentName(base));
    expect(payIntentName(base).length).toBeLessThanOrEqual(128);
  });

  it('keeps one stored key per pay intent and forgets it on demand', () => {
    const storage = new MemoryStorage();
    let sequence = 0;
    const create = () => `key-${++sequence}`;
    const intent = payIntentName({
      period_days: 30,
      selected_device_limit: 2,
      funding_mode: 'wallet',
      method_key: null,
      expected_tariff_total_kopeks: 45000,
    });

    expect(getOrCreateIntentKey(storage, intent, create)).toBe('key-1');
    expect(getOrCreateIntentKey(storage, intent, create)).toBe('key-1');

    storage.removeItem(intentStorageKey(intent));
    expect(getOrCreateIntentKey(storage, intent, create)).toBe('key-2');
  });
});
