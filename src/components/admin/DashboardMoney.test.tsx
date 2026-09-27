// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createInstance } from 'i18next';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { DashboardMoney as Money, SubscriptionStats } from '../../api/admin';
import ru from '../../locales/ru.json';
import { DashboardMoney } from './DashboardMoney';

vi.mock('../../hooks/useCurrency', () => ({
  useCurrency: () => ({ formatWithCurrency: (value: number) => `${value} $` }),
}));

/** Выдуманные деньги (репозиторий публичный): 30 суток до 27.09, самый большой день — 16.09. */
const days = Array.from({ length: 30 }, (_, index) => {
  const date = new Date(Date.UTC(2026, 7, 29 + index)).toISOString().slice(0, 10);
  const kopeks = date === '2026-09-16' ? 300000 : date === '2026-09-27' ? 30000 : 0;
  return { date, kopeks };
});

const money: Money = {
  today_kopeks: 30000,
  month_kopeks: 1000000,
  total_kopeks: 3000000,
  days,
  months: [
    { month: '2026-06', kopeks: 200000 },
    { month: '2026-07', kopeks: 0 },
    { month: '2026-08', kopeks: 1800000 },
    { month: '2026-09', kopeks: 1000000 },
  ],
};

const people = {
  people_paying: 57,
  people_on_trial: 23,
  new_buyers_today: 2,
} as SubscriptionStats;

async function renderMoney(props: Partial<Parameters<typeof DashboardMoney>[0]> = {}) {
  const i18n = createInstance();
  await i18n.use(initReactI18next).init({ lng: 'ru', resources: { ru: { translation: ru } } });
  return render(
    <I18nextProvider i18n={i18n}>
      <DashboardMoney money={money} loading={false} isError={false} people={people} {...props} />
    </I18nextProvider>,
  );
}

afterEach(cleanup);

describe('DashboardMoney — деньги вернулись на «Статистику» (СП-1б)', () => {
  it('shows today, this month by name and all time', async () => {
    await renderMoney();

    expect(screen.getByText('Деньги · как в выписке Platega')).toBeTruthy();
    expect(screen.getByText('Сегодня')).toBeTruthy();
    expect(screen.getAllByText('300 ₽').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Сентябрь').length).toBeGreaterThan(0);
    expect(screen.getAllByText('10 000 ₽').length).toBeGreaterThan(0);
    expect(screen.getByText('30 000 ₽')).toBeTruthy();
  });

  it('lists every month, an empty one as zero', async () => {
    await renderMoney();

    expect(screen.getByText('Июнь')).toBeTruthy();
    expect(screen.getByText('2 000 ₽')).toBeTruthy();
    expect(screen.getByText('Июль')).toBeTruthy();
    expect(screen.getByText('0 ₽')).toBeTruthy();
    expect(screen.getByText('18 000 ₽')).toBeTruthy();
  });

  it('shows today under the chart and any day on tap', async () => {
    await renderMoney();

    expect(screen.getByText('27 сентября: 300 ₽')).toBeTruthy();
    // в названии кнопки неразрывные пробелы («3 000 ₽»): сравниваем без их различия
    const plain = (name: string) => name.replace(/\s/g, ' ');
    fireEvent.click(
      screen.getByRole('button', { name: (name) => plain(name) === '16 сентября: 3 000 ₽' }),
    );
    expect(screen.getByText('16 сентября: 3 000 ₽')).toBeTruthy();
    expect(screen.getAllByRole('button')).toHaveLength(30);
  });

  it('shows people like the top of the admin panel', async () => {
    await renderMoney();

    expect(screen.getByText('57')).toBeTruthy();
    expect(screen.getByText('+2 сегодня')).toBeTruthy();
    expect(screen.getByText('23')).toBeTruthy();
  });

  it('puts the year next to a month of the previous year', async () => {
    await renderMoney({
      money: {
        ...money,
        months: [
          { month: '2026-12', kopeks: 500000 },
          { month: '2027-01', kopeks: 100000 },
        ],
      },
    });

    expect(screen.getByText('Декабрь 2026')).toBeTruthy();
    expect(screen.getAllByText('Январь').length).toBeGreaterThan(0);
  });

  it('says so on a failure and shows dashes, not zeros', async () => {
    await renderMoney({ money: undefined, isError: true, people: null });

    expect(screen.getByText('Не удалось загрузить деньги')).toBeTruthy();
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(3);
    expect(screen.queryByText('0 ₽')).toBeNull();
  });

  it('shows «…» while loading', async () => {
    await renderMoney({ money: undefined, loading: true });

    expect(screen.getAllByText('…').length).toBeGreaterThanOrEqual(3);
  });
});
