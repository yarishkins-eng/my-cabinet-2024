// @vitest-environment jsdom

import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/hooks/useAnimationLoop', () => ({
  useAnimationPause: () => false,
}));

import AuroraBackground from './aurora-background';

describe('AuroraBackground', () => {
  afterEach(() => {
    cleanup();
  });

  it('keeps the high-contrast aurora palette with black rails (the cabinet is dark-only)', () => {
    const { container } = render(<AuroraBackground settings={{}} />);
    const aurora = container.querySelector<HTMLElement>('[style*="background-image"]');

    expect(aurora?.style.backgroundImage).toContain('#000');
    expect(aurora?.style.backgroundImage).not.toContain('rgba(255,255,255,0.42)');
  });
});
