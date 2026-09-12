// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const queryResults = vi.hoisted(() => new Map<string, Record<string, unknown>>());
const Blank = vi.hoisted(() => () => null);
const navigate = vi.hoisted(() => vi.fn());

vi.mock('@tanstack/react-query', () => ({
  useQuery: ({ queryKey }: { queryKey: unknown[] }) => queryResults.get(String(queryKey[0])) ?? {},
  useMutation: () => ({ mutate: vi.fn(), isPending: false }),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
vi.mock('react-router', () => ({
  Navigate: () => null,
  useNavigate: () => navigate,
  useParams: () => ({ id: '17' }),
}));
vi.mock('../components/WebBackButton', () => ({ WebBackButton: Blank }));
vi.mock('../platform/hooks/useNativeDialog', () => ({ useDestructiveConfirm: () => vi.fn() }));
vi.mock('../components/dashboard/TrafficProgressBar', () => ({ default: Blank }));
vi.mock('../components/ui/hover-border-gradient', () => ({
  HoverBorderGradient: ({ children, disabled, onClick }: ComponentProps<'button'>) => (
    <button type="button" disabled={disabled} onClick={onClick}>
      {children}
    </button>
  ),
}));
vi.mock('../hooks/useTrafficZone', () => ({ useTrafficZone: () => ({ mainHex: '#000' }) }));
vi.mock('../hooks/useTrafficRefresh', () => ({
  useTrafficRefresh: () => ({
    trafficData: null,
    refreshTrafficMutation: { isPending: false },
    trafficRefreshCooldown: 0,
  }),
}));
vi.mock('../utils/formatTraffic', () => ({ formatTraffic: () => '0 GB' }));
vi.mock('../utils/glassTheme', () => ({
  getGlassColors: () => ({
    textGhost: '',
    codeBg: '',
    codeBorder: '',
    innerBorder: '',
    trackBg: '',
    textMuted: '',
  }),
}));
vi.mock('../utils/clipboard', () => ({ copyToClipboard: vi.fn() }));
vi.mock('../hooks/useTheme', () => ({ useTheme: () => ({ isLight: false }) }));
vi.mock('../components/InsufficientBalancePrompt', () => ({ default: Blank }));
vi.mock('../hooks/useCurrency', () => ({
  useCurrency: () => ({ formatAmount: String, currencySymbol: '₽' }),
}));
vi.mock('../store/successNotification', () => ({ useCloseOnSuccessNotification: vi.fn() }));
vi.mock('../components/subscription/PurchaseCTAButton', () => ({ default: Blank }));
vi.mock('../platform', () => ({ useHaptic: () => ({ notification: vi.fn() }) }));
vi.mock('../utils/subscriptionHelpers', () => ({
  getErrorMessage: () => '',
  getInsufficientBalanceError: () => null,
  getFlagEmoji: () => '',
}));
vi.mock('react-twemoji', () => ({
  default: ({ children }: { children: unknown }) => <>{children}</>,
}));
vi.mock('../components/subscription/sheets/DeviceTopupSheet', () => ({ DeviceTopupSheet: Blank }));
vi.mock('../components/subscription/sheets/DeviceReductionSheet', () => ({
  DeviceReductionSheet: Blank,
}));
vi.mock('../components/subscription/sheets/TrafficTopupSheet', () => ({
  TrafficTopupSheet: Blank,
}));
vi.mock('../components/subscription/sheets/ServerManagementSheet', () => ({
  ServerManagementSheet: Blank,
}));
vi.mock('../components/subscription/sheets/DeleteSubscriptionSheet', () => ({
  DeleteSubscriptionSheet: Blank,
}));
vi.mock('../components/icons', () => ({
  CopyIcon: Blank,
  CheckIcon: Blank,
  PauseIcon: Blank,
  CalendarIcon: Blank,
  RefreshIcon: Blank,
  DevicesIcon: Blank,
  DownloadIcon: Blank,
  TrashIcon: Blank,
}));

import Subscription from './Subscription';

const epoch = '2026-09-08T13:00:00+00:00';
const retiredUrl = 'https://example.invalid/retired';

describe('Subscription reset-link fence', () => {
  afterEach(() => {
    queryResults.clear();
    navigate.mockClear();
    cleanup();
  });

  it('does not print or copy a cached link from the previous reset epoch', () => {
    queryResults.set('subscriptions-list', { data: { multi_tariff_enabled: false } });
    queryResults.set('subscription', {
      data: {
        has_subscription: true,
        test_link_strict: true,
        test_reset_at: epoch,
        subscription: {
          id: 17,
          status: 'active',
          is_trial: false,
          start_date: epoch,
          end_date: '2030-01-01T00:00:00+00:00',
          days_left: 1,
          hours_left: 1,
          minutes_left: 1,
          time_left_display: '1d',
          traffic_limit_gb: 0,
          traffic_used_gb: 0,
          traffic_used_percent: 0,
          device_limit: 1,
          connected_squads: [],
          servers: [],
          autopay_enabled: false,
          autopay_days_before: 3,
          subscription_url: retiredUrl,
          hide_subscription_link: false,
          is_active: true,
          is_expired: false,
          is_limited: false,
        },
      },
      isLoading: false,
      isFetchedAfterMount: true,
      isFetching: false,
    });
    queryResults.set('connection-link', {
      data: {
        subscription_url: retiredUrl,
        display_link: retiredUrl,
        happ_redirect_link: null,
        happ_scheme_link: null,
        connect_mode: 'miniapp_custom',
        hide_link: false,
        instructions: { steps: [] },
        test_link_strict: true,
        test_reset_at: '2026-09-08T12:00:00+00:00',
      },
      isLoading: false,
      isFetching: false,
      isError: false,
    });
    queryResults.set('devices', { data: { total: 1, devices: [] } });

    render(<Subscription />);

    expect(screen.queryByTitle(retiredUrl)).toBeNull();
    expect(screen.queryByLabelText('subscription.copyLink')).toBeNull();
    const connect = screen.getByRole('button', { name: /dashboard\.connectDevice/ });
    expect(connect).toHaveProperty('disabled', false);
    connect.click();
    expect(navigate).toHaveBeenCalledWith('/connection');
    expect(screen.getByText('dashboard.deviceLimitReached')).toBeTruthy();
  });

  it('does not authorise a cached ordinary URL when fresh status metadata errors', () => {
    queryResults.set('subscriptions-list', { data: { multi_tariff_enabled: false } });
    queryResults.set('subscription', {
      data: {
        has_subscription: true,
        test_link_strict: true,
        test_reset_at: epoch,
        subscription: {
          id: 17,
          status: 'active',
          is_trial: false,
          start_date: epoch,
          end_date: '2030-01-01T00:00:00+00:00',
          days_left: 1,
          hours_left: 1,
          minutes_left: 1,
          time_left_display: '1d',
          traffic_limit_gb: 0,
          traffic_used_gb: 0,
          traffic_used_percent: 0,
          device_limit: 1,
          connected_squads: [],
          servers: [],
          autopay_enabled: false,
          autopay_days_before: 3,
          subscription_url: retiredUrl,
          hide_subscription_link: false,
          is_active: true,
          is_expired: false,
          is_limited: false,
        },
      },
      isLoading: false,
      isFetchedAfterMount: true,
      isFetching: false,
      isError: true,
    });
    queryResults.set('connection-link', {
      data: {
        subscription_url: retiredUrl,
        display_link: retiredUrl,
        happ_redirect_link: null,
        happ_scheme_link: null,
        connect_mode: 'miniapp_custom',
        hide_link: false,
        instructions: { steps: [] },
        test_link_strict: true,
        test_reset_at: epoch,
      },
      isLoading: false,
      isFetching: false,
      isError: false,
    });

    render(<Subscription />);

    expect(screen.queryByTitle(retiredUrl)).toBeNull();
  });
});
