// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const animationConfig = vi.hoisted(() => ({
  enabled: true,
  type: 'aurora' as const,
  opacity: 0.5,
  blur: 0,
  reducedOnMobile: false,
  settings: {},
}));

vi.mock('@tanstack/react-query', () => ({
  useQuery: () => ({ data: animationConfig }),
}));

vi.mock('@/api/themeColors', () => ({
  themeColorsApi: {
    getEnabledThemes: () => Promise.resolve({ dark: true, light: true }),
  },
}));

vi.mock('@/hooks/useTelegramSDK', () => ({
  getTelegramColorScheme: () => null,
}));

vi.mock('@/components/ui/backgrounds/registry', () => ({
  backgroundComponents: {
    aurora: () => <div data-testid="aurora-effect" />,
  },
  prefetchBackground: vi.fn(),
}));

vi.mock('@/utils/backgroundConfig', () => ({
  validateConfig: (value: unknown) => value,
  getCachedConfig: () => animationConfig,
  setCachedConfig: vi.fn(),
}));

import { ThemeProvider, useTheme } from '@/hooks/useTheme';
import { BackgroundRenderer, StaticBackgroundRenderer } from './BackgroundRenderer';

function ToggleTheme() {
  const { toggleTheme } = useTheme();
  return <button onClick={toggleTheme}>toggle theme</button>;
}

describe('BackgroundRenderer theme repaint', () => {
  beforeEach(() => {
    Object.assign(animationConfig, {
      enabled: true,
      type: 'aurora',
      opacity: 0.5,
      blur: 0,
      reducedOnMobile: false,
      settings: {},
    });
    window.localStorage.clear();
    window.localStorage.setItem('cabinet-theme', 'dark');
    document.documentElement.className = '';
    window.matchMedia = vi.fn().mockReturnValue({
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('replaces the portal DOM subtree and its opaque backdrop on theme change', () => {
    render(
      <ThemeProvider>
        <ToggleTheme />
        <BackgroundRenderer />
      </ThemeProvider>,
    );

    const darkLayer = document.body.querySelector<HTMLElement>(
      '[data-app-background-theme="dark"]',
    );
    expect(darkLayer).not.toBeNull();
    expect(darkLayer?.style.backgroundColor).toBe('var(--color-dark-bg)');
    expect(screen.getByTestId('aurora-effect')).toBeTruthy();
    expect(screen.getByTestId('aurora-effect').parentElement?.style.opacity).toBe('0.5');
    expect(darkLayer?.style.opacity).toBe('');

    fireEvent.click(screen.getByRole('button', { name: 'toggle theme' }));

    const lightLayer = document.body.querySelector<HTMLElement>(
      '[data-app-background-theme="light"]',
    );
    expect(lightLayer).not.toBeNull();
    expect(lightLayer).not.toBe(darkLayer);
    expect(darkLayer?.isConnected).toBe(false);
    expect(lightLayer?.style.backgroundColor).toBe('var(--color-light-bg)');
    expect(document.documentElement.classList.contains('light')).toBe(true);
  });

  it('keeps one opaque themed backdrop when animation is disabled', () => {
    animationConfig.enabled = false;

    render(
      <ThemeProvider>
        <ToggleTheme />
        <BackgroundRenderer />
      </ThemeProvider>,
    );

    expect(screen.queryByTestId('aurora-effect')).toBeNull();
    expect(document.body.querySelectorAll('[data-app-background-theme]')).toHaveLength(1);
    expect(
      document.body.querySelector<HTMLElement>('[data-app-background-theme]')?.style
        .backgroundColor,
    ).toBe('var(--color-dark-bg)');

    fireEvent.click(screen.getByRole('button', { name: 'toggle theme' }));

    expect(document.body.querySelectorAll('[data-app-background-theme]')).toHaveLength(1);
    expect(
      document.body.querySelector<HTMLElement>('[data-app-background-theme]')?.style
        .backgroundColor,
    ).toBe('var(--color-light-bg)');
  });

  it('does not remount a static landing background when the application theme changes', () => {
    render(
      <ThemeProvider>
        <ToggleTheme />
        <StaticBackgroundRenderer config={animationConfig} />
      </ThemeProvider>,
    );

    const darkLayer = document.body.querySelector<HTMLElement>(
      '[data-app-background-theme="dark"]',
    );
    expect(darkLayer).not.toBeNull();
    expect(darkLayer?.style.backgroundColor).toBe('');

    fireEvent.click(screen.getByRole('button', { name: 'toggle theme' }));

    const lightLayer = document.body.querySelector<HTMLElement>(
      '[data-app-background-theme="light"]',
    );
    expect(lightLayer).toBe(darkLayer);
    expect(lightLayer?.style.backgroundColor).toBe('');
  });
});
