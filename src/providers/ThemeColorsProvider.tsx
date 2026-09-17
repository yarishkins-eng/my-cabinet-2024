import { useEffect, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { themeColorsApi } from '../api/themeColors';
import { DEFAULT_THEME_COLORS } from '../types/theme';
import { applyThemeColors } from '../hooks/useThemeColors';
import { usePlatform } from '@/platform';

interface ThemeColorsProviderProps {
  children: React.ReactNode;
}

export function ThemeColorsProvider({ children }: ThemeColorsProviderProps) {
  const { data: colors } = useQuery({
    queryKey: ['theme-colors'],
    queryFn: themeColorsApi.getColors,
    staleTime: 5 * 60 * 1000, // 5 minutes
    refetchOnWindowFocus: false,
    retry: 1,
  });

  const { theme: platformTheme, capabilities } = usePlatform();

  // Apply colors on mount and when they change
  useEffect(() => {
    applyThemeColors(colors || DEFAULT_THEME_COLORS);
  }, [colors]);

  // Шапка, нижняя панель и подложка Telegram — в цвет страницы. Кабинет всегда
  // тёмный, поэтому цвета берутся только из тёмной палитры.
  const syncTelegramColors = useCallback(() => {
    if (!capabilities.hasThemeSync) return;

    const themeColors = colors || DEFAULT_THEME_COLORS;
    // Use surface color for header/bottom bar to match app UI
    platformTheme.setHeaderColor(themeColors.darkSurface);
    platformTheme.setBottomBarColor(themeColors.darkSurface);
    // Фон клиента под страницей — тот же, что у самой страницы. Иначе на
    // Android всё, что WebView не успел отрисовать, просвечивает цветом
    // клиента, а на iOS при оттягивании страницы видна подложка телефона.
    platformTheme.setBackgroundColor(themeColors.darkBackground);
  }, [capabilities.hasThemeSync, colors, platformTheme]);

  // Apply Telegram colors when colors change
  useEffect(() => {
    syncTelegramColors();
  }, [syncTelegramColors]);

  return <>{children}</>;
}
