// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const queryResults = vi.hoisted(() => new Map<string, Record<string, unknown>>());

vi.mock('@tanstack/react-query', () => ({
  useQuery: ({ queryKey }: { queryKey: unknown[] }) => queryResults.get(String(queryKey[0])),
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'en' } }),
}));
vi.mock('react-router', () => ({
  Link: ({ children }: { children: unknown }) => <>{children}</>,
  useNavigate: () => vi.fn(),
  useSearchParams: () => [new URLSearchParams('sub=17')],
}));
vi.mock('@telegram-apps/sdk-react', () => ({ openLink: vi.fn() }));
vi.mock('../hooks/useTelegramSDK', () => ({ useTelegramSDK: () => ({ isTelegramWebApp: false }) }));
vi.mock('../platform', () => ({ useHaptic: () => ({ impact: vi.fn() }) }));
vi.mock('../store/auth', () => ({
  useAuthStore: (selector: (state: unknown) => unknown) => selector({ user: null, isAdmin: false }),
}));
vi.mock('../components/connection/InstallationGuide', () => ({
  default: ({ appConfig }: { appConfig: { subscriptionUrl: string | null } }) => (
    <output data-testid="guide-url">{appConfig.subscriptionUrl}</output>
  ),
}));

import Connection from './Connection';

const epoch = '2026-09-08T13:00:00+00:00';
const freshUrl = 'https://example.invalid/fresh';
const staleUrl = 'https://example.invalid/stale';

function appConfig(overrides = {}) {
  return {
    data: {
      hasSubscription: true,
      subscriptionUrl: staleUrl,
      test_link_strict: true,
      test_reset_at: epoch,
      platforms: { ios: { apps: [{ name: 'App', blocks: [] }] } },
      ...overrides,
    },
    isLoading: false,
    isFetching: false,
    isFetchedAfterMount: true,
    isError: false,
    error: null,
  };
}

function strictSubscription(resetAt = epoch) {
  return {
    data: {
      has_subscription: true,
      subscription: null,
      test_link_strict: true,
      test_reset_at: resetAt,
    },
    isFetching: false,
    isFetchedAfterMount: true,
    isError: false,
  };
}

function link(resetAt = epoch, url = freshUrl) {
  return {
    data: {
      subscription_url: url,
      display_link: url,
      happ_redirect_link: null,
      happ_scheme_link: null,
      connect_mode: 'miniapp_custom',
      hide_link: false,
      instructions: { steps: [] },
      test_link_strict: true,
      test_reset_at: resetAt,
    },
    isLoading: false,
    isFetching: false,
    isFetchedAfterMount: true,
    isError: false,
  };
}

describe('Connection reset-link fence', () => {
  afterEach(() => {
    queryResults.clear();
    cleanup();
  });

  it('does not pass a previous reset generation into guide/template/TV sinks', () => {
    queryResults.set('appConfig', appConfig());
    queryResults.set('subscription', strictSubscription());
    queryResults.set('connectionLink', link('2026-09-08T12:00:00+00:00', staleUrl));

    render(<Connection />);

    expect(screen.queryByTestId('guide-url')).toBeNull();
  });

  it('keeps the ordinary app-config fallback when a non-strict link request fails', () => {
    queryResults.set('appConfig', appConfig({ test_link_strict: false, test_reset_at: null }));
    queryResults.set('subscription', {
      data: {
        has_subscription: true,
        subscription: null,
        test_link_strict: false,
        test_reset_at: null,
      },
      isFetching: false,
      isFetchedAfterMount: true,
      isError: false,
    });
    queryResults.set('connectionLink', {
      data: undefined,
      isLoading: false,
      isFetching: false,
      isFetchedAfterMount: true,
      isError: true,
    });

    render(<Connection />);

    expect(screen.getByTestId('guide-url').textContent).toBe(staleUrl);
  });

  it('fails closed when fresh status metadata errors instead of trusting cached false', () => {
    queryResults.set('appConfig', appConfig({ test_link_strict: false, test_reset_at: null }));
    queryResults.set('subscription', {
      data: {
        has_subscription: true,
        subscription: null,
        test_link_strict: false,
        test_reset_at: null,
      },
      isFetching: false,
      isFetchedAfterMount: true,
      isError: true,
    });
    queryResults.set('connectionLink', {
      data: undefined,
      isLoading: false,
      isFetching: false,
      isFetchedAfterMount: true,
      isError: true,
    });

    render(<Connection />);

    expect(screen.queryByTestId('guide-url')).toBeNull();
  });
});
