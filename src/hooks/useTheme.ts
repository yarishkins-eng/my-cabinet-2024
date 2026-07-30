import {
  createElement,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { EnabledThemes, DEFAULT_ENABLED_THEMES } from '../types/theme';
import { themeColorsApi } from '../api/themeColors';
import { STORAGE_KEYS } from '../config/constants';
import { getTelegramColorScheme } from './useTelegramSDK';

type Theme = 'dark' | 'light';

const THEME_KEY = STORAGE_KEYS.THEME;
const ENABLED_THEMES_KEY = STORAGE_KEYS.ENABLED_THEMES;

interface ThemeContextValue {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
  isDark: boolean;
  isLight: boolean;
  enabledThemes: EnabledThemes;
  canToggle: boolean;
  isLoading: boolean;
  refreshEnabledThemes: () => Promise<void>;
  applyEnabledThemes: (themes: EnabledThemes) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function readStorage(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Some Telegram WebViews can reject localStorage. The in-memory context remains usable.
  }
}

function isEnabledThemes(value: unknown): value is EnabledThemes {
  if (!value || typeof value !== 'object') return false;
  const themes = value as Partial<EnabledThemes>;
  return typeof themes.dark === 'boolean' && typeof themes.light === 'boolean';
}

function getCachedEnabledThemes(): EnabledThemes {
  const cached = readStorage(ENABLED_THEMES_KEY);
  if (cached) {
    try {
      const parsed: unknown = JSON.parse(cached);
      if (isEnabledThemes(parsed)) return parsed;
    } catch {
      // Ignore malformed cache and use the safe default.
    }
  }
  return DEFAULT_ENABLED_THEMES;
}

async function fetchEnabledThemes(): Promise<EnabledThemes> {
  try {
    const themes = await themeColorsApi.getEnabledThemes();
    if (isEnabledThemes(themes)) {
      return themes;
    }
  } catch {
    // The cached/default value below keeps theme selection available offline.
  }
  return getCachedEnabledThemes();
}

function fallbackTheme(enabledThemes: EnabledThemes): Theme {
  return enabledThemes.dark ? 'dark' : 'light';
}

function initialTheme(enabledThemes: EnabledThemes): Theme {
  const stored = readStorage(THEME_KEY) as Theme | null;
  if (stored === 'light' && enabledThemes.light) return 'light';
  if (stored === 'dark' && enabledThemes.dark) return 'dark';
  if (stored && !enabledThemes[stored]) return fallbackTheme(enabledThemes);

  if (!stored) {
    const telegramTheme = getTelegramColorScheme();
    if (telegramTheme && enabledThemes[telegramTheme]) return telegramTheme;
  }

  try {
    if (window.matchMedia('(prefers-color-scheme: light)').matches && enabledThemes.light) {
      return 'light';
    }
  } catch {
    // matchMedia is not available in every embedded WebView.
  }

  return fallbackTheme(enabledThemes);
}

/**
 * The theme is application-wide state. Keeping it in one provider makes the root
 * class and every card that uses inline glass colours update in the same React
 * commit, instead of synchronising independent hook instances through an event.
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [enabledThemes, setEnabledThemes] = useState<EnabledThemes>(getCachedEnabledThemes);
  const [theme, setThemeState] = useState<Theme>(() => initialTheme(getCachedEnabledThemes()));
  const [isLoading, setIsLoading] = useState(true);
  const enabledThemesVersion = useRef(0);

  const applyEnabledThemes = useCallback((nextThemes: EnabledThemes) => {
    if (!isEnabledThemes(nextThemes)) return;

    enabledThemesVersion.current += 1;
    writeStorage(ENABLED_THEMES_KEY, JSON.stringify(nextThemes));
    setEnabledThemes(nextThemes);
    setThemeState((currentTheme) =>
      nextThemes[currentTheme] ? currentTheme : fallbackTheme(nextThemes),
    );
  }, []);

  const refreshEnabledThemes = useCallback(async () => {
    const requestVersion = enabledThemesVersion.current;
    const nextThemes = await fetchEnabledThemes();

    // A newer admin or cross-tab update wins over an older in-flight GET.
    if (requestVersion !== enabledThemesVersion.current) {
      setIsLoading(false);
      return;
    }

    applyEnabledThemes(nextThemes);
    setIsLoading(false);
  }, [applyEnabledThemes]);

  useEffect(() => {
    void refreshEnabledThemes();
  }, [refreshEnabledThemes]);

  // Only cross-tab settings changes need an event. Same-tab consumers read one context.
  useEffect(() => {
    const handleStorageChange = (event: StorageEvent) => {
      if (event.key !== ENABLED_THEMES_KEY || !event.newValue) return;
      try {
        const nextThemes: unknown = JSON.parse(event.newValue);
        if (isEnabledThemes(nextThemes)) applyEnabledThemes(nextThemes);
      } catch {
        // Ignore malformed storage updates from another tab.
      }
    };

    window.addEventListener('storage', handleStorageChange);
    return () => window.removeEventListener('storage', handleStorageChange);
  }, [applyEnabledThemes]);

  // This runs before the browser paints the commit that changed the context.
  useLayoutEffect(() => {
    const resolvedTheme = enabledThemes[theme] ? theme : fallbackTheme(enabledThemes);
    if (resolvedTheme !== theme) {
      setThemeState(resolvedTheme);
      return;
    }

    const root = document.documentElement;
    root.classList.toggle('dark', resolvedTheme === 'dark');
    root.classList.toggle('light', resolvedTheme === 'light');
    writeStorage(THEME_KEY, resolvedTheme);
  }, [enabledThemes, theme]);

  useEffect(() => {
    let mediaQuery: MediaQueryList;
    try {
      mediaQuery = window.matchMedia('(prefers-color-scheme: light)');
    } catch {
      return;
    }

    const handleChange = (event: MediaQueryListEvent) => {
      // A stored choice is explicit. System changes only affect users without one.
      if (readStorage(THEME_KEY)) return;
      const nextTheme: Theme = event.matches ? 'light' : 'dark';
      if (enabledThemes[nextTheme]) setThemeState(nextTheme);
    };

    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, [enabledThemes]);

  const setTheme = useCallback(
    (nextTheme: Theme) => {
      if (enabledThemes[nextTheme]) setThemeState(nextTheme);
    },
    [enabledThemes],
  );

  const toggleTheme = useCallback(() => {
    setThemeState((currentTheme) => {
      const nextTheme: Theme = currentTheme === 'dark' ? 'light' : 'dark';
      return enabledThemes[nextTheme] ? nextTheme : currentTheme;
    });
  }, [enabledThemes]);

  const value = useMemo<ThemeContextValue>(
    () => ({
      theme,
      setTheme,
      toggleTheme,
      isDark: theme === 'dark',
      isLight: theme === 'light',
      enabledThemes,
      canToggle: !isLoading && enabledThemes.dark && enabledThemes.light,
      isLoading,
      refreshEnabledThemes,
      applyEnabledThemes,
    }),
    [
      applyEnabledThemes,
      enabledThemes,
      isLoading,
      refreshEnabledThemes,
      setTheme,
      theme,
      toggleTheme,
    ],
  );

  return createElement(ThemeContext.Provider, { value }, children);
}

export function useTheme(): ThemeContextValue {
  const value = useContext(ThemeContext);
  if (!value) {
    throw new Error('useTheme must be used inside ThemeProvider');
  }
  return value;
}
