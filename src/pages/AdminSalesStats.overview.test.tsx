// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createInstance } from 'i18next';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { SalesAds, SalesOverview, SalesPeople } from '../api/adminSalesStats';
import ru from '../locales/ru.json';
import { usePermissionStore } from '../store/permissions';
import AdminSalesStats from './AdminSalesStats';

const api = vi.hoisted(() => ({
  getOverview: vi.fn(),
  getPeople: vi.fn(),
  getAds: vi.fn(),
  getPaymentHealth: vi.fn(),
}));

vi.mock('../api/adminSalesStats', () => ({ salesStatsApi: api }));
vi.mock('../hooks/useCurrency', () => ({
  useCurrency: () => ({ formatWithCurrency: (value: number) => `${value} $` }),
}));
vi.mock('../components/admin/AdminBackButton', () => ({ AdminBackButton: () => null }));

/** Выдуманный месяц в форме настоящего ответа бота (время с микросекундами). Репозиторий кабинета публичный:
 * настоящих людей, кампаний и денег здесь быть не должно (ревью C5-1, C5-7). */
const overview: SalesOverview = {
  generated_at: '2026-09-27T08:52:45.537536Z',
  window: {
    start: '2026-08-31T21:00:00Z',
    end: '2026-09-27T08:52:45.537536Z',
    previous_start: '2026-07-31T21:00:00Z',
    previous_end: '2026-08-27T08:52:45.537536Z',
  },
  now: { paying: 57, on_trial: 23, ending_soon: 3 },
  money: {
    received_kopeks: 1000000,
    deposits_count: 30,
    receipts_count: 10,
    previous_received_kopeks: 800000,
    previous_comparable: true,
  },
  purchases: {
    count: 30,
    amount_kopeks: 1200000,
    first_count: 20,
    first_amount_kopeks: 700000,
    first_after_trial: 15,
    first_direct: 5,
    renewal_count: 10,
    renewal_amount_kopeks: 500000,
    addon_count: 8,
    addon_amount_kopeks: 40000,
    previous_first_count: 12,
    not_renewed: 3,
  },
  trial: { came: 300, took_trial: 120, trial_finished: 100, bought_after_trial: 15 },
};

const people: SalesPeople = {
  kind: 'not_renewed',
  total: 3,
  items: [
    {
      user_id: 9001,
      name: 'Иван Тестов',
      username: null,
      telegram_id: 100000001,
      tariff_name: 'Базовый',
      end_date: '2026-09-27T03:21:00.123456Z',
      autopay_enabled: false,
      balance_kopeks: 5000,
    },
    {
      user_id: 9002,
      name: '.',
      username: 'test_user',
      telegram_id: 100000002,
      tariff_name: 'Базовый',
      end_date: '2026-09-26T22:02:00Z',
      autopay_enabled: true,
      balance_kopeks: 25000,
    },
    {
      user_id: 9003,
      name: null,
      username: null,
      telegram_id: 100000003,
      tariff_name: null,
      end_date: '2026-09-25T10:00:00Z',
      autopay_enabled: null,
      balance_kopeks: 0,
    },
  ],
};

const ads: SalesAds = {
  campaigns_total: 10,
  campaigns_with_spend: 5,
  mature_spend_kopeks: 2000000,
  mature_buyers: 20,
  mature_cost_per_buyer_kopeks: 100000,
  mature_receipts_kopeks: 600000,
  fresh_spend_kopeks: 1000000,
  fresh_buyers: 1,
  campaigns: [
    {
      campaign_id: 1,
      name: 'Канал А',
      ad_spend_kopeks: 800000,
      buyers: 10,
      cost_per_buyer_kopeks: 80000,
      receipts_kopeks: 300000,
      fresh: false,
    },
    {
      campaign_id: 2,
      name: 'Канал Б',
      ad_spend_kopeks: 1000000,
      buyers: 1,
      cost_per_buyer_kopeks: 1000000,
      receipts_kopeks: 100000,
      fresh: true,
    },
  ],
};

function LocationProbe() {
  const location = useLocation();
  return (
    <>
      <div data-testid="path">{location.pathname}</div>
      <div data-testid="search">{location.search}</div>
    </>
  );
}

const lastSearch = () => screen.getByTestId('search').textContent;

async function renderPage(url = '/admin/sales-stats') {
  const i18n = createInstance();
  await i18n.use(initReactI18next).init({ lng: 'ru', resources: { ru: { translation: ru } } });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={[url]}>
          <Routes>
            <Route
              path="/admin/sales-stats"
              element={
                <>
                  <AdminSalesStats />
                  <LocationProbe />
                </>
              }
            />
            <Route path="*" element={<LocationProbe />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </I18nextProvider>,
  );
}

beforeEach(() => {
  api.getOverview.mockResolvedValue(overview);
  api.getPeople.mockResolvedValue(people);
  api.getAds.mockResolvedValue(ads);
  api.getPaymentHealth.mockResolvedValue({
    total_attempts: 60,
    total_paid: 40,
    success_rate: 66.7,
    failed_purchases: 0,
    by_gateway: [],
  });
  usePermissionStore.setState({
    permissions: ['sales_stats:read', 'users:read', 'campaigns:stats', 'campaigns:read'],
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('AdminSalesStats — экран продаж по правилам владельца (СП-1)', () => {
  it('shows the owner the month in his words', async () => {
    await renderPage();

    expect(await screen.findByText('10 000 ₽')).toBeTruthy();
    expect(screen.getByText('пополнений 30 · оплат сразу 10 · как в выписке Platega')).toBeTruthy();
    // сравнение — с теми же числами прошлого месяца до того же часа, процент честен (деньги были и раньше)
    expect(screen.getByText(/1–27 августа до 11:52: 8 000 ₽/)).toBeTruthy();
    expect(screen.getByText('↑ 25 %')).toBeTruthy();
    expect(screen.getByText('Купили 30 на 12 000 ₽')).toBeTruthy();
    expect(
      screen.getByText('впервые 20 (после пробного 15 · сразу без пробного 5) · продления 10'),
    ).toBeTruthy();
    expect(screen.getByText('Докупили устройств и трафика: 8 на 400 ₽')).toBeTruthy();
    expect(screen.getByText('1–27 сентября · по Москве · данные на 11:52')).toBeTruthy();
    expect(screen.getByText('120 · 40 %')).toBeTruthy();
    expect(screen.getByText('15 из 100, у кого пробный уже закончился · 15 %')).toBeTruthy();
    expect(screen.getByText('платили деньгами; Team и тестовые не считаются')).toBeTruthy();
    expect(screen.getByText('57')).toBeTruthy();
    expect(screen.getByText('23')).toBeTruthy();
    expect(screen.getByText('Оплаты · за выбранный период')).toBeTruthy();
    expect(api.getOverview).toHaveBeenCalledWith({ period: 'this_month' });
  });

  it('opens the list under «Не продлили» and leads to the client card', async () => {
    await renderPage();

    fireEvent.click(await screen.findByRole('button', { name: /Не продлили/ }));

    expect(await screen.findByText('Иван Тестов')).toBeTruthy();
    expect(api.getPeople).toHaveBeenCalledWith('not_renewed', { period: 'this_month' });
    expect(
      screen.getByText(
        'закончилась 27.09, 06:21 · Базовый · автоплатёж выключен · на балансе 50 ₽',
      ),
    ).toBeTruthy();
    expect(screen.getByText('ID 100000001')).toBeTruthy();
    expect(screen.getByText('@test_user')).toBeTruthy(); // имя «.» — не имя: ник вместо него
    expect(screen.queryByText('.')).toBeNull();
    // ни имени, ни ника — заголовком ID, и второй строкой он не повторяется
    expect(screen.getAllByText('ID 100000003')).toHaveLength(1);
    expect(lastSearch()).toContain('open=not_renewed'); // «Назад» из карточки вернёт открытый список

    fireEvent.click(screen.getByText('Иван Тестов'));
    await waitFor(() => expect(screen.getByTestId('path').textContent).toBe('/admin/users/9001'));
  });

  it('shows dashes instead of zeros when the server fails, and retries on request', async () => {
    api.getOverview.mockRejectedValueOnce(new Error('500'));
    await renderPage();

    expect(await screen.findByText('Не удалось загрузить статистику')).toBeTruthy();
    const money = screen.getByText('Пришло живых денег').parentElement as HTMLElement;
    expect(within(money).getByText('—')).toBeTruthy();
    expect(screen.queryByText('0 ₽')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }));
    expect(await screen.findByText('10 000 ₽')).toBeTruthy();
    expect(screen.queryByText('Не удалось загрузить статистику')).toBeNull();
  });

  it('shows «…» while loading, not the dash of a failure', async () => {
    api.getOverview.mockReturnValue(new Promise(() => {}));
    await renderPage();

    const money = (await screen.findByText('Пришло живых денег')).parentElement as HTMLElement;
    expect(within(money).getByText('…')).toBeTruthy();
    expect(screen.queryByText('—')).toBeNull();
  });

  it('hides people and ads from a role that may not see them', async () => {
    usePermissionStore.setState({ permissions: ['sales_stats:read'] });
    await renderPage();

    await screen.findByText('10 000 ₽');
    expect(screen.queryByRole('button', { name: /Не продлили/ })).toBeNull();
    expect(screen.queryByText('Реклама · за всё время')).toBeNull();
    expect(api.getAds).not.toHaveBeenCalled();
    expect(api.getPeople).not.toHaveBeenCalled();
  });

  it('shows ads by campaign with the fresh ones apart', async () => {
    await renderPage();

    expect(await screen.findByText('кампаний с указанным расходом: 5 из 10')).toBeTruthy();
    expect(
      screen.getByText('расход 20 000 ₽ · покупателей: 20 · покупатель ≈ 1 000 ₽'),
    ).toBeTruthy();
    expect(screen.getByText('Моложе 7 дней — ещё рано судить')).toBeTruthy();
    // у свежей кампании «покупатель ≈» не показываем — рано судить
    const fresh = screen.getByText('Канал Б').parentElement as HTMLElement;
    expect(fresh.textContent).not.toContain('покупатель ≈');
    expect(screen.getByRole('button', { name: /Кампании/ })).toBeTruthy();
  });

  it('asks to fill the ad spend instead of zeros and hides «Кампании» without the right to open them', async () => {
    api.getAds.mockResolvedValue({
      ...ads,
      campaigns_with_spend: 0,
      mature_spend_kopeks: 0,
      mature_buyers: 0,
      mature_cost_per_buyer_kopeks: null,
      mature_receipts_kopeks: 0,
      fresh_spend_kopeks: 0,
      fresh_buyers: 0,
      campaigns: [],
    });
    usePermissionStore.setState({
      permissions: ['sales_stats:read', 'users:read', 'campaigns:stats'],
    });
    await renderPage();

    expect(
      await screen.findByText(
        'Впишите «Расход на рекламу» у кампаний — тогда здесь появится цена покупателя',
      ),
    ).toBeTruthy();
    expect(screen.queryByText('Старше 7 дней')).toBeNull();
    expect(screen.queryByRole('button', { name: /Кампании/ })).toBeNull();
  });

  it('sends the period NAME, not phone-clock dates, and keeps it in the address', async () => {
    await renderPage();
    await screen.findByText('10 000 ₽');

    fireEvent.click(screen.getByRole('button', { name: 'Вчера' }));

    await waitFor(() => expect(api.getOverview).toHaveBeenLastCalledWith({ period: 'yesterday' }));
    expect(lastSearch()).toBe('?period=yesterday');
  });

  it('does not keep the old window label over the numbers of a period still loading', async () => {
    await renderPage();
    await screen.findByText('1–27 сентября · по Москве · данные на 11:52');
    api.getOverview.mockReturnValue(new Promise(() => {}));

    fireEvent.click(screen.getByRole('button', { name: 'Вчера' }));

    await waitFor(() => expect(api.getOverview).toHaveBeenLastCalledWith({ period: 'yesterday' }));
    expect(screen.queryByText('1–27 сентября · по Москве · данные на 11:52')).toBeNull();
  });

  it('labels «Всё время» without a made-up start date', async () => {
    api.getOverview.mockResolvedValue({
      ...overview,
      window: {
        ...overview.window,
        start: '2019-12-31T21:00:00Z',
        previous_start: null,
        previous_end: null,
      },
    });
    await renderPage('/admin/sales-stats?period=all');

    expect(await screen.findByText('за всё время · по Москве · данные на 11:52')).toBeTruthy();
    expect(screen.queryByText(/1 января/)).toBeNull();
  });

  it('on «Свой период» without dates asks for them instead of showing the numbers of the previous button', async () => {
    await renderPage();
    await screen.findByText('10 000 ₽');

    fireEvent.click(screen.getByRole('button', { name: 'Свой период' }));

    expect(await screen.findByText('Выберите начало и конец периода')).toBeTruthy();
    expect(screen.queryByText('10 000 ₽')).toBeNull();
    expect(screen.queryByText('Купили 30 на 12 000 ₽')).toBeNull();
    expect(screen.queryByRole('button', { name: /Не продлили/ })).toBeNull();
    expect(screen.getByText('57')).toBeTruthy(); // «Сейчас» от периода не зависит
    expect(api.getOverview).toHaveBeenCalledTimes(1);
  });

  it('keeps «Кончится» working on «Свой период» without dates — the list does not need a period', async () => {
    await renderPage('/admin/sales-stats?period=custom&open=ending_soon');

    expect(await screen.findByText('Выберите начало и конец периода')).toBeTruthy();
    await waitFor(() => expect(api.getPeople).toHaveBeenCalledWith('ending_soon', undefined));
    expect(await screen.findByText('Иван Тестов')).toBeTruthy();
    expect(api.getOverview).not.toHaveBeenCalled();
  });

  it('refresh reloads everything on the screen, the open list and payments included', async () => {
    await renderPage('/admin/sales-stats?open=not_renewed');
    await screen.findByText('Иван Тестов');
    await waitFor(() => expect(api.getPaymentHealth).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole('button', { name: 'Обновить' }));

    await waitFor(() => {
      expect(api.getOverview).toHaveBeenCalledTimes(2);
      expect(api.getAds).toHaveBeenCalledTimes(2);
      expect(api.getPeople).toHaveBeenCalledTimes(2);
      expect(api.getPaymentHealth).toHaveBeenCalledTimes(2);
    });
  });

  it('does not invent a percent or a conversion that is not there yet', async () => {
    api.getOverview.mockResolvedValue({
      ...overview,
      money: { ...overview.money, previous_received_kopeks: 0, previous_comparable: false },
      trial: { came: 40, took_trial: 18, trial_finished: 0, bought_after_trial: 0 },
    });
    await renderPage('/admin/sales-stats?period=yesterday');

    expect(await screen.findByText('пробные этих дней ещё идут')).toBeTruthy();
    expect(screen.queryByText(/↑|↓/)).toBeNull();
    expect(api.getOverview).toHaveBeenCalledWith({ period: 'yesterday' });
  });

  it('shows the percent of «Вчера» on everyday small sums, but not for a few hours of the 1st', async () => {
    api.getOverview.mockResolvedValue({
      ...overview,
      window: {
        start: '2026-09-25T21:00:00Z',
        end: '2026-09-26T21:00:00Z',
        previous_start: '2026-09-24T21:00:00Z',
        previous_end: '2026-09-25T21:00:00Z',
      },
      money: { ...overview.money, received_kopeks: 90000, previous_received_kopeks: 60000 },
    });
    await renderPage('/admin/sales-stats?period=yesterday');
    expect(await screen.findByText('↑ 50 %')).toBeTruthy();
    cleanup();

    api.getOverview.mockResolvedValue({
      ...overview,
      generated_at: '2026-10-01T07:00:00Z',
      window: {
        start: '2026-09-30T21:00:00Z',
        end: '2026-10-01T07:00:00Z',
        previous_start: '2026-08-31T21:00:00Z',
        previous_end: '2026-09-01T07:00:00Z',
      },
      money: { ...overview.money, received_kopeks: 80000, previous_received_kopeks: 10000 },
    });
    await renderPage();
    expect(await screen.findByText(/1 сентября до 10:00: 100 ₽/)).toBeTruthy();
    expect(screen.queryByText(/↑|↓/)).toBeNull();
  });

  it('says nobody took the trial rather than «still running»', async () => {
    api.getOverview.mockResolvedValue({
      ...overview,
      trial: { came: 3, took_trial: 0, trial_finished: 0, bought_after_trial: 0 },
    });
    await renderPage('/admin/sales-stats?period=yesterday');

    expect(await screen.findByText('пробный никто не брал')).toBeTruthy();
    expect(screen.queryByText('пробные этих дней ещё идут')).toBeNull();
  });

  it('hides the conversion percent on a small base', async () => {
    api.getOverview.mockResolvedValue({
      ...overview,
      trial: { came: 120, took_trial: 50, trial_finished: 19, bought_after_trial: 1 },
    });
    await renderPage('/admin/sales-stats?period=7d');

    expect(await screen.findByText('1 из 19, у кого пробный уже закончился')).toBeTruthy();
  });
});
