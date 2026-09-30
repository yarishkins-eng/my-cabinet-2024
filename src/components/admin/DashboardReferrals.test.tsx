// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { createInstance } from 'i18next';
import { I18nextProvider, initReactI18next } from 'react-i18next';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { DashboardReferrals as Referrals } from '../../api/admin';
import ru from '../../locales/ru.json';
import { DashboardReferrals } from './DashboardReferrals';

vi.mock('../../hooks/useCurrency', () => ({
  useCurrency: () => ({ formatWithCurrency: (value: number) => `${value} $` }),
}));

/** Выдуманные числа (репозиторий публичный), форма — как у ответа бота: месяцы по возрастанию, текущий последним. */
const data: Referrals = {
  months: [
    {
      month: '2026-08',
      came: 10,
      trial: 7,
      paid_first: 4,
      money_kopeks: 700000,
      rewards_kopeks: 175000,
    },
    {
      month: '2026-09',
      came: 9,
      trial: 5,
      paid_first: 3,
      money_kopeks: 450000,
      rewards_kopeks: 112500,
    },
  ],
  new_people_month: 300,
  money_month_kopeks: 1500000,
  came_pct: 3,
  money_pct: 30,
};

async function renderBlock(props: Partial<Parameters<typeof DashboardReferrals>[0]> = {}) {
  const i18n = createInstance();
  await i18n.use(initReactI18next).init({ lng: 'ru', resources: { ru: { translation: ru } } });
  return render(
    <I18nextProvider i18n={i18n}>
      <DashboardReferrals data={data} loading={false} isError={false} {...props} />
    </I18nextProvider>,
  );
}

/** Текст экрана без неразрывных пробелов: «4 500 ₽» и «3 %» печатаются через NBSP. */
const plain = (container: HTMLElement) => (container.textContent ?? '').replace(/\u00a0/g, ' ');

afterEach(cleanup);

describe('DashboardReferrals — рефералка на «Статистике» (РЕФ-2)', () => {
  it('shows the current month tiles from the last row, with the owner wording', async () => {
    const { container } = await renderBlock();
    const text = plain(container);

    expect(screen.getByText('Приглашения · по ссылке друга')).toBeTruthy();
    expect(screen.getByText('Team и тестовые не считаются')).toBeTruthy();
    expect(text).toContain('Сентябрь, с начала месяца');
    expect(text).toContain('Пришли по ссылке друга9');
    expect(text).toContain('3 % от всех новых, вместе с рекламой');
    expect(text).toContain('Заплатили впервые3');
    // деньги — все оплаты приглашённых, а не только первые: рядом стоит «заплатили впервые» (ревью W2P-1)
    expect(text).toContain('Деньги от приглашённых (все оплаты)4 500 ₽');
    expect(text).toContain('30 % от всех денег');
    expect(text).toContain('Начислено пригласившим1 125 ₽');
    expect(text).toContain('без бонусов приглашённым');
  });

  it('shows every month as a two-level card: money on top, four numbers below', async () => {
    const { container } = await renderBlock();
    const text = plain(container);

    expect(text).toContain(
      'Каждое событие — в своём месяце: заплатить мог и тот, кто пришёл раньше.',
    );
    expect(text).toContain('Августденьги: 7 000 ₽');
    for (const chip of [
      'пришли: 10',
      'взяли пробный: 7',
      'заплатили впервые: 4',
      'начислено: 1 750 ₽',
    ]) {
      expect(text).toContain(chip);
    }
    expect(text).toContain('Сентябрьденьги: 4 500 ₽');
  });

  it('prints no share when there is nothing to divide by', async () => {
    const { container } = await renderBlock({ data: { ...data, came_pct: null, money_pct: null } });
    const text = plain(container);

    expect(text).not.toContain('% от всех новых');
    expect(text).not.toContain('% от всех денег');
  });

  it('keeps the block with an error line when the server fails, instead of hiding it', async () => {
    const { container } = await renderBlock({ data: undefined, isError: true });
    const text = plain(container);

    expect(screen.getByText('Приглашения · по ссылке друга')).toBeTruthy();
    expect(text).toContain('Не удалось загрузить приглашения');
  });

  it('shows an ellipsis while loading, not zeros', async () => {
    const { container } = await renderBlock({ data: undefined, loading: true });

    expect(plain(container)).toContain('…');
    expect(plain(container)).not.toContain('Пришли по ссылке друга0');
  });
});
