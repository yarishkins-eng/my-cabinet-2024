// @vitest-environment jsdom

import { useState } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const getEnabledThemes = vi.hoisted(() => vi.fn());

vi.mock('../api/themeColors', () => ({
  themeColorsApi: { getEnabledThemes },
}));

vi.mock('./useTelegramSDK', () => ({
  getTelegramColorScheme: () => null,
}));

import { ThemeProvider, useTheme } from './useTheme';

function ThemeToggle() {
  const { toggleTheme } = useTheme();

  return <button onClick={toggleTheme}>toggle</button>;
}

function HeaderProbe() {
  const { isDark } = useTheme();

  return <output data-testid="header-theme">{isDark ? 'dark' : 'light'}</output>;
}

function CardProbe() {
  const { isDark } = useTheme();

  return (
    <output data-testid="card-theme" style={{ color: isDark ? 'rgb(1, 2, 3)' : 'rgb(4, 5, 6)' }}>
      {isDark ? 'dark' : 'light'}
    </output>
  );
}

function AdminSettingsProbe() {
  const { applyEnabledThemes } = useTheme();

  return (
    <button onClick={() => applyEnabledThemes({ dark: true, light: false })}>disable-light</button>
  );
}

function ThemeProbes({ admin = false }: { admin?: boolean }) {
  return (
    <>
      <ThemeToggle />
      <HeaderProbe />
      <CardProbe />
      {admin && <AdminSettingsProbe />}
    </>
  );
}

function RouteRemountProbe() {
  const [cardVisible, setCardVisible] = useState(true);

  return (
    <>
      <ThemeToggle />
      <HeaderProbe />
      <button onClick={() => setCardVisible(false)}>leave-route</button>
      <button onClick={() => setCardVisible(true)}>return-route</button>
      {cardVisible && <CardProbe />}
    </>
  );
}

describe('ThemeProvider', () => {
  beforeEach(() => {
    window.localStorage.clear();
    document.documentElement.className = '';
    getEnabledThemes.mockResolvedValue({ dark: true, light: true });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('commits the root class and all useTheme consumers to light together', () => {
    window.localStorage.setItem('cabinet-theme', 'dark');

    render(
      <ThemeProvider>
        <ThemeProbes />
      </ThemeProvider>,
    );

    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(screen.getByTestId('header-theme').textContent).toBe('dark');
    expect(screen.getByTestId('card-theme').textContent).toBe('dark');

    fireEvent.click(screen.getByRole('button', { name: 'toggle' }));

    expect(document.documentElement.classList.contains('light')).toBe(true);
    expect(document.documentElement.classList.contains('dark')).toBe(false);
    expect(screen.getByTestId('header-theme').textContent).toBe('light');
    expect(screen.getByTestId('card-theme').textContent).toBe('light');
    expect(screen.getByTestId('card-theme').style.color).toBe('rgb(4, 5, 6)');
  });

  it('forces the enabled fallback after settings disable the saved theme', async () => {
    window.localStorage.setItem('cabinet-theme', 'light');
    getEnabledThemes.mockResolvedValue({ dark: true, light: false });

    render(
      <ThemeProvider>
        <ThemeProbes />
      </ThemeProvider>,
    );

    await waitFor(() => {
      expect(document.documentElement.classList.contains('dark')).toBe(true);
      expect(screen.getByTestId('card-theme').textContent).toBe('dark');
    });
  });

  it('keeps the in-memory theme usable when localStorage throws in a WebView', () => {
    const descriptor = Object.getOwnPropertyDescriptor(window, 'localStorage');
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      value: {
        getItem: () => {
          throw new Error('storage unavailable');
        },
        setItem: () => {
          throw new Error('storage unavailable');
        },
      },
    });

    try {
      render(
        <ThemeProvider>
          <ThemeProbes />
        </ThemeProvider>,
      );

      fireEvent.click(screen.getByRole('button', { name: 'toggle' }));
      expect(document.documentElement.classList.contains('light')).toBe(true);
      expect(screen.getByTestId('card-theme').textContent).toBe('light');
    } finally {
      if (descriptor) Object.defineProperty(window, 'localStorage', descriptor);
    }
  });

  it('does not let an older initial GET overwrite a newer admin setting', async () => {
    let resolveInitialRequest: ((themes: { dark: boolean; light: boolean }) => void) | undefined;
    getEnabledThemes.mockImplementationOnce(
      () =>
        new Promise<{ dark: boolean; light: boolean }>((resolve) => {
          resolveInitialRequest = resolve;
        }),
    );

    render(
      <ThemeProvider>
        <ThemeProbes admin />
      </ThemeProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'disable-light' }));
    resolveInitialRequest?.({ dark: false, light: true });

    // Let the delayed GET finish. Its stale result must not replace the cache.
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(screen.getByTestId('header-theme').textContent).toBe('dark');
    expect(screen.getByTestId('card-theme').textContent).toBe('dark');
    expect(window.localStorage.getItem('cabinet-enabled-themes')).toBe(
      JSON.stringify({ dark: true, light: false }),
    );
  });

  it('applies an enabled-themes change from another tab to every consumer', async () => {
    render(
      <ThemeProvider>
        <ThemeProbes />
      </ThemeProvider>,
    );

    window.dispatchEvent(
      new StorageEvent('storage', {
        key: 'cabinet-enabled-themes',
        newValue: JSON.stringify({ dark: false, light: true }),
      }),
    );

    await waitFor(() => {
      expect(document.documentElement.classList.contains('light')).toBe(true);
      expect(screen.getByTestId('header-theme').textContent).toBe('light');
      expect(screen.getByTestId('card-theme').textContent).toBe('light');
    });
  });

  it('keeps the selected theme when a route remounts a card', () => {
    window.localStorage.setItem('cabinet-theme', 'dark');

    render(
      <ThemeProvider>
        <RouteRemountProbe />
      </ThemeProvider>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'toggle' }));
    fireEvent.click(screen.getByRole('button', { name: 'leave-route' }));
    fireEvent.click(screen.getByRole('button', { name: 'return-route' }));

    expect(document.documentElement.classList.contains('light')).toBe(true);
    expect(screen.getByTestId('header-theme').textContent).toBe('light');
    expect(screen.getByTestId('card-theme').textContent).toBe('light');
  });
});
