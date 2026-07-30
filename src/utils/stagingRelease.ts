export const STAGING_THEME_CONTEXT_RELEASE = 'cabinet-6020269';

export function isStagingThemeContextSmoke(location: Pick<Location, 'port' | 'search'>): boolean {
  return (
    location.port === '8443' &&
    new URLSearchParams(location.search).get('release') === STAGING_THEME_CONTEXT_RELEASE
  );
}
