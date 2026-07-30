// @vitest-environment jsdom

import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

let isDark = true;

vi.mock('@/hooks/useTheme', () => ({
  useTheme: () => ({ isDark }),
}));

vi.mock('@/hooks/useAnimationLoop', () => ({
  useAnimationPause: () => false,
}));

import AuroraBackground from './aurora-background';

describe('AuroraBackground', () => {
  afterEach(() => {
    cleanup();
    isDark = true;
  });

  it('does not render hard-coded black rails in the light theme', () => {
    isDark = false;
    const { container } = render(<AuroraBackground settings={{}} />);
    const aurora = container.querySelector<HTMLElement>('[style*="background-image"]');

    expect(aurora?.style.backgroundImage).not.toContain('#000');
    expect(aurora?.style.backgroundImage).toContain('rgba(255,255,255,0.42)');
  });

  it('keeps the existing high-contrast aurora palette in the dark theme', () => {
    const { container } = render(<AuroraBackground settings={{}} />);
    const aurora = container.querySelector<HTMLElement>('[style*="background-image"]');

    expect(aurora?.style.backgroundImage).toContain('#000');
  });
});
