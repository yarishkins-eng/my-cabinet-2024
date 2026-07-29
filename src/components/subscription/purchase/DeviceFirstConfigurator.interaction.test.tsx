// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, useLocation } from 'react-router';
import { DeviceFirstConfigurator } from './DeviceFirstConfigurator';
import {
  deviceFirstApi,
  type DeviceFirstCheckout,
  type DeviceFirstOptions,
} from '@/api/deviceFirst';

vi.mock('@/api/deviceFirst', () => ({
  deviceFirstApi: {
    create: vi.fn(),
    get: vi.fn(),
    confirm: vi.fn(),
    arm: vi.fn(),
    cancel: vi.fn(),
    paymentMethods: vi.fn(),
    createPaymentAttempt: vi.fn(),
  },
}));
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
    t: (key: string, values?: { count?: number; amount?: string }) =>
      values?.amount
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
  period_options: [30],
  default_period_days: 30,
  device_options: [2],
  balance_kopeks: 10000,
  price_matrix: [
    {
      period_days: 30,
      prices: [
        {
          device_limit: 2,
          price_kopeks: 45000,
          breakdown: {
            base_price_kopeks: 45000,
            devices_price_kopeks: 0,
            promo_group_discount_kopeks: 0,
            promo_offer_discount_kopeks: 0,
          },
        },
      ],
    },
  ],
};

function checkout(
  uiState: DeviceFirstCheckout['ui_state'],
  shortageKopeks = 35000,
): DeviceFirstCheckout {
  return {
    id: 'checkout-owned',
    tariff_id: 7,
    target_subscription_id: null,
    period_days: 30,
    selected_device_limit: 2,
    price_breakdown: options.price_matrix![0].prices[0].breakdown,
    quoted_price_kopeks: 45000,
    max_price_kopeks: 45000,
    lifecycle_state: uiState,
    funding_state: shortageKopeks ? 'partial' : 'funded',
    provisioning_state: 'not_started',
    terminal_reason: null,
    ui_state: uiState,
    created_subscription_id: null,
    current_device_limit: null,
    estimated_end_at: '2026-08-29T12:00:00Z',
    balance_kopeks: 45000 - shortageKopeks,
    shortage_kopeks: shortageKopeks,
  };
}

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{location.pathname + location.search}</output>;
}

function renderConfigurator(
  props: {
    initialCheckoutId?: string;
    fixtureCheckout?: DeviceFirstCheckout;
  } = {},
) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <MemoryRouter initialEntries={['/subscription/purchase']}>
      <QueryClientProvider client={queryClient}>
        <LocationProbe />
        <DeviceFirstConfigurator options={options} {...props} />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

describe('DeviceFirstConfigurator interaction safety', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(deviceFirstApi.paymentMethods).mockResolvedValue({
      methods: [{ key: 'sbp', provider_code: 2 }],
    });
  });

  afterEach(() => cleanup());

  it('creates once, persists checkout in the URL, then uses the explicit financial consent CTA', async () => {
    let resolveCreate!: (value: DeviceFirstCheckout) => void;
    vi.mocked(deviceFirstApi.create).mockReturnValue(
      new Promise((resolve) => {
        resolveCreate = resolve;
      }),
    );
    vi.mocked(deviceFirstApi.confirm).mockResolvedValue(checkout('confirmation'));
    vi.mocked(deviceFirstApi.arm).mockResolvedValue(checkout('awaiting_payment'));
    renderConfigurator();

    const review = screen.getByRole('button', { name: 'deviceFirst.review' });
    fireEvent.click(review);
    await waitFor(() => expect(deviceFirstApi.create).toHaveBeenCalledTimes(1));
    fireEvent.click(review);
    expect(deviceFirstApi.create).toHaveBeenCalledTimes(1);

    resolveCreate(checkout('configuration'));
    await waitFor(() =>
      expect(screen.getByTestId('location').textContent).toContain('checkout=checkout-owned'),
    );

    fireEvent.click(screen.getByRole('button', { name: 'deviceFirst.confirm' }));
    const financialConsent = await screen.findByRole('button', {
      name: 'deviceFirst.topUpAndOrder:350.00 ₽',
    });
    fireEvent.click(financialConsent);

    await waitFor(() => expect(deviceFirstApi.arm).toHaveBeenCalledWith('checkout-owned'));
  });

  it('restores a returned checkout without needing purchase options and resumes it by id', async () => {
    vi.mocked(deviceFirstApi.get).mockResolvedValue(checkout('provisioning'));
    renderConfigurator({ initialCheckoutId: 'checkout-owned' });

    await waitFor(() => expect(deviceFirstApi.get).toHaveBeenCalledWith('checkout-owned'));
    expect(await screen.findByText('deviceFirst.processingText')).toBeTruthy();
  });

  it('uses Continue only when the server reports that no shortage remains', async () => {
    vi.mocked(deviceFirstApi.arm).mockResolvedValue(checkout('processing', 0));
    renderConfigurator({ fixtureCheckout: checkout('awaiting_payment', 0) });

    fireEvent.click(screen.getByRole('button', { name: 'deviceFirst.continueAndOrder' }));

    await waitFor(() => expect(deviceFirstApi.arm).toHaveBeenCalledWith('checkout-owned'));
  });

  it.each(['processing', 'provisioning'] as const)(
    'does not offer cancellation after financial work starts in %s',
    (uiState) => {
      renderConfigurator({ fixtureCheckout: checkout(uiState, 0) });
      expect(screen.queryByRole('button', { name: 'deviceFirst.cancel' })).toBeNull();
    },
  );
});
