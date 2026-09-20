// @vitest-environment jsdom

import type { ReactNode } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CampaignAnalyticsV2 } from '../../api/campaigns';
import ru from '../../locales/ru.json';

import { CampaignAnalyticsV2Panel } from './CampaignAnalyticsV2Panel';

vi.mock('../../hooks/useCurrency', () => ({
  useCurrency: () => ({ formatWithCurrency: (value: number) => `${value.toFixed(2)} ₽` }),
}));

vi.mock('recharts', () => {
  const Container = ({ children }: { children?: ReactNode }) => <div>{children}</div>;
  const Element = () => <div />;
  return {
    ResponsiveContainer: Container,
    BarChart: Container,
    LineChart: Container,
    CartesianGrid: Element,
    Legend: Element,
    Tooltip: Element,
    XAxis: Element,
    YAxis: Element,
    Bar: Element,
    Cell: Element,
    Line: Element,
  };
});

const analytics: CampaignAnalyticsV2 = {
  campaign_id: 13,
  generated_at: '2026-09-19T19:00:00Z',
  timezone: 'Europe/Moscow',
  leads: 133,
  historical_trial_users_count: 38,
  active_trials_count: 35,
  lead_to_trial_rate: 28.6,
  paid_subscription_users_count: 5,
  lead_to_paid_subscription_rate: 3.8,
  paid_after_trial_count: 3,
  paid_without_trial_count: 2,
  trial_to_paid_rate: 7.9,
  confirmed_receipts_kopeks: 144_600,
  ad_spend_kopeks: 800_000,
  cost_per_lead_kopeks: 6_015,
  cost_per_trial_kopeks: 21_053,
  customer_acquisition_cost_kopeks: 160_000,
  gross_roas_percent: 18.1,
  receipts_minus_ad_spend_kopeks: -655_400,
  maturity_horizon_days: 7,
  immature_leads_count: 43,
  last_lead_at: '2026-09-19T18:15:00Z',
  last_trial_at: '2026-09-19T18:13:00Z',
  last_paid_subscription_at: '2026-09-19T16:00:00Z',
  data_quality: {
    status: 'partial',
  },
  daily_cohorts: [
    {
      date: '2026-09-19',
      leads: 43,
      trial_users: 38,
      paid_subscription_users: 5,
      mature_7d: false,
    },
  ],
  delay_curve: [
    { hours: 24, eligible_leads: 90, converted_leads: 4, conversion_rate: 4.4 },
    { hours: 168, eligible_leads: 60, converted_leads: 5, conversion_rate: 8.3 },
  ],
  cumulative_receipts: [
    {
      date: '2026-09-19',
      confirmed_receipts_kopeks: 144_600,
      ad_spend_kopeks: 800_000,
    },
  ],
};

async function renderPanel(data: CampaignAnalyticsV2 = analytics) {
  const i18n = createInstance();
  await i18n.init({
    lng: 'ru',
    fallbackLng: 'ru',
    resources: { ru: { translation: ru } },
    interpolation: { escapeValue: false },
  });
  return render(
    <I18nextProvider i18n={i18n}>
      <MemoryRouter>
        <CampaignAnalyticsV2Panel analytics={data} />
      </MemoryRouter>
    </I18nextProvider>,
  );
}

describe('CampaignAnalyticsV2Panel', () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('shows the historical funnel, both paid paths, receipts, and preliminary warning', async () => {
    await renderPanel();

    expect(screen.getByText('Путь клиента')).toBeTruthy();
    expect(screen.getByText('38 из 133 лидов · 28,6%')).toBeTruthy();
    expect(
      screen.getByText('5 из 133 лидов · 3,8% · после триала: 3 (7,9% от триалов), сразу: 2'),
    ).toBeTruthy();
    expect(screen.getAllByText('1446.00 ₽').length).toBeGreaterThan(0);
    expect(screen.getByText(/35 триалов ещё активны/)).toBeTruthy();
    expect(screen.getByText(/Часть старых операций/)).toBeTruthy();
    expect(screen.getByText('18,1%')).toBeTruthy();
    expect(screen.getByText('6554.00 ₽')).toBeTruthy();
  });

  it('does not render the retired wallet metrics', async () => {
    await renderPanel();

    expect(screen.queryByText('Бонусы выданы')).toBeNull();
    expect(screen.queryByText('Средний первый платёж')).toBeNull();
    expect(screen.queryByText('Расход на подписки')).toBeNull();
  });

  it('keeps unknown spend distinct from an explicit zero', async () => {
    await renderPanel({
      ...analytics,
      ad_spend_kopeks: null,
      cost_per_lead_kopeks: null,
      cost_per_trial_kopeks: null,
      customer_acquisition_cost_kopeks: null,
      gross_roas_percent: null,
      receipts_minus_ad_spend_kopeks: null,
      cumulative_receipts: analytics.cumulative_receipts.map((point) => ({
        ...point,
        ad_spend_kopeks: null,
      })),
    });

    expect(screen.getByText('Не указан')).toBeTruthy();
    expect(screen.queryByText('0.00 ₽')).toBeNull();
    expect(screen.queryByText('0 ₽')).toBeNull();
    const addSpendLinks = screen.getAllByRole('link', { name: 'Указать расход' });
    expect(addSpendLinks).toHaveLength(1);
    expect(addSpendLinks[0].getAttribute('href')).toBe('/admin/campaigns/13/edit');

    cleanup();
    await renderPanel({
      ...analytics,
      ad_spend_kopeks: 0,
      cost_per_lead_kopeks: 0,
      cost_per_trial_kopeks: 0,
      customer_acquisition_cost_kopeks: 0,
      gross_roas_percent: null,
      receipts_minus_ad_spend_kopeks: analytics.confirmed_receipts_kopeks,
      cumulative_receipts: analytics.cumulative_receipts.map((point) => ({
        ...point,
        ad_spend_kopeks: 0,
      })),
    });

    expect(screen.queryByText('Не указан')).toBeNull();
    expect(screen.getAllByText('0.00 ₽').length).toBeGreaterThan(0);
    expect(screen.getByRole('link', { name: 'Изменить расход' })).toBeTruthy();
  });

  it('exposes chart summaries for assistive technologies', async () => {
    await renderPanel();

    const charts = screen.getAllByRole('img');
    expect(charts).toHaveLength(2);

    const cohortSummary = document.getElementById(charts[0].getAttribute('aria-describedby')!);
    expect(cohortSummary?.textContent).toContain('19 сент.');
    expect(cohortSummary?.textContent).toContain('Зарегистрировались: 43');
    expect(cohortSummary?.textContent).toContain('Купили подписку: 5');

    const receiptsSummary = document.getElementById(charts[1].getAttribute('aria-describedby')!);
    expect(receiptsSummary?.textContent).toContain('Подтверждённые поступления: 1446.00 ₽');
    expect(receiptsSummary?.textContent).toContain('Общий расход на рекламу: 8000.00 ₽');
  });

  it('hides the data-quality warning when the backend reports complete data', async () => {
    await renderPanel({
      ...analytics,
      data_quality: { status: 'complete' },
    });

    expect(screen.queryByText(/Часть старых операций/)).toBeNull();
  });
});
