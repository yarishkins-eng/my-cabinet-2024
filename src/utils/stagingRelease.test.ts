import { describe, expect, it } from 'vitest';

import { isStagingReleaseSmoke } from './stagingRelease';

describe('isStagingReleaseSmoke', () => {
  it('accepts only the explicitly versioned staging launch URL', () => {
    expect(
      isStagingReleaseSmoke({
        port: '8443',
        search: '?release=cabinet-copy-success-ui-1',
      }),
    ).toBe(true);
    expect(isStagingReleaseSmoke({ port: '8443', search: '' })).toBe(false);
    expect(
      isStagingReleaseSmoke({
        port: '',
        search: '?release=cabinet-copy-success-ui-1',
      }),
    ).toBe(false);
    expect(
      isStagingReleaseSmoke({
        port: '8443',
        search: '?release=cabinet-theme-bg-remount-1',
      }),
    ).toBe(false);
    expect(
      isStagingReleaseSmoke({
        port: '8443',
        search: '?release=cabinet-6020269',
      }),
    ).toBe(false);
  });
});
