/**
 * Фиче-флаги фронта кабинета.
 *
 * Объединённый экран (редизайн «Главная + Подписка», Чат 3) — go-live: одобрен владельцем
 * 24.06.2026, теперь ВКЛючён по умолчанию. На «/» живёт новый `DashboardUnified`; старый
 * `Dashboard` остаётся в сборке как путь отката (lazy-чанк).
 *
 * Аварийный kill-switch: `VITE_UNIFIED_HOME=0` в `.env` на сервере вернёт старый `Dashboard`
 * без правки кода. Полный откат — `git revert` коммита go-live (вернёт OFF по умолчанию).
 * Vite пробрасывает на фронт только переменные с префиксом `VITE_`.
 */

/**
 * Объединённый экран на «/» вместо старого Dashboard. ВКЛ по умолчанию (go-live);
 * `VITE_UNIFIED_HOME=0` в серверном `.env` — аварийно вернуть старый `Dashboard`.
 */
export const UNIFIED_HOME_ENABLED = import.meta.env.VITE_UNIFIED_HOME !== '0';

/**
 * Dev-витрина состояний экрана (песочница на фикстурах, без авторизации/прода).
 * По умолчанию доступна ТОЛЬКО в режиме разработки (`npm run dev`) — в прод-сборке
 * `import.meta.env.DEV` ложно, и роут витрины не появляется. Можно форсировать
 * `VITE_SCREEN_SHOWCASE=1` (например, чтобы посмотреть в prod-сборке локально).
 */
export const SCREEN_SHOWCASE_ENABLED =
  import.meta.env.DEV || import.meta.env.VITE_SCREEN_SHOWCASE === '1';
