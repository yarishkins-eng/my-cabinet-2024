// @vitest-environment jsdom

import { StrictMode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import TopUpAmount from './TopUpAmount';
import { useSuccessNotification } from '../store/successNotification';
import { resetRateLimit, RATE_LIMIT_KEYS } from '../utils/rateLimit';

// 🔴 Этап Б-2. У этого экрана НЕ БЫЛО тестового файла вовсе — и это не мелочь, а пустое
// место размером с пункт этапа: любую правку здесь можно было откатить, и весь набор
// оставался зелёным. Файл заведён вместе с автосабмитом и починкой мины EC.

const { getPaymentMethods, createTopUp } = vi.hoisted(() => ({
  getPaymentMethods: vi.fn(),
  createTopUp: vi.fn(),
}));
vi.mock('../api/balance', () => ({
  balanceApi: {
    getPaymentMethods,
    createTopUp,
    createStarsInvoice: vi.fn(),
  },
}));

const { openLink, openTelegramLink, openInvoice } = vi.hoisted(() => ({
  openLink: vi.fn(),
  openTelegramLink: vi.fn(),
  openInvoice: vi.fn(),
}));
vi.mock('@/platform', () => ({
  usePlatform: () => ({ openLink, openTelegramLink, openInvoice, platform: 'telegram' }),
  useHaptic: () => ({ notification: vi.fn(), impact: vi.fn(), selection: vi.fn() }),
}));
vi.mock('@/utils/clipboard', () => ({
  copyToClipboard: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../hooks/useCurrency', () => ({
  useCurrency: () => ({
    formatAmount: (value: number) => String(value),
    currencySymbol: '₽',
    convertAmount: (value: number) => value,
    convertToRub: (value: number) => value,
    targetCurrency: 'RUB',
  }),
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

const platega = {
  id: 'platega',
  name: 'Platega',
  description: null,
  min_amount_kopeks: 100,
  max_amount_kopeks: 100000000,
  is_available: true,
  quick_amounts: [10000, 30000],
  options: [
    { id: '2', name: 'СБП', description: '' },
    { id: '11', name: 'Карта российского банка', description: '' },
    { id: '13', name: 'Криптовалюта', description: '' },
  ],
};

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{location.pathname + location.search}</output>;
}

// 🔴 `StrictMode` здесь не украшение, а воспроизведение боевого условия: он включён в
// `main.tsx`, и в нём React исполняет каждый эффект ДВАЖДЫ. Без защёлки автосабмит создал бы
// два счёта и сжёг две попытки из трёх у `checkRateLimit(PAYMENT, 3, 30000)`. Проверять
// «ровно один раз» вне `StrictMode` значит проверять условие, которого на боевом не бывает.
function renderScreen(search: string) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const utils = render(
    <StrictMode>
      <MemoryRouter initialEntries={[`/balance/top-up/platega${search}`]}>
        <QueryClientProvider client={queryClient}>
          <LocationProbe />
          <Routes>
            <Route path="/balance/top-up/:methodId" element={<TopUpAmount />} />
            <Route path="*" element={<output data-testid="elsewhere" />} />
          </Routes>
        </QueryClientProvider>
      </MemoryRouter>
    </StrictMode>,
  );
  return { ...utils, queryClient };
}

const CHECKOUT_RETURN = '/subscription/purchase?from=checkout&period=30&devices=5';

// 🔴 Без этого два сторожа этого файла были ПУСТЫМИ, и показал это мутационный прогон, а не
// ревью. `waitFor(…toHaveBeenCalledTimes(1))` проходит на ПЕРВОМ вызове и до второго не
// доживает; `expect(…).not.toHaveBeenCalled()` вообще проходит мгновенно — раньше, чем
// эффект успевает сработать. Оба сторожа оставались зелёными при снятой защите.
// `settle` доводит экран до состояния, когда автосабмиту уже нечего ждать: разрешены
// промисы запросов, отработали эффекты, включая ПОВТОРНЫЙ прогон `StrictMode`.
async function settle() {
  for (let tick = 0; tick < 3; tick += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

describe('TopUpAmount — короткий путь кассы', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // 🔴 Ограничитель попыток оплаты живёт в модуле, то есть ПЕРЕЖИВАЕТ тесты: три автосабмита
    // подряд упёрлись бы в свой же потолок, и следующий сторож упал бы по чужой причине.
    resetRateLimit(RATE_LIMIT_KEYS.PAYMENT);
    getPaymentMethods.mockResolvedValue([platega]);
    createTopUp.mockResolvedValue({
      payment_id: 'pay-1',
      payment_url: 'https://app.platega.io/pay/live',
      amount_kopeks: 29800,
      amount_rubles: 298,
      status: 'pending',
      expires_at: null,
    });
  });
  afterEach(() => cleanup());

  it('creates the invoice exactly once for a checkout that asked for it', async () => {
    renderScreen(`?amount=298&option=11&auto=1&returnTo=${encodeURIComponent(CHECKOUT_RETURN)}`);

    await waitFor(() => expect(createTopUp).toHaveBeenCalled());
    // 🔴 Считаем ПОСЛЕ `settle`, а не на первом вызове: в `StrictMode` второй прогон эффекта
    // идёт следом, и проверка «уже равно единице» его просто не дожидается.
    await settle();
    expect(createTopUp).toHaveBeenCalledTimes(1);
    // Сумма и способ — те самые, что посчитала касса. 29800 копеек, вариант '11' (карта),
    // а НЕ '2': `getPreferredOptionId` без метки поставил бы СБП, и человек, выбравший
    // карту, ушёл бы платить по СБП, ничего об этом не узнав.
    expect(createTopUp).toHaveBeenCalledWith(29800, 'platega', '11');

    // Второго счёта нет, сколько бы экран ни перерисовался.
    fireEvent.change(await screen.findByRole('spinbutton'), { target: { value: '298' } });
    await waitFor(() => expect(screen.getByText('https://app.platega.io/pay/live')).toBeTruthy());
    await settle();
    expect(createTopUp).toHaveBeenCalledTimes(1);
  });

  it('takes the auto flag out of the address, so Back does not fire a second invoice', async () => {
    renderScreen(`?amount=298&option=11&auto=1&returnTo=${encodeURIComponent(CHECKOUT_RETURN)}`);

    // 🔴 Мина DZ: вернувшийся с пополнения человек одним нажатием «назад» попадает СЮДА же.
    // Параметр снят через `replace`, то есть переписана ровно та запись истории, в которую
    // «назад» и приводит.
    // ⚠️ Ждём именно АДРЕС, а не вызов мутации: снятие параметра — это ре-рендер, и он
    // происходит ПОЗЖЕ вызова. Проверка по мутации проходила в одиночку и падала под полным
    // набором — то есть сторожила бы совпадение, а не защиту.
    await waitFor(() => expect(screen.getByTestId('location').textContent).not.toContain('auto=1'));
    expect(createTopUp).toHaveBeenCalledTimes(1);
    const target = screen.getByTestId('location').textContent ?? '';
    // Остальное человек не терял: сумма, способ и адрес возврата на месте.
    expect(target).toContain('amount=298');
    expect(target).toContain('option=11');
    expect(target).toContain('returnTo=');
  });

  it('does not open the bank by itself and leaves the live tap in place', async () => {
    renderScreen(`?amount=298&option=11&auto=1&returnTo=${encodeURIComponent(CHECKOUT_RETURN)}`);

    await waitFor(() => expect(createTopUp).toHaveBeenCalledTimes(1));
    expect(await screen.findByText('balance.openPaymentPage')).toBeTruthy();
    // 🔴 `openLink` вне живого нажатия режется блокировщиком всплывающих окон и отказывает
    // МОЛЧА, а метку «ушёл платить» взводит только ручной обработчик. Автооткрытие сломало бы
    // возврат: человек вернулся бы из банка на застывший экран и решил, что не заплатил.
    expect(openLink).not.toHaveBeenCalled();
    expect(openTelegramLink).not.toHaveBeenCalled();
  });

  it('refuses to auto-submit a provider option the server never offered', async () => {
    renderScreen(`?amount=298&option=999&auto=1&returnTo=${encodeURIComponent(CHECKOUT_RETURN)}`);

    // Экран поднялся, а счёта нет: подставить вместо неизвестного варианта СБП молча —
    // это увести человека платить не тем способом, который он выбрал.
    expect(await screen.findByText('balance.enterAmount')).toBeTruthy();
    await settle();
    expect(createTopUp).not.toHaveBeenCalled();
    // Улика того, что эффект ПРОМОЛЧАЛ, а не «мы посмотрели слишком рано»: у сработавшего
    // автосабмита параметр `auto` из адреса снят, здесь он обязан остаться на месте.
    expect(screen.getByTestId('location').textContent).toContain('auto=1');
  });

  it('never auto-submits an amount the person did not choose', async () => {
    renderScreen('?auto=1');

    expect(await screen.findByText('balance.enterAmount')).toBeTruthy();
    await settle();
    // Без суммы автосабмит выдал бы красное «Введите сумму» тому, кто ничего не нажимал.
    expect(createTopUp).not.toHaveBeenCalled();
    expect(screen.queryByText('balance.errors.enterAmount')).toBeNull();
    expect(screen.getByTestId('location').textContent).toContain('auto=1');
  });

  // 🔴 МИНА EC — живой дефект, доехавший на боевой этапом Б-1, и самый дорогой в этом файле.
  // Человек копирует платёжную ссылку и платит в браузере или на компьютере. Копирование
  // метку «ушёл платить» НЕ ставит, поэтому WS-успех уходит в `handleSuccess`, а не на
  // `/balance/top-up/result` — единственное место, где гасился кэш кассы. Итог: он заплатил
  // и вернулся на кассу с ПРЕЖНИМ «Не хватает N». Ровно то, что Б-1 объявил закрытым.
  it('drops the stale checkout cache on the way out, not only on the result screen', async () => {
    const { queryClient } = renderScreen(
      `?amount=298&option=11&returnTo=${encodeURIComponent(CHECKOUT_RETURN)}`,
    );
    await screen.findByText('balance.enterAmount');
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');

    // Приходит вебсокет «баланс пополнен» — тот же путь, что у скопированной ссылки и у
    // оплаты звёздами (`starsPaymentMutation.onSuccess` зовёт `handleSuccess` напрямую).
    useSuccessNotification.getState().show({ type: 'balance_topup', amountKopeks: 29800 });

    await waitFor(() => expect(screen.getByTestId('location').textContent).toBe(CHECKOUT_RETURN));
    // Ключи ЗАШИТЫ ЛИТЕРАЛАМИ: сторож, перебирающий тот же список, что и код, доказывает
    // только сам себя. `device-first-options` — это и есть баланс, который читает касса.
    const invalidatedKeys = invalidate.mock.calls
      .map(([arg]) => (arg as { queryKey?: unknown[] })?.queryKey?.[0])
      .filter(Boolean);
    expect(invalidatedKeys).toContain('device-first-options');
    expect(invalidatedKeys).toContain('balance');
  });

  it('stays a manual screen when the checkout marker is absent', async () => {
    renderScreen('?amount=298&option=11');

    expect(await screen.findByText('balance.enterAmount')).toBeTruthy();
    await settle();
    expect(createTopUp).not.toHaveBeenCalled();
    // Но предвыбор способа из адреса работает и без автосабмита.
    expect(screen.getByText('Карта российского банка').className).toContain('ring-accent-500/40');
  });
});
