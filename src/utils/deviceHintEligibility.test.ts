import { describe, expect, it } from 'vitest';
import { isDeviceHintEligible } from './deviceHintEligibility';

const firstConnection = {
  hasSubscription: true,
  hasSubscriptionId: true,
  devicesLoaded: true,
  deviceZoneKind: 'connect',
  screenCode: 'T1',
  hasBeenSeen: false,
  successModalOpen: false,
} as const;

describe('isDeviceHintEligible', () => {
  it('shows the coachmark for the first trial connection', () => {
    expect(isDeviceHintEligible(firstConnection)).toBe(true);
  });

  it('also shows for a paid subscription with no connected devices', () => {
    expect(isDeviceHintEligible({ ...firstConnection, screenCode: 'P1' })).toBe(true);
  });

  it.each([
    ['a device is already connected', { deviceZoneKind: 'connect_more', screenCode: 'T2' }],
    ['the subscription is expiring', { screenCode: 'P7' }],
    ['the panel has not loaded devices yet', { devicesLoaded: false }],
    ['the hint was already completed', { hasBeenSeen: true }],
    ['a success modal is open', { successModalOpen: true }],
  ])('does not show when %s', (_reason, change) => {
    expect(isDeviceHintEligible({ ...firstConnection, ...change })).toBe(false);
  });
});
