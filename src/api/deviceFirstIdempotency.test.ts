import { describe, expect, it } from 'vitest';
import {
  clearCreateIntentKeys,
  getOrCreateIntentKey,
  intentStorageKey,
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
});
