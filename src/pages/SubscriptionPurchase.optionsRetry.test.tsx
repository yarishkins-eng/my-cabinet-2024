// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider, onlineManager } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router';
import SubscriptionPurchase from './SubscriptionPurchase';
import { deviceFirstApi, type DeviceFirstOptions } from '@/api/deviceFirst';
import { subscriptionApi } from '../api/subscription';

vi.mock('react-i18next', async (importOriginal) => ({
  ...(await importOriginal<typeof import('react-i18next')>()),
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('@/hooks/useTheme', () => ({ useTheme: () => ({ isDark: true }) }));
vi.mock('@/store/successNotification', () => ({ useCloseOnSuccessNotification: vi.fn() }));
vi.mock('@/components/WebBackButton', () => ({ WebBackButton: () => <button>back</button> }));
vi.mock('@/components/subscription/purchase/DeviceFirstConfigurator', () => ({
  DeviceFirstConfigurator: ({ initialCheckoutId }: { initialCheckoutId?: string }) => (
    <div data-testid="device-first-configurator">
      {initialCheckoutId}
      <input aria-label="device-choice" defaultValue="1" />
    </div>
  ),
}));
vi.mock('../components/subscription/sheets/SwitchTariffSheet', () => ({
  SwitchTariffSheet: () => null,
}));
vi.mock('../components/subscription/purchase/TariffPurchaseForm', () => ({
  TariffPurchaseForm: () => null,
}));
vi.mock('../components/subscription/purchase/ClassicPurchaseWizard', () => ({
  ClassicPurchaseWizard: () => <div data-testid="classic-form" />,
}));
vi.mock('../components/subscription/purchase/TariffPickerGrid', () => ({
  TariffPickerGrid: ({ tariffs }: { tariffs: Array<{ name: string }> }) => (
    <div data-testid="old-tariff-grid">{tariffs.map((tariff) => tariff.name).join(',')}</div>
  ),
}));

const PURCHASE_OPTIONS = {
  sales_mode: 'tariffs',
  tariffs: [{ id: 3, name: 'Базовый', legacy_purchase_allowed: true }],
} as unknown as Awaited<ReturnType<typeof subscriptionApi.getPurchaseOptions>>;
const clients: QueryClient[] = [];
function renderPurchase(options?: { cache?: DeviceFirstOptions; url?: string }) {
  // Keep the component's real retry policy and React Query state transitions.
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  clients.push(client);
  if (options?.cache) {
    client.setQueryData(['device-first-options'], options.cache, {
      updatedAt: Date.now() - 60_000,
    });
    client.setQueryData(['purchase-options', undefined], PURCHASE_OPTIONS);
    client.setQueryData(['subscription', undefined], { subscription: null });
  }
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter
        initialEntries={[
          options?.url ?? '/subscription/purchase?from=checkout&period=30&devices=2',
        ]}
      >
        <SubscriptionPurchase />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return client;
}
function noPurchaseForm() {
  expect(screen.queryByTestId('old-tariff-grid')).toBeNull();
  expect(screen.queryByTestId('classic-form')).toBeNull();
  expect(screen.queryByTestId('device-first-configurator')).toBeNull();
}

beforeEach(() => {
  vi.spyOn(subscriptionApi, 'getSubscription').mockResolvedValue({ subscription: null } as never);
  vi.spyOn(subscriptionApi, 'getPurchaseOptions').mockResolvedValue(PURCHASE_OPTIONS);
  vi.spyOn(subscriptionApi, 'getSubscriptions').mockResolvedValue({
    multi_tariff_enabled: false,
  } as never);
});
afterEach(() => {
  cleanup();
  clients.splice(0).forEach((client) => client.clear());
  onlineManager.setOnline(true);
  vi.restoreAllMocks();
});

describe('Checkout loading and explicit legacy permission', () => {
  it('shows the new checkout after a successful response', async () => {
    vi.spyOn(deviceFirstApi, 'getOptions').mockResolvedValue({ eligible: true });
    renderPurchase();
    expect(await screen.findByTestId('device-first-configurator')).toBeTruthy();
    expect(screen.queryByTestId('old-tariff-grid')).toBeNull();
  });

  it('recovers after two brief errors using exactly three attempts', async () => {
    const getOptions = vi
      .spyOn(deviceFirstApi, 'getOptions')
      .mockRejectedValueOnce(new Error('network'))
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValue({ eligible: true });
    renderPurchase();
    expect(await screen.findByTestId('device-first-configurator')).toBeTruthy();
    expect(getOptions).toHaveBeenCalledTimes(3);
    expect(screen.queryByTestId('old-tariff-grid')).toBeNull();
  });

  it('exhausted HTTP failures show retry and support, never the old form', async () => {
    const getOptions = vi
      .spyOn(deviceFirstApi, 'getOptions')
      .mockRejectedValue({ response: { status: 500 } });
    renderPurchase();
    expect(await screen.findByText('subscription.checkoutLoadError')).toBeTruthy();
    expect(getOptions).toHaveBeenCalledTimes(3);
    noPurchaseForm();
    expect(screen.getByRole('link', { name: 'nav.support' }).getAttribute('href')).toBe('/support');
  });

  it.each(['ECONNABORTED', 'ETIMEDOUT'])(
    'does not automatically retry %s; manual retry restores checkout',
    async (code) => {
      const getOptions = vi
        .spyOn(deviceFirstApi, 'getOptions')
        .mockRejectedValueOnce(Object.assign(new Error('timeout'), { code }))
        .mockResolvedValue({ eligible: true });
      renderPurchase();
      expect(await screen.findByText('subscription.checkoutLoadError')).toBeTruthy();
      expect(getOptions).toHaveBeenCalledTimes(1);
      noPurchaseForm();
      fireEvent.click(screen.getByRole('button', { name: 'common.retry' }));
      expect(await screen.findByTestId('device-first-configurator')).toBeTruthy();
      expect(getOptions).toHaveBeenCalledTimes(2);
    },
  );

  it.each([
    { eligible: false },
    { eligible: false, legacy_tariff_purchase_allowed: true },
    { eligible: true },
  ])(
    'a stale cache cannot authorize a form while the initial refresh is pending: %j',
    async (cache) => {
      let resolve!: (options: DeviceFirstOptions) => void;
      vi.spyOn(deviceFirstApi, 'getOptions').mockImplementation(
        () =>
          new Promise((done) => {
            resolve = done;
          }),
      );
      renderPurchase({ cache });
      await waitFor(() => expect(deviceFirstApi.getOptions).toHaveBeenCalledTimes(1));
      noPurchaseForm();
      await act(async () => resolve({ eligible: true }));
      expect(await screen.findByTestId('device-first-configurator')).toBeTruthy();
    },
  );

  it.each([true, false])('a failed refresh does not reuse cached eligible=%s', async (eligible) => {
    vi.spyOn(deviceFirstApi, 'getOptions').mockRejectedValue({ code: 'ECONNABORTED' });
    renderPurchase({ cache: { eligible, legacy_tariff_purchase_allowed: true } });
    expect(await screen.findByText('subscription.checkoutLoadError')).toBeTruthy();
    noPurchaseForm();
  });

  it.each([
    { eligible: false, reason: 'eligible_tariff_count_not_one' },
    { eligible: false, legacy_tariff_purchase_allowed: false },
    {} as DeviceFirstOptions,
  ])('ineligibility or incomplete data alone never permits legacy: %j', async (response) => {
    vi.spyOn(deviceFirstApi, 'getOptions').mockResolvedValue(response);
    renderPurchase();
    expect(await screen.findByRole('alert')).toBeTruthy();
    noPurchaseForm();
  });

  it('keeps legacy tariffs available when the fresh API explicitly permits them', async () => {
    vi.spyOn(deviceFirstApi, 'getOptions').mockResolvedValue({
      eligible: false,
      legacy_tariff_purchase_allowed: true,
    });
    renderPurchase();
    expect(await screen.findByTestId('old-tariff-grid')).toBeTruthy();
  });

  it('only exposes explicitly allowed legacy tariffs, including with an old cached tariff entry', async () => {
    vi.spyOn(deviceFirstApi, 'getOptions').mockResolvedValue({
      eligible: false,
      legacy_tariff_purchase_allowed: true,
    });
    vi.mocked(subscriptionApi.getPurchaseOptions).mockResolvedValue({
      sales_mode: 'tariffs',
      tariffs: [
        { id: 1, name: 'Allowed', legacy_purchase_allowed: true },
        { id: 2, name: 'AP blocked', legacy_purchase_allowed: false },
        { id: 3, name: 'Unknown cached permission' },
      ],
    } as never);
    renderPurchase();
    expect((await screen.findByTestId('old-tariff-grid')).textContent).toBe('Allowed');
  });

  it('waits for fresh per-tariff permission even after fresh Device-First options arrive', async () => {
    vi.spyOn(deviceFirstApi, 'getOptions').mockResolvedValue({
      eligible: false,
      legacy_tariff_purchase_allowed: true,
    });
    let resolve!: (options: typeof PURCHASE_OPTIONS) => void;
    vi.mocked(subscriptionApi.getPurchaseOptions).mockImplementation(
      () =>
        new Promise((done) => {
          resolve = done;
        }),
    );
    renderPurchase({ cache: { eligible: false, legacy_tariff_purchase_allowed: true } });
    await waitFor(() => expect(deviceFirstApi.getOptions).toHaveBeenCalledTimes(1));
    noPurchaseForm();
    await act(async () =>
      resolve({
        sales_mode: 'tariffs',
        tariffs: [{ id: 3, name: 'Now AP', legacy_purchase_allowed: false }],
      } as never),
    );
    expect(await screen.findByText('subscription.noOptionsAvailable')).toBeTruthy();
    noPurchaseForm();
  });

  it('a background error hides the existing configurator and restores its selection after retry', async () => {
    const getOptions = vi.spyOn(deviceFirstApi, 'getOptions').mockResolvedValue({ eligible: true });
    const client = renderPurchase();
    const configurator = await screen.findByTestId('device-first-configurator');
    const input = screen.getByRole('textbox', { name: 'device-choice' }) as HTMLInputElement;
    fireEvent.change(input, { target: { value: '3' } });
    getOptions.mockRejectedValueOnce({ code: 'ECONNABORTED' });
    await act(async () => {
      await client.refetchQueries({ queryKey: ['device-first-options'] });
    });
    expect(await screen.findByText('subscription.checkoutLoadError')).toBeTruthy();
    expect(screen.getByTestId('device-first-configurator')).toBe(configurator);
    expect(configurator.parentElement?.hidden).toBe(true);
    expect(configurator.parentElement?.hasAttribute('inert')).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'common.retry' }));
    await waitFor(() => expect(configurator.parentElement?.hidden).toBe(false));
    expect(screen.getByRole('textbox', { name: 'device-choice' })).toBe(input);
    expect(input.value).toBe('3');
  });

  it('keeps classic purchases available after confirmed ineligibility', async () => {
    vi.spyOn(deviceFirstApi, 'getOptions').mockResolvedValue({
      eligible: false,
      legacy_tariff_purchase_allowed: false,
    });
    vi.mocked(subscriptionApi.getPurchaseOptions).mockResolvedValue({
      sales_mode: 'classic',
      periods: [{ id: 1 }],
    } as never);
    renderPurchase();
    expect(await screen.findByTestId('classic-form')).toBeTruthy();
  });

  it('a failed legacy options request cannot block the working new checkout', async () => {
    vi.spyOn(deviceFirstApi, 'getOptions').mockResolvedValue({ eligible: true });
    vi.mocked(subscriptionApi.getPurchaseOptions).mockRejectedValue(
      new Error('legacy unavailable'),
    );
    renderPurchase();
    expect(await screen.findByTestId('device-first-configurator')).toBeTruthy();
  });

  it('preserves invoice recovery when both options requests fail', async () => {
    vi.spyOn(deviceFirstApi, 'getOptions').mockRejectedValue({ code: 'ECONNABORTED' });
    vi.mocked(subscriptionApi.getPurchaseOptions).mockRejectedValue(new Error('offline'));
    renderPurchase({ url: '/subscription/purchase?checkout=owned-invoice' });
    expect(screen.getByTestId('device-first-configurator').textContent).toBe('owned-invoice');
    expect(screen.queryByTestId('old-tariff-grid')).toBeNull();
  });

  it('offline paused queries show a recoverable error even with cached legacy permission', async () => {
    onlineManager.setOnline(false);
    vi.spyOn(deviceFirstApi, 'getOptions').mockResolvedValue({ eligible: true });
    renderPurchase({ cache: { eligible: false, legacy_tariff_purchase_allowed: true } });
    expect(await screen.findByText('subscription.checkoutLoadError')).toBeTruthy();
    noPurchaseForm();
  });
});
