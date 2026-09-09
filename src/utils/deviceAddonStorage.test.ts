// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from 'vitest';

import {
  bindIntentRetry,
  DeviceAddonPendingRetryError,
  getIntentRetry,
  getOrCreateIntentRetry,
  getOrCreateTopupRetry,
} from './deviceAddonStorage';

describe('device addon retry storage', () => {
  beforeEach(() => localStorage.clear());

  it('reuses an immutable intent request after a lost response', () => {
    const first = getOrCreateIntentRetry(10, 44, 3, 'quote-a');
    // The next render has a newer quote. Replacing the old token would turn a
    // lost POST response into a second intent rather than an idempotent replay.
    const retry = getOrCreateIntentRetry(10, 44, 3, 'quote-b');
    expect(retry.idempotency_key).toBe(first.idempotency_key);
    expect(retry.quote_token).toBe('quote-a');
  });

  it('does not replace an unresolved request when the person changes devices', () => {
    getOrCreateIntentRetry(10, 44, 3, 'quote-a');
    expect(() => getOrCreateIntentRetry(10, 44, 4, 'quote-b')).toThrow(
      DeviceAddonPendingRetryError,
    );
  });

  it('remembers the accepted intent so a lost top-up response can resume that owner route', () => {
    getOrCreateIntentRetry(10, 44, 3, 'quote-a');
    bindIntentRetry(10, 44, 'intent-uuid');
    expect(getIntentRetry(10, 44)?.intent_id).toBe('intent-uuid');
    expect(getIntentRetry(11, 44)).toBeNull();
  });

  it('does not let another account reuse a stored request key', () => {
    const first = getOrCreateIntentRetry(10, 44, 3, 'quote-a');
    const otherUser = getOrCreateIntentRetry(11, 44, 3, 'quote-a');
    expect(otherUser.idempotency_key).not.toBe(first.idempotency_key);
  });

  it('keeps a top-up retry immutable even when a later render supplies another amount', () => {
    const first = getOrCreateTopupRetry(10, 'intent-a', {
      subscription_id: 44,
      devices_to_add: 3,
      expected_amount_kopeks: 700,
      payment_method: 'platega',
      payment_option: '2',
    });
    const retry = getOrCreateTopupRetry(10, 'intent-a', {
      subscription_id: 44,
      devices_to_add: 3,
      expected_amount_kopeks: 900,
      payment_method: 'platega',
      payment_option: '1',
    });
    expect(retry.idempotency_key).toBe(first.idempotency_key);
    expect(retry.expected_amount_kopeks).toBe(700);
    expect(retry.payment_option).toBe('2');
  });
});
