import { Fragment, createElement, useLayoutEffect, type ReactNode } from 'react';

/**
 * Кабинет всегда тёмный (решение владельца 17.09.2026, этап СТ-1).
 *
 * Это временная заглушка: потребители `isDark` / `isLight` / `theme` ещё живут
 * в ~40 файлах и снимаются этапом СТ-2 вместе с этим файлом. Никаких чтений
 * темы телефона, Telegram, localStorage или сервера здесь больше нет.
 */
type Theme = 'dark';

interface ThemeContextValue {
  theme: Theme;
  isDark: true;
  isLight: false;
}

const THEME_VALUE: ThemeContextValue = { theme: 'dark', isDark: true, isLight: false };

export function ThemeProvider({ children }: { children: ReactNode }) {
  // index.html уже даёт <html class="dark">; здесь — страховка на случай, если
  // класс снял кто-то посторонний.
  useLayoutEffect(() => {
    document.documentElement.classList.add('dark');
    document.documentElement.classList.remove('light');
  }, []);

  return createElement(Fragment, null, children);
}

export function useTheme(): ThemeContextValue {
  return THEME_VALUE;
}
