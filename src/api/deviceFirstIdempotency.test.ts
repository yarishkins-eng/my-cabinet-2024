import { describe, expect, it } from 'vitest';
import {
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
});
