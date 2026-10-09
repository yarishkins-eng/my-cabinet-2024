// @vitest-environment jsdom

import { useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Route, Routes, MemoryRouter, useLocation, useSearchParams } from 'react-router';
import TopUpAmount from '../../../pages/TopUpAmount';
import TopUpResult from '../../../pages/TopUpResult';
import { resetRateLimit, RATE_LIMIT_KEYS } from '../../../utils/rateLimit';
import { DeviceFirstConfigurator } from './DeviceFirstConfigurator';
import {
  deviceFirstApi,
  type DeviceFirstCheckout,
  type DeviceFirstOptions,
} from '@/api/deviceFirst';

vi.mock('@/api/deviceFirst', () => ({
  deviceFirstApi: {
    getOptions: vi.fn(),
    create: vi.fn(),
    clearCreateIntents: vi.fn(),
    get: vi.fn(),
    getOpen: vi.fn(),
    getPendingPayment: vi.fn(),
    confirm: vi.fn(),
    arm: vi.fn(),
    commit: vi.fn(),
    nativeLaunch: vi.fn(),
    payDirect: vi.fn(),
    nativeLaunchDirect: vi.fn(),
    cancel: vi.fn(),
    abandon: vi.fn(),
    paymentMethods: vi.fn(),
    createPaymentAttempt: vi.fn(),
    resumeInvoice: vi.fn(),
  },
}));
// 🔴 Этап Б-2. Касса читает минимум провайдера БАЛАНСНЫМ запросом (`['payment-methods']`),
// и его модуль тянет за собой настоящий `i18n` — а он в тестовой среде не поднимается.
// Мок держит запрос под контролем: по умолчанию сервер молчит, значит сумма остаётся сырой
// разницей, а автосоздание счёта выключено. Тест, которому нужен минимум, подменяет ответ сам.
const {
  createTopUp,
  getPendingPayment,
  getLatestPayment,
  checkPaymentStatus,
  getBalancePaymentMethods,
} = vi.hoisted(() => ({
  createTopUp: vi.fn(),
  getPendingPayment: vi.fn(),
  getLatestPayment: vi.fn(),
  checkPaymentStatus: vi.fn(),
  getBalancePaymentMethods: vi.fn(),
}));
vi.mock('@/api/balance', () => ({
  balanceApi: {
    createTopUp,
    getPendingPayment,
    getLatestPayment,
    checkPaymentStatus,
    getPaymentMethods: getBalancePaymentMethods,
  },
}));
// 🔴 Пункт 1 реза 22.08.2026. `hideBackButton`/`showBackButton` больше не нужны: экран
// не подменяется, поэтому кнопку «Назад» гасить не от чего. Вместо них — `openLink`
// платформы, которым Телеграм открывает провайдера ОТДЕЛЬНОЙ поверхностью, оставляя
// мини-приложение в живых. Ходим через адаптер, как требует `eslint.config.js:60-64`.
const { openLink } = vi.hoisted(() => ({ openLink: vi.fn() }));
vi.mock('@/platform', () => ({
  usePlatform: () => ({
    openLink,
    openTelegramLink: vi.fn(),
    openInvoice: vi.fn(),
    platform: 'telegram',
    haptic: { notification: vi.fn(), impact: vi.fn(), selection: vi.fn() },
  }),
  useHaptic: () => ({ notification: vi.fn(), impact: vi.fn(), selection: vi.fn() }),
}));
const { showToast } = vi.hoisted(() => ({ showToast: vi.fn() }));
vi.mock('@/components/Toast', () => ({
  useToast: () => ({ showToast }),
}));
vi.mock('@/utils/clipboard', () => ({
  copyToClipboard: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/hooks/useCurrency', () => ({
  useCurrency: () => ({
    convertAmount: (value: number) => value,
    convertToRub: (value: number) => value,
    targetCurrency: 'RUB',
    formatAmount: (value: number) => value.toFixed(2),
    currencySymbol: '₽',
  }),
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    i18n: { language: 'ru' },
    t: (
      key: string,
      values?: {
        count?: number;
        amount?: string;
        balance?: string;
        total?: string;
        method?: string;
      },
    ) => {
      if (values?.amount) return `${key}:${values.amount}`;
      // 🔴 РЕК-8б: у строки про арифметику баланса ДВА числа, и оба обязаны доехать.
      // Без этой ветки мок вернул бы голый ключ, и сторож проверял бы наличие строки,
      // а не то, какие числа в неё подставлены.
      if (values?.balance !== undefined && values?.total !== undefined)
        return `${key}:${values.balance}:${values.total}`;
      // 🔴 РЕК-16: то же и с названием выбранного способа. Ветка стоит НИЖЕ денежной, иначе
      // `paymentMethodAmount` (у него есть и `method`, и `amount`) сменил бы форму, и все
      // прежние ожидания вида `…:450 ₽` стали бы проверять другое.
      if (values?.method !== undefined) return `${key}:${values.method}`;
      // 🔴 РЕК-16, волна 2: строка про полную оплату теперь называет ЧИСЛО — сколько денег
      // останется лежать. Без этой ветки мок вернул бы голый ключ, и сторож проверял бы
      // наличие строки, а не сумму в ней.
      if (values?.balance !== undefined) return `${key}:${values.balance}`;
      if (values?.count === undefined) return key;
      return `${key}:${values.count}`;
    },
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
const topUpMethodsResponse = [{ id: 'platega', is_available: true, min_amount_kopeks: 1 }];
const staleTopUp = [{ ...topUpMethodsResponse[0], is_available: false, min_amount_kopeks: 10000 }];

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
    settlement_mode: 'legacy_deposit',
    tariff_total_kopeks: 45000,
    wallet_applied_kopeks: 0,
    external_payable_kopeks: 0,
    funding_mode: null,
    lifecycle_state: uiState,
    funding_state: shortageKopeks ? 'partial' : 'funded',
    provisioning_state: 'not_started',
    terminal_reason: null,
    ui_state: uiState,
    created_subscription_id: null,
    current_device_limit: null,
    current_subscription_is_trial: null,
    estimated_end_at: '2026-08-29T12:00:00Z',
    expires_at: '2026-08-02T12:15:00Z',
    balance_kopeks: 45000 - shortageKopeks,
    shortage_kopeks: shortageKopeks,
    top_up_surplus_kopeks: 0,
  };
}

function directInvoice(): DeviceFirstCheckout {
  return {
    ...checkout('awaiting_payment'),
    settlement_mode: 'direct_purchase_v2',
    funding_state: 'invoice_pending',
    external_payable_kopeks: 45000,
    balance_kopeks: 0,
  };
}

const plategaPayPayload = {
  period_days: 30,
  selected_device_limit: 2,
  funding_mode: 'platega',
  method_key: 'sbp',
  expected_tariff_total_kopeks: 45000,
};

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{location.pathname + location.search}</output>;
}

// The page derives the restored checkout id from the URL; the test harness
// mirrors that exactly so navigation (drain, Back, acceptCheckout) behaves
// like production instead of freezing a static prop.
function ConfiguratorFromRoute({
  options: routeOptions = options,
  fixtureCheckout,
  fixtureMethods,
}: {
  options?: DeviceFirstOptions;
  fixtureCheckout?: DeviceFirstCheckout;
  fixtureMethods?: Array<{ key: string; provider_code: number }>;
}) {
  const [searchParams] = useSearchParams();
  return (
    <DeviceFirstConfigurator
      options={routeOptions}
      initialCheckoutId={searchParams.get('checkout')}
      fixtureCheckout={fixtureCheckout}
      fixtureMethods={fixtureMethods}
    />
  );
}

function renderConfigurator(
  props: {
    fixtureCheckout?: DeviceFirstCheckout;
    fixtureMethods?: Array<{ key: string; provider_code: number }>;
    options?: DeviceFirstOptions;
    initialPath?: string;
    seed?: (client: QueryClient) => void;
  } = {},
) {
  const { initialPath = '/subscription/purchase', seed, ...componentProps } = props;
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  seed?.(queryClient);
  // 🔴 РЕК-16: клиент запросов отдаётся наружу. Без него из теста нельзя выжать ПЕРЕЗАПРОС —
  // а два P1 волны 1 живут именно в нём: список способов уже загружен, а повторный запрос упал.
  return {
    ...render(
      <MemoryRouter initialEntries={[initialPath]}>
        <QueryClientProvider client={queryClient}>
          <LocationProbe />
          <ConfiguratorFromRoute {...componentProps} />
        </QueryClientProvider>
      </MemoryRouter>,
    ),
    queryClient,
  };
}

vi.mock('@/store/auth', () => ({
  useAuthStore: (selector: (state: { refreshUser: () => void }) => unknown) =>
    selector({ refreshUser: vi.fn() }),
}));

const flowMethods = [
  {
    id: 'platega',
    name: 'Platega',
    description: null,
    is_available: true,
    min_amount_kopeks: 100,
    max_amount_kopeks: 100000000,
    quick_amounts: [],
    options: [
      { id: '11', name: 'Карта', description: '' },
      { id: '2', name: 'СБП', description: '' },
    ],
  },
];
function flowPayment(overrides = {}) {
  return {
    id: 501,
    method: 'platega',
    amount_kopeks: 35000,
    amount_rubles: 350,
    status: 'pending',
    status_text: 'pending',
    status_emoji: '',
    is_paid: false,
    created_at: new Date().toISOString(),
    expires_at: null,
    is_checkable: true,
    payment_url: 'https://pay.example/501',
    intent_outcome: 'waiting',
    intent_payment_id: 501,
    intent_paid: false,
    intent_amount_kopeks: 35000,
    intent_period_days: 30,
    intent_devices: 2,
    intent_quote_kopeks: 45000,
    ...overrides,
  };
}
function FlowCheckout() {
  const [params] = useSearchParams();
  const incoming = useLocation();
  const [landing] = useState(() => incoming.pathname + incoming.search);
  return (
    <>
      <output data-testid="checkout-landing">{landing}</output>
      <DeviceFirstConfigurator
        options={{
          ...options,
          balance_kopeks: params.has('checkout') ? 0 : 45000,
          topup_intent_enabled: true,
        }}
        initialCheckoutId={params.get('checkout')}
      />
    </>
  );
}
function renderFlow() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  client.setQueryData(['payment-methods'], flowMethods);
  render(
    <MemoryRouter
      initialEntries={[
        '/balance/top-up/platega?amount=350&option=11&auto=1&returnTo=' +
          encodeURIComponent('/subscription/purchase?from=checkout&period=30&devices=2'),
      ]}
    >
      <QueryClientProvider client={client}>
        <LocationProbe />
        <Routes>
          <Route path="/balance/top-up/:methodId" element={<TopUpAmount />} />
          <Route path="/balance/top-up/result" element={<TopUpResult />} />
          <Route path="/subscription/purchase" element={<FlowCheckout />} />
        </Routes>
      </QueryClientProvider>
    </MemoryRouter>,
  );
  return client;
}
async function firstInvoiceBankWaiting() {
  const client = renderFlow();
  const pay = await screen.findByRole('button', { name: /balance.topUpOrder.pay:/ });
  expect(createTopUp).toHaveBeenCalledTimes(1);
  expect(createTopUp).toHaveBeenCalledWith(35000, 'platega', '11', { period_days: 30, devices: 2 });
  fireEvent.click(pay);
  expect(openLink).toHaveBeenCalledWith('https://pay.example/501');
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
  await act(async () => {
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await screen.findByText('balance.topUpResult.intent.waitingTitle');
  expect(getPendingPayment).toHaveBeenCalledWith('platega', 501);
  fireEvent.click(
    screen.getByRole('button', { name: 'balance.topUpResult.intent.continuePayment' }),
  );
  expect(openLink).toHaveBeenCalledTimes(2);
  expect(createTopUp).toHaveBeenCalledTimes(1);
  getPendingPayment.mockResolvedValue(
    flowPayment({
      intent_outcome: 'processing',
      intent_paid: true,
      is_paid: true,
      status: 'succeeded',
    }),
  );
  await act(async () => {
    await client.refetchQueries({ queryKey: ['topup-status', 'platega', 501] });
  });
  await screen.findByText('balance.topUpResult.intent.processingTitle');
  expect(
    screen.queryByRole('button', { name: 'balance.topUpResult.intent.continuePayment' }),
  ).toBeNull();
  expect(screen.getByTestId('location').textContent).toContain('/balance/top-up/result');
  return client;
}
function assertNoFrontendDebit() {
  for (const method of [
    'payDirect',
    'nativeLaunchDirect',
    'create',
    'arm',
    'commit',
    'confirm',
    'createPaymentAttempt',
  ] as const) {
    expect(deviceFirstApi[method]).not.toHaveBeenCalled();
  }
  expect(createTopUp).toHaveBeenCalledTimes(1);
}

describe('Mutation skeptic integrated money flow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    sessionStorage.clear();
    resetRateLimit(RATE_LIMIT_KEYS.PAYMENT);
    getBalancePaymentMethods.mockResolvedValue(flowMethods);
    vi.mocked(deviceFirstApi.getOptions).mockResolvedValue({
      ...options,
      topup_intent_enabled: true,
    });
    vi.mocked(deviceFirstApi.getOpen).mockResolvedValue(null);
    vi.mocked(deviceFirstApi.getPendingPayment).mockResolvedValue(null);
    vi.mocked(deviceFirstApi.paymentMethods).mockResolvedValue({
      methods: [{ key: 'cards_ru', provider_code: 11 }],
    });
    createTopUp.mockResolvedValue({
      payment_id: '501',
      payment_url: 'https://pay.example/501',
      amount_kopeks: 35000,
      amount_rubles: 350,
      intent_status: 'accepted',
      price_kopeks: 45000,
      period_days: 30,
      devices: 2,
    });
    getPendingPayment.mockResolvedValue(flowPayment());
  });
  afterEach(() => {
    cleanup();
    /* @ts-expect-error configurable test override */ delete document.visibilityState;
  });

  it('S01 first invoice → bank → waiting → processing → ready actual checkout; no repeated invoice/debit', async () => {
    const client = await firstInvoiceBankWaiting();
    vi.mocked(deviceFirstApi.get).mockResolvedValue({
      ...checkout('ready', 0),
      id: 'CO-77',
      created_subscription_id: 911,
    });
    getPendingPayment.mockResolvedValue(
      flowPayment({
        intent_outcome: 'fulfilled',
        intent_paid: true,
        is_paid: true,
        status: 'succeeded',
        intent_checkout_public_id: 'CO-77',
      }),
    );
    await act(async () => {
      await client.refetchQueries({ queryKey: ['topup-status', 'platega', 501] });
    });
    await screen.findByText('balance.topUpResult.intent.readyTitle');
    await screen.findByText('deviceFirst.ready', {}, { timeout: 4000 });
    expect(screen.getByTestId('location').textContent).toBe(
      '/subscription/purchase?checkout=CO-77',
    );
    expect(deviceFirstApi.get).toHaveBeenCalledWith('CO-77');
    assertNoFrontendDebit();
  });

  it('S02 first invoice → bank → waiting → processing → refusal → actual checkout; entering does not debit', async () => {
    const client = await firstInvoiceBankWaiting();
    getPendingPayment.mockResolvedValue(
      flowPayment({
        intent_outcome: 'refused',
        intent_paid: true,
        is_paid: true,
        status: 'succeeded',
        intent_reason: 'price_changed',
        intent_refusal_kind: 'retry',
        intent_offer_kopeks: 45000,
        intent_offer_tariff_name: 'Premium',
      }),
    );
    await act(async () => {
      await client.refetchQueries({ queryKey: ['topup-status', 'platega', 501] });
    });
    fireEvent.click(
      await screen.findByRole('button', { name: /balance.topUpResult.intent.offer/ }),
    );
    await screen.findByRole('button', { name: /deviceFirst.payAndOrder/ });
    // The actual configurator consumes period/devices/from after seeding its selection.
    expect(screen.getByTestId('checkout-landing').textContent).toBe(
      '/subscription/purchase?from=checkout&period=30&devices=2',
    );
    assertNoFrontendDebit();
  });
});
