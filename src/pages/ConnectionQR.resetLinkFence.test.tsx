// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const queryResults = vi.hoisted(() => new Map<string, Record<string, unknown>>());
const navigate = vi.hoisted(() => vi.fn());
const locationState = vi.hoisted(() => ({ current: null as unknown }));

vi.mock('@tanstack/react-query', () => ({
  useQuery: ({ queryKey }: { queryKey: unknown[] }) => queryResults.get(String(queryKey[0])),
}));
vi.mock('react-router', () => ({
  useLocation: () => ({ state: locationState.current }),
  useNavigate: () => navigate,
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('qrcode.react', () => ({
  QRCodeSVG: ({ value }: { value: string }) => <output data-testid="qr">{value}</output>,
}));
vi.mock('../hooks/useBranding', () => ({ useBranding: () => ({ appName: 'Teplo' }) }));
vi.mock('@/components/admin', () => ({ AdminBackButton: () => null }));

import ConnectionQR from './ConnectionQR';

const epoch = '2026-09-08T13:00:00+00:00';
const freshUrl = 'https://example.invalid/fresh';

function setStrictFreshQueries() {
  queryResults.set('appConfig', {
    data: {
      hasSubscription: true,
      subscriptionUrl: freshUrl,
      test_link_strict: true,
      test_reset_at: epoch,
    },
    isFetchedAfterMount: true,
    isFetching: false,
    isError: false,
  });
  queryResults.set('subscription', {
    data: {
      has_subscription: true,
      subscription: null,
      test_link_strict: true,
      test_reset_at: epoch,
    },
    isFetchedAfterMount: true,
    isFetching: false,
    isError: false,
  });
  queryResults.set('connectionLink', {
    data: {
      subscription_url: freshUrl,
      display_link: freshUrl,
      happ_redirect_link: null,
      happ_scheme_link: null,
      connect_mode: 'miniapp_custom',
      hide_link: false,
      instructions: { steps: [] },
      test_link_strict: true,
      test_reset_at: epoch,
    },
    isFetching: false,
    isError: false,
  });
}

describe('ConnectionQR reset-link fence', () => {
  afterEach(() => {
    queryResults.clear();
    locationState.current = null;
    navigate.mockReset();
    cleanup();
  });

  it('rejects browser-history QR state from a prior reset generation', async () => {
    setStrictFreshQueries();
    locationState.current = {
      url: 'https://example.invalid/retired',
      hideLink: false,
      subscriptionId: 17,
      testResetAt: '2026-09-08T12:00:00+00:00',
    };

    render(<ConnectionQR />);

    expect(screen.queryByTestId('qr')).toBeNull();
    await waitFor(() =>
      expect(navigate).toHaveBeenCalledWith('/connection?sub=17', { replace: true }),
    );
  });

  it('keeps an ordinary fresh app-config QR when its optional endpoint refresh fails', () => {
    queryResults.set('appConfig', {
      data: {
        hasSubscription: true,
        subscriptionUrl: freshUrl,
        test_link_strict: false,
        test_reset_at: null,
      },
      isFetchedAfterMount: true,
      isFetching: false,
      isError: false,
    });
    queryResults.set('subscription', {
      data: {
        has_subscription: true,
        subscription: null,
        test_link_strict: false,
        test_reset_at: null,
      },
      isFetchedAfterMount: true,
      isFetching: false,
      isError: false,
    });
    queryResults.set('connectionLink', { data: undefined, isFetching: false, isError: true });
    locationState.current = { url: freshUrl, hideLink: false, subscriptionId: 17 };

    render(<ConnectionQR />);

    expect(screen.getByTestId('qr').textContent).toBe(freshUrl);
    expect(navigate).not.toHaveBeenCalled();
  });
});
