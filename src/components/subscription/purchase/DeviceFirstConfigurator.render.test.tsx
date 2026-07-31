import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DeviceFirstConfigurator } from './DeviceFirstConfigurator';
import type {
  DeviceFirstCheckout,
  DeviceFirstOptions,
  DeviceFirstUiState,
} from '@/api/deviceFirst';

vi.mock('@/hooks/useTheme', () => ({
  useTheme: () => ({ isDark: true }),
}));
vi.mock('@/hooks/useCurrency', () => ({
  useCurrency: () => ({
    formatAmount: (value: number) => value.toFixed(2),
    currencySymbol: '₽',
  }),
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: { count?: number; amount?: number | string }) =>
      values?.amount !== undefined
        ? `${key}:${values.amount}`
        : values?.count === undefined
          ? key
          : `${key}:${values.count}`,
  }),
}));

const options: DeviceFirstOptions = {
  eligible: true,
  tariff: {
    id: 7,
    name: 'Premium',
    traffic_limit_gb: 0,
    base_device_limit: 2,
    pricing_revision: 3,
  },
  period_options: [30, 90],
  default_period_days: 30,
  device_options: [2, 5, 8],
  balance_kopeks: 10000,
  price_matrix: [
    {
      period_days: 30,
      prices: [
        {
          device_limit: 2,
          price_kopeks: 30100,
          breakdown: {
            base_price_kopeks: 30000,
            devices_price_kopeks: 0,
            promo_group_discount_kopeks: 0,
            promo_offer_discount_kopeks: 0,
          },
        },
      ],
    },
  ],
};

function checkout(uiState: DeviceFirstUiState): DeviceFirstCheckout {
  return {
    id: `checkout-${uiState}`,
    tariff_id: 7,
    target_subscription_id: null,
    period_days: 30,
    selected_device_limit: 5,
    price_breakdown: {
      base_price_kopeks: 30000,
      devices_price_kopeks: 15000,
      promo_group_discount_kopeks: 0,
      promo_offer_discount_kopeks: 0,
    },
    quoted_price_kopeks: 45000,
    max_price_kopeks: 45000,
    lifecycle_state: uiState,
    funding_state: uiState === 'awaiting_payment' ? 'insufficient' : 'funded',
    provisioning_state: uiState === 'ready' ? 'ready' : 'not_started',
    terminal_reason: null,
    ui_state: uiState,
    created_subscription_id: uiState === 'ready' ? 42 : null,
    current_device_limit: 2,
    current_subscription_is_trial: false,
    estimated_end_at: '2026-08-29T12:00:00Z',
    balance_kopeks: 10000,
    shortage_kopeks: uiState === 'awaiting_payment' ? 35000 : 0,
    top_up_surplus_kopeks: 0,
  };
}

function render(fixtureCheckout: DeviceFirstCheckout | null): string {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return renderToStaticMarkup(
    <MemoryRouter>
      <QueryClientProvider client={queryClient}>
        <DeviceFirstConfigurator
          options={options}
          fixtureCheckout={fixtureCheckout}
          fixtureMethods={[
            { key: 'sbp', provider_code: 2 },
            { key: 'cards_ru', provider_code: 11 },
          ]}
        />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

describe('DeviceFirstConfigurator real state rendering', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders C0 configuration from server-owned options', () => {
    const html = render(null);
    expect(html).toContain('role="radio"');
    expect(html).toContain('aria-checked="true"');
    expect(html).toContain('deviceFirst.review');
    expect(html).toContain('301 ₽');
    expect(html).not.toContain('301,00 ₽');
    expect(html).toContain('deviceFirst.deviceCount:2');
    expect(html).toContain('deviceFirst.perDeviceMonth:151');
    expect(html).not.toContain('role="dialog"');
  });

  it.each([
    ['configuration', 'deviceFirst.confirm'],
    ['confirmation', 'deviceFirst.payAndOrder'],
    ['awaiting_payment', 'deviceFirst.topUpAmount'],
  ] as const)(
    'renders interactive %s fixture state without a second modal overlay',
    (uiState, expectedAction) => {
      const html = render(checkout(uiState));
      expect(html).not.toContain('role="dialog"');
      expect(html).toContain(expectedAction);
      expect(html).toContain('deviceFirst.cancel');
    },
  );

  it('renders only server-approved payment methods and shortage', () => {
    const html = render(checkout('awaiting_payment'));
    expect(html).toContain('deviceFirst.sbp');
    expect(html).toContain('deviceFirst.cards');
    expect(html).not.toContain('deviceFirst.crypto');
    expect(html).toContain('350 ₽');
  });

  it('explains the provider minimum remainder when it stays on balance', () => {
    const minimumTopUp = {
      ...checkout('awaiting_payment'),
      shortage_kopeks: 10000,
      top_up_surplus_kopeks: 3000,
    };
    const html = render(minimumTopUp);

    expect(html).toContain('deviceFirst.topUpSurplusHint:30 ₽');
  });

  it.each(['processing', 'provisioning'] as const)(
    'renders honest pending state for %s',
    (uiState) => {
      const html = render(checkout(uiState));
      expect(html).toContain('role="status"');
      expect(html).toContain('deviceFirst.processingText');
      expect(html).not.toContain('deviceFirst.cancel');
      expect(html).not.toContain('deviceFirst.readyText');
    },
  );

  it('renders ready only after the server reports ready', () => {
    const html = render(checkout('ready'));
    expect(html).toContain('deviceFirst.readyText');
    expect(html).toContain('deviceFirst.home');
    expect(html).not.toContain('deviceFirst.cancel');
  });

  it('uses the short year label only in selectors and keeps the exact 365-day term in confirmation', () => {
    const annualCheckout = { ...checkout('confirmation'), period_days: 365 };
    const html = render(annualCheckout);

    expect(html).toContain('deviceFirst.periodYearExact');
    expect(html).not.toContain('deviceFirst.periodMonths:12');
  });

  it('shows a previous device limit only for an explicitly paid target subscription', () => {
    const paid = render({ ...checkout('confirmation'), current_subscription_is_trial: false });
    const trial = render({ ...checkout('confirmation'), current_subscription_is_trial: true });
    const unknown = render({ ...checkout('confirmation'), current_subscription_is_trial: null });

    expect(paid).toContain('2 → 5');
    expect(trial).not.toContain('2 → 5');
    expect(unknown).not.toContain('2 → 5');
  });

  it.each(['reprice_required', 'conflict', 'expired', 'failed', 'cancelled'] as const)(
    'renders a non-success recovery state for %s',
    (uiState) => {
      const html = render(checkout(uiState));
      expect(html).toContain('deviceFirst.refreshText');
      expect(html).not.toContain('deviceFirst.readyText');
    },
  );

  it('explains an amount-mismatch payment without implying that money was lost', () => {
    const mismatch = { ...checkout('conflict'), terminal_reason: 'payment_amount_mismatch' };
    const html = render(mismatch);

    expect(html).toContain('deviceFirst.paymentMismatchTitle');
    expect(html).toContain('deviceFirst.paymentMismatchText');
    expect(html).not.toContain('deviceFirst.refreshText');
  });
});
