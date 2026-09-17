// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

/**
 * Цвета клиента Telegram вокруг страницы.
 *
 * Шапка и нижняя панель клиента красятся в поверхность страницы, а фон самого
 * мини-приложения — в фон страницы: на Android WebView лежит поверх него
 * прозрачным, и всё, что клиент не успел отрисовать, просвечивает цветом
 * клиента; на iOS этот же цвет виден при оттягивании страницы. Кабинет всегда
 * тёмный, поэтому все три цвета берутся из тёмной палитры — тема телефона не
 * влияет ни на один из них.
 */

const theme = {
  setHeaderColor: vi.fn(),
  setBottomBarColor: vi.fn(),
  setBackgroundColor: vi.fn(),
};

vi.mock('@/platform', () => ({
  usePlatform: () => ({ theme, capabilities: { hasThemeSync: true } }),
}));
vi.mock('../api/themeColors', () => ({
  themeColorsApi: { getColors: () => Promise.resolve({}) },
}));
vi.mock('@tanstack/react-query', () => ({
  useQuery: () => ({
    data: {
      accent: '#3b82f6',
      darkBackground: '#0b1f1c',
      darkSurface: '#123456',
      darkText: '#f1f5f9',
      darkTextSecondary: '#94a3b8',
      success: '#22c55e',
      warning: '#f59e0b',
      error: '#ef4444',
    },
  }),
}));

const { ThemeColorsProvider } = await import('./ThemeColorsProvider');

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('ThemeColorsProvider — цвета клиента Telegram', () => {
  it('фон клиента = тёмный фон страницы, шапка и панель = тёмная поверхность', () => {
    render(
      <ThemeColorsProvider>
        <span />
      </ThemeColorsProvider>,
    );
    expect(theme.setBackgroundColor).toHaveBeenLastCalledWith('#0b1f1c');
    expect(theme.setHeaderColor).toHaveBeenLastCalledWith('#123456');
    expect(theme.setBottomBarColor).toHaveBeenLastCalledWith('#123456');
  });
});
