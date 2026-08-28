// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import PromoDiscountBanner from './PromoDiscountBanner';
import type { ActiveDiscount, PromoOffer } from '../../api/promo';

/**
 * 🔴 Зачем этот баннер существует: живой экран Главной (`DashboardUnified`) не показывал
 * промо-предложения ВООБЩЕ — блок жил в старом `Dashboard.tsx`, не подключённом к маршрутам
 * с 24.06. Нашёл живой проход владельца 28.08: он прошёл все вкладки кабинета и не увидел
 * своей скидки, хотя предложение лежало в базе живое.
 *
 * 🔴 Библиотеку запросов НЕ мокаем — только слой API. Иначе `queryFn` компонента не
 * исполняется, и мутация «сломать фильтр» переживёт набор.
 */

const getOffers = vi.fn<[], Promise<PromoOffer[]>>();
const getActiveDiscount = vi.fn<[], Promise<ActiveDiscount>>();
const claimOffer = vi.fn<[number], Promise<{ success: boolean; message: string }>>();

vi.mock('../../api/promo', () => ({
  promoApi: {
    getOffers: () => getOffers(),
    getActiveDiscount: () => getActiveDiscount(),
    claimOffer: (id: number) => claimOffer(id),
  },
}));

// Подстановки ДОЛЖНЫ быть видны в тексте: иначе сторож не отличит «назвали процент и срок»
// от «нарисовали заголовок без них» — это была бы проверка совпадения.
vi.mock('react-i18next', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-i18next')>();
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, options?: Record<string, unknown>) =>
        options ? `${key}|${Object.values(options).join(',')}` : key,
      i18n: { language: 'ru' },
    }),
  };
});

// Числа намеренно НЕ совпадают с умолчаниями соседнего кода (25/48 у боевого шаблона).
const PERCENT = 17;
const NO_DISCOUNT: ActiveDiscount = {
  discount_percent: 0,
  source: null,
  expires_at: null,
  is_active: false,
};

function offer(over: Partial<PromoOffer> = {}): PromoOffer {
  return {
    id: 404,
    notification_type: 'expired_discount_wave2',
    discount_percent: PERCENT,
    effect_type: 'percent_discount',
    expires_at: '2026-09-03T14:05:00Z',
    is_active: true,
    is_claimed: false,
    claimed_at: null,
    extra_data: null,
    ...over,
  };
}

function renderBanner() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const utils = render(
    <QueryClientProvider client={queryClient}>
      <PromoDiscountBanner />
    </QueryClientProvider>,
  );
  return { ...utils, queryClient };
}

beforeEach(() => {
  getOffers.mockReset().mockResolvedValue([]);
  getActiveDiscount.mockReset().mockResolvedValue(NO_DISCOUNT);
  claimOffer.mockReset().mockResolvedValue({ success: true, message: 'ok' });
});

afterEach(() => cleanup());

describe('баннер скидки на Главной', () => {
  it('называет процент, срок и даёт кнопку, когда предложение не забрано', async () => {
    getOffers.mockResolvedValue([offer()]);

    renderBanner();

    expect(await screen.findByText(`promo.offers.discountPercent|${PERCENT}`)).toBeTruthy();
    // Срок обязан быть НАЗВАН: без него у крючка нет срочности, ради которой он придуман.
    expect(screen.getByText(/promo\.offers\.expires\|03\.09 \d{2}:05/)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'promo.offers.activate' })).toBeTruthy();
  });

  it('забирает именно это предложение и гасит кэш цен', async () => {
    getOffers.mockResolvedValue([offer({ id: 777 })]);
    const { queryClient } = renderBanner();
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');

    fireEvent.click(await screen.findByRole('button', { name: 'promo.offers.activate' }));

    await waitFor(() => expect(claimOffer).toHaveBeenCalledWith(777));
    const keys = invalidate.mock.calls.map((c) => (c[0] as { queryKey: string[] }).queryKey[0]);
    // Скидка меняет ЦЕНУ — значит гасить надо и кассы, иначе человек видит прежнюю сумму.
    expect(keys).toContain('active-discount');
    expect(keys).toContain('device-first-options');
    expect(keys).toContain('purchase-options');
  });

  it('НЕ показывает предложение тестовых серверов — его выдача заглушена на сервере', async () => {
    // Единственный вход, на котором «показывать всё» и «показывать только скидки»
    // расходятся: предложение живое и незабранное, но его механизм мёртв.
    // 🔴 Процент тут ПОЛОЖИТЕЛЬНЫЙ намеренно. С `discount_percent: null` предложение
    // отсекал бы соседний забор, и мутация «убрать фильтр test_access» пережила бы тест —
    // так и вышло с первого раза. Разный ответ две ветки дают ровно на этом входе.
    getOffers.mockResolvedValue([offer({ effect_type: 'test_access', discount_percent: 30 })]);

    const { container } = renderBanner();

    await waitFor(() => expect(getOffers).toHaveBeenCalled());
    await waitFor(() => expect(container.textContent).toBe(''));
  });

  it('из нескольких предложений показывает то, что сгорит раньше', async () => {
    getOffers.mockResolvedValue([
      offer({ id: 1, discount_percent: 5, expires_at: '2026-09-10T10:00:00Z' }),
      offer({ id: 2, discount_percent: 9, expires_at: '2026-09-01T10:00:00Z' }),
    ]);

    renderBanner();

    expect(await screen.findByText('promo.offers.discountPercent|9')).toBeTruthy();
    expect(screen.queryByText('promo.offers.discountPercent|5')).toBeNull();
  });

  it('показывает уже активную скидку, когда забирать больше нечего', async () => {
    getActiveDiscount.mockResolvedValue({
      discount_percent: PERCENT,
      source: 'expired_discount_wave2',
      expires_at: '2026-09-03T14:05:00Z',
      is_active: true,
    });

    renderBanner();

    expect(await screen.findByText(`promo.offers.discountActiveTitle|${PERCENT}`)).toBeTruthy();
    // Кнопки тут быть НЕ должно: забирать уже нечего, а «отказаться» мы намеренно не носим.
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('молчит, когда нет ни предложения, ни активной скидки', async () => {
    const { container } = renderBanner();

    await waitFor(() => expect(getOffers).toHaveBeenCalled());
    await waitFor(() => expect(container.textContent).toBe(''));
  });

  it('показывает отказ сервера, а не глотает его', async () => {
    getOffers.mockResolvedValue([offer()]);
    claimOffer.mockRejectedValue({ response: { data: { detail: 'Предложение уже забрано' } } });

    renderBanner();
    fireEvent.click(await screen.findByRole('button', { name: 'promo.offers.activate' }));

    expect(await screen.findByText('Предложение уже забрано')).toBeTruthy();
  });
});
