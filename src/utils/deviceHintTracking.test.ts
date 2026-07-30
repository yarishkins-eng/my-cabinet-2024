// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getDeviceHintSeen, setDeviceHintSeen } from './deviceHintTracking';

describe('device hint tracking', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('persists an intentional dismissal for the same subscription', () => {
    const subscriptionId = 910001;

    expect(getDeviceHintSeen(subscriptionId)).toBe(false);
    setDeviceHintSeen(subscriptionId);

    expect(getDeviceHintSeen(subscriptionId)).toBe(true);
    expect(localStorage.getItem(`app_device_hint_seen_${subscriptionId}`)).toBe('true');
  });

  it('keeps a dismissal for the current session when localStorage is unavailable', () => {
    const subscriptionId = 910002;
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage unavailable');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('storage unavailable');
    });

    setDeviceHintSeen(subscriptionId);

    expect(getDeviceHintSeen(subscriptionId)).toBe(true);
  });
});
