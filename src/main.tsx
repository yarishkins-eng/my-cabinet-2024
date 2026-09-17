import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  init,
  restoreInitData,
  retrieveRawInitData,
  mountMiniApp,
  miniAppReady,
  setMiniAppHeaderColor,
  setMiniAppBottomBarColor,
  setMiniAppBackgroundColor,
  mountViewport,
  expandViewport,
  mountSwipeBehavior,
  disableVerticalSwipes,
  mountClosingBehavior,
  disableClosingConfirmation,
  mountBackButton,
  bindViewportCssVars,
  requestFullscreen,
  isFullscreen,
} from '@telegram-apps/sdk-react';
import { clearStaleSessionIfNeeded } from './utils/token';
import { useAuthStore } from './store/auth';
import { AppWithNavigator } from './AppWithNavigator';
import { ErrorBoundary } from './components/ErrorBoundary';
import { initLogoPreload } from './api/branding';
import { checkBackendOnStartup } from './api/health';
import { getCachedFullscreenEnabled, isTelegramMobile } from './hooks/useTelegramSDK';
import { applyTelegramLanguage } from './i18n';
import { DEFAULT_THEME_COLORS } from './types/theme';
import './styles/globals.css';

// Polyfill Object.hasOwn for older iOS/Android WebViews (Safari < 15.4, old Chrome).
// @telegram-apps/sdk v3 depends on valibot which uses Object.hasOwn internally.
// Without this, init() throws LaunchParamsRetrieveError on affected devices.
// See: https://github.com/Telegram-Mini-Apps/tma.js/issues/683
if (typeof (Object as { hasOwn?: unknown }).hasOwn !== 'function') {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (Object as any).hasOwn = (obj: object, prop: PropertyKey): boolean =>
    Object.prototype.hasOwnProperty.call(obj, prop);
}

// Only initialize Telegram SDK when running inside Telegram
const isTelegramEnv =
  !!(window as unknown as Record<string, unknown>).TelegramWebviewProxy ||
  location.hash.includes('tgWebApp') ||
  location.search.includes('tgWebApp');

const HMR_KEY = '__tg_sdk_initialized';
const alreadyInitialized = (window as unknown as Record<string, unknown>)[HMR_KEY] === true;

if (isTelegramEnv && !alreadyInitialized) {
  (window as unknown as Record<string, unknown>)[HMR_KEY] = true;

  try {
    init();
    restoreInitData();

    clearStaleSessionIfNeeded(retrieveRawInitData() || null);

    // Adopt the user's Telegram client language on first run (no explicit choice yet).
    applyTelegramLanguage();

    // Each mount in its own try/catch so one failure doesn't block others.
    // themeParams кабинету не нужны: он всегда тёмный и тему телефона не читает.
    try {
      // mountMiniApp() в SDK 3.x асинхронный: до его завершения setMiniApp*()
      // бросают «the component is unmounted». Поэтому — в .then().
      // Кабинет всегда тёмный: до первого React-эффекта Telegram красит шапку,
      // панель и подложку в цвет темы телефона — на светлом телефоне это белая
      // вспышка. Подложка первой (самая заметная), каждый вызов в своём try:
      // setBottomBarColor требует Mini Apps 7.10+, остальные — старше.
      mountMiniApp()
        .then(() => {
          try {
            setMiniAppBackgroundColor(DEFAULT_THEME_COLORS.darkBackground as `#${string}`);
          } catch {}
          try {
            setMiniAppHeaderColor(DEFAULT_THEME_COLORS.darkSurface as `#${string}`);
          } catch {}
          try {
            setMiniAppBottomBarColor(DEFAULT_THEME_COLORS.darkSurface as `#${string}`);
          } catch {}
        })
        .catch(() => {});
    } catch {}
    try {
      mountSwipeBehavior();
      disableVerticalSwipes();
    } catch {}
    try {
      mountClosingBehavior();
      disableClosingConfirmation();
    } catch {}
    try {
      mountBackButton();
    } catch {}
    // Viewport must be mounted before requesting fullscreen
    mountViewport()
      .then(() => {
        bindViewportCssVars();
        expandViewport();

        // Auto-enter fullscreen if enabled in settings (mobile only)
        if (getCachedFullscreenEnabled() && isTelegramMobile()) {
          if (!isFullscreen()) {
            requestFullscreen();
          }
        }
      })
      .catch(() => {});

    miniAppReady();
  } catch {}
} else if (!isTelegramEnv) {
  // Outside Telegram — still clear stale session tokens if any
  clearStaleSessionIfNeeded(null);
}

// Bootstrap auth after the Telegram SDK is initialised so CloudStorage-backed
// refresh-token recovery can run inside initialize() (launch params + CloudStorage
// are only available post-init()).
void useAuthStore.getState().initialize();

// In parallel with auth bootstrap, eagerly check backend liveness so a dead
// backend paints the ServiceUnavailableScreen immediately instead of flashing
// the /login page first.
void checkBackendOnStartup();

if ('requestIdleCallback' in window) {
  requestIdleCallback(() => initLogoPreload());
} else {
  setTimeout(initLogoPreload, 100);
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary level="app">
      <QueryClientProvider client={queryClient}>
        <AppWithNavigator />
      </QueryClientProvider>
    </ErrorBoundary>
  </React.StrictMode>,
);
