/**
 * Navigation helpers for back-button behavior.
 *
 * The Telegram Mini App (and any deep-link entry) can be opened directly on a
 * nested route — e.g. a bot button that opens `/admin` or `/balance/top-up`.
 * In that case React Router's history stack holds a single entry, so a plain
 * `navigate(-1)` has nothing to go back to and the back button appears dead.
 * These helpers let callers detect that situation and fall back to a sensible
 * parent route instead.
 */

/**
 * React Router stores the current position in the history stack on
 * `window.history.state.idx`. The first/entry record is `0`. When `idx === 0`
 * there is no in-app history to go back to (the page is the deep-link entry).
 */
export function hasInAppHistory(): boolean {
  const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0;
  return idx > 0;
}

/**
 * Derive a parent route by dropping the last path segment.
 *
 *   /admin/users/123  → /admin/users
 *   /balance/top-up   → /balance
 *   /info             → /
 *   /                 → /
 *
 * Used as the back-button target when there is no in-app history. If the
 * derived path is not a real route the app's catch-all redirects to `/`,
 * so the user is never left stuck.
 */
/**
 * 🔴 Этап В-1. Экран результата пополнения стал ТОЧКОЙ ВХОДА: человек приземляется на него
 * прямо из банка по диплинку, глубина истории — ноль. Общее правило «отрезать последний
 * кусок адреса» дало бы `/balance/top-up` — приглашение выбрать способ и заплатить ещё раз,
 * ровно тому, кто только что заплатил. Ведём на баланс: там видно фактическое состояние счёта.
 */
const FALLBACK_PARENT_OVERRIDES: Record<string, string> = {
  '/balance/top-up/result': '/balance',
};

export function getFallbackParentPath(pathname: string): string {
  const normalised = pathname.replace(/\/+$/, '') || '/';
  const override = FALLBACK_PARENT_OVERRIDES[normalised];
  if (override) return override;
  const segments = normalised.split('/').filter(Boolean);
  const parent = segments.slice(0, -1);
  return parent.length ? '/' + parent.join('/') : '/';
}
