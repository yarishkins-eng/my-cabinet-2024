// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, useLocation, useSearchParams } from 'react-router';
import { DeviceFirstConfigurator } from './DeviceFirstConfigurator';
import {
  deviceFirstApi,
  type DeviceFirstCheckout,
  type DeviceFirstOptions,
} from '@/api/deviceFirst';

vi.mock('@/api/deviceFirst', () => ({
  deviceFirstApi: {
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
vi.mock('@telegram-apps/sdk-react', () => ({
  hideBackButton: vi.fn(),
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
  } = {},
) {
  const { initialPath = '/subscription/purchase', ...componentProps } = props;
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <MemoryRouter initialEntries={[initialPath]}>
      <QueryClientProvider client={queryClient}>
        <LocationProbe />
        <ConfiguratorFromRoute {...componentProps} />
      </QueryClientProvider>
    </MemoryRouter>,
  );
}

describe('DeviceFirstConfigurator interaction safety', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(deviceFirstApi.get).mockResolvedValue(checkout('awaiting_payment'));
    vi.mocked(deviceFirstApi.paymentMethods).mockResolvedValue({
      methods: [{ key: 'sbp', provider_code: 2 }],
    });
    vi.mocked(deviceFirstApi.getPendingPayment).mockResolvedValue({
      redirect_url: null,
      status: 'pending',
      resume_allowed: false,
    });
  });

  const realLocation = window.location;
  afterEach(() => {
    Object.defineProperty(window, 'location', { value: realLocation, writable: true });
    cleanup();
  });

  // --- мина X: экран не залипает на «Недоступно» ---------------------------------

  it('picks a real device option once the tariff arrives instead of freezing on a phantom one', async () => {
    // 🔴 Холодная загрузка по адресу возврата с Platega: опции ещё не пришли, и запасное
    // «1 устройство» попадает в выбор. Такого варианта нет ни в одном тарифе, поэтому
    // цена не находится ни для одного срока — все они уходят в «Недоступно».
    const { rerender } = render(
      <MemoryRouter initialEntries={['/subscription/purchase']}>
        <QueryClientProvider
          client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
        >
          <DeviceFirstConfigurator options={{ eligible: true }} />
        </QueryClientProvider>
      </MemoryRouter>,
    );
    // На пустых опциях сроков ещё нет вовсе — важно, ЧТО будет, когда они придут:
    // без синхронизации выбор останется «1 устройство», и каждый срок уйдёт в «Недоступно».

    rerender(
      <MemoryRouter initialEntries={['/subscription/purchase']}>
        <QueryClientProvider
          client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
        >
          <DeviceFirstConfigurator options={options} />
        </QueryClientProvider>
      </MemoryRouter>,
    );

    await waitFor(() => expect(screen.queryByText(/deviceFirst\.unavailable/)).toBeNull());
    // И выбрана именно карточка устройства: без неё ни одна не попадает в tab-порядок
    // (`tabIndex={isSelected ? 0 : -1}`), то есть с клавиатуры экран был недостижим.
    const deviceCard = screen.getByText('deviceFirst.deviceCount:2').closest('button');
    expect(deviceCard?.getAttribute('aria-checked')).toBe('true');
    expect(deviceCard?.getAttribute('tabindex')).toBe('0');
  });

  it('never rewrites the selection under an open confirmation', async () => {
    // 🔴 Сторож от молчаливой подмены цены. `confirmDeviceLimit` берётся из того же
    // `devices` (`DeviceFirstConfigurator.tsx:261-262`), поэтому подтяжка выбора без
    // гарда переписала бы сумму под кнопкой оплаты — ту, которую человек уже прочитал.
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    });
    const tree = (routeOptions: DeviceFirstOptions) => (
      <MemoryRouter initialEntries={['/subscription/purchase']}>
        <QueryClientProvider client={queryClient}>
          <LocationProbe />
          <ConfiguratorFromRoute options={routeOptions} />
        </QueryClientProvider>
      </MemoryRouter>
    );

    const { rerender } = render(tree(options));
    fireEvent.click(await screen.findByText('deviceFirst.review'));
    // Цена подтверждённого выбора стоит прямо на кнопке оплаты: 45000 копеек → 450.
    await waitFor(() => expect(screen.getByText(/paymentMethodAmount:450/)).toBeTruthy());

    // Тариф под открытым подтверждением поменялся: другой набор вариантов и другая цена.
    rerender(
      tree({
        ...options,
        period_options: [90],
        default_period_days: 90,
        device_options: [6],
        price_matrix: [
          {
            period_days: 90,
            prices: [
              {
                device_limit: 6,
                price_kopeks: 99000,
                breakdown: options.price_matrix![0].prices[0].breakdown,
              },
            ],
          },
        ],
      }),
    );

    // 🔴 Чужая сумма не смеет появиться под тем же открытым подтверждением. Без гарда
    // выбор переехал бы на 6 устройств / 90 дней, и на кнопке оплаты встало бы 990
    // вместо прочитанных человеком 450.
    expect(screen.queryByText(/paymentMethodAmount:990/)).toBeNull();
    // Честный исход, когда прежний вариант действительно исчез: не подмена цены, а
    // прямое «этого варианта больше нет» с путём назад к выбору.
    expect(screen.getByText('deviceFirst.changeOptions')).toBeTruthy();
  });

  it('hides the back button on the fused native launch too, where the jump is a replace', async () => {
    // 🔴 Шестой переход — `replace`, а не `assign`: поиском по `assign` он не находится,
    // и мутация «убрать его из помощника» переживала весь набор.
    const { hideBackButton } = await import('@telegram-apps/sdk-react');
    const replace = vi.fn();
    Object.defineProperty(window, 'location', {
      value: { ...window.location, assign: vi.fn(), replace },
      writable: true,
    });
    vi.mocked(deviceFirstApi.nativeLaunchDirect).mockResolvedValue({
      checkout: directInvoice(),
      redirect_url: 'https://app.platega.io/pay/native',
    });

    renderConfigurator({
      initialPath: '/subscription/purchase?period=30&devices=2&method=sbp&autostart=1',
    });

    await waitFor(() => expect(replace).toHaveBeenCalledWith('https://app.platega.io/pay/native'));
    expect(vi.mocked(hideBackButton)).toHaveBeenCalled();
  });

  it('hides the back button BEFORE leaving, not after', async () => {
    // Порядок и есть вся правка: после ухода наш код уже не исполняется.
    const { hideBackButton } = await import('@telegram-apps/sdk-react');
    const order: string[] = [];
    vi.mocked(hideBackButton).mockImplementation(() => {
      order.push('hide');
    });
    Object.defineProperty(window, 'location', {
      value: {
        ...window.location,
        assign: vi.fn(() => order.push('leave')),
        replace: vi.fn(),
      },
      writable: true,
    });
    vi.mocked(deviceFirstApi.payDirect).mockResolvedValue({
      checkout: directInvoice(),
      redirect_url: 'https://app.platega.io/pay/2',
    });

    renderConfigurator();
    fireEvent.click(await screen.findByText('deviceFirst.review'));
    fireEvent.click(await screen.findByText(/deviceFirst\.paymentMethodAmount/));

    await waitFor(() => expect(order).toContain('leave'));
    expect(order).toEqual(['hide', 'leave']);
  });

  it('also snaps the period when the tariff no longer sells it', async () => {
    // Вторая ось мины X: у устройств и сроков одна болезнь, а тест был только про устройства.
    const ninetyOnly: DeviceFirstOptions = {
      ...options,
      period_options: [90],
      default_period_days: 90,
      device_options: [2],
      price_matrix: [
        {
          period_days: 90,
          prices: [
            {
              device_limit: 2,
              price_kopeks: 99000,
              breakdown: options.price_matrix![0].prices[0].breakdown,
            },
          ],
        },
      ],
    };
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const tree = (routeOptions: DeviceFirstOptions) => (
      <MemoryRouter initialEntries={['/subscription/purchase']}>
        <QueryClientProvider client={queryClient}>
          <ConfiguratorFromRoute options={routeOptions} />
        </QueryClientProvider>
      </MemoryRouter>
    );

    const { rerender } = render(tree(options));
    rerender(tree(ninetyOnly));

    await waitFor(() => expect(screen.queryByText(/deviceFirst\.unavailable/)).toBeNull());
  });

  it('keeps the selection the person made when the provider cancels the invoice', async () => {
    // 🔴 Провайдер закрыл счёт → нас молча уводит на экран выбора. Раньше выбор человека
    // при этом терялся: он оформлял 6 устройств на 90 дней, а видел первый попавшийся
    // вариант и мог не заметить, что покупает другое.
    const wide: DeviceFirstOptions = {
      ...options,
      period_options: [30, 90],
      device_options: [2, 6],
      price_matrix: [
        options.price_matrix![0],
        {
          period_days: 90,
          prices: [
            {
              device_limit: 6,
              price_kopeks: 99000,
              breakdown: options.price_matrix![0].prices[0].breakdown,
            },
          ],
        },
      ],
    };
    const cancelledRow: DeviceFirstCheckout = {
      ...checkout('cancelled'),
      settlement_mode: 'direct_purchase_v2',
      period_days: 90,
      selected_device_limit: 6,
      terminal_reason: 'provider_terminal:canceled',
    };
    vi.mocked(deviceFirstApi.get).mockResolvedValue(cancelledRow);

    renderConfigurator({
      options: wide,
      initialPath: '/subscription/purchase?checkout=checkout-owned',
    });

    // Экран выбора вернулся — и на нём стоит ЕГО конфигурация, а не первая попавшаяся.
    await waitFor(() =>
      expect(
        screen
          .getByText('deviceFirst.deviceCount:6')
          .closest('button')
          ?.getAttribute('aria-checked'),
      ).toBe('true'),
    );
    expect(
      screen.getByText('deviceFirst.deviceCount:2').closest('button')?.getAttribute('aria-checked'),
    ).toBe('false');
  });

  it('takes its pagehide listener with it when the screen unmounts', async () => {
    // Экран может уйти, так и не уведя человека к провайдеру (ошибка перехода, уход по
    // меню). Оставленный слушатель погасил бы кнопку «Назад» на чужом экране.
    const removeSpy = vi.spyOn(window, 'removeEventListener');
    Object.defineProperty(window, 'location', {
      value: { ...window.location, assign: vi.fn(), replace: vi.fn() },
      writable: true,
    });
    vi.mocked(deviceFirstApi.payDirect).mockResolvedValue({
      checkout: directInvoice(),
      redirect_url: 'https://app.platega.io/pay/3',
    });

    const { unmount } = renderConfigurator();
    fireEvent.click(await screen.findByText('deviceFirst.review'));
    fireEvent.click(await screen.findByText(/deviceFirst\.paymentMethodAmount/));
    await waitFor(() => expect(window.location.assign).toHaveBeenCalled());

    unmount();
    expect(removeSpy).toHaveBeenCalledWith('pagehide', expect.any(Function));
    removeSpy.mockRestore();
  });

  // --- мина W: мёртвой кнопки «Назад» на странице провайдера не остаётся ----------

  it('hides the dead back button before leaving for the payment provider', async () => {
    const { hideBackButton } = await import('@telegram-apps/sdk-react');
    const assign = vi.fn();
    Object.defineProperty(window, 'location', {
      value: { ...window.location, assign, replace: vi.fn() },
      writable: true,
    });
    vi.mocked(deviceFirstApi.payDirect).mockResolvedValue({
      checkout: directInvoice(),
      redirect_url: 'https://app.platega.io/pay/1',
    });

    renderConfigurator();
    fireEvent.click(await screen.findByText('deviceFirst.review'));
    fireEvent.click(await screen.findByText(/deviceFirst\.paymentMethodAmount/));

    await waitFor(() => expect(assign).toHaveBeenCalledWith('https://app.platega.io/pay/1'));
    // Кнопка гасится ДО ухода: на чужой странице наш обработчик уже не существует,
    // и нажатие уходило бы в пустоту.
    expect(vi.mocked(hideBackButton)).toHaveBeenCalled();
  });

  it('confirms locally without a server order and births it only from the payment CTA', async () => {
    vi.mocked(deviceFirstApi.payDirect).mockResolvedValue({ checkout: directInvoice() });
    vi.mocked(deviceFirstApi.get).mockResolvedValue(directInvoice());
    renderConfigurator();

    fireEvent.click(screen.getByRole('button', { name: 'deviceFirst.review' }));

    // The confirmation step is local: nothing was created server-side and the
    // URL still carries no durable checkout id.
    expect(deviceFirstApi.payDirect).not.toHaveBeenCalled();
    expect(deviceFirstApi.create).not.toHaveBeenCalled();
    expect(screen.getByTestId('location').textContent).toBe('/subscription/purchase');
    const financialConsent = await screen.findByRole('button', {
      name: 'deviceFirst.paymentMethodAmount:450 ₽',
    });
    // The balance does not cover the price: provider methods are the only
    // payment CTAs, no wallet button and no duplicate order action.
    expect(screen.queryByRole('button', { name: /deviceFirst.payAndOrder/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'deviceFirst.confirm' })).toBeNull();
    fireEvent.click(financialConsent);

    await waitFor(() => expect(deviceFirstApi.payDirect).toHaveBeenCalledWith(plategaPayPayload));
    expect(deviceFirstApi.payDirect).toHaveBeenCalledTimes(1);
    expect(deviceFirstApi.create).not.toHaveBeenCalled();
    expect(deviceFirstApi.confirm).not.toHaveBeenCalled();
    expect(deviceFirstApi.commit).not.toHaveBeenCalled();
    expect(deviceFirstApi.arm).not.toHaveBeenCalled();
    // The fused response is the canonical server checkout; its id becomes the
    // durable recovery handle.
    await waitFor(() =>
      expect(screen.getByTestId('location').textContent).toContain('checkout=checkout-owned'),
    );
    expect(await screen.findByRole('button', { name: 'deviceFirst.changeOptions' })).toBeTruthy();
  });

  it('keeps a direct invoice resumable while changing options and requires a separate abandon confirmation', async () => {
    vi.mocked(deviceFirstApi.abandon).mockResolvedValue({
      ...directInvoice(),
      lifecycle_state: 'cancelled',
      ui_state: 'cancelled',
    });

    renderConfigurator({ fixtureCheckout: directInvoice() });

    fireEvent.click(screen.getByRole('button', { name: 'deviceFirst.cancel' }));
    expect(deviceFirstApi.abandon).not.toHaveBeenCalled();
    expect(screen.getByText('deviceFirst.abandonTitle')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'deviceFirst.abandonConfirm' }));
    await waitFor(() => expect(deviceFirstApi.abandon).toHaveBeenCalledWith('checkout-owned'));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'deviceFirst.review' })).toBeTruthy(),
    );
  });

  it('returns to configuration without abandoning a direct invoice and resumes that exact invoice at pay time', async () => {
    vi.mocked(deviceFirstApi.payDirect).mockResolvedValue({ checkout: directInvoice() });
    renderConfigurator({ fixtureCheckout: directInvoice() });

    fireEvent.click(screen.getByRole('button', { name: 'deviceFirst.changeOptions' }));
    expect(deviceFirstApi.abandon).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'deviceFirst.review' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'deviceFirst.review' }));
    expect(deviceFirstApi.create).not.toHaveBeenCalled();
    expect(deviceFirstApi.confirm).not.toHaveBeenCalled();
    fireEvent.click(
      await screen.findByRole('button', { name: 'deviceFirst.paymentMethodAmount:450 ₽' }),
    );

    // The server resolves the resume: the same invoice comes back and no new
    // payment transition was ever requested from the browser.
    await waitFor(() => expect(deviceFirstApi.payDirect).toHaveBeenCalledWith(plategaPayPayload));
    expect(deviceFirstApi.payDirect).toHaveBeenCalledTimes(1);
    expect(deviceFirstApi.abandon).not.toHaveBeenCalled();
    expect(await screen.findByRole('button', { name: 'deviceFirst.changeOptions' })).toBeTruthy();
  });

  it('consumes the Telegram fused-launch query once and calls only the fused native endpoint', async () => {
    vi.mocked(deviceFirstApi.nativeLaunchDirect).mockReturnValue(new Promise(() => {}));

    renderConfigurator({
      initialPath: '/subscription/purchase?period=30&devices=2&method=sbp&autostart=1',
    });

    await waitFor(() =>
      expect(deviceFirstApi.nativeLaunchDirect).toHaveBeenCalledWith(plategaPayPayload),
    );
    expect(deviceFirstApi.nativeLaunchDirect).toHaveBeenCalledTimes(1);
    expect(deviceFirstApi.nativeLaunch).not.toHaveBeenCalled();
    expect(deviceFirstApi.payDirect).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(screen.getByTestId('location').textContent).toBe('/subscription/purchase'),
    );
  });

  it('never launches an unavailable query method and removes its one-shot parameters', async () => {
    renderConfigurator({
      initialPath: '/subscription/purchase?period=30&devices=2&method=cards_ru&autostart=1',
    });

    expect(
      (await screen.findAllByRole('alert')).some((alert) =>
        alert.textContent?.includes('deviceFirst.errorPaymentMethod'),
      ),
    ).toBe(true);
    expect(deviceFirstApi.nativeLaunchDirect).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(screen.getByTestId('location').textContent).toBe('/subscription/purchase'),
    );
  });

  it('does not launch payment when live payment methods cannot be loaded', async () => {
    vi.mocked(deviceFirstApi.paymentMethods).mockRejectedValue(new Error('offline'));

    renderConfigurator({
      initialPath: '/subscription/purchase?period=30&devices=2&method=sbp&autostart=1',
    });

    expect(
      (await screen.findAllByRole('alert')).some((alert) =>
        alert.textContent?.includes('deviceFirst.errorPaymentMethodsLoad'),
      ),
    ).toBe(true);
    expect(deviceFirstApi.nativeLaunchDirect).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(screen.getByTestId('location').textContent).toBe('/subscription/purchase'),
    );
  });

  it('never launches an unknown URL selection and keeps the showcase honest', async () => {
    renderConfigurator({
      initialPath: '/subscription/purchase?period=14&devices=2&method=sbp&autostart=1',
    });

    expect(
      (await screen.findAllByRole('alert')).some((alert) =>
        alert.textContent?.includes('deviceFirst.errorSelectionChanged'),
      ),
    ).toBe(true);
    expect(deviceFirstApi.nativeLaunchDirect).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(screen.getByTestId('location').textContent).toBe('/subscription/purchase'),
    );
    expect(screen.getByRole('button', { name: 'deviceFirst.review' })).toBeTruthy();
  });

  it('does not expose payment CTAs while the pay mutation is in flight', async () => {
    vi.mocked(deviceFirstApi.payDirect).mockReturnValue(new Promise(() => {}));
    renderConfigurator();

    fireEvent.click(screen.getByRole('button', { name: 'deviceFirst.review' }));
    fireEvent.click(
      await screen.findByRole('button', { name: 'deviceFirst.paymentMethodAmount:450 ₽' }),
    );

    await waitFor(() => expect(screen.getByText('deviceFirst.openingPayment')).toBeTruthy());
    expect(
      screen.queryByRole('button', { name: 'deviceFirst.paymentMethodAmount:450 ₽' }),
    ).toBeNull();
    expect(screen.queryByRole('button', { name: 'deviceFirst.changeOptions' })).toBeNull();
    expect(deviceFirstApi.payDirect).toHaveBeenCalledTimes(1);
  });

  it('restores a returned checkout without needing purchase options and resumes it by id', async () => {
    vi.mocked(deviceFirstApi.get).mockResolvedValue(checkout('provisioning'));
    renderConfigurator({ initialPath: '/subscription/purchase?checkout=checkout-owned' });

    await waitFor(() => expect(deviceFirstApi.get).toHaveBeenCalledWith('checkout-owned'));
    expect(await screen.findByText('deviceFirst.processingText')).toBeTruthy();
  });

  it('resumes the only server-owned open order instead of hiding its conflict behind a generic error', async () => {
    vi.mocked(deviceFirstApi.payDirect).mockRejectedValue({
      response: { data: { detail: { code: 'open_checkout_exists' } } },
    });
    vi.mocked(deviceFirstApi.getOpen).mockResolvedValue(directInvoice());
    renderConfigurator();

    fireEvent.click(screen.getByRole('button', { name: 'deviceFirst.review' }));
    fireEvent.click(
      await screen.findByRole('button', { name: 'deviceFirst.paymentMethodAmount:450 ₽' }),
    );

    await waitFor(() => expect(deviceFirstApi.getOpen).toHaveBeenCalledTimes(1));
    // The canonical invoice screen explains itself instead of a dead generic
    // failure.
    expect(await screen.findByRole('button', { name: 'deviceFirst.changeOptions' })).toBeTruthy();
    expect(await screen.findByText('deviceFirst.errorResumeOrder')).toBeTruthy();
    expect(screen.queryByText('deviceFirst.error')).toBeNull();
  });

  it('clears only stale create intents when a conflicting order disappears before recovery', async () => {
    vi.mocked(deviceFirstApi.payDirect).mockRejectedValue({
      response: { data: { detail: { code: 'open_checkout_exists' } } },
    });
    vi.mocked(deviceFirstApi.getOpen).mockRejectedValue({
      response: { status: 404, data: { detail: { code: 'no_open_checkout' } } },
    });
    renderConfigurator();

    fireEvent.click(screen.getByRole('button', { name: 'deviceFirst.review' }));
    fireEvent.click(
      await screen.findByRole('button', { name: 'deviceFirst.paymentMethodAmount:450 ₽' }),
    );

    await waitFor(() => expect(deviceFirstApi.clearCreateIntents).toHaveBeenCalledTimes(1));
    expect(await screen.findByText('deviceFirst.errorResumeUnavailable')).toBeTruthy();
  });

  it('explains a historical pending trial hold and offers support instead of a generic error', async () => {
    vi.mocked(deviceFirstApi.payDirect).mockRejectedValue({
      response: { data: { detail: { code: 'legacy_trial_reconciliation_required' } } },
    });
    renderConfigurator();

    fireEvent.click(screen.getByRole('button', { name: 'deviceFirst.review' }));
    fireEvent.click(
      await screen.findByRole('button', { name: 'deviceFirst.paymentMethodAmount:450 ₽' }),
    );

    expect(await screen.findByText('deviceFirst.errorLegacyTrialReconciliation')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'deviceFirst.contactSupport' })).toBeTruthy();
  });

  it('lands on the canonical invoice screen when the funding mode is already locked', async () => {
    vi.mocked(deviceFirstApi.payDirect).mockRejectedValue({
      response: { data: { detail: { code: 'funding_mode_locked' } } },
    });
    vi.mocked(deviceFirstApi.getOpen).mockResolvedValue(directInvoice());
    renderConfigurator({ options: { ...options, balance_kopeks: 100000 } });

    fireEvent.click(screen.getByRole('button', { name: 'deviceFirst.review' }));
    fireEvent.click(await screen.findByRole('button', { name: 'deviceFirst.payAndOrder:450 ₽' }));

    await waitFor(() => expect(deviceFirstApi.getOpen).toHaveBeenCalledTimes(1));
    expect(await screen.findByText('deviceFirst.errorFundingLocked')).toBeTruthy();
    // The canonical screen keeps the deliberate abandon path, never a silent
    // funding switch.
    expect(await screen.findByRole('button', { name: 'deviceFirst.cancel' })).toBeTruthy();
  });

  it('shows one concise device label, the server total, and a monthly per-device comparison', () => {
    const matrixOptions: DeviceFirstOptions = {
      ...options,
      period_options: [30, 365],
      device_options: [2, 4],
      price_matrix: [
        {
          period_days: 30,
          prices: [
            { ...options.price_matrix![0].prices[0], device_limit: 2, price_kopeks: 30000 },
            { ...options.price_matrix![0].prices[0], device_limit: 4, price_kopeks: 50000 },
          ],
        },
        {
          period_days: 365,
          prices: [
            { ...options.price_matrix![0].prices[0], device_limit: 2, price_kopeks: 300000 },
            { ...options.price_matrix![0].prices[0], device_limit: 4, price_kopeks: 500000 },
          ],
        },
      ],
    };
    renderConfigurator({ options: matrixOptions });

    const twoDevices = screen.getByRole('radio', { name: /deviceFirst.deviceCount:2/ });
    expect(twoDevices.textContent).toContain('deviceFirst.deviceCount:2');
    expect(twoDevices.textContent).toContain('300 ₽');
    expect(twoDevices.textContent).toContain('deviceFirst.perDeviceMonth:150');
    expect(twoDevices.textContent).not.toContain('deviceFirst.deviceShort');
    expect(screen.getByRole('radio', { name: /deviceFirst.periodYear/ })).toBeTruthy();
    fireEvent.click(screen.getByRole('radio', { name: /deviceFirst.periodYear/ }));

    const annualTwoDevices = screen.getByRole('radio', { name: /deviceFirst.deviceCount:2/ });
    expect(annualTwoDevices.textContent).toContain('3 000 ₽');
    expect(annualTwoDevices.textContent).toContain('deviceFirst.perDeviceMonth:125');
    expect(screen.getByRole('radio', { name: /deviceFirst.deviceCount:4/ }).textContent).toContain(
      'deviceFirst.perDeviceMonth:104',
    );
  });

  it('uses Continue only when the server reports that no shortage remains', async () => {
    vi.mocked(deviceFirstApi.arm).mockResolvedValue(checkout('processing', 0));
    renderConfigurator({ fixtureCheckout: checkout('awaiting_payment', 0) });

    fireEvent.click(screen.getByRole('button', { name: 'deviceFirst.continueAndOrder' }));

    await waitFor(() => expect(deviceFirstApi.arm).toHaveBeenCalledWith('checkout-owned'));
  });

  it('uses the first method actually supplied by the server, not a hard-coded SBP default', async () => {
    vi.mocked(deviceFirstApi.createPaymentAttempt).mockReturnValue(new Promise(() => {}));
    renderConfigurator({
      fixtureCheckout: checkout('awaiting_payment'),
      fixtureMethods: [
        { key: 'cards_ru', provider_code: 11 },
        { key: 'crypto', provider_code: 12 },
      ],
    });

    const cards = await screen.findByRole('radio', { name: 'deviceFirst.cards' });
    await waitFor(() => expect(cards.getAttribute('aria-checked')).toBe('true'));
    fireEvent.keyDown(cards, { key: 'End' });
    const crypto = screen.getByRole('radio', { name: 'deviceFirst.crypto' });
    await waitFor(() => expect(crypto.getAttribute('aria-checked')).toBe('true'));
    expect(
      screen.getByRole('radiogroup', { name: 'deviceFirst.paymentMethodQuestion' }),
    ).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'deviceFirst.topUpAmount:350 ₽' }));
    await waitFor(() =>
      expect(deviceFirstApi.createPaymentAttempt).toHaveBeenCalledWith('checkout-owned', 'crypto'),
    );
  });

  it('explains a payment-method loading failure and offers retry and support instead of a dead CTA', async () => {
    vi.mocked(deviceFirstApi.paymentMethods).mockRejectedValue(new Error('offline'));
    renderConfigurator();

    fireEvent.click(screen.getByRole('button', { name: 'deviceFirst.review' }));

    expect((await screen.findByRole('alert')).textContent).toContain(
      'deviceFirst.errorPaymentMethodsLoad',
    );
    expect(
      screen.queryByRole('button', { name: 'deviceFirst.paymentMethodAmount:450 ₽' }),
    ).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'deviceFirst.retry' }));
    await waitFor(() => expect(deviceFirstApi.paymentMethods).toHaveBeenCalledTimes(2));
    expect(screen.getByRole('button', { name: 'deviceFirst.contactSupport' })).toBeTruthy();
  });

  it('returns from the local confirmation to the preserved configuration without any server call', async () => {
    renderConfigurator();

    fireEvent.click(screen.getByRole('button', { name: 'deviceFirst.review' }));
    expect(
      await screen.findByRole('button', { name: 'deviceFirst.paymentMethodAmount:450 ₽' }),
    ).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'deviceFirst.changeOptions' }));

    expect(await screen.findByRole('button', { name: 'deviceFirst.review' })).toBeTruthy();
    expect(deviceFirstApi.cancel).not.toHaveBeenCalled();
    expect(deviceFirstApi.payDirect).not.toHaveBeenCalled();
    expect(screen.queryByText('deviceFirst.refreshTitle')).toBeNull();
  });

  it.each(['processing', 'provisioning'] as const)(
    'does not offer cancellation after financial work starts in %s',
    (uiState) => {
      renderConfigurator({ fixtureCheckout: checkout(uiState, 0) });
      expect(screen.queryByRole('button', { name: 'deviceFirst.cancel' })).toBeNull();
    },
  );

  it('pays from the wallet with the exact raw expected price when the balance covers it', async () => {
    vi.mocked(deviceFirstApi.payDirect).mockResolvedValue({
      checkout: checkout('processing', 0),
    });
    vi.mocked(deviceFirstApi.get).mockResolvedValue(checkout('processing', 0));
    renderConfigurator({ options: { ...options, balance_kopeks: 100000 } });

    fireEvent.click(screen.getByRole('button', { name: 'deviceFirst.review' }));
    fireEvent.click(await screen.findByRole('button', { name: 'deviceFirst.payAndOrder:450 ₽' }));

    await waitFor(() =>
      expect(deviceFirstApi.payDirect).toHaveBeenCalledWith({
        period_days: 30,
        selected_device_limit: 2,
        funding_mode: 'wallet',
        method_key: null,
        expected_tariff_total_kopeks: 45000,
      }),
    );
    expect(deviceFirstApi.payDirect).toHaveBeenCalledTimes(1);
    expect(await screen.findByText('deviceFirst.processingText')).toBeTruthy();
  });

  it('redraws the confirmation with a reprice notice instead of a generic error', async () => {
    vi.mocked(deviceFirstApi.payDirect).mockRejectedValue({
      response: { status: 409, data: { detail: { code: 'reprice_required' } } },
    });
    renderConfigurator();

    fireEvent.click(screen.getByRole('button', { name: 'deviceFirst.review' }));
    fireEvent.click(
      await screen.findByRole('button', { name: 'deviceFirst.paymentMethodAmount:450 ₽' }),
    );

    // The price moved: the confirmation stays, explains itself and never
    // shows a dead generic error. No automatic retry is fired.
    expect(await screen.findByText('deviceFirst.refreshTitle')).toBeTruthy();
    expect(screen.getByText('deviceFirst.refreshText')).toBeTruthy();
    expect(screen.queryByText('deviceFirst.error')).toBeNull();
    expect(deviceFirstApi.payDirect).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole('button', { name: 'deviceFirst.paymentMethodAmount:450 ₽' }));
    await waitFor(() => expect(deviceFirstApi.payDirect).toHaveBeenCalledTimes(2));
    expect(deviceFirstApi.payDirect).toHaveBeenLastCalledWith(plategaPayPayload);
  });

  it('keeps the person on the confirmation with a top-up path when the wallet is short', async () => {
    vi.mocked(deviceFirstApi.payDirect).mockRejectedValue({
      response: { status: 422, data: { detail: { code: 'wallet_insufficient' } } },
    });
    renderConfigurator({ options: { ...options, balance_kopeks: 100000 } });

    fireEvent.click(screen.getByRole('button', { name: 'deviceFirst.review' }));
    fireEvent.click(await screen.findByRole('button', { name: 'deviceFirst.payAndOrder:450 ₽' }));

    expect(await screen.findByText('deviceFirst.errorWalletInsufficient')).toBeTruthy();
    // No row was created: the person stays on the confirmation and gets an
    // explicit top-up path instead of a generic failure.
    expect(screen.getByRole('button', { name: 'deviceFirst.needTopup' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'deviceFirst.payAndOrder:450 ₽' })).toBeTruthy();
    expect(deviceFirstApi.getOpen).not.toHaveBeenCalled();
  });

  it.each(['configuration', 'confirmation'] as const)(
    'drains a legacy %s draft reached by deep link instead of resuming it',
    async (uiState) => {
      // The fixture uses the legacy deposit settlement: a confirmed row
      // without direct settlement is a legacy draft and drains like one.
      vi.mocked(deviceFirstApi.get).mockResolvedValue(checkout(uiState));
      vi.mocked(deviceFirstApi.cancel).mockResolvedValue({
        ...checkout(uiState),
        ui_state: 'cancelled',
        lifecycle_state: 'cancelled',
      });

      renderConfigurator({
        initialPath: '/subscription/purchase?checkout=checkout-owned',
      });

      // The stale showcase quote is never resumed: an honest drain screen with
      // one explicit cancellation action.
      expect(await screen.findByText('deviceFirst.refreshText')).toBeTruthy();
      expect(deviceFirstApi.payDirect).not.toHaveBeenCalled();
      expect(deviceFirstApi.nativeLaunchDirect).not.toHaveBeenCalled();

      fireEvent.click(screen.getByRole('button', { name: 'deviceFirst.startNew' }));

      await waitFor(() => expect(deviceFirstApi.cancel).toHaveBeenCalledWith('checkout-owned'));
      expect(await screen.findByRole('button', { name: 'deviceFirst.review' })).toBeTruthy();
      // The selection from the cancelled quote is rebuilt locally and the
      // durable id leaves the URL.
      const twoDevices = screen.getByRole('radio', { name: /deviceFirst.deviceCount:2/ });
      expect(twoDevices.getAttribute('aria-checked')).toBe('true');
      await waitFor(() =>
        expect(screen.getByTestId('location').textContent).toBe('/subscription/purchase'),
      );
    },
  );

  it('resumes a fused-born confirmed order reached by deep link instead of draining it', async () => {
    const confirmedDirect = {
      ...checkout('confirmation'),
      settlement_mode: 'direct_purchase_v2' as const,
      balance_kopeks: 0,
      external_payable_kopeks: 45000,
    };
    vi.mocked(deviceFirstApi.get).mockResolvedValueOnce(confirmedDirect);
    vi.mocked(deviceFirstApi.get).mockResolvedValue(directInvoice());
    vi.mocked(deviceFirstApi.payDirect).mockResolvedValue({ checkout: directInvoice() });

    renderConfigurator({ initialPath: '/subscription/purchase?checkout=checkout-owned' });

    // The row is live (born at pay time, its attempt never finished): resume
    // it through the row-wired confirmation. The drain/cancel screen and any
    // cancellation are never offered for it.
    expect(
      await screen.findByRole('button', { name: 'deviceFirst.paymentMethodAmount:450 ₽' }),
    ).toBeTruthy();
    expect(screen.queryByText('deviceFirst.refreshTitle')).toBeNull();
    expect(screen.queryByRole('button', { name: 'deviceFirst.startNew' })).toBeNull();
    expect(deviceFirstApi.cancel).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'deviceFirst.paymentMethodAmount:450 ₽' }));

    // The retry goes through the fused route with the row's own selection and
    // the row's immutable total as the optimistic price token.
    await waitFor(() => expect(deviceFirstApi.payDirect).toHaveBeenCalledWith(plategaPayPayload));
    expect(await screen.findByRole('button', { name: 'deviceFirst.changeOptions' })).toBeTruthy();
  });

  it('resumes the live confirmed order instead of draining it after losing a pay race', async () => {
    const confirmedDirect = {
      ...checkout('confirmation'),
      settlement_mode: 'direct_purchase_v2' as const,
      balance_kopeks: 0,
      external_payable_kopeks: 45000,
    };
    vi.mocked(deviceFirstApi.payDirect)
      .mockRejectedValueOnce({ response: { data: { detail: { code: 'open_checkout_exists' } } } })
      .mockResolvedValue({ checkout: directInvoice() });
    vi.mocked(deviceFirstApi.getOpen).mockResolvedValue(confirmedDirect);
    vi.mocked(deviceFirstApi.get).mockResolvedValue(directInvoice());
    renderConfigurator();

    fireEvent.click(screen.getByRole('button', { name: 'deviceFirst.review' }));
    fireEvent.click(
      await screen.findByRole('button', { name: 'deviceFirst.paymentMethodAmount:450 ₽' }),
    );

    await waitFor(() => expect(deviceFirstApi.getOpen).toHaveBeenCalledTimes(1));
    // The concurrent winner's row sits in the birth window (confirmed, no
    // attempt yet): it resumes through the row-wired confirmation. A drain
    // screen here would let the loser cancel the winner's live order.
    expect(screen.queryByText('deviceFirst.refreshTitle')).toBeNull();
    expect(screen.queryByRole('button', { name: 'deviceFirst.startNew' })).toBeNull();
    expect(deviceFirstApi.cancel).not.toHaveBeenCalled();
    expect(await screen.findByText('deviceFirst.errorResumeOrder')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'deviceFirst.paymentMethodAmount:450 ₽' }));

    await waitFor(() => expect(deviceFirstApi.payDirect).toHaveBeenCalledTimes(2));
    expect(deviceFirstApi.payDirect).toHaveBeenLastCalledWith(plategaPayPayload);
    expect(await screen.findByRole('button', { name: 'deviceFirst.changeOptions' })).toBeTruthy();
  });

  it('breaks the reprice loop on a resumed confirmation by re-pricing from the fresh matrix', async () => {
    // The row was born when the price was 460 ₽; the matrix now says 450 ₽.
    const confirmedDirect = {
      ...checkout('confirmation'),
      settlement_mode: 'direct_purchase_v2' as const,
      tariff_total_kopeks: 46000,
      balance_kopeks: 0,
      external_payable_kopeks: 46000,
    };
    vi.mocked(deviceFirstApi.get).mockResolvedValueOnce(confirmedDirect);
    vi.mocked(deviceFirstApi.payDirect).mockRejectedValue({
      response: { status: 409, data: { detail: { code: 'reprice_required' } } },
    });
    renderConfigurator({ initialPath: '/subscription/purchase?checkout=checkout-owned' });

    // The resumed row honestly shows its own immutable total first.
    fireEvent.click(
      await screen.findByRole('button', { name: 'deviceFirst.paymentMethodAmount:460 ₽' }),
    );
    await waitFor(() =>
      expect(deviceFirstApi.payDirect).toHaveBeenNthCalledWith(1, {
        ...plategaPayPayload,
        expected_tariff_total_kopeks: 46000,
      }),
    );

    // The reprice terminally kills the row server-side: it leaves the screen,
    // the same selection stays, and the CTA now offers the FRESH matrix price
    // instead of looping the stale total.
    expect(await screen.findByText('deviceFirst.refreshTitle')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'deviceFirst.startNew' })).toBeNull();
    expect(deviceFirstApi.cancel).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(screen.getByTestId('location').textContent).toBe('/subscription/purchase'),
    );
    const freshCta = await screen.findByRole('button', {
      name: 'deviceFirst.paymentMethodAmount:450 ₽',
    });

    fireEvent.click(freshCta);
    await waitFor(() =>
      expect(deviceFirstApi.payDirect).toHaveBeenNthCalledWith(2, plategaPayPayload),
    );
  });

  it('lands on the surviving order when a cross-config race answers invalid_state', async () => {
    vi.mocked(deviceFirstApi.payDirect).mockRejectedValue({
      response: { status: 409, data: { detail: { code: 'invalid_state' } } },
    });
    vi.mocked(deviceFirstApi.getOpen).mockResolvedValue(directInvoice());
    vi.mocked(deviceFirstApi.get).mockResolvedValue(directInvoice());
    renderConfigurator();

    fireEvent.click(screen.getByRole('button', { name: 'deviceFirst.review' }));
    fireEvent.click(
      await screen.findByRole('button', { name: 'deviceFirst.paymentMethodAmount:450 ₽' }),
    );

    await waitFor(() => expect(deviceFirstApi.getOpen).toHaveBeenCalledTimes(1));
    expect(await screen.findByRole('button', { name: 'deviceFirst.changeOptions' })).toBeTruthy();
    expect(await screen.findByText('deviceFirst.errorOrderUpdated')).toBeTruthy();
    expect(screen.queryByText('deviceFirst.error')).toBeNull();
  });

  it('quietly keeps the local confirmation when an invalid_state race leaves no open order', async () => {
    vi.mocked(deviceFirstApi.payDirect).mockRejectedValue({
      response: { status: 409, data: { detail: { code: 'invalid_state' } } },
    });
    vi.mocked(deviceFirstApi.getOpen).mockRejectedValue({
      response: { status: 404, data: { detail: { code: 'no_open_checkout' } } },
    });
    renderConfigurator();

    fireEvent.click(screen.getByRole('button', { name: 'deviceFirst.review' }));
    fireEvent.click(
      await screen.findByRole('button', { name: 'deviceFirst.paymentMethodAmount:450 ₽' }),
    );

    await waitFor(() => expect(deviceFirstApi.getOpen).toHaveBeenCalledTimes(1));
    // Nothing survived the race: the selection is still on screen and no
    // dead-end error is shown — nothing was charged.
    expect(
      await screen.findByRole('button', { name: 'deviceFirst.paymentMethodAmount:450 ₽' }),
    ).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(deviceFirstApi.cancel).not.toHaveBeenCalled();
  });

  it('surfaces a fused-launch reprice on the confirmation screen with the fresh price CTA', async () => {
    vi.mocked(deviceFirstApi.nativeLaunchDirect).mockRejectedValue({
      response: { status: 409, data: { detail: { code: 'reprice_required' } } },
    });

    renderConfigurator({
      initialPath: '/subscription/purchase?period=30&devices=2&method=sbp&autostart=1',
    });

    await waitFor(() => expect(deviceFirstApi.nativeLaunchDirect).toHaveBeenCalledTimes(1));
    expect(await screen.findByText('deviceFirst.refreshTitle')).toBeTruthy();
    // The person lands on an honest confirmation screen, not on a generic
    // error: the same selection is mirrored locally and can be paid again.
    expect(
      await screen.findByRole('button', { name: 'deviceFirst.paymentMethodAmount:450 ₽' }),
    ).toBeTruthy();
    expect(screen.queryByText('deviceFirst.error')).toBeNull();
  });
});
