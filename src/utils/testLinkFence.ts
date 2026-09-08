export interface TestLinkMetadata {
  test_link_strict?: boolean;
  test_reset_at?: string | null;
}

/** A reset bearer may be used only when every strict metadata response agrees. */
export function strictTestLinkEpoch(...metadata: Array<TestLinkMetadata | null | undefined>): {
  strict: boolean;
  epoch: string | null;
  matches: boolean;
} {
  const strictMetadata = metadata.filter(
    (item): item is TestLinkMetadata =>
      item?.test_link_strict === true || item?.test_reset_at != null,
  );
  if (!strictMetadata.length) return { strict: false, epoch: null, matches: true };

  const epoch = strictMetadata[0].test_reset_at ?? null;
  return {
    strict: true,
    epoch,
    matches:
      // `null` is a valid common generation for an enrolled tester before its
      // first reset.  Missing metadata is not equivalent to an explicit null.
      metadata.every(
        (item) =>
          item != null &&
          Object.prototype.hasOwnProperty.call(item, 'test_reset_at') &&
          (item.test_link_strict === true || metadata.length === 1) &&
          item.test_reset_at === epoch,
      ),
  };
}
