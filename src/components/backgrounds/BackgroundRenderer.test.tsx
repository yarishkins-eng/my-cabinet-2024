// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
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

import { BackgroundRenderer, StaticBackgroundRenderer } from './BackgroundRenderer';

describe('BackgroundRenderer backdrop', () => {
  beforeEach(() => {
    Object.assign(animationConfig, {
      enabled: true,
      type: 'aurora',
      opacity: 0.5,
      blur: 0,
      reducedOnMobile: false,
      settings: {},
    });
    // jsdom has no matchMedia; BackgroundRenderer reads prefers-reduced-motion.
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

  it('paints one opaque dark backdrop under the animated effect', () => {
    render(<BackgroundRenderer />);

    const layers = document.body.querySelectorAll<HTMLElement>('[data-app-background-theme]');
    expect(layers).toHaveLength(1);
    const layer = layers[0];
    expect(layer.getAttribute('data-app-background-theme')).toBe('dark');
    expect(layer.style.backgroundColor).toBe('var(--color-dark-bg)');
    expect(layer.style.opacity).toBe('');
    expect(screen.getByTestId('aurora-effect')).toBeTruthy();
    expect(screen.getByTestId('aurora-effect').parentElement?.style.opacity).toBe('0.5');
  });

  it('keeps the opaque dark backdrop when animation is disabled', () => {
    animationConfig.enabled = false;

    render(<BackgroundRenderer />);

    expect(screen.queryByTestId('aurora-effect')).toBeNull();
    expect(document.body.querySelectorAll('[data-app-background-theme]')).toHaveLength(1);
    expect(
      document.body.querySelector<HTMLElement>('[data-app-background-theme]')?.style
        .backgroundColor,
    ).toBe('var(--color-dark-bg)');
  });

  it('does not paint a backdrop for a static landing background', () => {
    render(<StaticBackgroundRenderer config={animationConfig} />);

    const layer = document.body.querySelector<HTMLElement>('[data-app-background-theme="dark"]');
    expect(layer).not.toBeNull();
    expect(layer?.style.backgroundColor).toBe('');
  });
});
