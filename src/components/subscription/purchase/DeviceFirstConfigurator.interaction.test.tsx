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
// 🔴 Этап Б-2. Касса читает минимум провайдера БАЛАНСНЫМ запросом (`['payment-methods']`),
// и его модуль тянет за собой настоящий `i18n` — а он в тестовой среде не поднимается.
// Мок держит запрос под контролем: по умолчанию сервер молчит, значит сумма остаётся сырой
// разницей, а автосоздание счёта выключено. Тест, которому нужен минимум, подменяет ответ сам.
const { getBalancePaymentMethods } = vi.hoisted(() => ({
  getBalancePaymentMethods: vi.fn(),
}));
vi.mock('@/api/balance', () => ({
  balanceApi: { getPaymentMethods: getBalancePaymentMethods },
}));
// 🔴 Пункт 1 реза 22.08.2026. `hideBackButton`/`showBackButton` больше не нужны: экран
// не подменяется, поэтому кнопку «Назад» гасить не от чего. Вместо них — `openLink`
// платформы, которым Телеграм открывает провайдера ОТДЕЛЬНОЙ поверхностью, оставляя
// мини-приложение в живых. Ходим через адаптер, как требует `eslint.config.js:60-64`.
const { openLink } = vi.hoisted(() => ({ openLink: vi.fn() }));
vi.mock('@/platform', () => ({
  usePlatform: () => ({ openLink }),
}));
vi.mock('@/utils/clipboard', () => ({
  copyToClipboard: vi.fn().mockResolvedValue(undefined),
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
    // Умолчание — «минимум провайдера неизвестен»: так ведёт себя холодный экран, пока
    // балансный запрос не вернулся. Сумма при этом сырая, автосчёт выключен.
    getBalancePaymentMethods.mockRejectedValue(new Error('payment methods unavailable'));
    // 🔴 Пункт 4.11а. Дефолт изменён на ЖИВОЙ счёт, и это не удобство, а правда боевого
    // сервера: сразу после создания счёта `_is_live_direct_provider_invoice` пропускает
    // адрес (`bot-code/app/cabinet/routes/device_first.py:876`). Прежний дефолт `null`
    // означал «счёт мёртв» — и на нём же проверялось, что кнопка оплаты работает. То есть
    // набор охранял вредный случай: увести человека на мёртвую страницу провайдера.
    // Отдельными тестами ниже проверяются оба честных края: сервер сказал `null` → кнопки
    // нет; запрос упал совсем → кнопка есть из ответа мутации.
    vi.mocked(deviceFirstApi.getPendingPayment).mockResolvedValue({
      redirect_url: 'https://app.platega.io/pay/live',
      status: 'pending',
      resume_allowed: false,
    });
  });

  const realLocation = window.location;
  afterEach(() => {
    Object.defineProperty(window, 'location', { value: realLocation, writable: true });
    cleanup();
  });

  // 🔴 Пункт 4.11а. Путь до провайдера стал двухшаговым: сначала НАШ экран счёта, и только
  // явный тап по кнопке оплаты уводит. Сторожа мины W ходят теперь этой дорогой — раньше
  // они ловили уход, который случался сам.
  // Адрес мутации ОТЛИЧАЕТСЯ от дефолтного адреса сервера нарочно: так видно, чей именно
  // адрес попал под кнопку. Пока запрос счёта не ответил, это адрес мутации.
  async function payAndTapInvoiceCta(redirectUrl: string) {
    vi.mocked(deviceFirstApi.payDirect).mockResolvedValue({
      checkout: directInvoice(),
      redirect_url: redirectUrl,
    });
    // Сервер подтверждает тот же самый счёт — как на боевом сразу после его создания.
    vi.mocked(deviceFirstApi.getPendingPayment).mockResolvedValue({
      redirect_url: redirectUrl,
      status: 'pending',
      resume_allowed: false,
    });
    renderConfigurator();
    fireEvent.click(await screen.findByText('deviceFirst.review'));
    fireEvent.click(await screen.findByText(/deviceFirst\.paymentMethodAmount/));
    fireEvent.click(
      await screen.findByRole('button', { name: 'deviceFirst.continueExistingInvoice' }),
    );
  }

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

  it('lands the deep link from the bot on our invoice screen instead of leaving on its own', async () => {
    // 🔴 Пункт 4.11а. Этот переход был единственным `replace` и срабатывал БЕЗ единого
    // касания: автостарт по диплинку «Оплатить» из бота. Человек уезжал к провайдеру,
    // ничего не нажав в мини-аппе, и вернуться оттуда было нечем. Теперь запуск из бота
    // доводит до нашего экрана счёта; уход — только по явному тапу.
    const assign = vi.fn();
    const replace = vi.fn();
    Object.defineProperty(window, 'location', {
      value: { ...window.location, assign, replace },
      writable: true,
    });
    vi.mocked(deviceFirstApi.nativeLaunchDirect).mockResolvedValue({
      checkout: directInvoice(),
      redirect_url: 'https://app.platega.io/pay/native',
    });
    vi.mocked(deviceFirstApi.get).mockResolvedValue(directInvoice());
    vi.mocked(deviceFirstApi.getPendingPayment).mockResolvedValue({
      redirect_url: 'https://app.platega.io/pay/native',
      status: 'pending',
      resume_allowed: false,
    });

    renderConfigurator({
      initialPath: '/subscription/purchase?period=30&devices=2&method=sbp&autostart=1',
    });

    const cta = await screen.findByRole('button', {
      name: 'deviceFirst.continueExistingInvoice',
    });
    // Экран счёта есть, а уход не случился сам — ни одним из трёх способов.
    expect(replace).not.toHaveBeenCalled();
    expect(assign).not.toHaveBeenCalled();
    expect(openLink).not.toHaveBeenCalled();

    fireEvent.click(cta);
    expect(openLink).toHaveBeenCalledWith('https://app.platega.io/pay/native');
    // 🔴 Пункт 1 реза 22.08.2026. Сторожа на `assign`/`replace` держим ЗДЕСЬ и после
    // перехода на `openLink`: именно подмена документа была причиной того, что человек не
    // доезжал до банка. Вернут её любым из двух способов — покраснеет.
    expect(assign).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
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

  it('провайдер закрыл счёт — человек читает объяснение и уходит САМ, не потеряв выбор', async () => {
    // 🔴 ПЕРЕПИСАН 25.08.2026 (этап AR). Прежний сторож назывался «keeps the selection the person
    // made when the provider cancels the invoice» и закреплял МОЛЧАЛИВЫЙ авто-возврат: он
    // проверял, что человека уже унесло на экран выбора, и радовался, что выбор уцелел.
    // Молчание и было бедой: 22 из 31 отменённого заказа на боевом закрыты провайдером, и ни
    // одному человеку экран не сказал ни слова. Теперь свойство другое и оно шире:
    //   1) человек ОСТАЁТСЯ на экране закрытого заказа и читает, что произошло;
    //   2) уходит своим нажатием;
    //   3) и только после этого видит экран выбора — со СВОЕЙ конфигурацией.
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
      // 🔴 Ровно то, что отдаёт боевой сервер: `provider_terminal:*` не входит в
      // `_NO_MONEY_TERMINAL_REASONS`, поэтому `money_state` здесь ВСЕГДА `unknown`
      // (замер боевой базы 25.08.2026: у всех 22 таких заказов). Если бы ветка была
      // написана с гардом по `no_money`, этот сторож покраснел бы — и правильно.
      money_state: 'unknown',
    };
    vi.mocked(deviceFirstApi.get).mockResolvedValue(cancelledRow);

    renderConfigurator({
      options: wide,
      initialPath: '/subscription/purchase?checkout=checkout-owned',
    });

    // 1. Экран НЕ отмотался: человек видит объяснение про закрытый счёт.
    expect(await screen.findByText('deviceFirst.providerClosedTitle')).toBeTruthy();
    expect(screen.getByText('deviceFirst.providerClosedText')).toBeTruthy();
    // 🔴 Улика того, что мы именно на экране заказа, а не на выборе: карточек устройств тут нет.
    expect(screen.queryByText('deviceFirst.deviceCount:6')).toBeNull();

    // 2. Уходит он сам.
    fireEvent.click(screen.getByRole('button', { name: 'deviceFirst.startNew' }));

    // 3. Экран выбора — и на нём стоит ЕГО конфигурация, а не первая попавшаяся.
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

  it('survives an opener that throws, and still lets the link be taken by hand', async () => {
    // 🔴 Пункт 1 реза 22.08.2026, наследник теста «вернуть кнопку, если переход бросил».
    // Гасить теперь нечего, а запасной ход живёт в адаптере (`TelegramAdapter.ts:289-294`).
    // Наше свойство другое и оно важнее: отказ ухода не должен ни ронять экран, ни
    // оставлять человека без способа заплатить. Бросок из обработчика клика раньше уходил
    // в `window` и делал `npm test` красным при зелёных тестах — поэтому он гасится, а
    // видимым выходом остаётся кнопка «скопировать ссылку».
    openLink.mockImplementationOnce(() => {
      throw new Error('opener unavailable');
    });
    const unhandled: string[] = [];
    const catchUnhandled = (event: ErrorEvent) => unhandled.push(event.error?.message ?? '');
    window.addEventListener('error', catchUnhandled);
    try {
      await payAndTapInvoiceCta('https://app.platega.io/pay/4');

      expect(openLink).toHaveBeenCalledWith('https://app.platega.io/pay/4');
      expect(unhandled).toEqual([]);
      // Экран жив, и забрать ссылку руками по-прежнему можно.
      // ⚠️ Запас по времени добавлен 26.08.2026: файл потяжелел на девять новых сторожей, и под
      // полной нагрузкой набора этот `findByRole` один раз не уложился в дефолтную секунду при
      // исправном коде. Вывод выглядел зелёным, а `npm test` вышел с кодом 1 — ровно та грабля,
      // на которой проект обжигался дважды. Свойство теста не изменилось.
      expect(
        await screen.findByRole(
          'button',
          { name: 'deviceFirst.copyPaymentLink' },
          { timeout: 5000 },
        ),
      ).toBeTruthy();
    } finally {
      window.removeEventListener('error', catchUnhandled);
    }
  });

  it('warns before leaving only on the screen that still leads to the provider', async () => {
    // 🔴 Пункт 4.11а. Экран выбора способа оплаты больше НИКУДА не уводит: тап по способу
    // создаёт счёт и показывает наш экран счёта. Прежнее «страница оплаты откроется вместо
    // кабинета» стало бы там ложью — и это первый экран каждого покупателя.
    renderConfigurator();
    fireEvent.click(await screen.findByText('deviceFirst.review'));
    const method = await screen.findByText(/deviceFirst\.paymentMethodAmount/);
    expect(screen.queryByText('deviceFirst.leavingForProvider')).toBeNull();
    // 🔴 Но и молчать нельзя: покупка стала двухтаповой, а кнопка с суммой читается как
    // «заплатить». Ожидание выставляется ДО тапа и стоит выше кнопок — под ними на телефоне
    // 375×667 строка уходит за сгиб, а скринридер читает её после нажатия.
    const hint = screen.getByText('deviceFirst.twoStepPayHint');
    expect(hint.compareDocumentPosition(method) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    cleanup();

    // А на экране счёта уход настоящий — там предупреждение обязано остаться, и стоять
    // ДО кнопки: под ней на телефоне 375×667 оно уходило за сгиб, а скринридер читал его
    // после того, как человек уже нажал.
    // Фикстурой экран не поднять — запрос счёта включается только для настоящего заказа
    // (`fixtureCheckout === undefined`), поэтому идём тем же путём, что и человек: по
    // адресу с `?checkout=`.
    vi.mocked(deviceFirstApi.get).mockResolvedValue(directInvoice());
    vi.mocked(deviceFirstApi.getPendingPayment).mockResolvedValue({
      redirect_url: 'https://app.platega.io/pay/5',
      status: 'pending',
      resume_allowed: false,
    });
    renderConfigurator({ initialPath: '/subscription/purchase?checkout=checkout-owned' });
    const warning = await screen.findByText('deviceFirst.leavingForProvider');
    const cta = screen.getByRole('button', { name: 'deviceFirst.continueExistingInvoice' });
    expect(warning.compareDocumentPosition(cta) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('keeps the selection when the person cancels the order themselves', async () => {
    // 🔴 Владелец поймал мину именно на этом пути, а первая версия правки покрывала
    // только отмену провайдером. Мина F закрывает корзину той же причиной, что и
    // ручная отмена, — путь один и тот же.
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
    const live: DeviceFirstCheckout = {
      ...directInvoice(),
      period_days: 90,
      selected_device_limit: 6,
    };
    vi.mocked(deviceFirstApi.abandon).mockResolvedValue({
      ...live,
      ui_state: 'cancelled',
      lifecycle_state: 'cancelled',
      terminal_reason: 'cancelled_by_user_after_invoice',
    });

    renderConfigurator({ options: wide, fixtureCheckout: live });
    fireEvent.click(await screen.findByText('deviceFirst.cancel'));
    fireEvent.click(await screen.findByText('deviceFirst.abandonConfirm'));

    await waitFor(() =>
      expect(
        screen
          .getByText('deviceFirst.deviceCount:6')
          .closest('button')
          ?.getAttribute('aria-checked'),
      ).toBe('true'),
    );
  });

  it('routes every remaining provider jump through the helper too', async () => {
    // Мутационный прогон показал: из шести переходов сторожами были закрыты два.
    // Здесь закрываем «Продолжить этот счёт» с экрана заказа — путь возвращающегося
    // человека, того самого, кто теряет контекст чаще всех.
    const assign = vi.fn();
    Object.defineProperty(window, 'location', {
      value: { ...window.location, assign, replace: vi.fn() },
      writable: true,
    });
    vi.mocked(deviceFirstApi.get).mockResolvedValue(directInvoice());
    vi.mocked(deviceFirstApi.getPendingPayment).mockResolvedValue({
      redirect_url: 'https://app.platega.io/pay/6',
      status: 'pending',
      resume_allowed: false,
    });

    renderConfigurator({ initialPath: '/subscription/purchase?checkout=checkout-owned' });
    fireEvent.click(await screen.findByText('deviceFirst.continueExistingInvoice'));

    expect(openLink).toHaveBeenCalledWith('https://app.platega.io/pay/6');
    expect(assign).not.toHaveBeenCalled();
  });

  // --- пункт 4.11а: свой экран счёта больше не перепрыгивается ---------------------

  it('keeps the person on our invoice screen after the pay tap instead of jumping past it', async () => {
    // 🔴 Сердце пункта. Раньше `payDirect` клал заказ в нужное состояние и СЛЕДУЮЩЕЙ
    // строкой уводил редиректом: экран счёта рождался и умирал вместе с документом, а
    // человек оказывался на странице Platega, где есть только крестик, закрывающий весь
    // мини-апп. Здесь фиксируем обратное: человек остаётся, экран показан целиком.
    const assign = vi.fn();
    const replace = vi.fn();
    Object.defineProperty(window, 'location', {
      value: { ...window.location, assign, replace },
      writable: true,
    });
    vi.mocked(deviceFirstApi.payDirect).mockResolvedValue({
      checkout: directInvoice(),
      redirect_url: 'https://app.platega.io/pay/stay',
    });

    renderConfigurator();
    fireEvent.click(await screen.findByText('deviceFirst.review'));
    fireEvent.click(await screen.findByText(/deviceFirst\.paymentMethodAmount/));

    expect(await screen.findByText('deviceFirst.invoiceReadyTitle')).toBeTruthy();
    expect(screen.getByText('deviceFirst.invoiceReadyText')).toBeTruthy();
    // 🔴 И заголовок, и текст экрана были написаны копирайтом ВОССТАНОВЛЕНИЯ: «Проверяем
    // счёт», «Счёт мог быть создан, но ответ ещё проверяется». Сюда теперь попадает каждый
    // обычный покупатель, которому счёт только что создан, — для него это ложь дважды.
    // Ключи разведены; здесь сторожим, что старые на этот экран не вернулись.
    expect(screen.queryByText('deviceFirst.paymentChecking')).toBeNull();
    expect(screen.queryByText('deviceFirst.paymentCheckingText')).toBeNull();
    expect(
      screen.getByRole('button', { name: 'deviceFirst.continueExistingInvoice' }),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'deviceFirst.changeOptions' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'deviceFirst.cancel' })).toBeTruthy();
    // Уход не начат ни одним из трёх способов.
    expect(assign).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
    expect(openLink).not.toHaveBeenCalled();
  });

  it('shows the payment CTA even when the pending-payment read fails outright', async () => {
    // 🔴 Вторая половина пункта, без которой первая калечит экран. Кнопка оплаты рисовалась
    // ТОЛЬКО из отдельного запроса `getPendingPayment`, который штатно отвечает
    // `redirect_url: null`. Пока мы уходили сами, это было незаметно.
    // ⚠️ Обоснование поправлено 25.08.2026 (этап AR, мина AN): прежде здесь стояло «а он живёт
    // с `retry: false`». Больше не живёт — молчание сети теперь переспрашивается дважды
    // (ответ сервера ниже 500 по-прежнему окончателен). Свойство самого сторожа от этого не
    // изменилось: адрес пришёл вместе со счётом, поэтому кнопка обязана быть даже когда
    // запрос падает совсем. Уберут запоминание адреса — покраснеет.
    // Перестав уходить, мы бы оставили человека на экране БЕЗ ЕДИНОГО способа заплатить.
    // Здесь запрос падает совсем — кнопка обязана быть, потому что адрес пришёл вместе со
    // счётом. Уберут запоминание адреса — покраснеет.
    const assign = vi.fn();
    Object.defineProperty(window, 'location', {
      value: { ...window.location, assign, replace: vi.fn() },
      writable: true,
    });
    vi.mocked(deviceFirstApi.getPendingPayment).mockRejectedValue(new Error('network is down'));
    vi.mocked(deviceFirstApi.payDirect).mockResolvedValue({
      checkout: directInvoice(),
      redirect_url: 'https://app.platega.io/pay/from-mutation',
    });

    renderConfigurator();
    fireEvent.click(await screen.findByText('deviceFirst.review'));
    fireEvent.click(await screen.findByText(/deviceFirst\.paymentMethodAmount/));

    fireEvent.click(
      await screen.findByRole('button', { name: 'deviceFirst.continueExistingInvoice' }),
    );
    expect(openLink).toHaveBeenCalledWith('https://app.platega.io/pay/from-mutation');
    expect(assign).not.toHaveBeenCalled();
  });

  it('does not loop back to the create-invoice button after a resume', async () => {
    // 🔴 Петля. `resume` не меняет id заказа, а кэш `pending-payment` не инвалидировала ни
    // одна мутация — в нём оставалось старое `{redirect_url: null, resume_allowed: true}`.
    // Пока действовал авто-редирект, человек этого не видел. Без него он вернулся бы на тот
    // же экран с той же кнопкой «Продолжить создание счёта» и нажал бы её снова.
    const assign = vi.fn();
    Object.defineProperty(window, 'location', {
      value: { ...window.location, assign, replace: vi.fn() },
      writable: true,
    });
    vi.mocked(deviceFirstApi.get).mockResolvedValue(directInvoice());
    // Первый ответ — «счёта нет, можно создать». Дальше сервер отвечает как на боевом:
    // попытка появилась, значит `resume_allowed` больше НИКОГДА не будет истинным
    // (`bot-code/app/cabinet/routes/device_first.py:863-873` требует, чтобы попыток не было).
    vi.mocked(deviceFirstApi.getPendingPayment)
      .mockResolvedValueOnce({ redirect_url: null, status: 'missing', resume_allowed: true })
      .mockResolvedValue({
        redirect_url: 'https://app.platega.io/pay/resumed',
        status: 'pending',
        resume_allowed: false,
      });
    vi.mocked(deviceFirstApi.resumeInvoice).mockResolvedValue({
      checkout: directInvoice(),
      redirect_url: 'https://app.platega.io/pay/resumed',
    });

    renderConfigurator({ initialPath: '/subscription/purchase?checkout=checkout-owned' });
    const resume = await screen.findByRole('button', { name: 'deviceFirst.resumeInvoice' });
    // 🔴 Пока счёта нет, предупреждение «страница оплаты откроется вместо кабинета» — ложь:
    // эта кнопка после правки никуда не уводит, она создаёт счёт. Ровно ту же ложь пункт
    // снял с экрана подтверждения, и здесь она не должна была остаться.
    expect(screen.queryByText('deviceFirst.leavingForProvider')).toBeNull();

    fireEvent.click(resume);

    // Счёт создан: появилась кнопка оплаты — и уход НЕ случился сам. Проверка «не звали до
    // тапа» обязательна: без неё мутационный прогон показал, что авто-редирект можно вернуть
    // сюда, и набор этого не заметит — тап по кнопке зовёт тот же адрес.
    const cta = await screen.findByRole('button', {
      name: 'deviceFirst.continueExistingInvoice',
    });
    expect(openLink).not.toHaveBeenCalled();

    fireEvent.click(cta);
    expect(openLink).toHaveBeenCalledWith('https://app.platega.io/pay/resumed');
    expect(assign).not.toHaveBeenCalled();
    expect(deviceFirstApi.resumeInvoice).toHaveBeenCalledTimes(1);
    // 🔴 И главное: кнопка «создать счёт» ИСЧЕЗЛА. Пока протухшее `resume_allowed: true`
    // оставалось в кэше, человек видел её снова и жал повторно — это и была петля.
    expect(screen.queryByRole('button', { name: 'deviceFirst.resumeInvoice' })).toBeNull();
  });

  it('hides the payment CTA when the server says the invoice is no longer live', async () => {
    // 🔴 Обратная сторона пункта, и её нашли три линзы разом. Сервер отвечает `redirect_url:
    // null` не только когда «не успел»: это вердикт `_is_live_direct_provider_invoice`
    // (`bot-code/app/cabinet/routes/device_first.py:161-185`) — счёт оплачен, отменён
    // провайдером или протух. Перекрыть этот вердикт своим запомненным адресом значит увести
    // человека на мёртвую страницу Platega, где есть только крестик, — ровно та ловушка,
    // которую пункт чинит. Здесь фиксируем: сказал `null` — кнопки нет, и экран об этом
    // говорит честно, а не зовёт «оплатите счёт».
    const assign = vi.fn();
    Object.defineProperty(window, 'location', {
      value: { ...window.location, assign, replace: vi.fn() },
      writable: true,
    });
    vi.mocked(deviceFirstApi.payDirect).mockResolvedValue({
      checkout: directInvoice(),
      redirect_url: 'https://app.platega.io/pay/dead',
    });
    // Опрос статуса возвращает ТОТ ЖЕ прямой заказ: иначе он подменит его легаси-фикстурой
    // из `beforeEach`, и проверка уедет на чужую ветку экрана.
    vi.mocked(deviceFirstApi.get).mockResolvedValue(directInvoice());
    vi.mocked(deviceFirstApi.getPendingPayment).mockResolvedValue({
      redirect_url: null,
      status: 'reconciliation',
      resume_allowed: false,
    });

    renderConfigurator();
    fireEvent.click(await screen.findByText('deviceFirst.review'));
    fireEvent.click(await screen.findByText(/deviceFirst\.paymentMethodAmount/));

    // 🔴 Здесь же лежит самый опасный случай этого состояния: сервер гасит адрес и когда
    // человек УЖЕ ЗАПЛАТИЛ, а вебхук не дошёл (`payment.is_paid` в заборе
    // `bot-code/app/cabinet/routes/device_first.py:170`). Снаружи он неотличим от «счёт ещё
    // создаётся». Поэтому экран обязан нести защиту «не оплачивайте повторно»: иначе
    // оплативший платит второй раз, а деньги вернутся ему на баланс без подписки.
    expect(await screen.findByText('deviceFirst.paymentChecking')).toBeTruthy();
    expect(screen.getByText('deviceFirst.paymentCheckingText')).toBeTruthy();
    await waitFor(() =>
      expect(
        screen.queryByRole('button', { name: 'deviceFirst.continueExistingInvoice' }),
      ).toBeNull(),
    );
    // Ни обещания оплатить, ни предупреждения про уход — уходить некуда.
    expect(screen.queryByText('deviceFirst.invoiceReadyTitle')).toBeNull();
    expect(screen.queryByText('deviceFirst.invoiceReadyText')).toBeNull();
    expect(screen.queryByText('deviceFirst.leavingForProvider')).toBeNull();
    expect(assign).not.toHaveBeenCalled();
    expect(openLink).not.toHaveBeenCalled();
    // Выход с экрана при этом остаётся.
    expect(screen.getByRole('button', { name: 'deviceFirst.changeOptions' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'deviceFirst.cancel' })).toBeTruthy();
  });

  it('names the invoice dialog by what the screen actually says', async () => {
    // Прямой счёт объявлялся скринридеру как «Нужно пополнить баланс» — имя чужого экрана.
    // Ключи зашиты литералами: сторож не должен ходить по тому же выражению, что и код.
    // Фикстурой окно не поднять: `role="dialog"` есть только у портальной поверхности,
    // то есть у настоящего заказа. Идём тем же путём, что и человек.
    vi.mocked(deviceFirstApi.get).mockResolvedValue(directInvoice());
    renderConfigurator({ initialPath: '/subscription/purchase?checkout=checkout-owned' });

    const dialog = await screen.findByRole('dialog');
    // Пока запрос счёта не ответил, экран честно называется «Проверяем счёт»; когда счёт
    // подтверждён — «Заказ ждёт оплаты». Важно, что имя окна В ЛЮБОЙ момент совпадает с
    // видимым заголовком и никогда не остаётся чужим «Нужно пополнить баланс».
    expect(dialog.getAttribute('aria-label')).not.toBe('deviceFirst.needTopup');
    await waitFor(() =>
      expect(dialog.getAttribute('aria-label')).toBe('deviceFirst.invoiceReadyTitle'),
    );
    expect(screen.getByRole('heading', { level: 3 }).textContent).toBe(
      dialog.getAttribute('aria-label'),
    );
  });

  it('keeps the selection when leaving a resumed confirmation through Change options', async () => {
    // Вторая половина того же требования. Мутационный прогон показал, что она не прибита
    // ничем: голый возврат на этом экране переживал весь набор.
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
    const resumed: DeviceFirstCheckout = {
      ...checkout('confirmation'),
      settlement_mode: 'direct_purchase_v2',
      period_days: 90,
      selected_device_limit: 6,
    };

    renderConfigurator({ options: wide, fixtureCheckout: resumed });
    fireEvent.click(screen.getByRole('button', { name: 'deviceFirst.changeOptions' }));

    await waitFor(() =>
      expect(
        screen
          .getByText('deviceFirst.deviceCount:6')
          .closest('button')
          ?.getAttribute('aria-checked'),
      ).toBe('true'),
    );
    expect(
      screen
        .getByText('deviceFirst.periodMonths:3')
        .closest('button')
        ?.getAttribute('aria-checked'),
    ).toBe('true');
  });

  it('stops polling an invoice the provider gave no deadline for', async () => {
    // 🔴 Обязательный хвост пункта. Опрос выключался либо через 30 с после срока счёта
    // провайдера, либо через две минуты — но вторая ветка ИСКЛЮЧАЛА прямой счёт, а у всех
    // боевых СБП-счетов срока нет вовсе. Пока авто-редирект уничтожал документ, это было
    // незаметно. Без него экран стучал бы в сервер бесконечно.
    // Порог зашит литералом нарочно: сторож, перебирающий ту же константу, что и код, в
    // этом проекте уже дважды переживал мутацию.
    vi.useFakeTimers();
    try {
      // Срока провайдера у счёта нет — ровно как на боевом (`expiresIn` не приходит).
      const noDeadline = { ...directInvoice(), provider_invoice_expires_at: null };
      vi.mocked(deviceFirstApi.get).mockResolvedValue(noDeadline);

      const polls = () => vi.mocked(deviceFirstApi.get).mock.calls.length;
      renderConfigurator({ initialPath: '/subscription/purchase?checkout=checkout-owned' });
      // Разгон отдельными шагами: один большой прыжок часов React с react-query успевают
      // отработать лишь частично, и опрос выглядел бы остановленным, ещё не начавшись.
      await vi.advanceTimersByTimeAsync(100);
      await vi.advanceTimersByTimeAsync(3_000);
      await vi.advanceTimersByTimeAsync(30_000);
      // Сначала убеждаемся, что опрос вообще идёт: без этого тест был бы зелёным и на
      // сломанном экране, который не опрашивает сервер никогда.
      expect(polls()).toBeGreaterThan(1);
      // 🔴 И что окно не схлопнуто. У порога обязана быть нижняя граница: без неё его можно
      // ужать до секунд, и человек, вернувшийся с оплаты, не увидит результата — а «стоп
      // опроса» сегодня единственное, что решает, сколько экран живёт сам. Минута — заведомо
      // меньше настоящего порога и заведомо больше «схлопнули до секунд».
      await vi.advanceTimersByTimeAsync(30_000);
      const atOneMinute = polls();
      await vi.advanceTimersByTimeAsync(20_000);
      expect(polls()).toBeGreaterThan(atOneMinute);

      // Переваливаем за две минуты с начала опроса и даём ещё столько же сверху.
      await vi.advanceTimersByTimeAsync(2 * 60 * 1000);
      const justAfterTimeout = polls();
      await vi.advanceTimersByTimeAsync(2 * 60 * 1000);
      expect(polls()).toBe(justAfterTimeout);
    } finally {
      vi.useRealTimers();
    }
  });

  it('rearms the poll clock when the person comes back from the bank', async () => {
    // 🔴 Пункт 1 реза 22.08.2026 — регрессия, которую создаёт САМА эта правка.
    // Пока уход убивал документ, возврат с оплаты был новой загрузкой, и отсчёт опроса
    // начинался с нуля. Теперь мини-приложение остаётся живым — а порог молчания две
    // минуты (`:365`) против окна оплаты по СБП в 30–41 минуту. Не перевзведи мы часы,
    // человек возвращался бы из банка на экран, который замолчал, пока он платил.
    // Порог зашит литералом нарочно: сторож, перебирающий ту же константу, что и код,
    // в этом проекте уже дважды переживал мутацию.
    vi.useFakeTimers();
    try {
      const noDeadline = { ...directInvoice(), provider_invoice_expires_at: null };
      vi.mocked(deviceFirstApi.get).mockResolvedValue(noDeadline);
      vi.mocked(deviceFirstApi.getPendingPayment).mockResolvedValue({
        redirect_url: 'https://app.platega.io/pay/return',
        status: 'pending',
        resume_allowed: false,
      });
      const polls = () => vi.mocked(deviceFirstApi.get).mock.calls.length;

      renderConfigurator({ initialPath: '/subscription/purchase?checkout=checkout-owned' });
      await vi.advanceTimersByTimeAsync(100);
      await vi.advanceTimersByTimeAsync(3_000);
      await vi.advanceTimersByTimeAsync(30_000);
      expect(polls()).toBeGreaterThan(1);

      // Экран замолчал сам — это и есть исходное состояние вернувшегося человека.
      await vi.advanceTimersByTimeAsync(3 * 60 * 1000);
      const whenSilent = polls();
      await vi.advanceTimersByTimeAsync(60_000);
      expect(polls()).toBe(whenSilent);

      // Уходим на оплату и возвращаемся.
      fireEvent.click(screen.getByRole('button', { name: 'deviceFirst.continueExistingInvoice' }));
      // 🔴 Полчаса, а не 100 мс, и в этом ВЕСЬ смысл сторожа. Первая версия ждала 100 мс —
      // за это время часы, взведённые самим кликом, ещё свежие, и проверка проходила по
      // совпадению: убери перевзвод из обработчика возврата, и тест оставался зелёным.
      // Нашли две независимые проверки, не я. В жизни человек уходит в банк на 30–41 минуту,
      // клик-перевзвод к возврату давно протух, и работает ровно та строка, которую этот
      // сторож обязан держать.
      await vi.advanceTimersByTimeAsync(30 * 60 * 1000);
      document.dispatchEvent(new Event('visibilitychange'));
      await vi.advanceTimersByTimeAsync(100);
      const onReturn = polls();

      // Часы перевзведены: экран снова опрашивает сервер сам.
      await vi.advanceTimersByTimeAsync(30_000);
      expect(polls()).toBeGreaterThan(onReturn);
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not refetch on a plain minimise the person never left for', async () => {
    // Обратная половина: без неё сторож выше был бы зелёным и на экране, который
    // перезапрашивает сервер от любого сворачивания. Условие — тот же
    // `paymentLinkOpenedRef`, что на экране пополнения (`TopUpAmount.tsx:301`).
    vi.mocked(deviceFirstApi.get).mockResolvedValue(directInvoice());
    vi.mocked(deviceFirstApi.getPendingPayment).mockResolvedValue({
      redirect_url: 'https://app.platega.io/pay/idle',
      status: 'pending',
      resume_allowed: false,
    });

    renderConfigurator({ initialPath: '/subscription/purchase?checkout=checkout-owned' });
    await screen.findByRole('button', { name: 'deviceFirst.continueExistingInvoice' });
    const before = vi.mocked(deviceFirstApi.get).mock.calls.length;

    document.dispatchEvent(new Event('visibilitychange'));
    await Promise.resolve();
    expect(vi.mocked(deviceFirstApi.get).mock.calls.length).toBe(before);
  });

  it('treats a copied link as leaving to pay, so the return still refreshes the order', async () => {
    // 🔴 P0, найденный волной ревью в МОЕЙ ЖЕ правке. Отметку «человек ушёл платить»
    // ставил только уход по кнопке. Тот, кто скопировал ссылку и оплатил в браузере,
    // возвращался на экран, который заказ не перечитывал и уже замолчал по порогу двух
    // минут, — а подпись под кнопкой обещала ему «заказ обновится сам».
    vi.mocked(deviceFirstApi.get).mockResolvedValue(directInvoice());
    vi.mocked(deviceFirstApi.getPendingPayment).mockResolvedValue({
      redirect_url: 'https://app.platega.io/pay/copied',
      status: 'pending',
      resume_allowed: false,
    });

    renderConfigurator({ initialPath: '/subscription/purchase?checkout=checkout-owned' });
    fireEvent.click(await screen.findByRole('button', { name: 'deviceFirst.copyPaymentLink' }));
    await screen.findByRole('button', { name: 'deviceFirst.paymentLinkCopied' });
    const afterCopy = vi.mocked(deviceFirstApi.get).mock.calls.length;

    document.dispatchEvent(new Event('visibilitychange'));

    await waitFor(() =>
      expect(vi.mocked(deviceFirstApi.get).mock.calls.length).toBeGreaterThan(afterCopy),
    );
  });

  it('says so out loud when the clipboard itself refuses', async () => {
    // 🔴 Д5. Запасной выход не имеет права отказывать молча — иначе он сам тупик.
    // До правки отказ писал `false` в состояние, которое и так `false`: React делал
    // bail-out, ре-рендера не было, и отказ был неотличим от «я не нажал».
    const { copyToClipboard } = await import('@/utils/clipboard');
    vi.mocked(copyToClipboard).mockRejectedValueOnce(new Error('clipboard unavailable'));
    vi.mocked(deviceFirstApi.get).mockResolvedValue(directInvoice());
    vi.mocked(deviceFirstApi.getPendingPayment).mockResolvedValue({
      redirect_url: 'https://app.platega.io/pay/no-clipboard',
      status: 'pending',
      resume_allowed: false,
    });

    renderConfigurator({ initialPath: '/subscription/purchase?checkout=checkout-owned' });
    fireEvent.click(await screen.findByRole('button', { name: 'deviceFirst.copyPaymentLink' }));

    // Подпись обязана смениться на отказ, а не остаться прежней.
    await screen.findByRole('button', { name: 'deviceFirst.paymentLinkCopyFailed' });
    expect(screen.queryByRole('button', { name: 'deviceFirst.paymentLinkCopied' })).toBeNull();
  });

  it('offers the payment link by hand, because the opener can fail without saying so', async () => {
    // 🔴 `openLink` отказывает МОЛЧА: и SDK, и `window.open` могут не открыть ничего.
    // Пока уход убивал документ, отказ был виден сразу — экран просто не менялся. Теперь
    // экран одинаков и при успехе, и при отказе, поэтому забрать ссылку руками обязано
    // быть можно. Это единственный видимый выход из молчаливого отказа.
    const { copyToClipboard } = await import('@/utils/clipboard');
    vi.mocked(deviceFirstApi.get).mockResolvedValue(directInvoice());
    vi.mocked(deviceFirstApi.getPendingPayment).mockResolvedValue({
      redirect_url: 'https://app.platega.io/pay/by-hand',
      status: 'pending',
      resume_allowed: false,
    });

    renderConfigurator({ initialPath: '/subscription/purchase?checkout=checkout-owned' });
    fireEvent.click(await screen.findByRole('button', { name: 'deviceFirst.copyPaymentLink' }));

    await waitFor(() =>
      expect(vi.mocked(copyToClipboard)).toHaveBeenCalledWith('https://app.platega.io/pay/by-hand'),
    );
    // Копируется ИМЕННО платёжный адрес, а не адрес нашей страницы.
    expect(
      await screen.findByRole('button', { name: 'deviceFirst.paymentLinkCopied' }),
    ).toBeTruthy();
  });

  it('does not loop on the create-invoice button when the resume comes back without a link', async () => {
    // 🔴 Находка волны 2, и петля была ЖИВА после моей же починки. Сервер сознательно не
    // отдаёт адрес, если попытка «ambiguous/reconciling»
    // (`bot-code/app/cabinet/routes/device_first.py:812-819`), а помощник в этом случае молча
    // выходил, ничего не записав. Протухшее `resume_allowed: true` оставалось, кнопка
    // «Продолжить создание счёта» никуда не девалась, и второй тап по ней получал
    // `invoice_resume_unavailable` — код, которого нет в разборе ошибок: человек видел безликое
    // «попробуйте ещё раз» при всё той же живой кнопке.
    vi.mocked(deviceFirstApi.get).mockResolvedValue(directInvoice());
    vi.mocked(deviceFirstApi.getPendingPayment).mockResolvedValue({
      redirect_url: null,
      status: 'missing',
      resume_allowed: true,
    });
    // Ответ БЕЗ адреса — ровно то, что отдаёт боевой сервер в этой ветке.
    vi.mocked(deviceFirstApi.resumeInvoice).mockResolvedValue({ checkout: directInvoice() });

    renderConfigurator({ initialPath: '/subscription/purchase?checkout=checkout-owned' });
    fireEvent.click(await screen.findByRole('button', { name: 'deviceFirst.resumeInvoice' }));

    // Кнопка создания счёта ушла — жать по кругу больше нечего.
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'deviceFirst.resumeInvoice' })).toBeNull(),
    );
    expect(deviceFirstApi.resumeInvoice).toHaveBeenCalledTimes(1);
    // И экран честно говорит, что идёт сверка, а не зовёт платить.
    expect(screen.getByText('deviceFirst.paymentCheckingText')).toBeTruthy();
    expect(
      screen.queryByRole('button', { name: 'deviceFirst.continueExistingInvoice' }),
    ).toBeNull();
  });

  it('tells the person what to do once the screen stops refreshing itself', async () => {
    // Опрос теперь замолкает, и подсказка рядом с «Обновить статус» — единственное, что об
    // этом говорит. Скептик показал, что её можно удалить при полностью зелёном наборе.
    vi.mocked(deviceFirstApi.get).mockResolvedValue(directInvoice());

    renderConfigurator({ initialPath: '/subscription/purchase?checkout=checkout-owned' });

    const refresh = await screen.findByRole('button', { name: 'deviceFirst.refreshStatus' });
    const hint = screen.getByText('deviceFirst.refreshStatusHint');
    // Подсказка идёт ПОСЛЕ кнопки, к которой относится: она объясняет уже увиденное.
    expect(refresh.compareDocumentPosition(hint) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('keeps polling after payment while the VPN is being provisioned', async () => {
    // 🔴 Находка волны 2, и это была моя же починка. Тот же запрос обслуживает три состояния:
    // экран счёта, «Проверяем оплату» и «Настраиваем VPN». Сняв исключение для прямого счёта,
    // я заглушил все три — то есть заплативший человек смотрел бы на «Настраиваем…» вечно,
    // и подсказки про «Обновить статус» на том экране нет. Порог обязан касаться ТОЛЬКО
    // экрана счёта. Состояние и порог зашиты литералами.
    vi.useFakeTimers();
    try {
      const polls = () => vi.mocked(deviceFirstApi.get).mock.calls.length;
      vi.mocked(deviceFirstApi.get).mockResolvedValue({
        ...directInvoice(),
        provider_invoice_expires_at: null,
        lifecycle_state: 'fulfilling',
        ui_state: 'processing',
      });

      renderConfigurator({ initialPath: '/subscription/purchase?checkout=checkout-owned' });
      await vi.advanceTimersByTimeAsync(100);
      await vi.advanceTimersByTimeAsync(3_000);
      await vi.advanceTimersByTimeAsync(3 * 60 * 1000);
      const afterThreshold = polls();
      expect(afterThreshold).toBeGreaterThan(1);

      await vi.advanceTimersByTimeAsync(60_000);
      // Порог позади, а экран выдачи продолжает следить — иначе оплативший не узнает,
      // что подписка готова.
      expect(polls()).toBeGreaterThan(afterThreshold);
    } finally {
      vi.useRealTimers();
    }
  });

  it('restarts polling for an invoice created by a resume', async () => {
    // 🔴 Находка волны 1. `pollStartedAt` сбрасывается только когда меняется СТРОКА состояния
    // заказа, а `resume` оставляет ту же `awaiting_payment` под тем же id. Значит для нового
    // счёта опрос не включался бы вовсе: человек создал счёт, оплатил, а экран замер навсегда.
    // Раньше это было не видно — прямой счёт опрашивался вечно.
    vi.useFakeTimers();
    try {
      const polls = () => vi.mocked(deviceFirstApi.get).mock.calls.length;
      vi.mocked(deviceFirstApi.get).mockResolvedValue({
        ...directInvoice(),
        provider_invoice_expires_at: null,
      });
      vi.mocked(deviceFirstApi.getPendingPayment)
        .mockResolvedValueOnce({ redirect_url: null, status: 'missing', resume_allowed: true })
        .mockResolvedValue({
          redirect_url: 'https://app.platega.io/pay/after-resume',
          status: 'pending',
          resume_allowed: false,
        });
      vi.mocked(deviceFirstApi.resumeInvoice).mockResolvedValue({
        checkout: { ...directInvoice(), provider_invoice_expires_at: null },
        redirect_url: 'https://app.platega.io/pay/after-resume',
      });

      renderConfigurator({ initialPath: '/subscription/purchase?checkout=checkout-owned' });
      await vi.advanceTimersByTimeAsync(100);
      await vi.advanceTimersByTimeAsync(3_000);
      // Переваливаем порог: опрос старого счёта затих.
      await vi.advanceTimersByTimeAsync(3 * 60 * 1000);
      const beforeResume = polls();
      await vi.advanceTimersByTimeAsync(30_000);
      expect(polls()).toBe(beforeResume);

      fireEvent.click(screen.getByRole('button', { name: 'deviceFirst.resumeInvoice' }));
      await vi.advanceTimersByTimeAsync(100);
      await vi.advanceTimersByTimeAsync(30_000);
      // Счёт новый — отсчёт новый, экран снова следит за оплатой.
      expect(polls()).toBeGreaterThan(beforeResume);
    } finally {
      vi.useRealTimers();
    }
  });

  it('draws the cancel button as live red text with an icon, not as a disabled-looking one', async () => {
    // 🔴 Кнопка была покрашена `text-dark-500` — цветом выключенных элементов, то есть
    // выглядела неработающей ровно там, где человек ищет выход. Красный ТЕКСТ с иконкой,
    // без заливки: заливка поставила бы отмену в зону большого пальца наравне с оплатой.
    // Классы зашиты литералами: сторож не ходит по той же строке, что и код.
    renderConfigurator({ fixtureCheckout: directInvoice() });

    const cancel = screen.getByRole('button', { name: 'deviceFirst.cancel' });
    expect(cancel.className).toContain('text-error-400');
    expect(cancel.className).not.toContain('text-dark-500');
    // Заливки нет: акцентной остаётся оплата.
    expect(cancel.className).not.toContain('bg-error-500 ');
    expect(cancel.querySelector('svg')).toBeTruthy();
  });

  it('keeps the selection when leaving the invoice screen through Change options', async () => {
    // 🔴 Кнопка звала голый `returnToConfiguration`, а он выбор из заказа не восстанавливает.
    // На заказе, открытом из бота или с Главной, состояние компонента пустое — человек,
    // оформивший 6 устройств на 90 дней, молча падал в умолчание. Это мина X, которую уже
    // чинили на соседнем пути.
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
    const live: DeviceFirstCheckout = {
      ...directInvoice(),
      period_days: 90,
      selected_device_limit: 6,
    };

    renderConfigurator({ options: wide, fixtureCheckout: live });
    fireEvent.click(screen.getByRole('button', { name: 'deviceFirst.changeOptions' }));

    await waitFor(() =>
      expect(
        screen
          .getByText('deviceFirst.deviceCount:6')
          .closest('button')
          ?.getAttribute('aria-checked'),
      ).toBe('true'),
    );
    expect(
      screen
        .getByText('deviceFirst.periodMonths:3')
        .closest('button')
        ?.getAttribute('aria-checked'),
    ).toBe('true');
  });

  // --- мина W: мёртвой кнопки «Назад» на странице провайдера не остаётся ----------

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

  it('мина AN: молчание сети переспрашиваем, ответ «адреса нет» — НЕТ', async () => {
    // 🔴 Две половины одной защиты, и обе обязаны быть проверены ОДНИМ входом каждая,
    // иначе сторож стережёт совпадение:
    //   сеть промолчала → окончательного ответа не было → переспрашиваем;
    //   сервер ОТВЕТИЛ 404 → адреса нет, и это защита от повторной оплаты → не трогаем.
    // Улика того, что момент действительно прошёл, — число попыток в первом сценарии:
    // пока оно не дошло до трёх, время повторов ещё не истекло, и «ровно одна попытка»
    // во втором сценарии ничего бы не доказывала.
    const invoice = directInvoice();
    vi.mocked(deviceFirstApi.get).mockResolvedValue(invoice);

    vi.mocked(deviceFirstApi.getPendingPayment).mockRejectedValue(new Error('network is down'));
    renderConfigurator({ initialPath: '/subscription/purchase?checkout=checkout-owned' });
    await waitFor(() => expect(deviceFirstApi.getPendingPayment).toHaveBeenCalledTimes(3), {
      timeout: 4000,
    });

    cleanup();
    vi.mocked(deviceFirstApi.getPendingPayment).mockClear();
    vi.mocked(deviceFirstApi.getPendingPayment).mockRejectedValue({
      response: { status: 404, data: { detail: { code: 'pending_payment_not_found' } } },
    });
    renderConfigurator({ initialPath: '/subscription/purchase?checkout=checkout-owned' });
    await waitFor(() => expect(deviceFirstApi.getPendingPayment).toHaveBeenCalled());
    // Ждём заведомо дольше, чем заняли три попытки выше.
    await new Promise((resolve) => setTimeout(resolve, 1200));
    expect(deviceFirstApi.getPendingPayment).toHaveBeenCalledTimes(1);
  }, 10000);

  it('нажал «оплатить», а счёт уже закрыт — объяснение, а не молчаливый выброс', async () => {
    // 🔴 ПЕРЕПИСАН 26.08.2026 по находке волны 1. Первая редакция этого сторожа проверяла, что
    // человека УЖЕ УНЕСЛО на экран выбора, — то есть закрепляла ровно то молчание, ради снятия
    // которого затеян этап. Четыре линзы нашли это независимо.
    // Сервер бросает `invoice_terminal` тогда же, когда закрывает счёт причиной
    // `provider_terminal:*`: это тот же человек и то же состояние. Свойство теперь такое:
    //   1) он остаётся и читает объяснение;
    //   2) технической ошибки под объяснением нет — экран не даёт двух указаний разом;
    //   3) уйдя своим нажатием, он не теряет выбор.
    // Вход боевой: приземлился по `?checkout=` (локально умолчания 30/2, выбор живёт только в
    // строке заказа), нажал «возобновить счёт», а провайдер счёт уже закрыл.
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
    const stillOpen: DeviceFirstCheckout = {
      ...directInvoice(),
      period_days: 90,
      selected_device_limit: 6,
    };
    // 🔴 ФИКСТУРА ПЕРЕПИСАНА после мутационного прогона: первая была `mockResolvedValueOnce`,
    // и строка успевала прийти закрытой САМА, вторым чтением, ещё до нажатия. Сторож проходил
    // и со снятой защитой — то есть проверял совпадение, а не работу. Теперь строка закрывается
    // РОВНО тогда, когда сервер отказал: до этого момента любое чтение даёт «ждёт оплаты».
    let resumeRefused = false;
    const closedRow: DeviceFirstCheckout = {
      ...stillOpen,
      ui_state: 'cancelled',
      lifecycle_state: 'cancelled',
      terminal_reason: 'provider_terminal:canceled',
      money_state: 'unknown',
    };
    vi.mocked(deviceFirstApi.get).mockImplementation(async () =>
      resumeRefused ? closedRow : stillOpen,
    );
    vi.mocked(deviceFirstApi.getPendingPayment).mockResolvedValue({
      redirect_url: null,
      status: 'pending',
      resume_allowed: true,
    });
    vi.mocked(deviceFirstApi.resumeInvoice).mockImplementation(async () => {
      resumeRefused = true;
      throw { response: { data: { detail: { code: 'invoice_terminal' } } } };
    });

    renderConfigurator({
      options: wide,
      initialPath: '/subscription/purchase?checkout=checkout-owned',
    });

    const resumeButton = await screen.findByRole('button', { name: 'deviceFirst.resumeInvoice' });
    // 🔴 Улика: ДО нажатия объяснения на экране нет. Без неё сторож не отличал бы свою правку
    // от строки, пришедшей закрытой сама по себе.
    expect(screen.queryByText('deviceFirst.providerClosedText')).toBeNull();
    fireEvent.click(resumeButton);

    // 1. Он остался и читает объяснение — то же, что читает пришедший опросом.
    expect(await screen.findByText('deviceFirst.providerClosedText')).toBeTruthy();
    // 2. Двух указаний разом нет: протухшая техническая ошибка погашена.
    expect(screen.queryByText('deviceFirst.errorPaymentChecking')).toBeNull();
    expect(screen.queryByText('deviceFirst.error')).toBeNull();

    // 3. Уходит своим нажатием — и на экране выбора ЕГО конфигурация, а не умолчания 30/2.
    fireEvent.click(screen.getByRole('button', { name: 'deviceFirst.startNew' }));
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

  it('заказ не прочитался — экран не утверждает, что денег не списывали', async () => {
    // 🔴 Найдено волной 1, тремя линзами независимо. Соседняя с загрузкой ветка показывала
    // «Данные подписки или цена изменились. Создайте новый расчёт — деньги без подтверждения
    // не списаны». Падает сюда ровно тот, у кого холодный старт вебвью сорвал ТРИ чтения
    // подряд после оплаты картой, — и ему сообщали об отсутствии списания и звали
    // оформить заказ заново, то есть заплатить второй раз.
    // Улика: старого текста на экране нет НИ В КАКОМ виде.
    vi.mocked(deviceFirstApi.get).mockRejectedValue(new Error('network is down'));
    renderConfigurator({ initialPath: '/subscription/purchase?checkout=checkout-owned' });

    expect(
      await screen.findByText('deviceFirst.restoringErrorText', undefined, { timeout: 9000 }),
    ).toBeTruthy();
    expect(screen.queryByText('deviceFirst.refreshText')).toBeNull();
    expect(screen.queryByText('deviceFirst.refreshTitle')).toBeNull();
    // 🔴 Волна 2: текст просит «напишите в поддержку», значит выход в поддержку обязан быть на
    // экране. Раньше единственная кнопка называлась «Начать новый расчёт» и стирала
    // `?checkout=` — последнюю ссылку на заказ, за который человек мог заплатить.
    expect(screen.getByRole('button', { name: 'deviceFirst.contactSupport' })).toBeTruthy();
  }, 15000);

  it('мина AQ: банк отказал, а заказ ещё не закрыт — экран говорит об отказе и снимает метку', async () => {
    // 🔴 Заказ закрывает не возврат человека, а вебхук или сверка. Пока они не сработали,
    // строка остаётся `awaiting_payment`, и человек видел живую кнопку «Перейти к оплате»
    // и ни слова о том, что банк только что отказал. Метку `payment=failed` на этом маршруте
    // до сих пор не читал никто.
    vi.mocked(deviceFirstApi.get).mockResolvedValue(directInvoice());
    vi.mocked(deviceFirstApi.getPendingPayment).mockResolvedValue({
      redirect_url: 'https://app.platega.io/pay/9',
      status: 'pending',
      resume_allowed: false,
    });

    renderConfigurator({
      initialPath: '/subscription/purchase?checkout=checkout-owned&payment=failed',
    });

    expect(await screen.findByText('deviceFirst.providerDeclinedNotice')).toBeTruthy();
    // 🔴 Улика: метка снята с адреса сразу. Иначе она пережила бы перезагрузку и объявляла бы
    // отказ по заказу, который человек к тому времени уже оплатил.
    await waitFor(() =>
      expect(screen.getByTestId('location').textContent).toBe(
        '/subscription/purchase?checkout=checkout-owned',
      ),
    );
  });

  it('мина EW: пошёл платить снова — плашка отказа гаснет, а не висит поверх оплаты', async () => {
    // 🔴 Наша мина, нашли три проверки волны 2. Плашка — это НОВОСТЬ от платёжной системы, а не
    // свойство заказа. Состояние ставилось один раз и не сбрасывалось ничем, а компонент между
    // заказами не размонтируется. Худший вход именно этот: человек жмёт «Перейти к оплате» и
    // платит успешно, а над работающей кнопкой у него написано «Оплата не прошла».
    vi.mocked(deviceFirstApi.get).mockResolvedValue(directInvoice());
    vi.mocked(deviceFirstApi.getPendingPayment).mockResolvedValue({
      redirect_url: 'https://app.platega.io/pay/11',
      status: 'pending',
      resume_allowed: false,
    });

    renderConfigurator({
      initialPath: '/subscription/purchase?checkout=checkout-owned&payment=failed',
    });

    expect(await screen.findByText('deviceFirst.providerDeclinedNotice')).toBeTruthy();
    fireEvent.click(
      await screen.findByRole('button', { name: 'deviceFirst.continueExistingInvoice' }),
    );

    // Улика, что уход действительно состоялся, а не просто «плашки нет».
    expect(openLink).toHaveBeenCalledWith('https://app.platega.io/pay/11');
    await waitFor(() =>
      expect(screen.queryByText('deviceFirst.providerDeclinedNotice')).toBeNull(),
    );
  });

  it('счёт закрыт на ОПЛАТЕ, а не на возобновлении — человек читает про закрытый счёт', async () => {
    // 🔴 Волна 2: главный платёжный путь идёт через слитую мутацию, у которой локальной строки
    // заказа НЕТ по построению. Там перечитывать нечего, и человеку оставалась ошибка — а у
    // кода `invoice_terminal` не было своего текста, и он падал в безликое «Не удалось
    // выполнить действие. Попробуйте ещё раз», то есть звал повторить ровно то, откуда его
    // только что отбили. Текст взят слово в слово из бота.
    vi.mocked(deviceFirstApi.payDirect).mockRejectedValue({
      response: { data: { detail: { code: 'invoice_terminal' } } },
    });
    renderConfigurator();

    fireEvent.click(screen.getByRole('button', { name: 'deviceFirst.review' }));
    fireEvent.click(
      await screen.findByRole('button', { name: 'deviceFirst.paymentMethodAmount:450 ₽' }),
    );

    expect(await screen.findByText('deviceFirst.errorInvoiceTerminal')).toBeTruthy();
    // Улика: безликого «попробуйте ещё раз» больше нет.
    expect(screen.queryByText('deviceFirst.error')).toBeNull();
  });

  it('заказ протух — техническую защиту «не оплачивайте повторно» НЕ гасим', async () => {
    // 🔴 Волна 2 нашла, что моё гашение ошибки было слишком широким: на `expired`/`failed`/
    // `conflict` своего объяснения у экрана нет, он падает в запасной текст «деньги без
    // подтверждения не списаны», и единственным носителем защиты была как раз ошибка.
    // Гасить её можно ТОЛЬКО там, где этап поставил замену, — на закрытом провайдером счёте.
    const invoice = directInvoice();
    let expiredNow = false;
    vi.mocked(deviceFirstApi.get).mockImplementation(async () =>
      expiredNow ? { ...invoice, ui_state: 'expired', lifecycle_state: 'expired' } : invoice,
    );
    vi.mocked(deviceFirstApi.getPendingPayment).mockResolvedValue({
      redirect_url: null,
      status: 'pending',
      resume_allowed: true,
    });
    vi.mocked(deviceFirstApi.resumeInvoice).mockImplementation(async () => {
      expiredNow = true;
      throw { response: { data: { detail: { code: 'external_invoice_active' } } } };
    });

    renderConfigurator({ initialPath: '/subscription/purchase?checkout=checkout-owned' });
    fireEvent.click(await screen.findByRole('button', { name: 'deviceFirst.resumeInvoice' }));

    // Ошибка поставлена и обязана пережить переход в терминальное состояние без объяснения.
    expect(await screen.findByText('deviceFirst.errorPaymentChecking')).toBeTruthy();
  });

  it('мина AQ: если заказ уже закрыт, про отказ говорит объяснение, а не второй голос', async () => {
    // Два текста про одно состояние — ровно то, что запрещает пункт 4.2б. Как только строка
    // пришла закрытой, сообщение об отказе замолкает.
    vi.mocked(deviceFirstApi.get).mockResolvedValue({
      ...directInvoice(),
      ui_state: 'cancelled',
      lifecycle_state: 'cancelled',
      terminal_reason: 'provider_terminal:canceled',
      money_state: 'unknown',
    });

    renderConfigurator({
      initialPath: '/subscription/purchase?checkout=checkout-owned&payment=failed',
    });

    expect(await screen.findByText('deviceFirst.providerClosedText')).toBeTruthy();
    expect(screen.queryByText('deviceFirst.providerDeclinedNotice')).toBeNull();
  });

  it('пока заказ грузится, экран НЕ утверждает, что оплата учтена', async () => {
    // 🔴 Мина AR, вторая половина. Здесь экран писал «Настраиваем VPN. Оплата учтена» — про
    // деньги, о которых он в этот момент не знает ничего: строка заказа ещё не пришла.
    // Врало это не только тому, кому отказал банк: на этот же экран приводят карточка
    // «незавершённый заказ» с Главной и кнопка из бота.
    // Сторож держит момент ЗАГРУЗКИ: запрос заказа не разрешается никогда.
    vi.mocked(deviceFirstApi.get).mockReturnValue(new Promise(() => {}));
    renderConfigurator({ initialPath: '/subscription/purchase?checkout=checkout-owned' });

    expect(await screen.findByText('deviceFirst.restoringOrderText')).toBeTruthy();
    // 🔴 Улика: обещания оплаты на экране нет ни в каком виде.
    expect(screen.queryByText('deviceFirst.processingText')).toBeNull();
    expect(screen.queryByText('deviceFirst.processing')).toBeNull();
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

  // ── Этап Б-1: свой баланс можно пустить в дело в любой момент ──────────────────

  // 🔴 Сторож на ГЛАВНОЕ обещание этапа. До Б-1 кнопка пополнения жила внутри блока
  // ошибки, а ошибки на этом экране не бывает: оплату с баланса при нехватке не
  // предлагают, значит `wallet_insufficient` взяться неоткуда. Кнопку видел кто угодно,
  // кроме того, кому она нужна. Проверяем ровно этот случай: денег НЕ хватает, ошибки НЕТ.
  it('offers a top-up path to a short wallet before any error happens', async () => {
    // 100 ₽ на балансе против 450 ₽ цены — тот самый массовый случай: рекламный бонус,
    // которого не хватает на месяц.
    renderConfigurator({ options: { ...options, balance_kopeks: 10000 } });

    fireEvent.click(screen.getByRole('button', { name: 'deviceFirst.review' }));

    // Ошибки нет — значит кнопка пришла не из блока отказа.
    expect(screen.queryByRole('alert')).toBeNull();
    // 🔴 Этап Б-2: у человека со СВОИМИ деньгами это доплата, а не пополнение. Слова
    // «и оформить» на кнопке нет и быть не может — возврат приводит на подтверждение,
    // где надо нажать ещё раз.
    const topUp = await screen.findByRole('button', {
      name: 'deviceFirst.topUpShortage:350 ₽',
    });

    fireEvent.click(topUp);

    // Суммы и адреса возврата в проверке ЗАШИТЫ ЛИТЕРАЛАМИ: сторож, который считает
    // недостачу тем же выражением, что и код, доказывает только сам себя.
    const target = screen.getByTestId('location').textContent ?? '';
    // 🔴 Этап Б-2: сразу экран суммы нужного провайдера, а не выбор провайдера с одной карточкой.
    expect(target.startsWith('/balance/top-up/platega?')).toBe(true);
    const query = new URLSearchParams(target.slice(target.indexOf('?') + 1));
    // Недостача, а не полная цена: 450 − 100 = 350.
    expect(query.get('amount')).toBe('350');
    // Возврат несёт метку кассы и ВЫБОР человека — без них он вернётся на пустой экран.
    expect(query.get('returnTo')).toBe('/subscription/purchase?from=checkout&period=30&devices=2');
    // 🔴 Минимум провайдера в этом прогоне не пришёл (балансный запрос отбит), значит счёт
    // сам не создаётся: мы не знаем, примет ли сервер сумму. Тихо промолчать здесь — значит
    // отправить человека в отказ, которого он не вызывал.
    expect(query.get('auto')).toBeNull();
    expect(query.get('option')).toBeNull();
  });

  // 🔴 Сторож на ЧЕСТНУЮ СУММУ. Число на кнопке обязано совпадать с числом в адресе, иначе
  // человек видит одно, а платит другое. Проверяется на минимуме провайдера, который БОЛЬШЕ
  // недостачи: 450 − 400 = 50 ₽ не хватает, но провайдер меньше 100 ₽ не примет.
  it('raises the top-up to the provider minimum and shows the very number it will charge', async () => {
    getBalancePaymentMethods.mockResolvedValue([
      {
        id: 'platega',
        name: 'Platega',
        is_available: true,
        min_amount_kopeks: 10000,
        max_amount_kopeks: 100000000,
      },
    ]);
    renderConfigurator({ options: { ...options, balance_kopeks: 40000 } });

    fireEvent.click(screen.getByRole('button', { name: 'deviceFirst.review' }));

    // Сводка честно говорит про 50 ₽ недостачи — это разные числа, и оба правдивы.
    expect(await screen.findByText('deviceFirst.shortage')).toBeTruthy();
    await screen.findByRole('button', { name: 'deviceFirst.paymentMethodAmount:450 ₽' });
    const topUp = await screen.findByRole('button', {
      name: 'deviceFirst.topUpShortage:100 ₽',
    });

    fireEvent.click(topUp);

    const target = screen.getByTestId('location').textContent ?? '';
    const query = new URLSearchParams(target.slice(target.indexOf('?') + 1));
    expect(query.get('amount')).toBe('100');
    // 🔴 Способ едет ЧИСЛОМ провайдера: касса зовёт его `sbp`, экран пополнения знает его
    // как `'2'`. Подставить сюда `method.key` значит молча подменить способ на СБП по
    // умолчанию (`getPreferredOptionId`) у того, кто выбрал карту.
    expect(query.get('option')).toBe('2');
    expect(query.get('auto')).toBe('1');
  });

  // 🔴 Мостик словарей проверяется НЕ на СБП: у СБП число совпало бы случайно с порядком,
  // и сторож доказывал бы совпадение, а не защиту. Карта российского банка — это `11`.
  it('carries the provider number of the method the checkout actually chose, not its key', async () => {
    vi.mocked(deviceFirstApi.paymentMethods).mockResolvedValue({
      methods: [{ key: 'cards_ru', provider_code: 11 }],
    });
    getBalancePaymentMethods.mockResolvedValue([
      {
        id: 'platega',
        name: 'Platega',
        is_available: true,
        min_amount_kopeks: 100,
        max_amount_kopeks: 100000000,
      },
    ]);
    renderConfigurator({ options: { ...options, balance_kopeks: 10000 } });

    fireEvent.click(screen.getByRole('button', { name: 'deviceFirst.review' }));
    // Ждём именно КНОПКУ СПОСОБА: она появляется только после того, как список способов
    // приехал и предохранитель `methodKey` подменил зашитый `sbp` на то, что даёт сервер.
    // Без этого ожидания сторож проверял бы окно, в котором способа ещё нет вовсе.
    await screen.findByRole('button', { name: 'deviceFirst.paymentMethodAmount:450 ₽' });
    fireEvent.click(screen.getByRole('button', { name: 'deviceFirst.topUpShortage:350 ₽' }));

    const target = screen.getByTestId('location').textContent ?? '';
    const query = new URLSearchParams(target.slice(target.indexOf('?') + 1));
    expect(query.get('option')).toBe('11');
    expect(query.get('option')).not.toBe('cards_ru');
  });

  // 🔴 Обратная сторона того же мостика: пока способ с сервера не приехал, `methodKey` держит
  // зашитый `sbp`, которого сервер может и не давать. В этом окне мы НЕ кладём ни `option`,
  // ни `auto` — молча подставить чужой способ хуже, чем показать экран выбора.
  it('sends no provider number at all while the server has not named its methods yet', async () => {
    let releaseMethods: (value: {
      methods: Array<{ key: string; provider_code: number }>;
    }) => void = () => {};
    vi.mocked(deviceFirstApi.paymentMethods).mockReturnValue(
      new Promise((resolve) => {
        releaseMethods = resolve;
      }),
    );
    getBalancePaymentMethods.mockResolvedValue([
      {
        id: 'platega',
        name: 'Platega',
        is_available: true,
        min_amount_kopeks: 100,
        max_amount_kopeks: 100000000,
      },
    ]);
    renderConfigurator({ options: { ...options, balance_kopeks: 10000 } });

    fireEvent.click(screen.getByRole('button', { name: 'deviceFirst.review' }));
    fireEvent.click(await screen.findByRole('button', { name: 'deviceFirst.topUpShortage:350 ₽' }));

    const target = screen.getByTestId('location').textContent ?? '';
    const query = new URLSearchParams(target.slice(target.indexOf('?') + 1));
    expect(target.startsWith('/balance/top-up/platega?')).toBe(true);
    expect(query.get('amount')).toBe('350');
    expect(query.get('option')).toBeNull();
    expect(query.get('auto')).toBeNull();
    releaseMethods({ methods: [{ key: 'sbp', provider_code: 2 }] });
  });

  // 🔴 САМАЯ МАССОВАЯ ВЕТКА — новичок с нулём. У него недостача РАВНА полной цене, и до
  // этапа Б-2 экран показывал ему «Баланс 0 ₽», «Не хватает 450 ₽» и кнопку пополнения:
  // три упоминания денег, которых нет, над работающей кнопкой прямой оплаты.
  it('says nothing about a wallet the newcomer does not have', async () => {
    // 🔴 Балансная сторона отвечает, и у неё ЕСТЬ второй провайдер. Пока сторож держался на
    // умолчании `beforeEach` (запрос отбит), он был пустым: критик полноты показал, что моя
    // же починка возвращала кнопку именно в этом состоянии, а тест этого не видел.
    getBalancePaymentMethods.mockResolvedValue([
      {
        id: 'platega',
        name: 'Platega',
        is_available: true,
        min_amount_kopeks: 100,
        max_amount_kopeks: 100000000,
      },
      {
        id: 'telegram_stars',
        name: 'Telegram Stars',
        is_available: true,
        min_amount_kopeks: 100,
        max_amount_kopeks: 100000000,
      },
    ]);
    renderConfigurator({ options: { ...options, balance_kopeks: 0 } });

    fireEvent.click(screen.getByRole('button', { name: 'deviceFirst.review' }));

    expect(await screen.findByText(/deviceFirst\.paymentMethodAmount/)).toBeTruthy();
    expect(screen.queryByText('deviceFirst.balance')).toBeNull();
    expect(screen.queryByText('deviceFirst.shortage')).toBeNull();
    expect(screen.queryByRole('button', { name: /deviceFirst\.topUpShortage/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /deviceFirst\.topUpAmount/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'deviceFirst.needTopup' })).toBeNull();
    // «ИЛИ оплатите полной суммой» — союз при двух вариантах. Второго варианта у него нет.
    expect(screen.queryByText('deviceFirst.paymentMethodsAvailable')).toBeNull();
    // Заголовок не зовёт «проверить итог»: проверять, кроме цены, нечего.
    expect(screen.getByText('deviceFirst.chooseMethodNotice')).toBeTruthy();
    expect(screen.queryByText('deviceFirst.chargeNotice')).toBeNull();
  });

  // 🔴 Обратная половина: у кого баланс ПОКРЫВАЕТ цену, выбирать нечего — кнопка одна.
  it('drops the choose-a-method promise when there is nothing left to choose', async () => {
    renderConfigurator({ options: { ...options, balance_kopeks: 100000 } });

    fireEvent.click(screen.getByRole('button', { name: 'deviceFirst.review' }));

    expect(
      await screen.findByRole('button', { name: 'deviceFirst.payAndOrder:450 ₽' }),
    ).toBeTruthy();
    expect(screen.getByText('deviceFirst.reviewBeforeCharge')).toBeTruthy();
    expect(screen.queryByText('deviceFirst.chargeNotice')).toBeNull();
    expect(screen.queryByText('deviceFirst.chooseMethodNotice')).toBeNull();
  });

  // 🔴 Единственный оставшийся выход. Если способы оплаты не поднялись, у человека с нулём
  // на балансе на экране НЕТ ни одного действия, ведущего к покупке, — только «Повторить» и
  // «Написать в поддержку». В общем пополнении могут быть другие провайдеры, поэтому кнопка
  // показывается ДАЖЕ при нулевом балансе, и подписана «Пополнить», а не «Доплатить»:
  // доплачивать ему не к чему.
  it('leaves the newcomer a way out when the payment methods themselves are dead', async () => {
    vi.mocked(deviceFirstApi.paymentMethods).mockRejectedValue(new Error('methods are down'));
    renderConfigurator({ options: { ...options, balance_kopeks: 0 } });

    fireEvent.click(screen.getByRole('button', { name: 'deviceFirst.review' }));

    expect(await screen.findByText('deviceFirst.errorPaymentMethodsLoad')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'deviceFirst.topUpAmount:450 ₽' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /deviceFirst\.topUpShortage/ })).toBeNull();
  });

  // 🔴 Нашла волна ревью. Строка-подсказка стоит ВЫШЕ развилки и про её исход не знает. При
  // упавших способах она обещала «Выберите способ оплаты.» прямо над «Не удалось загрузить
  // способы оплаты» — экран спорил сам с собой. Молчание честнее: ветка ниже говорит за себя.
  it('stops promising a choice of method right above the words that there is none', async () => {
    vi.mocked(deviceFirstApi.paymentMethods).mockRejectedValue(new Error('methods are down'));
    renderConfigurator({ options: { ...options, balance_kopeks: 0 } });

    fireEvent.click(screen.getByRole('button', { name: 'deviceFirst.review' }));

    expect(await screen.findByText('deviceFirst.errorPaymentMethodsLoad')).toBeTruthy();
    expect(screen.queryByText('deviceFirst.chooseMethodNotice')).toBeNull();
    expect(screen.queryByText('deviceFirst.chargeNotice')).toBeNull();
  });

  // 🔴 Та же болезнь, вторая ветка: у ВОЗОБНОВЛЁННОГО заказа цена остаётся числом, а пары
  // уже нет в матрице — экран говорит «Недоступно», а подсказка над ним обещала «проверьте
  // итог перед списанием», хотя списывать нечем и кнопок нет ни одной.
  it('says nothing about charging when the resumed order has no price left in the matrix', async () => {
    const goneFromMatrix = {
      ...checkout('confirmation'),
      settlement_mode: 'direct_purchase_v2' as const,
      period_days: 180,
      selected_device_limit: 9,
      tariff_total_kopeks: 45000,
      balance_kopeks: 100000,
    };
    vi.mocked(deviceFirstApi.get).mockResolvedValue(goneFromMatrix);
    // 🔴 Баланс задаётся В ОПЦИЯХ, а не только в строке заказа: `confirmBalanceKopeks` берёт
    // сперва опции. Мутация показала, что без этого сторож проходил по чужой причине — его
    // держало условие ветки частичного баланса, а не проверка «выбор непригоден».
    renderConfigurator({
      options: { ...options, balance_kopeks: 100000 },
      initialPath: '/subscription/purchase?checkout=checkout-owned',
    });

    expect(await screen.findByText('deviceFirst.unavailable')).toBeTruthy();
    expect(screen.queryByText('deviceFirst.reviewBeforeCharge')).toBeNull();
    expect(screen.queryByText('deviceFirst.chargeNotice')).toBeNull();
    expect(screen.queryByText('deviceFirst.chooseMethodNotice')).toBeNull();
  });

  // 🔴 ТЗ требовало кнопку «первой, АКЦЕНТНОЙ». Она была рамочной — значит в ветке частичного
  // баланса на экране не оставалось ни одной залитой кнопки, хотя у соседней ветки главное
  // действие залито. Различать действия одним цветом рамки нельзя.
  it('fills the top-up button only where it is the main action, and leaves it quiet elsewhere', async () => {
    getBalancePaymentMethods.mockResolvedValue([
      {
        id: 'platega',
        name: 'Platega',
        is_available: true,
        min_amount_kopeks: 100,
        max_amount_kopeks: 100000000,
      },
    ]);
    renderConfigurator({ options: { ...options, balance_kopeks: 10000 } });
    fireEvent.click(screen.getByRole('button', { name: 'deviceFirst.review' }));
    const primary = await screen.findByRole('button', { name: 'deviceFirst.topUpShortage:350 ₽' });
    expect(primary.className).toContain('bg-accent-500');
    cleanup();

    // А там, где она запасной выход, заливки быть не должно — иначе перетянет внимание у
    // способов оплаты, которые короче.
    vi.mocked(deviceFirstApi.paymentMethods).mockRejectedValue(new Error('methods are down'));
    renderConfigurator({ options: { ...options, balance_kopeks: 0 } });
    fireEvent.click(screen.getByRole('button', { name: 'deviceFirst.review' }));
    const fallback = await screen.findByRole('button', { name: 'deviceFirst.topUpAmount:450 ₽' });
    expect(fallback.className).not.toContain('bg-accent-500');
  });

  // 🔴 С копейками на балансе доплата округляется до ПОЛНОЙ цены — то есть человек заплатит
  // столько же, но пройдёт на три экрана больше. Делать такую дорогу громкой — ровно то, за
  // что ревью отклонило кандидата «А».
  it('does not make the longer road loud when topping up costs the same as paying outright', async () => {
    renderConfigurator({ options: { ...options, balance_kopeks: 50 } });

    fireEvent.click(screen.getByRole('button', { name: 'deviceFirst.review' }));

    const full = await screen.findByRole('button', {
      name: 'deviceFirst.paymentMethodAmount:450 ₽',
    });
    const topUp = screen.getByRole('button', { name: 'deviceFirst.topUpShortage:450 ₽' });
    // Прямая оплата идёт ПЕРВОЙ, доплата ушла вниз и осталась тихой.
    expect(full.compareDocumentPosition(topUp) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(topUp.className).not.toContain('bg-accent-500');
  });

  // 🔴 Сводка печатает честную недостачу, кнопка — сумму счёта. Когда минимум провайдера
  // больше недостачи, это РАЗНЫЕ числа, и без объяснения человек читает их как ошибку.
  it('explains where the extra money goes when the provider minimum outgrows the shortage', async () => {
    getBalancePaymentMethods.mockResolvedValue([
      {
        id: 'platega',
        name: 'Platega',
        is_available: true,
        min_amount_kopeks: 10000,
        max_amount_kopeks: 100000000,
      },
    ]);
    renderConfigurator({ options: { ...options, balance_kopeks: 40000 } });

    fireEvent.click(screen.getByRole('button', { name: 'deviceFirst.review' }));

    expect(
      await screen.findByRole('button', { name: 'deviceFirst.topUpShortage:100 ₽' }),
    ).toBeTruthy();
    // 100 ₽ уйдёт в счёт, 50 ₽ не хватало — 50 ₽ останется. Число зашито литералом.
    expect(screen.getByText('deviceFirst.topUpSurplusHint:50 ₽')).toBeTruthy();
  });

  // 🔴 Нашёл прогон сценария по замеренной геометрии телефона 375×667: в ветке, ради которой
  // этап и делался, строка велела «выберите способ оплаты», а способы лежали на сотню
  // пикселей НИЖЕ сгиба. Единственная видимая кнопка — «Доплатить», и она способом оплаты не
  // является. Строку убрали: акцентная кнопка со своей подписью и строка «Или оплатите полной
  // суммой» прямо над способами объясняют развилку без вранья.
  it('does not tell the person to pick a method that is two screens below the fold', async () => {
    renderConfigurator({ options: { ...options, balance_kopeks: 10000 } });

    fireEvent.click(screen.getByRole('button', { name: 'deviceFirst.review' }));

    // Ждём именно кнопку СПОСОБА: до неё блок способов ещё не отрисован, и проверка
    // «объяснение развилки на месте» проходила бы по пустому экрану.
    await screen.findByRole('button', { name: 'deviceFirst.paymentMethodAmount:450 ₽' });
    expect(screen.getByRole('button', { name: 'deviceFirst.topUpShortage:350 ₽' })).toBeTruthy();
    expect(screen.queryByText('deviceFirst.chargeNotice')).toBeNull();
    expect(screen.queryByText('deviceFirst.chooseMethodNotice')).toBeNull();
    expect(screen.queryByText('deviceFirst.reviewBeforeCharge')).toBeNull();
    // Объяснение развилки при этом на месте — иначе мы просто сняли текст.
    expect(screen.getByText('deviceFirst.paymentMethodsAvailable')).toBeTruthy();
    expect(screen.getByText('deviceFirst.topUpShortageHint')).toBeTruthy();
  });

  // 🔴 И обратное: если на балансной стороне не осталось ни одного провайдера, кнопка ведёт
  // в пустой экран. Тупик без объяснения хуже отсутствия кнопки.
  it('does not offer a door that opens into an empty room', async () => {
    vi.mocked(deviceFirstApi.paymentMethods).mockRejectedValue(new Error('methods are down'));
    getBalancePaymentMethods.mockResolvedValue([]);
    renderConfigurator({ options: { ...options, balance_kopeks: 10000 } });

    fireEvent.click(screen.getByRole('button', { name: 'deviceFirst.review' }));

    expect(await screen.findByText('deviceFirst.errorPaymentMethodsLoad')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /deviceFirst\.topUp/ })).toBeNull();
  });

  // 🔴 Кандидат «А» отклонён ревью: кнопки способов оплаты остаются на ПОЛНУЮ цену и остаются
  // КНОПКАМИ. Прямая оплата — единственный путь, который сам доводит до подписки (вебхук
  // выдаёт VPN), и он на одно нажатие короче доплаты. Опустить его в серую строку значит
  // сделать громкой худшую половину.
  it('keeps paying the full price a real button next to the top-up, not a paragraph', async () => {
    renderConfigurator({ options: { ...options, balance_kopeks: 10000 } });

    fireEvent.click(screen.getByRole('button', { name: 'deviceFirst.review' }));

    const full = await screen.findByRole('button', {
      name: 'deviceFirst.paymentMethodAmount:450 ₽',
    });
    expect(full.tagName).toBe('BUTTON');
    const topUp = screen.getByRole('button', { name: 'deviceFirst.topUpShortage:350 ₽' });
    // Доплата стоит ПЕРВОЙ: на телефоне до нижних кнопок надо доскроллить.
    expect(topUp.compareDocumentPosition(full) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // И ровно одна кнопка доплаты на экране, а не две: ветки развода взаимоисключающие.
    expect(screen.getAllByRole('button', { name: /deviceFirst\.topUp/ })).toHaveLength(1);
  });

  // 🔴 Обратная половина того же сторожа: у кого денег ХВАТАЕТ, тому предлагать
  // пополнение — оскорбление и лишний шаг.
  it('does not offer a top-up path when the wallet already covers the price', async () => {
    renderConfigurator({ options: { ...options, balance_kopeks: 100000 } });

    fireEvent.click(screen.getByRole('button', { name: 'deviceFirst.review' }));

    expect(
      await screen.findByRole('button', { name: 'deviceFirst.payAndOrder:450 ₽' }),
    ).toBeTruthy();
    expect(screen.queryByRole('button', { name: /deviceFirst.topUpAmount/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'deviceFirst.needTopup' })).toBeNull();
    // 🔴 Этап Б-2 завёл ВТОРУЮ надпись той же кнопке. Сторож, знающий только первую, остаётся
    // зелёным и пустым: предлагать доплату тому, у кого хватает, он бы уже не поймал.
    expect(screen.queryByRole('button', { name: /deviceFirst.topUpShortage/ })).toBeNull();
  });

  // 🔴 Сторож на посев выбора. Человек ушёл с 90 днями и 5 устройствами — обязан вернуться
  // к ним, а не к умолчанию. Проверяется через НАСТОЯЩУЮ точку входа (адрес возврата),
  // а не вызовом хелпера: тесты на хелперы не доказывают, что механизм подключён.
  it('restores the selection carried by the top-up return address', async () => {
    const wideOptions: DeviceFirstOptions = {
      ...options,
      period_options: [30, 90],
      default_period_days: 30,
      device_options: [2, 5],
      price_matrix: [
        options.price_matrix![0],
        {
          period_days: 90,
          prices: [
            {
              device_limit: 5,
              price_kopeks: 120000,
              breakdown: {
                base_price_kopeks: 120000,
                devices_price_kopeks: 0,
                promo_group_discount_kopeks: 0,
                promo_offer_discount_kopeks: 0,
              },
            },
          ],
        },
      ],
    };

    renderConfigurator({
      options: wideOptions,
      initialPath: '/subscription/purchase?from=checkout&period=90&devices=5',
    });

    // Выбор человека восстановлен — 90 дней, а не умолчание 30.
    await waitFor(() =>
      expect(
        screen
          .getByText('deviceFirst.periodMonths:3')
          .closest('button')
          ?.getAttribute('aria-checked'),
      ).toBe('true'),
    );
    // 🔴 Подтверждение НЕ открывается само: эффект синхронизации выходит первой строкой
    // при открытом подтверждении, и посев не применился бы никогда — человек увидел бы
    // «Недоступно» сразу после успешной доплаты. Он возвращается на экран выбора,
    // видит СВЕЖУЮ цену и подтверждает сам.
    expect(screen.getByRole('button', { name: 'deviceFirst.review' })).toBeTruthy();
    // Заряд из адреса снят: иначе `?period=&devices=` пережил бы перезагрузку и тихо
    // возвращал старый выбор поверх нового.
    await waitFor(() =>
      expect(screen.getByTestId('location').textContent).toBe('/subscription/purchase'),
    );
  });

  // 🔴 Витрина экранов рисует ЖИВОЙ компонент на выдуманных опциях без баланса, поэтому недостача
  // там равна полной цене и кнопка «Пополнить» появлялась бы на странице, чей заголовок обещает,
  // что платежи не используются, — и уводила бы в настоящую воронку пополнения.
  // Мутационный прогон показал, что заслонка `fixtureCheckout === undefined` не была прикрыта
  // ничем: её снятие переживало весь набор.
  it('never shows the money top-up button on the fixture showcase', async () => {
    renderConfigurator({
      options: { ...options, balance_kopeks: 0 },
      fixtureCheckout: { ...checkout('confirmation'), settlement_mode: 'direct_purchase_v2' },
    });

    await waitFor(() =>
      expect(screen.queryByRole('button', { name: /deviceFirst.topUpAmount/ })).toBeNull(),
    );
    expect(screen.queryByRole('button', { name: 'deviceFirst.needTopup' })).toBeNull();
  });

  // 🔴 Сторож против воскрешения мины X. Он написан ПОСЛЕ того, как мутация убила первую версию:
  // та сеяла вариант, который в новых опциях продаётся, и тогда посев в состояние и посев в ref
  // дают одно и то же — сторож был пустым.
  // Настоящее отличие вот в чём: ref пускает выбор ТОЛЬКО если у комбинации есть ЦЕНА
  // (priceFor), а нормализация ниже проверяет списки сроков и устройств ПО ОТДЕЛЬНОСТИ.
  // Значит комбинация, где оба значения в списках, а цены у пары нет, их и разводит:
  //   · через ref — выбор не применяется, человек остаётся на рабочем умолчании;
  //   · прямым посевом в состояние — нормализация обе проверки пропускает, состояние остаётся
  //     непродаваемым, и ВСЕ сроки рисуются «Недоступно» с мёртвой кнопкой. Это и есть мина X.
  it('never seeds a selection that has no price — that is how mine X came back', async () => {
    const unpricedPair: DeviceFirstOptions = {
      ...options,
      period_options: [30, 90],
      default_period_days: 30,
      device_options: [2, 5],
      // 90 дней продаются, 5 устройств продаются — но ПАРЫ 90×5 в матрице нет.
      price_matrix: [
        options.price_matrix![0],
        {
          period_days: 90,
          prices: [
            {
              device_limit: 2,
              price_kopeks: 120000,
              breakdown: {
                base_price_kopeks: 120000,
                devices_price_kopeks: 0,
                promo_group_discount_kopeks: 0,
                promo_offer_discount_kopeks: 0,
              },
            },
          ],
        },
      ],
    };

    renderConfigurator({
      options: unpricedPair,
      initialPath: '/subscription/purchase?from=checkout&period=90&devices=5',
    });

    // Экран остался рабочим: держится продающееся умолчание (30 дней), а не мёртвая пара.
    await waitFor(() =>
      expect(
        screen
          .getByText('deviceFirst.periodMonths:1')
          .closest('button')
          ?.getAttribute('aria-checked'),
      ).toBe('true'),
    );
    // И кнопка оформления жива — то есть цена нашлась.
    expect(screen.getByRole('button', { name: 'deviceFirst.review' })).toBeTruthy();
  });

  // 🔴 Без метки кассы посев не срабатывает: те же параметры приходят из бот-диплинка,
  // и там ими распоряжается автостарт, а не мы.
  it('ignores period/devices in the address when the checkout marker is absent', async () => {
    renderConfigurator({
      options: { ...options, period_options: [30], device_options: [2] },
      initialPath: '/subscription/purchase?period=90&devices=5',
    });

    // Адрес не тронут — чистильщик посева не звался.
    expect(screen.getByTestId('location').textContent).toBe(
      '/subscription/purchase?period=90&devices=5',
    );
  });
});
