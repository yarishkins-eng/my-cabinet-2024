// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';

const { getQuote, getIntent, createIntent, purchase, createTopup, getTopup } = vi.hoisted(() => ({
  getQuote: vi.fn(),
  getIntent: vi.fn(),
  createIntent: vi.fn(),
  purchase: vi.fn(),
  createTopup: vi.fn(),
  getTopup: vi.fn(),
}));
vi.mock('@/api/deviceAddon', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/deviceAddon')>()),
  deviceAddonApi: { getQuote, getIntent, createIntent, purchase, createTopup, getTopup },
}));
const { getPaymentMethods } = vi.hoisted(() => ({ getPaymentMethods: vi.fn() }));
vi.mock('@/api/balance', () => ({ balanceApi: { getPaymentMethods } }));
vi.mock('@/store/auth', () => ({
  useAuthStore: (selector: (state: { user: { id: number } }) => unknown) =>
    selector({ user: { id: 10 } }),
}));
const { openLink, openTelegramLink } = vi.hoisted(() => ({
  openLink: vi.fn(),
  openTelegramLink: vi.fn(),
}));
vi.mock('@/platform', () => ({ usePlatform: () => ({ openLink, openTelegramLink }) }));
vi.mock('@/hooks/useTelegramSDK', () => ({ isInTelegramWebApp: () => false }));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: { amount?: string }) =>
      values?.amount === undefined ? key : `${key}:${values.amount}`,
  }),
}));

import { DeviceAddonFlow } from './DeviceAddonFlow';
import { getDeviceAddonError } from '@/api/deviceAddon';
import DeviceAddon from '@/pages/DeviceAddon';

const quote = {
  subscription_id: 44,
  devices_to_add: 2,
  original_device_limit: 2,
  new_device_limit: 4,
  max_device_limit: 10,
  included_free_devices: 0,
  chargeable_devices: 2,
  monthly_price_kopeks: 50000,
  base_price_kopeks: 25000,
  discount_percent: 0,
  price_kopeks: 12345,
  balance_kopeks: 12345,
  missing_kopeks: 0,
  days_left: 12,
  end_date: '2026-10-01T00:00:00Z',
  quote_token: 'signed-fresh-quote',
  quote_expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
};
const platega = {
  id: 'platega',
  name: 'Platega',
  description: null,
  min_amount_kopeks: 100,
  max_amount_kopeks: 1_000_000,
  is_available: true,
  quick_amounts: [],
  options: [{ id: '2', name: 'SBP', description: '' }],
};

function renderFlow(props: Partial<React.ComponentProps<typeof DeviceAddonFlow>> = {}) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return {
    queryClient: client,
    ...render(
      <MemoryRouter initialEntries={['/subscription/device-topup/intent-1?attempt=attempt-1']}>
        <QueryClientProvider client={client}>
          <DeviceAddonFlow subscriptionId={44} initialDevices={2} {...props} />
        </QueryClientProvider>
      </MemoryRouter>,
    ),
  };
}

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{location.pathname + location.search}</output>;
}

function renderNewFlowRouter() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return {
    queryClient,
    ...render(
      <MemoryRouter initialEntries={['/subscription/device-topup/new']}>
        <QueryClientProvider client={queryClient}>
          <LocationProbe />
          <Routes>
            <Route
              path="/subscription/device-topup/new"
              element={<DeviceAddonFlow subscriptionId={44} initialDevices={2} />}
            />
            <Route path="/subscription/device-topup/:intentId" element={<DeviceAddon />} />
          </Routes>
        </QueryClientProvider>
      </MemoryRouter>,
    ),
  };
}

function renderOwnedFlowRouter(intentId = 'intent-1') {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return {
    queryClient,
    ...render(
      <MemoryRouter initialEntries={[`/subscription/device-topup/${intentId}`]}>
        <QueryClientProvider client={queryClient}>
          <LocationProbe />
          <Routes>
            <Route path="/subscription/device-topup/:intentId" element={<DeviceAddon />} />
            <Route path="/subscription/device-topup/new" element={<DeviceAddon />} />
          </Routes>
        </QueryClientProvider>
      </MemoryRouter>,
    ),
  };
}

function axiosApiError(status: number, code: string, message: string, nextQuote = undefined) {
  return {
    isAxiosError: true,
    response: { status, data: { detail: { code, message, quote: nextQuote } } },
  };
}

describe('DeviceAddonFlow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    getPaymentMethods.mockResolvedValue([platega]);
  });
  afterEach(() => cleanup());

  it('offers only supported add-on methods without mutating ordinary wallet methods', async () => {
    getQuote.mockResolvedValue({ ...quote, balance_kopeks: 0, missing_kopeks: 12345 });
    const methods = [
      {
        ...platega,
        options: [
          { id: '2', name: 'SBP', description: '' },
          { id: '11', name: 'Card', description: '' },
          { id: '13', name: 'Crypto', description: '' },
        ],
      },
    ];
    getPaymentMethods.mockResolvedValue(methods);
    const { queryClient } = renderFlow();
    await screen.findByRole('button', { name: 'SBP' });
    expect(screen.getByRole('button', { name: 'Card' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Crypto' })).toBeNull();
    expect(queryClient.getQueryData(['payment-methods'])).toEqual(methods);
    expect(methods[0].options).toHaveLength(3);
    expect(createTopup).not.toHaveBeenCalled();
  });

  it('disables add-on top-up when only an unsupported wallet method is enabled', async () => {
    getQuote.mockResolvedValue({ ...quote, balance_kopeks: 0, missing_kopeks: 12345 });
    getPaymentMethods.mockResolvedValue([
      { ...platega, options: [{ id: '13', name: 'Crypto', description: '' }] },
    ]);
    renderFlow();
    await screen.findByText('subscription.deviceAddon.paymentUnavailable');
    const topup = screen.getByRole('button', { name: /subscription\.deviceAddon\.topup/ });
    expect(topup).toHaveProperty('disabled', true);
    fireEvent.click(topup);
    expect(createIntent).not.toHaveBeenCalled();
    expect(createTopup).not.toHaveBeenCalled();
  });

  it('treats a canonical paid attempt as balance credit, never as a payment URL success', async () => {
    const draft = {
      id: 'intent-1',
      subscription_id: 44,
      devices_to_add: 2,
      price_kopeks: 12345,
      purchase_state: 'draft',
      receipt: null,
      fulfillment_status: null,
      fulfillment_error_code: null,
      topup_attempts: [],
      quote,
    };
    getIntent.mockResolvedValue(draft);
    getTopup.mockResolvedValue({
      attempt: {
        id: 'attempt-1',
        intent_id: 'intent-1',
        requested_amount_kopeks: 500,
        payment_method: 'platega',
        payment_option: '2',
        provider_method_code: null,
        status: 'paid',
        credited_amount_kopeks: 500,
        can_create_new_attempt: false,
        action_required: false,
      },
      intent: { id: 'intent-1', purchase_state: 'draft', fulfillment_status: null },
      // An untrusted-looking URL must not turn the operation into a successful purchase.
      payment_url: 'https://provider.example/redirect?success=1',
    });
    purchase.mockResolvedValue({});

    renderFlow({ intentId: 'intent-1', attemptId: 'attempt-1' });

    await screen.findByText('subscription.deviceAddon.balanceCredited');
    expect(screen.queryByText('balance.goToPayment')).toBeNull();
    expect(purchase).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'subscription.deviceAddon.buy:123.45 ₽' }));
    await waitFor(() => expect(purchase).toHaveBeenCalledWith('intent-1', 'signed-fresh-quote'));
  });

  it('does not expose a financial CTA when there is no fresh server quote', async () => {
    getQuote.mockRejectedValue(new Error('quote endpoint failed'));

    renderFlow({ intentId: undefined, attemptId: undefined });

    await screen.findByText('subscription.deviceAddon.freshQuoteRequired', {}, { timeout: 2_000 });
    expect(
      screen.queryByRole('button', { name: /subscription\.deviceAddon\.(buy|topup)/ }),
    ).toBeNull();
    expect(createIntent).not.toHaveBeenCalled();
    expect(purchase).not.toHaveBeenCalled();
  });

  it('leaves the title to the outer sheet when rendered without a close handler', async () => {
    getQuote.mockResolvedValue(quote);
    renderFlow({ intentId: undefined, attemptId: undefined });
    await screen.findByRole('button', { name: 'subscription.deviceAddon.buy:123.45 ₽' });
    expect(screen.queryByText('subscription.deviceAddon.title')).toBeNull();
  });

  it('keeps close available while the intent is loading', () => {
    getIntent.mockReturnValue(new Promise(() => undefined));
    const onClose = vi.fn();
    renderFlow({ intentId: 'intent-1', attemptId: undefined, onClose });
    fireEvent.click(screen.getByRole('button', { name: 'common.close' }));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('refreshes an expired display quote but waits for a new explicit click before purchase', async () => {
    const expired = {
      ...quote,
      quote_token: 'expired-quote',
      quote_expires_at: new Date(Date.now() - 1).toISOString(),
    };
    const refreshed = { ...quote, quote_token: 'refreshed-quote' };
    getQuote.mockResolvedValueOnce(expired).mockResolvedValue(refreshed);

    renderFlow({ intentId: undefined, attemptId: undefined });

    const buy = await screen.findByRole('button', {
      name: 'subscription.deviceAddon.buy:123.45 ₽',
    });
    await waitFor(() => expect(buy.disabled).toBe(false));
    expect(createIntent).not.toHaveBeenCalled();
    expect(purchase).not.toHaveBeenCalled();

    createIntent.mockResolvedValue({
      id: 'intent-1',
      subscription_id: 44,
      devices_to_add: 2,
      price_kopeks: 12345,
      purchase_state: 'draft',
      receipt: null,
      fulfillment_status: null,
      fulfillment_error_code: null,
      topup_attempts: [],
      quote: refreshed,
    });
    purchase.mockResolvedValue({});
    fireEvent.click(buy);
    await waitFor(() => expect(purchase).toHaveBeenCalledWith('intent-1', 'refreshed-quote'));
  });

  it('keeps a historical draft readable after its target subscription is deleted, without a new invoice', async () => {
    localStorage.setItem(
      'device_addon_v1:intent:10:44',
      JSON.stringify({
        user_id: 10,
        intent_id: 'historical-intent',
        subscription_id: 44,
        devices_to_add: 2,
        idempotency_key: 'historical-key',
        created_at: Date.now(),
      }),
    );
    getIntent.mockResolvedValue({
      id: 'historical-intent',
      subscription_id: 44,
      devices_to_add: 2,
      price_kopeks: 12345,
      purchase_state: 'draft',
      receipt: null,
      fulfillment_status: null,
      fulfillment_error_code: null,
      topup_attempts: [],
      quote: null,
      quote_error: { code: 'target_unavailable', message: 'deleted subscription' },
    });

    const onClose = vi.fn();
    renderFlow({ intentId: 'historical-intent', attemptId: undefined, onClose });

    await screen.findByText('deleted subscription');
    expect(localStorage.getItem('device_addon_v1:intent:10:44')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'common.close' }));
    expect(onClose).toHaveBeenCalledOnce();
    expect(
      screen.queryByRole('button', { name: /subscription\.deviceAddon\.(buy|topup)/ }),
    ).toBeNull();
    expect(createIntent).not.toHaveBeenCalled();
    expect(createTopup).not.toHaveBeenCalled();
  });

  it('submits the quote token shown at click time even when intent creation returns a newer quote', async () => {
    const newerQuote = { ...quote, price_kopeks: 20000, quote_token: 'newer-server-quote' };
    getQuote.mockResolvedValue(quote);
    createIntent.mockResolvedValue({
      id: 'intent-1',
      subscription_id: 44,
      devices_to_add: 2,
      price_kopeks: 20000,
      purchase_state: 'draft',
      receipt: null,
      fulfillment_status: null,
      fulfillment_error_code: null,
      topup_attempts: [],
      quote: newerQuote,
    });
    purchase.mockResolvedValue({});

    renderFlow({ intentId: undefined, attemptId: undefined });
    fireEvent.click(
      await screen.findByRole('button', { name: 'subscription.deviceAddon.buy:123.45 ₽' }),
    );

    await waitFor(() =>
      expect(createIntent).toHaveBeenCalledWith('signed-fresh-quote', expect.any(String)),
    );
    expect(purchase).toHaveBeenCalledWith('intent-1', 'signed-fresh-quote');
    expect(purchase).not.toHaveBeenCalledWith('intent-1', 'newer-server-quote');
  });

  it('moves a new-flow purchase to its owned route and observes pending fulfillment until ready', async () => {
    const pending = {
      id: 'intent-1',
      subscription_id: 44,
      devices_to_add: 2,
      price_kopeks: 12345,
      purchase_state: 'purchased' as const,
      receipt: { devices_added: 2, new_device_limit: 4, amount_paid_kopeks: 12345 },
      fulfillment_status: 'pending' as const,
      fulfillment_error_code: null,
      topup_attempts: [],
    };
    const ready = { ...pending, fulfillment_status: 'ready' as const };
    getQuote.mockResolvedValue(quote);
    createIntent.mockResolvedValue({
      ...pending,
      purchase_state: 'draft',
      receipt: null,
      fulfillment_status: null,
      quote,
    });
    purchase.mockResolvedValue(pending);
    getIntent.mockResolvedValueOnce(pending).mockResolvedValue(ready);

    const { queryClient } = renderNewFlowRouter();
    fireEvent.click(
      await screen.findByRole('button', { name: 'subscription.deviceAddon.buy:123.45 ₽' }),
    );

    await waitFor(() =>
      expect(screen.getByTestId('location').textContent).toBe(
        '/subscription/device-topup/intent-1',
      ),
    );
    await screen.findByText('subscription.deviceAddon.provisioning');

    await queryClient.invalidateQueries({ queryKey: ['device-addon-intent', 'intent-1'] });
    await screen.findByText('subscription.deviceAddon.ready');
  });

  it('clears a purchased retry key and starts another purchase with the owned subscription id', async () => {
    getQuote.mockResolvedValue({
      ...quote,
      devices_to_add: 1,
      new_device_limit: 3,
      chargeable_devices: 1,
    });
    localStorage.setItem(
      'device_addon_v1:intent:10:44',
      JSON.stringify({
        user_id: 10,
        intent_id: 'intent-1',
        subscription_id: 44,
        devices_to_add: 2,
        idempotency_key: 'old-key',
        created_at: Date.now(),
      }),
    );
    getIntent.mockResolvedValue({
      id: 'intent-1',
      subscription_id: 44,
      devices_to_add: 2,
      price_kopeks: 12345,
      purchase_state: 'purchased',
      receipt: { devices_added: 2, new_device_limit: 4, amount_paid_kopeks: 12345 },
      fulfillment_status: 'ready',
      fulfillment_error_code: null,
      topup_attempts: [],
    });

    renderOwnedFlowRouter();
    const buyMore = await screen.findByRole('button', {
      name: 'subscription.deviceAddon.buyMore',
    });
    expect(localStorage.getItem('device_addon_v1:intent:10:44')).toBeNull();
    fireEvent.click(buyMore);
    await waitFor(() =>
      expect(screen.getByTestId('location').textContent).toBe(
        '/subscription/device-topup/new?subscription_id=44',
      ),
    );
    await waitFor(() => expect(getQuote).toHaveBeenCalledWith(44, 1));
    expect(screen.queryByRole('button', { name: 'subscription.deviceAddon.buyMore' })).toBeNull();
    expect(
      await screen.findByRole('button', { name: 'subscription.deviceAddon.buy:123.45 ₽' }),
    ).toBeTruthy();
  });

  it('drops a bound retry for a deleted merge draft and returns to a fresh quote', async () => {
    localStorage.setItem(
      'device_addon_v1:intent:10:44',
      JSON.stringify({
        user_id: 10,
        intent_id: 'deleted-merge-draft',
        subscription_id: 44,
        devices_to_add: 2,
        idempotency_key: 'deleted-draft-key',
        created_at: Date.now(),
      }),
    );
    getIntent.mockRejectedValue(
      axiosApiError(404, 'intent_not_found', 'Device add-on intent not found'),
    );
    getQuote.mockResolvedValue(quote);

    renderOwnedFlowRouter('deleted-merge-draft');

    await waitFor(() =>
      expect(screen.getByTestId('location').textContent).toBe(
        '/subscription/device-topup/new?subscription_id=44',
      ),
    );
    expect(localStorage.getItem('device_addon_v1:intent:10:44')).toBeNull();
    expect(
      await screen.findByRole('button', { name: 'subscription.deviceAddon.buy:123.45 ₽' }),
    ).toBeTruthy();
    expect(createIntent).not.toHaveBeenCalled();
  });

  it('lets a historical draft choose another quantity using the intent subscription id', async () => {
    getIntent.mockResolvedValue({
      id: 'intent-1',
      subscription_id: 44,
      devices_to_add: 2,
      price_kopeks: 12345,
      purchase_state: 'draft',
      receipt: null,
      fulfillment_status: null,
      fulfillment_error_code: null,
      topup_attempts: [],
      quote,
    });
    renderOwnedFlowRouter();
    fireEvent.click(
      await screen.findByRole('button', { name: 'subscription.deviceAddon.chooseAnother' }),
    );
    await waitFor(() =>
      expect(screen.getByTestId('location').textContent).toBe(
        '/subscription/device-topup/new?subscription_id=44',
      ),
    );
  });

  it('uses a server create error, clears its retry key, and retries for the same or new quantity', async () => {
    getQuote.mockResolvedValue(quote);
    createIntent.mockRejectedValue(
      axiosApiError(503, 'device_addon_purchase_disabled', 'server purchase disabled'),
    );
    renderFlow({ intentId: undefined, attemptId: undefined });
    const buy = await screen.findByRole('button', {
      name: 'subscription.deviceAddon.buy:123.45 ₽',
    });

    fireEvent.click(buy);
    await screen.findByText('server purchase disabled');
    expect(localStorage.length).toBe(0);
    fireEvent.click(buy);
    await waitFor(() => expect(createIntent).toHaveBeenCalledTimes(2));
    expect(localStorage.length).toBe(0);

    fireEvent.click(screen.getByRole('button', { name: '+' }));
    await waitFor(() => expect(getQuote).toHaveBeenCalledWith(44, 3));
    fireEvent.click(
      await screen.findByRole('button', { name: 'subscription.deviceAddon.buy:123.45 ₽' }),
    );
    await waitFor(() => expect(createIntent).toHaveBeenCalledTimes(3));
  });

  it('clears the retry key for a non-503 client error response too', async () => {
    getQuote.mockResolvedValue(quote);
    createIntent.mockRejectedValue(axiosApiError(422, 'quote_invalid', 'invalid quote'));
    renderFlow({ intentId: undefined, attemptId: undefined });
    fireEvent.click(
      await screen.findByRole('button', { name: 'subscription.deviceAddon.buy:123.45 ₽' }),
    );
    await screen.findByText('invalid quote');
    expect(localStorage.length).toBe(0);
  });

  it('keeps one idempotency key only when the create response is lost', async () => {
    getQuote.mockResolvedValue(quote);
    createIntent.mockRejectedValue({ isAxiosError: true, request: {} });
    renderFlow({ intentId: undefined, attemptId: undefined });
    const buy = await screen.findByRole('button', {
      name: 'subscription.deviceAddon.buy:123.45 ₽',
    });
    fireEvent.click(buy);
    await waitFor(() => expect(createIntent).toHaveBeenCalledTimes(1));
    const firstKey = createIntent.mock.calls[0][1];
    expect(localStorage.length).toBe(1);
    fireEvent.click(buy);
    await waitFor(() => expect(createIntent).toHaveBeenCalledTimes(2));
    expect(createIntent.mock.calls[1][1]).toBe(firstKey);
  });

  it('shows a disabled quote without loading methods or exposing any money action', async () => {
    getQuote.mockResolvedValue({
      ...quote,
      balance_kopeks: 0,
      missing_kopeks: 12345,
      purchase_enabled: false,
    });
    renderFlow({ intentId: undefined, attemptId: undefined });
    await screen.findByText('subscription.deviceAddon.purchaseUnavailable');
    expect(getPaymentMethods).not.toHaveBeenCalled();
    expect(
      screen.queryByRole('button', { name: /subscription\.deviceAddon\.(buy|topup)/ }),
    ).toBeNull();
    expect(screen.queryByText('balance.goToPayment')).toBeNull();
  });

  it('keeps an existing invoice status readable while its payment action is disabled', async () => {
    getIntent.mockResolvedValue({
      id: 'intent-1',
      subscription_id: 44,
      devices_to_add: 2,
      price_kopeks: 12345,
      purchase_state: 'draft',
      receipt: null,
      fulfillment_status: null,
      fulfillment_error_code: null,
      purchase_enabled: false,
      topup_attempts: [],
      quote: { ...quote, missing_kopeks: 500, purchase_enabled: false },
    });
    getTopup.mockResolvedValue({
      attempt: {
        id: 'attempt-1',
        intent_id: 'intent-1',
        requested_amount_kopeks: 500,
        payment_method: 'platega',
        payment_option: '2',
        status: 'pending',
        credited_amount_kopeks: null,
        can_open_payment: true,
        can_create_new_attempt: false,
        action_required: false,
      },
      intent: { id: 'intent-1', purchase_state: 'draft', fulfillment_status: null },
      payment_url: 'https://provider.example/pay',
    });

    renderFlow({ intentId: 'intent-1', attemptId: 'attempt-1' });
    await screen.findByText('subscription.deviceAddon.awaitingPayment');
    expect(
      screen.getByRole('button', { name: 'subscription.deviceAddon.checkStatus' }),
    ).toBeTruthy();
    expect(screen.queryByText('balance.goToPayment')).toBeNull();
    expect(getPaymentMethods).not.toHaveBeenCalled();
  });

  it('re-renders a 409 quote change without requesting an undefined intent', async () => {
    const changedQuote = {
      ...quote,
      price_kopeks: 20000,
      quote_token: 'changed-quote',
    };
    const draft = {
      id: 'intent-1',
      subscription_id: 44,
      devices_to_add: 2,
      price_kopeks: 12345,
      purchase_state: 'draft' as const,
      receipt: null,
      fulfillment_status: null,
      fulfillment_error_code: null,
      topup_attempts: [],
      quote: changedQuote,
    };
    getQuote.mockResolvedValue(quote);
    createIntent.mockResolvedValue({ ...draft, quote });
    getIntent.mockResolvedValue(draft);
    purchase.mockRejectedValue(axiosApiError(409, 'quote_changed', 'price changed', changedQuote));
    renderFlow({ intentId: undefined, attemptId: undefined });
    fireEvent.click(
      await screen.findByRole('button', { name: 'subscription.deviceAddon.buy:123.45 ₽' }),
    );

    const changedBuy = await screen.findByRole('button', {
      name: 'subscription.deviceAddon.buy:200 ₽',
    });
    await waitFor(() => expect(changedBuy).toHaveProperty('disabled', false));
    expect(getIntent).toHaveBeenCalled();
    expect(getIntent.mock.calls.every(([id]) => id !== undefined)).toBe(true);
  });

  it('uses the refreshed shortage after a paid invoice instead of looping into purchase', async () => {
    const refreshedQuote = { ...quote, missing_kopeks: 300, balance_kopeks: 12045 };
    getIntent.mockResolvedValue({
      id: 'intent-1',
      subscription_id: 44,
      devices_to_add: 2,
      price_kopeks: 12345,
      purchase_state: 'draft',
      receipt: null,
      fulfillment_status: null,
      fulfillment_error_code: null,
      topup_attempts: [],
      quote: refreshedQuote,
    });
    getTopup.mockResolvedValue({
      attempt: {
        id: 'attempt-1',
        intent_id: 'intent-1',
        requested_amount_kopeks: 500,
        payment_method: 'platega',
        payment_option: '2',
        provider_method_code: null,
        status: 'paid',
        credited_amount_kopeks: 500,
        can_create_new_attempt: true,
        action_required: false,
      },
      intent: { id: 'intent-1', purchase_state: 'draft', fulfillment_status: null },
    });

    renderFlow({ intentId: 'intent-1', attemptId: 'attempt-1' });

    await screen.findByText('subscription.deviceAddon.balanceCreditedStillMissing');
    expect(screen.getByRole('button', { name: 'subscription.deviceAddon.topup:3 ₽' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /subscription\.deviceAddon\.buy/ })).toBeNull();
    expect(purchase).not.toHaveBeenCalled();
  });

  it('removes a payment link when the exact attempt no longer permits opening it', async () => {
    getIntent.mockResolvedValue({
      id: 'intent-1',
      subscription_id: 44,
      devices_to_add: 2,
      price_kopeks: 12345,
      purchase_state: 'draft',
      receipt: null,
      fulfillment_status: null,
      fulfillment_error_code: null,
      topup_attempts: [],
      quote: { ...quote, missing_kopeks: 500 },
    });
    getTopup
      .mockResolvedValueOnce({
        attempt: {
          id: 'attempt-1',
          intent_id: 'intent-1',
          requested_amount_kopeks: 500,
          payment_method: 'platega',
          payment_option: '2',
          status: 'pending',
          credited_amount_kopeks: null,
          can_open_payment: true,
          can_create_new_attempt: false,
          action_required: false,
        },
        intent: { id: 'intent-1', purchase_state: 'draft', fulfillment_status: null },
        payment_url: 'https://provider.example/pay',
      })
      .mockResolvedValue({
        attempt: {
          id: 'attempt-1',
          intent_id: 'intent-1',
          requested_amount_kopeks: 500,
          payment_method: 'platega',
          payment_option: '2',
          status: 'reconciling',
          credited_amount_kopeks: null,
          can_open_payment: false,
          can_create_new_attempt: false,
          action_required: false,
        },
        intent: { id: 'intent-1', purchase_state: 'draft', fulfillment_status: null },
        payment_url: null,
      });

    const { queryClient } = renderFlow({ intentId: 'intent-1', attemptId: 'attempt-1' });
    await screen.findByText('balance.goToPayment');

    await queryClient.invalidateQueries({ queryKey: ['device-addon-topup', 'attempt-1'] });
    await waitFor(() => expect(screen.queryByText('balance.goToPayment')).toBeNull());
  });

  it('holds an operator-review attempt for support without another invoice CTA', async () => {
    const shortageQuote = { ...quote, missing_kopeks: 300, balance_kopeks: 12045 };
    getIntent.mockResolvedValue({
      id: 'intent-1',
      subscription_id: 44,
      devices_to_add: 2,
      price_kopeks: 12345,
      purchase_state: 'draft',
      receipt: null,
      fulfillment_status: null,
      fulfillment_error_code: null,
      topup_attempts: [],
      quote: shortageQuote,
    });
    getTopup.mockResolvedValue({
      attempt: {
        id: 'attempt-1',
        intent_id: 'intent-1',
        requested_amount_kopeks: 500,
        payment_method: 'platega',
        payment_option: '2',
        provider_method_code: null,
        status: 'operator_review',
        credited_amount_kopeks: null,
        can_create_new_attempt: false,
        action_required: true,
      },
      intent: { id: 'intent-1', purchase_state: 'draft', fulfillment_status: null },
    });

    renderFlow({ intentId: 'intent-1', attemptId: 'attempt-1' });

    await screen.findByText('subscription.deviceAddon.supportRequired');
    expect(screen.getByRole('link', { name: 'nav.support' }).getAttribute('href')).toBe('/support');
    expect(
      screen.queryByRole('button', { name: /subscription\.deviceAddon\.(buy|topup)/ }),
    ).toBeNull();
  });

  it('creates one durable top-up attempt on a double click and sends the backend enum', async () => {
    const shortageQuote = { ...quote, missing_kopeks: 500, balance_kopeks: 11845 };
    getQuote.mockResolvedValue(shortageQuote);
    createIntent.mockResolvedValue({
      id: 'intent-1',
      subscription_id: 44,
      devices_to_add: 2,
      price_kopeks: 12345,
      purchase_state: 'draft',
      receipt: null,
      fulfillment_status: null,
      fulfillment_error_code: null,
      topup_attempts: [],
      // A GET after intent creation could contain a changed price. It must not
      // change the invoice amount that the person explicitly requested.
      quote: { ...shortageQuote, missing_kopeks: 900, quote_token: 'newer-server-quote' },
    });
    createTopup.mockResolvedValue({
      attempt: {
        id: 'attempt-1',
        intent_id: 'intent-1',
        requested_amount_kopeks: 500,
        payment_method: 'platega',
        payment_option: '2',
        provider_method_code: null,
        status: 'pending',
        credited_amount_kopeks: null,
        can_open_payment: true,
        can_create_new_attempt: false,
        action_required: false,
      },
      payment_url: 'https://provider.example/pay',
      return_start_param: 'dtu-11111111-1111-4111-8111-111111111111',
    });

    renderFlow({ intentId: undefined, attemptId: undefined });
    const topup = await screen.findByRole('button', {
      name: 'subscription.deviceAddon.topup:5 ₽',
    });
    await waitFor(() => expect(topup.disabled).toBe(false));
    fireEvent.click(topup);
    fireEvent.click(topup);

    await waitFor(() => expect(createTopup).toHaveBeenCalledTimes(1));
    expect(createIntent).toHaveBeenCalledTimes(1);
    expect(createTopup).toHaveBeenCalledWith(
      'intent-1',
      expect.objectContaining({
        expected_amount_kopeks: 500,
        payment_method: 'platega',
        payment_option: '2',
        return_surface: 'cabinet',
      }),
    );
  });

  it('unwraps the actual FastAPI detail envelope for a rejected price fence', () => {
    const error = {
      isAxiosError: true,
      response: { data: { detail: { code: 'funding_changed', message: 'changed', quote } } },
    };
    expect(getDeviceAddonError(error)).toEqual({
      code: 'funding_changed',
      message: 'changed',
      quote,
    });
  });
});
