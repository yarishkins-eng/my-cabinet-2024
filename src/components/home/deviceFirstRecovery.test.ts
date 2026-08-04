import { describe, expect, it } from 'vitest';
import {
  deviceFirstRecoveryVariant,
  isMoneyInFlightRecovery,
  shouldHideRecoveryCard,
} from './deviceFirstRecovery';

describe('deviceFirstRecoveryVariant', () => {
  it('maps operator_review to operator', () => {
    expect(deviceFirstRecoveryVariant('operator_review')).toBe('operator');
  });

  it('maps awaiting_payment to awaiting_payment', () => {
    expect(deviceFirstRecoveryVariant('awaiting_payment')).toBe('awaiting_payment');
  });

  it('maps pre-payment browsing states to draft', () => {
    expect(deviceFirstRecoveryVariant('configuration')).toBe('draft');
    expect(deviceFirstRecoveryVariant('confirmation')).toBe('draft');
  });

  it('maps provisioning states to processing', () => {
    expect(deviceFirstRecoveryVariant('processing')).toBe('processing');
    expect(deviceFirstRecoveryVariant('provisioning')).toBe('processing');
  });

  it('treats unknown states as processing (safe: card stays visible)', () => {
    expect(deviceFirstRecoveryVariant('something_new')).toBe('processing');
  });
});

describe('shouldHideRecoveryCard', () => {
  it('hides a browsing draft while the trial offer is on screen', () => {
    expect(shouldHideRecoveryCard('draft', true)).toBe(true);
  });

  it('keeps the draft when no trial offer competes with it', () => {
    expect(shouldHideRecoveryCard('draft', false)).toBe(false);
  });

  it('never hides states with money or provisioning in flight', () => {
    expect(shouldHideRecoveryCard('awaiting_payment', true)).toBe(false);
    expect(shouldHideRecoveryCard('operator', true)).toBe(false);
    expect(shouldHideRecoveryCard('processing', true)).toBe(false);
  });
});

describe('isMoneyInFlightRecovery', () => {
  it('flags states where the trial block must stay off', () => {
    expect(isMoneyInFlightRecovery('processing')).toBe(true);
    expect(isMoneyInFlightRecovery('operator')).toBe(true);
  });

  it('allows the trial block for browsing and unpaid-invoice states', () => {
    expect(isMoneyInFlightRecovery('draft')).toBe(false);
    expect(isMoneyInFlightRecovery('awaiting_payment')).toBe(false);
    expect(isMoneyInFlightRecovery(null)).toBe(false);
  });
});
