export const STAGING_RELEASE = 'cabinet-copy-success-ui-1';

export function isStagingReleaseSmoke(location: Pick<Location, 'port' | 'search'>): boolean {
  return (
    location.port === '8443' &&
    new URLSearchParams(location.search).get('release') === STAGING_RELEASE
  );
}
