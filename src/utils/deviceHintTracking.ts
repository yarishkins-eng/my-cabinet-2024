const KEY_PREFIX = 'app_device_hint_seen_';
// Telegram WebView may deny or clear localStorage. Keep an intentional dismissal
// for the current Mini App session even in that fallback case.
const sessionSeenSubscriptionIds = new Set<number>();

export function getDeviceHintSeen(subscriptionId: number): boolean {
  if (sessionSeenSubscriptionIds.has(subscriptionId)) return true;

  try {
    return localStorage.getItem(`${KEY_PREFIX}${subscriptionId}`) === 'true';
  } catch {
    return false;
  }
}

export function setDeviceHintSeen(subscriptionId: number): void {
  sessionSeenSubscriptionIds.add(subscriptionId);

  try {
    localStorage.setItem(`${KEY_PREFIX}${subscriptionId}`, 'true');
  } catch {}
}
