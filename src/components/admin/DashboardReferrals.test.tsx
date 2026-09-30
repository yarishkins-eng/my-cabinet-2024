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
      came: 14,
      trial: 8,
      paid_first: 6,
      money_kopeks: 896700,
      rewards_kopeks: 284175,
    },
    {
      month: '2026-09',
      came: 12,
      trial: 8,
      paid_first: 2,
      money_kopeks: 614300,
      rewards_kopeks: 153583,
    },
  ],
  new_people_month: 508,
  money_month_kopeks: 2098700,
  came_pct: 2,
  money_pct: 29,
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

/** Текст экрана без неразрывных пробелов: «6 143 ₽» и «2 %» печатаются через NBSP. */
const plain = (container: HTMLElement) => (container.textContent ?? '').replace(/\u00a0/g, ' ');

afterEach(cleanup);

describe('DashboardReferrals — рефералка на «Статистике» (РЕФ-2)', () => {
  it('shows the current month tiles from the last row, with the owner wording', async () => {
    const { container } = await renderBlock();
    const text = plain(container);

    expect(screen.getByText('Приглашения · по ссылке друга')).toBeTruthy();
    expect(screen.getByText('Team и тестовые не считаются')).toBeTruthy();
    expect(text).toContain('Сентябрь, с начала месяца');
    expect(text).toContain('Пришли по ссылке друга12');
    expect(text).toContain('2 % от всех новых, вместе с рекламой');
    expect(text).toContain('Заплатили впервые2');
    expect(text).toContain('Деньги от приглашённых6 143 ₽');
    expect(text).toContain('29 % от всех денег');
    expect(text).toContain('Начислено пригласившим1 536 ₽');
    expect(text).toContain('без бонусов приглашённым');
  });

  it('shows every month as a two-level card: money on top, four numbers below', async () => {
    const { container } = await renderBlock();
    const text = plain(container);

    expect(text).toContain(
      'Каждое событие — в своём месяце: заплатить мог и тот, кто пришёл раньше.',
    );
    expect(text).toContain('Августденьги: 8 967 ₽');
    for (const chip of [
      'пришли: 14',
      'взяли пробный: 8',
      'заплатили впервые: 6',
      'начислено: 2 842 ₽',
    ]) {
      expect(text).toContain(chip);
    }
    expect(text).toContain('Сентябрьденьги: 6 143 ₽');
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
