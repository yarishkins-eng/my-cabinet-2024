import { describe, expect, it } from 'vitest';
import { strictTestLinkEpoch } from './testLinkFence';

describe('strictTestLinkEpoch', () => {
  it('keeps ordinary users outside the strict fence', () => {
    expect(strictTestLinkEpoch({ test_link_strict: false }, { test_reset_at: null })).toEqual({
      strict: false,
      epoch: null,
      matches: true,
    });
  });

  it('requires every strict response to carry exactly the current reset epoch', () => {
    const epoch = '2026-09-08T13:00:00+00:00';
    expect(
      strictTestLinkEpoch(
        { test_link_strict: true, test_reset_at: epoch },
        { test_link_strict: true, test_reset_at: epoch },
        { test_link_strict: true, test_reset_at: epoch },
      ),
    ).toEqual({ strict: true, epoch, matches: true });
  });

  it('accepts the explicit shared null epoch before an enrolled tester resets once', () => {
    expect(
      strictTestLinkEpoch(
        { test_link_strict: true, test_reset_at: null },
        { test_link_strict: true, test_reset_at: null },
        { test_link_strict: true, test_reset_at: null },
      ),
    ).toEqual({ strict: true, epoch: null, matches: true });
  });

  it('rejects a prior cached reset generation and a missing endpoint marker', () => {
    const current = '2026-09-08T13:00:00+00:00';
    expect(
      strictTestLinkEpoch(
        { test_link_strict: true, test_reset_at: current },
        { test_link_strict: true, test_reset_at: '2026-09-08T12:00:00+00:00' },
        undefined,
      ),
    ).toEqual({ strict: true, epoch: current, matches: false });
  });
});
