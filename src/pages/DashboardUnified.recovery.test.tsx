// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router';
import { PlatformProvider } from '../platform';
import DashboardUnified from './DashboardUnified';
import type { DeviceFirstCheckout } from '@/api/deviceFirst';

/**
 * 🔴 Пункт 4.11б. Владелец поймал живой проверкой: он отменил заказ, а на Главной карточка
 * «Незавершённый заказ» осталась висеть и вела на уже отменённый заказ.
 *
 * Суть бага — в ПОСЛЕДОВАТЕЛЬНОСТИ, а не в одном ответе: сначала сервер отдал заказ, потом
 * стал отвечать ошибкой 404 «такого нет», а react-query на ошибке сохраняет последний
 * удачный ответ. Поэтому тесты ниже обязательно проходят два шага и переиспользуют один и
 * тот же кэш между размонтированиями — на свежем кэше баг не воспроизводится вовсе, и
 * первая версия этого файла его не ловила: мутация «вернуть всё как было» её пережила.
 *
 * Этим же ответом на Главной питаются ТРИ вещи: карточка, главная кнопка продажи (`onSell`)
 * и гашение блока покупки. Лечим в одной точке чтения — сторожим все три.
 */

const expiredSubscription = {
  id: 42,
  status: 'expired',
  // 🔴 Именно `is_expired` включает экран P8, где есть кнопка продажи. Без неё экран P1,
  // кнопки продажи нет физически, и сторож на «угнанную кнопку» пуст — проверено.
  is_expired: true,
  is_trial: false,
  device_limit: 4,
  traffic_limit_gb: 0,
  traffic_used_gb: 0,
  end_date: '2026-08-01T12:00:00Z',
  autopay_enabled: false,
  in_grace: false,
  restriction_subscription: false,
  can_topup_devices: false,
  can_topup_traffic: false,
  connected_squads: ['de'],
  subscription_url: 'https://example.invalid/sub',
  links: [],
  happ: null,
  grace_until: null,
  disabled_reason_hint: null,
};

const liveCheckout: DeviceFirstCheckout = {
  id: 'checkout-owned',
  tariff_id: 7,
  target_subscription_id: null,
  period_days: 30,
  selected_device_limit: 5,
  price_breakdown: {
    base_price_kopeks: 42900,
    devices_price_kopeks: 0,
    promo_group_discount_kopeks: 0,
    promo_offer_discount_kopeks: 0,
  },
  quoted_price_kopeks: 42900,
  max_price_kopeks: 42900,
  settlement_mode: 'direct_purchase_v2',
  tariff_total_kopeks: 42900,
  wallet_applied_kopeks: 0,
  external_payable_kopeks: 42900,
  funding_mode: 'platega',
  lifecycle_state: 'awaiting_funds',
  funding_state: 'invoice_pending',
  provisioning_state: 'not_started',
  terminal_reason: null,
  ui_state: 'awaiting_payment',
  created_subscription_id: null,
  current_device_limit: 4,
  current_subscription_is_trial: false,
  estimated_end_at: '2026-10-15T12:00:00Z',
  expires_at: '2026-08-18T21:15:00Z',
  balance_kopeks: 13100,
  shortage_kopeks: 29800,
  top_up_surplus_kopeks: 0,
};

// Канонический отказ ровно в той форме, в какой его шлёт боевой сервер
// (`bot-code/app/cabinet/routes/device_first.py:397`) — без поля `message`.
const noOpenCheckout404 = {
  response: { status: 404, data: { detail: { code: 'no_open_checkout' } } },
};
// Обрыв связи: ответа нет вовсе. Карточка обязана это ПЕРЕЖИТЬ — она единственный вход
// к живому заказу с Главной, и прятать его из-за моргнувшей сети нельзя.
const networkError = new Error('Network Error');

const navigate = vi.fn();
let getOpen: () => Promise<DeviceFirstCheckout> = () => Promise.resolve(liveCheckout);
// 🔴 Считаем обращения к серверу: без этого проверки после возврата на Главную срабатывают
// РАНЬШЕ, чем перезапрос успел ответить, и сторож становится пустым — проверено мутацией.
let getOpenCalls = 0;

// 🔴 Библиотеку запросов НЕ мокаем: иначе новый `queryFn` в тесте не исполняется, и мутация
// «вернуть всё как было» переживает набор. Мокаем только слой API.
vi.mock('../api/deviceFirst', () => ({
  deviceFirstApi: {
    getOpen: () => {
      getOpenCalls += 1;
      return getOpen();
    },
  },
}));
let subscriptionOf: unknown = expiredSubscription;
vi.mock('../api/subscription', () => ({
  subscriptionApi: {
    getSubscription: () =>
      // `has_subscription` — то, по чему страница решает «подписки нет» и показывать ли
      // блок покупки (`DashboardUnified.tsx:337-339`).
      Promise.resolve({ subscription: subscriptionOf, has_subscription: subscriptionOf !== null }),
    getSubscriptions: () => Promise.resolve({ subscriptions: [] }),
    getTrialInfo: () => Promise.resolve({ is_available: false }),
    getDevices: () => Promise.resolve({ devices: [] }),
    getPurchaseOptions: () => Promise.resolve({ multi_tariff_enabled: false }),
  },
}));
vi.mock('../api/balance', () => ({
  balanceApi: { getBalance: () => Promise.resolve({ balance_kopeks: 13100 }) },
}));
vi.mock('react-router', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router')>();
  return { ...actual, useNavigate: () => navigate };
});
vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-i18next')>();
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, fallbackOrOptions?: unknown) =>
        typeof fallbackOrOptions === 'string' ? fallbackOrOptions : key,
      i18n: { language: 'ru' },
    }),
  };
});
vi.mock('../hooks/useTheme', () => ({ useTheme: () => ({ isDark: true }) }));
vi.mock('@/hooks/useTheme', () => ({ useTheme: () => ({ isDark: true }) }));
vi.mock('../hooks/useCurrency', () => ({
  useCurrency: () => ({ formatAmount: (v: number) => v.toFixed(2), currencySymbol: '₽' }),
}));
vi.mock('../hooks/useTrafficRefresh', () => ({ useTrafficRefresh: () => ({}) }));
vi.mock('../hooks/usePullToRefresh', () => ({
  usePullToRefresh: () => ({ pullDistance: 0, isRefreshing: false }),
}));
vi.mock('../store/auth', () => ({
  useAuthStore: (selector: (state: unknown) => unknown) =>
    selector({
      user: { telegram_id: 1, first_name: 'krotop', username: 'krotop' },
      refreshUser: vi.fn(),
    }),
}));
vi.mock('../store/successNotification', () => ({
  useSuccessNotification: (selector: (state: unknown) => unknown) => selector({ isOpen: false }),
}));

function renderHome(queryClient: QueryClient) {
  return render(
    <PlatformProvider>
      <QueryClientProvider client={queryClient}>
        <MemoryRouter initialEntries={['/']}>
          <DashboardUnified />
        </MemoryRouter>
      </QueryClientProvider>
    </PlatformProvider>,
  );
}

/**
 * Человек ушёл с Главной и вернулся: кэш тот же, компонент новый.
 * Ждём именно ОТВЕТА нового запроса, а не просто отрисовки: иначе проверка успевает
 * пройти по старым данным и ничего не доказывает.
 */
async function goAwayAndComeBack(queryClient: QueryClient) {
  const before = getOpenCalls;
  cleanup();
  renderHome(queryClient);
  await waitFor(() => expect(getOpenCalls).toBeGreaterThan(before));
  await waitFor(() => expect(screen.getByText('dashboard.welcome')).toBeTruthy());
  // Даём ответу дойти до состояния запроса.
  await waitFor(() => expect(queryClient.isFetching()).toBe(0));
}

describe('Главная: карточка незавершённого заказа', () => {
  afterEach(() => {
    cleanup();
    navigate.mockClear();
    getOpen = () => Promise.resolve(liveCheckout);
    getOpenCalls = 0;
    subscriptionOf = expiredSubscription;
  });

  it('убирает заказ, когда сервер начал отвечать, что открытого заказа нет', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    renderHome(queryClient);
    // Шаг 1: заказ есть, карточка на месте.
    expect(await screen.findByText('Незавершённый заказ')).toBeTruthy();

    // Шаг 2: человек отменил заказ — сервер отвечает каноническим «такого нет».
    getOpen = () => Promise.reject(noOpenCheckout404);
    await goAwayAndComeBack(queryClient);

    // Карточки нет — это то, чего добивался владелец.
    await waitFor(() => expect(screen.queryByText('Незавершённый заказ')).toBeNull());

    // 🔴 И главная кнопка продажи больше не угнана. Она питается тем же ответом и молча
    // уводила в мёртвый заказ — на экране этого не видно, поэтому проверяем адрес перехода.
    // Жмём именно ЕЁ, а не «все кнопки подряд»: в цикл попадала сама карточка, и сторож
    // оказывался переодетым дублем проверки выше.
    const sell = screen.getByRole('button', { name: 'home.hero.renew' });
    fireEvent.click(sell);
    expect(navigate).toHaveBeenCalled();
    for (const [target] of navigate.mock.calls) {
      expect(String(target)).not.toContain('checkout=');
    }
  });

  it('НЕ убирает заказ, когда связь оборвалась', async () => {
    // 🔴 Обратная сторона и главный риск починки: карточка — единственный вход к живому
    // заказу с Главной. Спрятать его из-за 5xx или пропавшей сети значит потерять деньги
    // клиента там, где раньше терялся только вид.
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    renderHome(queryClient);
    expect(await screen.findByText('Незавершённый заказ')).toBeTruthy();

    getOpen = () => Promise.reject(networkError);
    await goAwayAndComeBack(queryClient);

    expect(screen.getByText('Незавершённый заказ')).toBeTruthy();
  });

  it('НЕ прячет заказ, по которому деньги уже в полёте', async () => {
    // 🔴 Прежняя фикстура была только `awaiting_payment`, поэтому проверка «карточки нет»
    // доказывала лишь отсутствие ОДНОГО вида карточки: у заказа на разборе она рисуется
    // другим текстом. А это тот самый сегмент, где деньги уже ушли, и потерять вход к нему
    // дороже всего — сценарий этапа 4.4.
    const underReview = {
      ...liveCheckout,
      lifecycle_state: 'operator_review',
      ui_state: 'operator_review' as DeviceFirstCheckout['ui_state'],
      money_state: 'unknown' as const,
    };
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    getOpen = () => Promise.resolve(underReview);
    renderHome(queryClient);
    expect(await screen.findByText('deviceFirst.reviewUnknownTitle')).toBeTruthy();

    getOpen = () => Promise.reject(networkError);
    await goAwayAndComeBack(queryClient);
    expect(screen.getByText('deviceFirst.reviewUnknownTitle')).toBeTruthy();
  });

  it('возвращает человеку возможность купить, когда застрявший заказ закрылся', async () => {
    // 🔴 Третий потребитель того же ответа. Пока заказ считался «деньги в полёте», у
    // человека БЕЗ подписки гас весь блок покупки и триала — и после закрытия заказа
    // оператором он не мог купить ничем. Проверяем, что блок возвращается.
    subscriptionOf = null;
    const underReview = {
      ...liveCheckout,
      lifecycle_state: 'operator_review',
      ui_state: 'operator_review' as DeviceFirstCheckout['ui_state'],
      money_state: 'unknown' as const,
    };
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    getOpen = () => Promise.resolve(underReview);
    renderHome(queryClient);
    await screen.findByText('deviceFirst.reviewUnknownTitle');
    // 🔴 Ждём, пока страница успокоится. Без этого проверка «блока нет» проходит просто
    // потому, что данные ещё грузятся, и мутация «убрать гашение блока» её переживает —
    // проверено, ровно так и вышло.
    await waitFor(() => expect(queryClient.isFetching()).toBe(0));
    // Пока заказ считается «деньги в полёте» — пути купить на Главной нет вовсе.
    const browsePlans = 'Посмотреть тарифы и купить подписку';
    expect(screen.queryByText(browsePlans)).toBeNull();

    getOpen = () => Promise.reject(noOpenCheckout404);
    await goAwayAndComeBack(queryClient);

    await waitFor(() => expect(screen.getByText(browsePlans)).toBeTruthy());
  });

  it('ведёт к заказу, пока сервер подтверждает, что он есть', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    renderHome(queryClient);

    fireEvent.click(await screen.findByText('Незавершённый заказ'));
    expect(navigate).toHaveBeenCalledWith('/subscription/purchase?checkout=checkout-owned');
  });
});
