/**
 * Normalise a user-supplied redirect / returnTo URL down to a safe in-app path.
 *
 * Returns the input unchanged when it is a plain absolute path (`/foo/bar`).
 * Returns `/` otherwise — for protocol-relative URLs (`//evil.com`), absolute
 * URLs (`https://…`), exotic schemes (`javascript:`, `data:`), or anything
 * that smuggles a host through URL encoding (`%2F%2Fevil.com`).
 *
 * Even with react-router's navigate() — which only treats inputs as paths
 * and won't trigger an external nav — pasted absolute URLs would still
 * produce ugly path artifacts. Centralising the check matches what
 * TelegramRedirect already did and gives every returnTo entry the same
 * shape.
 */
export function getSafeRedirectPath(url: string | null | undefined): string {
  if (!url) return '/';
  // Only allow relative paths starting with /
  if (!url.startsWith('/') || url.startsWith('//')) {
    return '/';
  }
  // Catch the encoded forms (//evil.com → %2F%2Fevil.com, scheme://…)
  try {
    const decoded = decodeURIComponent(url);
    if (!decoded.startsWith('/') || decoded.startsWith('//') || decoded.includes('://')) {
      return '/';
    }
  } catch {
    return '/';
  }
  return url;
}

/** Маршрут кассы device-first. Сравнивается ТОЧНО — см. комментарий ниже. */
const CHECKOUT_PATHNAME = '/subscription/purchase';
/**
 * Опорный адрес для разбора. Намеренно ФИКСИРОВАННЫЙ, а не `window.location.origin`:
 * функция обязана давать один и тот же ответ и в браузере, и вне его (её первая же
 * проверка сторожем поймала обратное). Настоящий origin здесь не нужен — `getSafeRedirectPath`
 * выше уже гарантирует, что строка начинается с одного `/`, а сравнение с этой опорой ловит
 * ровно то, ради чего оно стоит: строку, которая при разборе уезжает на ЧУЖОЙ хост.
 */
const PARSE_BASE = 'http://cabinet.invalid';

/**
 * 🔴 Этап Б-1. Адрес возврата после пополнения честится ТОЛЬКО для кассы device-first
 * и только по её собственной метке `from=checkout`, которую пишет она одна.
 *
 * ⛔ Опознавать кассу ПО МАРШРУТУ нельзя: на `/subscription/purchase` рисуются ещё три
 * экрана (`TariffPurchaseForm`, `ClassicPurchaseWizard`, `SwitchTariffSheet`), и их общий
 * `InsufficientBalancePrompt` кладёт в `returnTo` ровно эту же строку. Для них и для двух
 * шторок докупки поведение обязано остаться прежним — уход на Главную.
 *
 * Почему касса заслуживает исключения: она НЕ сохраняет корзину вообще (`user_cart_service`
 * не встречается в device-first ни разу), а сервер отбивает нехватку баланса ДО всякой записи
 * в базу. Значит после пополнения ей нечему исполниться самой — человека надо вернуть, иначе
 * он читает «Перейти к подписке», попадает на Главную, а подписки там нет.
 * ⚠️ Обратное тоже верно и проверено: у докупки устройств и трафика корзина сохраняется БЕЗ
 * метки намерения и после пополнения тоже не исполняется. Это отдельный дефект (мина), и
 * лечить его подменой возврата здесь — значит замаскировать его, а не починить.
 *
 * ⚠️ Путь сравнивается ТОЧНО, а не префиксом: `getSafeRedirectPath` пропускает `/\evil.com`
 * (обратный слэш парсер URL приравнивает к прямому), и префиксное сравнение оставило бы дыру.
 */
export function resolveCheckoutReturn(returnTo: string | null | undefined): string | null {
  if (!returnTo) return null;
  const safe = getSafeRedirectPath(returnTo);
  if (safe === '/') return null;
  try {
    const parsed = new URL(safe, PARSE_BASE);
    if (parsed.origin !== PARSE_BASE) return null;
    if (parsed.pathname !== CHECKOUT_PATHNAME) return null;
    if (parsed.searchParams.get('from') !== 'checkout') return null;
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return null;
  }
}
