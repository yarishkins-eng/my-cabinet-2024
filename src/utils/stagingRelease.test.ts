import { describe, expect, it } from 'vitest';

import { isStagingThemeContextSmoke } from './stagingRelease';

describe('isStagingThemeContextSmoke', () => {
  it('accepts only the explicitly versioned staging launch URL', () => {
    expect(isStagingThemeContextSmoke({ port: '8443', search: '?release=cabinet-6020269' })).toBe(
      true,
    );
    expect(isStagingThemeContextSmoke({ port: '8443', search: '' })).toBe(false);
    expect(isStagingThemeContextSmoke({ port: '', search: '?release=cabinet-6020269' })).toBe(
      false,
    );
  });
});
