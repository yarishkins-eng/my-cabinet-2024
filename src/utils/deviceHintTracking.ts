const KEY_PREFIX = 'app_device_hint_seen_';

export function getDeviceHintSeen(subscriptionId: number): boolean {
  try {
    return localStorage.getItem(`${KEY_PREFIX}${subscriptionId}`) === 'true';
  } catch {
    return false;
  }
}

export function setDeviceHintSeen(subscriptionId: number): void {
  try {
    localStorage.setItem(`${KEY_PREFIX}${subscriptionId}`, 'true');
  } catch {}
}
