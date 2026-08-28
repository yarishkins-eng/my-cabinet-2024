// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
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

// 🔴 Без этого негативные проверки проходят ПО ПУСТОМУ экрану: `waitFor` доволен уже на
// первом тике, когда запрос ещё не ответил, и мутация «показывать всё подряд» их переживает.
// Так и вышло с первого раза — поймано мутацией, не ревью.
async function settle() {
  await act(async () => {
    for (let i = 0; i < 10; i += 1) await Promise.resolve();
  });
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
    // 🔴 И сам список предложений: без него баннер до 30 секунд держит кнопку на уже
    // забранном, второе нажатие вернёт отказ. Пропуск нашла линза, а не мой прогон мутаций.
    expect(keys).toContain('promo-offers');
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
    await settle();
    expect(container.textContent).toBe('');
  });

  it('НЕ рисует кнопку на предложении, которое сервер уже погасил', async () => {
    // 🔴 `/offers` отдаёт и ЗАБРАННЫЕ предложения, помечая их `is_active: false`
    // (`app/cabinet/routes/promo.py`). Значит `offer.is_active` — единственное, что не даёт
    // нарисовать «Активировать» на уже забранном. Ни один сторож этого входа не давал:
    // мутация «убрать проверку» переживала набор. Нашла линза «соответствие плану».
    getOffers.mockResolvedValue([offer({ is_active: false, is_claimed: true })]);

    const { container } = renderBanner();

    await waitFor(() => expect(getOffers).toHaveBeenCalled());
    await settle();
    expect(container.textContent).toBe('');
  });

  it('НЕ рисует предложение с нулевым процентом', async () => {
    // Вход, на котором «смотреть на процент» и «не смотреть» расходятся: тип обычный,
    // предложение живое, но скидки в нём нет — рисовать «Скидка 0%» нельзя.
    getOffers.mockResolvedValue([offer({ discount_percent: 0 })]);

    const { container } = renderBanner();

    await waitFor(() => expect(getOffers).toHaveBeenCalled());
    await settle();
    expect(container.textContent).toBe('');
  });

  it('из нескольких предложений показывает САМОЕ ВЫГОДНОЕ, а не ближайшее по сроку', async () => {
    // 🔴 Вход подобран так, что «по сроку» и «по выгоде» дают РАЗНЫЙ ответ: дешёвое сгорает
    // раньше. Раньше баннер брал ближайшее — и в паре с правилом «активная важнее» человек,
    // забрав 5 %, терял доступ к 30 % до истечения первых. Нашёл критик полноты волны 2.
    getOffers.mockResolvedValue([
      offer({ id: 1, discount_percent: 5, expires_at: '2026-09-01T10:00:00Z' }),
      offer({ id: 2, discount_percent: 30, expires_at: '2026-09-10T10:00:00Z' }),
    ]);

    renderBanner();

    expect(await screen.findByText('promo.offers.discountPercent|30')).toBeTruthy();
    expect(screen.queryByText('promo.offers.discountPercent|5')).toBeNull();
  });

  it('при равном проценте берёт то, что сгорит раньше', async () => {
    getOffers.mockResolvedValue([
      offer({ id: 1, discount_percent: 12, expires_at: '2026-09-10T10:00:00Z' }),
      offer({ id: 2, discount_percent: 12, expires_at: '2026-09-01T09:00:00Z' }),
    ]);

    renderBanner();

    // Различить их можно только по сроку — он и есть улика выбора.
    expect(await screen.findByText(/promo\.offers\.expires\|01\.09/)).toBeTruthy();
  });

  it('после отказа перечитывает состояние, а не держит мёртвую кнопку', async () => {
    // Отказ значит «на сервере уже не то»: предложение забрали из телеграма или оно истекло.
    // Не перечитав, экран держал бы живую кнопку на мёртвом предложении вечно.
    getOffers.mockResolvedValue([offer()]);
    claimOffer.mockRejectedValue({ response: { data: { detail: 'This offer has expired' } } });
    const { queryClient } = renderBanner();
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');

    fireEvent.click(await screen.findByRole('button', { name: 'promo.offers.activate' }));
    await screen.findByRole('alert');

    const keys = invalidate.mock.calls.map((c) => (c[0] as { queryKey: string[] }).queryKey[0]);
    expect(keys).toContain('promo-offers');
    expect(keys).toContain('active-discount');
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

  it('НЕ показывает скидку, у которой сервер снял признак активности', async () => {
    // Единственный вход, на котором «смотреть на флаг» и «смотреть только на процент»
    // расходятся: процент есть, но скидка уже неактивна (истекла и ещё не убрана).
    getActiveDiscount.mockResolvedValue({
      discount_percent: PERCENT,
      source: 'expired_discount_wave2',
      expires_at: '2026-09-03T14:05:00Z',
      is_active: false,
    });

    const { container } = renderBanner();

    await waitFor(() => expect(getActiveDiscount).toHaveBeenCalled());
    await settle();
    expect(container.textContent).toBe('');
  });

  it('молчит, когда нет ни предложения, ни активной скидки', async () => {
    const { container } = renderBanner();

    await waitFor(() => expect(getOffers).toHaveBeenCalled());
    await waitFor(() => expect(getActiveDiscount).toHaveBeenCalled());
    await settle();
    expect(container.textContent).toBe('');
  });

  it('говорит об отказе ПО-РУССКИ и не пересказывает английский текст сервера', async () => {
    // Все отказы этого маршрута на сервере — захардкоженные английские строки. Показать
    // их как есть значит написать русскому человеку «This offer has expired».
    getOffers.mockResolvedValue([offer()]);
    claimOffer.mockRejectedValue({ response: { data: { detail: 'This offer has expired' } } });

    renderBanner();
    fireEvent.click(await screen.findByRole('button', { name: 'promo.offers.activate' }));

    expect((await screen.findByRole('alert')).textContent).toBe('promo.offers.activationFailed');
    expect(screen.queryByText('This offer has expired')).toBeNull();
  });

  it('НЕ предлагает забрать новое предложение, пока скидка уже активна', async () => {
    // 🔴 Сервер при заборе перезаписывает процент, не спрашивая, что там лежало. Предложи
    // мы забрать 9 % человеку с активными 17 — он потерял бы разницу одним нажатием и без
    // слова, отменить нельзя. Это единственный вход, где «предложение важнее» и
    // «активная важнее» дают разный ответ.
    getOffers.mockResolvedValue([offer({ discount_percent: 9 })]);
    getActiveDiscount.mockResolvedValue({
      discount_percent: PERCENT,
      source: 'trial_expired_discount',
      expires_at: '2026-09-03T14:05:00Z',
      is_active: true,
    });

    renderBanner();

    expect(await screen.findByText(`promo.offers.discountActiveTitle|${PERCENT}`)).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('фильтрует тестовый доступ независимо от регистра', async () => {
    // Поле свободное, сервер сравнивает в нижнем регистре. `Test_Access` обязан отсеяться
    // так же, как `test_access`, иначе кнопка нарисуется и упрётся в заглушку выдачи.
    getOffers.mockResolvedValue([offer({ effect_type: 'Test_Access', discount_percent: 30 })]);

    const { container } = renderBanner();

    await waitFor(() => expect(getOffers).toHaveBeenCalled());
    await settle();
    expect(container.textContent).toBe('');
  });

  it('на время запроса подписывает кнопку «Активация…», а не молчит', async () => {
    getOffers.mockResolvedValue([offer()]);
    let release: (v: { success: boolean; message: string }) => void = () => {};
    claimOffer.mockReturnValue(new Promise((resolve) => (release = resolve)));

    renderBanner();
    fireEvent.click(await screen.findByRole('button', { name: 'promo.offers.activate' }));

    expect(await screen.findByRole('button', { name: 'promo.offers.activating' })).toBeTruthy();
    await act(async () => {
      release({ success: true, message: 'ok' });
    });
  });
});

describe('сторожа, которых не хватало (нашёл скептик волны 2 мутациями)', () => {
  it('НЕ рисует кнопку, пока не пришёл ответ про активную скидку', async () => {
    // 🔴 Гонка двух запросов. Список предложений отвечает сразу, ответ про активную скидку
    // держим. Нарисуй мы кнопку сейчас — человек с активными 17 % забрал бы 9 % и потерял
    // разницу молча: сервер перезаписывает процент и отвечает 200 OK.
    getOffers.mockResolvedValue([offer({ discount_percent: 9 })]);
    let release: (v: ActiveDiscount) => void = () => {};
    getActiveDiscount.mockReturnValue(new Promise((resolve) => (release = resolve)));

    const { container } = renderBanner();

    await waitFor(() => expect(getOffers).toHaveBeenCalled());
    await settle();
    expect(container.textContent).toBe('');

    // А когда ответ пришёл и активной скидки нет — кнопка появляется.
    await act(async () => {
      release(NO_DISCOUNT);
    });
    expect(await screen.findByRole('button', { name: 'promo.offers.activate' })).toBeTruthy();
  });

  it('держит кнопку занятой, пока не приедут новые данные', async () => {
    // Без `await` у инвалидации кнопка оживает раньше экрана: человек видит нетронутый
    // баннер, жмёт второй раз и получает отказ. Мутация «убрать await» переживала набор.
    getOffers.mockResolvedValue([offer()]);
    const { queryClient } = renderBanner();
    let releaseInvalidate: () => void = () => {};
    vi.spyOn(queryClient, 'invalidateQueries').mockImplementation(
      () => new Promise<void>((resolve) => (releaseInvalidate = resolve)),
    );

    fireEvent.click(await screen.findByRole('button', { name: 'promo.offers.activate' }));

    await waitFor(() => expect(claimOffer).toHaveBeenCalled());
    await settle();
    const button = screen.getByRole('button');
    expect(button.textContent).toBe('promo.offers.activating');
    expect((button as HTMLButtonElement).disabled).toBe(true);

    await act(async () => {
      releaseInvalidate();
    });
  });

  it('не даёт нажать второй раз, пока идёт первый запрос', async () => {
    getOffers.mockResolvedValue([offer()]);
    let release: (v: { success: boolean; message: string }) => void = () => {};
    claimOffer.mockReturnValue(new Promise((resolve) => (release = resolve)));

    renderBanner();
    const button = await screen.findByRole('button', { name: 'promo.offers.activate' });
    fireEvent.click(button);
    await settle();
    fireEvent.click(screen.getByRole('button'));

    expect(claimOffer).toHaveBeenCalledTimes(1);
    expect((screen.getByRole('button') as HTMLButtonElement).disabled).toBe(true);
    await act(async () => {
      release({ success: true, message: 'ok' });
    });
  });

  it('не печатает пустой срок у бессрочной скидки', async () => {
    // У активной скидки срок бывает пустым (предложения до починки СК-1б). Тогда строки
    // «Истекает: …» быть не должно вовсе, а не «Истекает: » с пустотой.
    getActiveDiscount.mockResolvedValue({
      discount_percent: PERCENT,
      source: 'expired_discount_wave2',
      expires_at: null,
      is_active: true,
    });

    renderBanner();

    expect(await screen.findByText(`promo.offers.discountActiveTitle|${PERCENT}`)).toBeTruthy();
    expect(screen.queryByText(/promo\.offers\.expires/)).toBeNull();
  });
});
