// @vitest-environment jsdom

import { StrictMode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import TopUpAmount from './TopUpAmount';
import { useSuccessNotification } from '../store/successNotification';
import { resetRateLimit, RATE_LIMIT_KEYS } from '../utils/rateLimit';

type PaymentMethodFixture = typeof platega;

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
// 🔴 Валюта показа — не декорация, а участник денежной арифметики. По умолчанию рубли
// (конвертация тождественна), но один сторож обязан гонять НЕрублёвую локаль: там
// конвертация туда-обратно теряет копейки, и проверка диапазона может отбить свою же сумму.
const { currency } = vi.hoisted(() => ({ currency: { code: 'RUB', rubPerUnit: 1 } }));
vi.mock('../hooks/useCurrency', () => ({
  useCurrency: () => ({
    formatAmount: (value: number) => String(value),
    currencySymbol: '₽',
    // Показ округляет ВНИЗ до двух знаков — ровно как `.toFixed(2)` в живом коде.
    convertAmount: (rubles: number) => Math.floor((rubles / currency.rubPerUnit) * 100) / 100,
    convertToRub: (units: number) => Math.round(units * currency.rubPerUnit * 100) / 100,
    targetCurrency: currency.code,
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
function renderScreen(search: string, options: { warmCache?: PaymentMethodFixture[] } = {}) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  // 🔴 На боевом кэш `['payment-methods']` ВСЕГДА тёплый: его греет сама касса тем же ключом,
  // и `auto=1` она кладёт в адрес только после ответа этого запроса. Значит `method` определён
  // уже на первом рендере, и эффект автосабмита попадает ВНУТРЬ двойного прогона `StrictMode`.
  // Без прогрева тест ловит другое состояние — то, где `method` ещё нет и двойной прогон
  // выходит первой строкой. Нашёл критик полноты; мой прежний вывод «ref не нужен» был неверен.
  if (options.warmCache) queryClient.setQueryData(['payment-methods'], options.warmCache);
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
    currency.code = 'RUB';
    currency.rubPerUnit = 1;
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
  // 🔴 ЭТАП РЕК-3 УСИЛИЛ ЭТОТ СТОРОЖ ПО ТОЙ ЖЕ ПРИЧИНЕ, ЧТО И БЛИЗНЕЦА В `TopUpResult.test`.
  // Пометка «протухло» не лечит беду: кассы на экране нет, запрос неактивен, запись остаётся
  // в кэше и отдаётся следующему монтированию синхронно. С приземлением РЕК-3 сразу на
  // подтверждение это стало денежным экраном со старым балансом. Проверяем ИСХОД: записи о
  // деньгах кассы в кэше не осталось. Соседний ключ `balance` по-прежнему гасится ПОМЕТКОЙ —
  // его читает живой экран баланса, и там фоновое обновление уместно; разница намеренная.
  it('drops the stale checkout cache on the way out, not only on the result screen', async () => {
    const { queryClient } = renderScreen(
      `?amount=298&option=11&returnTo=${encodeURIComponent(CHECKOUT_RETURN)}`,
    );
    await screen.findByText('balance.enterAmount');
    queryClient.setQueryData(['device-first-options'], { balance_kopeks: 0 });
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');

    // Приходит вебсокет «баланс пополнен» — тот же путь, что у скопированной ссылки и у
    // оплаты звёздами (`starsPaymentMutation.onSuccess` зовёт `handleSuccess` напрямую).
    useSuccessNotification.getState().show({ type: 'balance_topup', amountKopeks: 29800 });

    await waitFor(() => expect(screen.getByTestId('location').textContent).toBe(CHECKOUT_RETURN));
    expect(queryClient.getQueryData(['device-first-options'])).toBeUndefined();
    // Ключи ЗАШИТЫ ЛИТЕРАЛАМИ: сторож, перебирающий тот же список, что и код, доказывает
    // только сам себя.
    const invalidatedKeys = invalidate.mock.calls
      .map(([arg]) => (arg as { queryKey?: unknown[] })?.queryKey?.[0])
      .filter(Boolean);
    expect(invalidatedKeys).toContain('balance');
  });

  // 🔴 Нашла волна ревью, и это была самая дорогая находка этапа. Пока счёт жив, кнопка
  // «Получить ссылку для оплаты» — ловушка: `handleSubmit` первой строкой гасит `paymentUrl`,
  // блок «Счёт создан» исчезает, создаётся второй счёт и сгорает попытка из трёх. На ручном
  // пути человек сам её нажал и знал, что результат ниже; с автосабмитом он приходит на
  // готовый экран, и на телефоне 375×667 видит ТОЛЬКО её.
  it('hides the invoice-destroying button while a live invoice is on the screen', async () => {
    renderScreen(`?amount=298&option=11&auto=1&returnTo=${encodeURIComponent(CHECKOUT_RETURN)}`);

    await waitFor(() => expect(createTopUp).toHaveBeenCalled());
    await settle();
    expect(screen.getByText('balance.openPaymentPage')).toBeTruthy();
    expect(screen.queryByText('balance.getPaymentLink')).toBeNull();

    // Выход не потерян: сменил способ — счёт погас, кнопка вернулась.
    fireEvent.click(screen.getByText('СБП'));
    await settle();
    expect(screen.getByText('balance.getPaymentLink')).toBeTruthy();
    expect(screen.queryByText('balance.openPaymentPage')).toBeNull();
    // И второго счёта при этом никто не создал.
    expect(createTopUp).toHaveBeenCalledTimes(1);
  });

  // 🔴 Ссылка выставлена на ПРЕЖНИЙ способ. До автосабмита такого сочетания не бывало: счёт
  // не мог существовать раньше выбора. Иначе человек выбирает «Карта», жмёт «Перейти к
  // оплате» и платит по СБП.
  it('drops a payment link that no longer matches what the person picked', async () => {
    renderScreen(`?amount=298&option=11&auto=1&returnTo=${encodeURIComponent(CHECKOUT_RETURN)}`);
    await waitFor(() => expect(createTopUp).toHaveBeenCalled());
    await settle();
    expect(screen.getByText('https://app.platega.io/pay/live')).toBeTruthy();

    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '500' } });
    await settle();
    expect(screen.queryByText('https://app.platega.io/pay/live')).toBeNull();
  });

  // 🔴 Админский тумблер «открывать страницу оплаты сразу». При нём `onSuccess` делает
  // `window.location.href` — мини-приложение вылетает к провайдеру. Из эффекта это уход БЕЗ
  // касания, метка «ушёл платить» остаётся ложной, а серверный `return_url` не несёт адреса
  // возврата на кассу. На боевом флаг выключен; короткий путь обязан выключаться сам, если
  // его включат, а не полагаться на то, что не включат.
  it('refuses the short path entirely when the provider is set to jump straight to the bank', async () => {
    getPaymentMethods.mockResolvedValue([{ ...platega, open_url_direct: true }]);
    renderScreen(`?amount=298&option=11&auto=1&returnTo=${encodeURIComponent(CHECKOUT_RETURN)}`);

    expect(await screen.findByText('balance.enterAmount')).toBeTruthy();
    await settle();
    expect(createTopUp).not.toHaveBeenCalled();
    expect(screen.getByTestId('location').textContent).toContain('auto=1');
  });

  // 🔴 Два серверных фильтра ведут себя ПРОТИВОПОЛОЖНО на пустом `sub_options`: касса отдаёт
  // все способы с номерами, а баланс отдаёт `options: null`. В этом состоянии вариант выбрать
  // не из чего, и запрос ушёл бы вообще без способа — а сервер молча подставляет первый
  // активный. Ровно тот исход, против которого сторож и писали.
  it('creates nothing when the balance side offers no options to honour the checkout choice', async () => {
    getPaymentMethods.mockResolvedValue([{ ...platega, options: null }]);
    renderScreen(`?amount=298&option=11&auto=1&returnTo=${encodeURIComponent(CHECKOUT_RETURN)}`);

    expect(await screen.findByText('balance.enterAmount')).toBeTruthy();
    await settle();
    expect(createTopUp).not.toHaveBeenCalled();
  });

  // 🔴 Решение «не стреляем» обязано быть окончательным. Без защёлки выход оставлял `auto=1`
  // в адресе, а `selectedOption` — в зависимостях эффекта: позже человек сам тыкал в чип
  // способа, эффект перезапускался, все проверки проходили и счёт создавался, хотя
  // «Получить ссылку» никто не нажимал.
  it('never fires later just because the person touched a payment chip', async () => {
    renderScreen(`?amount=298&option=999&auto=1&returnTo=${encodeURIComponent(CHECKOUT_RETURN)}`);
    expect(await screen.findByText('balance.enterAmount')).toBeTruthy();
    await settle();
    expect(createTopUp).not.toHaveBeenCalled();

    // Человек сам выбирает тот вариант, который назвала касса, — и это НЕ отправка.
    fireEvent.click(screen.getByText('Карта российского банка'));
    await settle();
    expect(createTopUp).not.toHaveBeenCalled();
  });

  // 🔴 Мина DZ: вернувшийся с пополнения человек одним нажатием «назад» попадает сюда же.
  // Проверяем ремонтаж по ТОМУ адресу, на который «назад» и приводит, — переписанному.
  it('creates no second invoice when the person comes back to the rewritten address', async () => {
    renderScreen(`?amount=298&option=11&auto=1&returnTo=${encodeURIComponent(CHECKOUT_RETURN)}`);
    await waitFor(() => expect(createTopUp).toHaveBeenCalled());
    await settle();
    const rewritten = screen.getByTestId('location').textContent ?? '';
    expect(rewritten).not.toContain('auto=1');
    cleanup();

    // Свежий монтаж: защёлка `useRef` тут уже НЕ помогает, работает только снятый параметр.
    renderScreen(rewritten.slice(rewritten.indexOf('?')));
    expect(await screen.findByText('balance.enterAmount')).toBeTruthy();
    await settle();
    expect(createTopUp).toHaveBeenCalledTimes(1);
  });

  // 🔴 Мутация пережила первую версию этого сторожа, и правильно сделала: в рублях
  // конвертация тождественна, поэтому «проверять отправляемое число» и «проверять
  // введённое» давали ОДИН результат — сторож стерёг совпадение, а не защиту.
  // Здесь локаль долларовая, курс дробный: касса прислала ровно минимум провайдера (100 ₽),
  // показ округлил его вниз до 1.10, а обратная конвертация даёт 99,73 — меньше минимума.
  // До починки автосабмит отбивал СВОЮ ЖЕ сумму красной строкой на экране, где человек
  // ничего не нажимал.
  it('does not reject its own amount on a currency whose round-trip loses kopecks', async () => {
    currency.code = 'USD';
    currency.rubPerUnit = 90.66;
    getPaymentMethods.mockResolvedValue([{ ...platega, min_amount_kopeks: 10000 }]);
    renderScreen(`?amount=100&option=11&auto=1&returnTo=${encodeURIComponent(CHECKOUT_RETURN)}`);

    await waitFor(() => expect(createTopUp).toHaveBeenCalled());
    await settle();
    // Уходит каноническая сумма кассы, а не её обратная конвертация.
    expect(createTopUp).toHaveBeenCalledWith(10000, 'platega', '11');
    // 🔴 РЕК-16.4 переименовал этот отказ: он больше не называет диапазон, а называет ту
    // границу, о которую ударились. Сторож переписан на НОВЫЙ ключ — оставь он старый,
    // и проверял бы отсутствие строки, которую код уже не показывает никогда.
    expect(screen.queryByText(/balance\.errors\.amount(BelowMin|AboveMax)/)).toBeNull();
  });

  // 🔴 Вторая мутация, пережившая первую версию: снятие защёлки с решения «не стреляем».
  // Её входа не было ни в одном сторожа, потому что он требует, чтобы способ, названный
  // кассой, ПОЯВИЛСЯ у провайдера уже после того, как экран решил молчать. Так бывает, когда
  // владелец правит набор вариантов в админке между двумя экранами.
  it('stays silent even after the missing option comes back and the person taps it', async () => {
    // Сначала варианта «11» у провайдера нет вовсе — экран честно отказывается стрелять.
    getPaymentMethods.mockResolvedValueOnce([{ ...platega, options: [platega.options[0]] }]);
    getPaymentMethods.mockResolvedValue([platega]);
    const { queryClient } = renderScreen(
      `?amount=298&option=11&auto=1&returnTo=${encodeURIComponent(CHECKOUT_RETURN)}`,
    );
    expect(await screen.findByText('balance.enterAmount')).toBeTruthy();
    await settle();
    expect(createTopUp).not.toHaveBeenCalled();

    // Варианты обновились, «Карта российского банка» появилась.
    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: ['payment-methods'] });
    });
    await settle();
    expect(screen.getByText('Карта российского банка')).toBeTruthy();
    expect(createTopUp).not.toHaveBeenCalled();

    // И человек сам её выбирает. Это выбор, а не отправка: счёт создаётся только по нажатию
    // «Получить ссылку». Без защёлки эффект перезапустился бы и выставил счёт молча.
    fireEvent.click(screen.getByText('Карта российского банка'));
    await settle();
    expect(createTopUp).not.toHaveBeenCalled();
    expect(screen.getByText('balance.getPaymentLink')).toBeTruthy();
  });

  // 🔴 Сторож, которого требовало ТЗ и которого у меня НЕ БЫЛО: «убрать ref-латч → краснеет».
  // Прогреваем кэш ровно как боевой путь, поэтому эффект стреляет внутри двойного прогона
  // `StrictMode`. Без защёлки — два счёта и две сожжённые попытки из трёх.
  it('creates exactly one invoice when the methods cache is already warm, as it always is', async () => {
    renderScreen(`?amount=298&option=11&auto=1&returnTo=${encodeURIComponent(CHECKOUT_RETURN)}`, {
      warmCache: [platega],
    });

    await waitFor(() => expect(createTopUp).toHaveBeenCalled());
    await settle();
    expect(createTopUp).toHaveBeenCalledTimes(1);
  });

  // 🔴 Нашёл критик полноты: обработчиков, меняющих сумму, ТРИ. Быстрая кнопка оставляла живой
  // счёт на ПРЕЖНЕЕ число рядом с новым — а «Получить ссылку» уже спрятана, и человек
  // оставался с единственной кнопкой «Перейти к оплате» на сумму, которой на экране нет.
  // 🔴 РЕК-20 перенёс спусковой крючок этой проверки, и это ЗАЯВЛЕНИЕ, а не подкрутка. Раньше
  // она жала кнопку готовой суммы «100» — кнопок больше нет, их убрали по заказу владельца.
  // Защита осталась та же: обработчиков, гасящих живой счёт при смене суммы, три, и ввод в
  // поле — один из них (`TopUpAmount.tsx`, `onChange` делает `setPaymentUrl(null)` вслед за
  // `setAmount`). Исчез только исполнитель, которого больше нет на экране.
  it('drops the live invoice when a new number replaces the one under it', async () => {
    renderScreen(`?amount=298&option=11&auto=1&returnTo=${encodeURIComponent(CHECKOUT_RETURN)}`, {
      warmCache: [platega],
    });
    await waitFor(() => expect(createTopUp).toHaveBeenCalled());
    await settle();
    expect(screen.getByText('balance.openPaymentPage')).toBeTruthy();

    fireEvent.change(screen.getByRole('spinbutton'), { target: { value: '100' } });
    await settle();
    // Счёт на прежнее число погашен вместе с числом.
    expect(screen.queryByText('balance.openPaymentPage')).toBeNull();
    // Смена суммы — это НЕ отправка: второго счёта сама она не делает.
    expect(createTopUp).toHaveBeenCalledTimes(1);

    // 🔴 Проверяем ДЕЙСТВИЕ, а не надпись кнопки. Надпись здесь обманчива: на прогретом кэше
    // мутация не успевает переключить статус, и кнопка стоит в состоянии загрузки — то есть
    // сторож по тексту доказывал бы тайминг, а не работоспособность. Способ создать счёт
    // заново обязан ВЕРНУТЬСЯ, и вот его прямое доказательство: новый счёт на НОВОЕ число.
    fireEvent.keyDown(screen.getByRole('spinbutton'), { key: 'Enter' });
    await settle();
    expect(createTopUp).toHaveBeenCalledTimes(2);
    expect(createTopUp).toHaveBeenLastCalledWith(10000, 'platega', '11');
  });

  // 🔴 Нашёл критик полноты: прятать ОТРИСОВКУ ловушки мало, сам вызов оставался достижим с
  // клавиатуры, а Enter вдобавок обходит `disabled`. Человек тапает поле посмотреть число,
  // жмёт «Готово» — и живой счёт исчезает, создаётся второй.
  it('does not let the keyboard destroy an invoice the finger cannot', async () => {
    renderScreen(`?amount=298&option=11&auto=1&returnTo=${encodeURIComponent(CHECKOUT_RETURN)}`, {
      warmCache: [platega],
    });
    await waitFor(() => expect(createTopUp).toHaveBeenCalled());
    await settle();

    fireEvent.keyDown(screen.getByRole('spinbutton'), { key: 'Enter' });
    await settle();
    expect(createTopUp).toHaveBeenCalledTimes(1);
    expect(screen.getByText('balance.openPaymentPage')).toBeTruthy();
  });

  // 🔴 Нашёл критик полноты. Курс валюты доезжает ПОСЛЕ первого рендера: поле заполнено по
  // запасному курсу, эталон пересчитан по настоящему — и сравнение строк считает человека
  // редактором, хотя он ничего не трогал. Каноническая ветка отключалась, и на сервер уходила
  // обратная конвертация: вместо 450 ₽ ушло бы ~408 ₽. Человек платит комиссию и всё равно
  // возвращается с «не хватает». Автопуть обязан слать своё число, а не то, что в поле.
  it('sends the number the checkout named, not whatever the currency drift left in the field', async () => {
    // 🔴 Мутация пережила первую версию этого сторожа: при НЕПОДВИЖНОМ курсе поле и эталон
    // считаются одинаково, `userEditedAmount` ложно, и старая ветка давала тот же ответ —
    // сторож стерёг совпадение. Настоящая беда требует, чтобы курс ДОЕХАЛ ПОЗЖЕ первого
    // кадра: поле заполнено по запасному курсу, эталон пересчитан по настоящему, и сравнение
    // строк объявляет человека редактором, хотя он не касался поля.
    currency.code = 'USD';
    currency.rubPerUnit = 100; // запасной курс `DEFAULT_RATES`
    let releaseMethods: (value: PaymentMethodFixture[]) => void = () => {};
    getPaymentMethods.mockReturnValue(
      new Promise((resolve) => {
        releaseMethods = resolve;
      }),
    );
    renderScreen(`?amount=450&option=11&auto=1&returnTo=${encodeURIComponent(CHECKOUT_RETURN)}`);
    await settle();
    // Поле заполнено по запасному курсу: 450 / 100 = «4.5».
    expect(createTopUp).not.toHaveBeenCalled();

    // Приехал настоящий курс, следом — способы. Эталон стал «4.96», поле осталось «4.5».
    currency.rubPerUnit = 90.66;
    await act(async () => {
      releaseMethods([platega]);
    });
    await settle();

    // 45000 копеек — ровно недостача кассы. Литерал, а не выражение.
    // Без починки ушло бы `ceil(convertToRub(4.5) * 100)` = 40797 — человек заплатил бы
    // комиссию и вернулся на кассу всё с тем же «не хватает».
    expect(createTopUp).toHaveBeenCalledWith(45000, 'platega', '11');
  });

  // 🔴 Этап В-1. Адрес возврата обязан лечь В ПАМЯТЬ, а не только остаться в строке браузера.
  // Когда человек вернётся из банка кнопкой платёжной системы, Телеграм запустит мини-приложение
  // ЗАНОВО: строки не будет, и память — единственное, что помнит, куда его вести. Без этого
  // сторожа строку `return_to` можно было выбросить, не покрасив ни один тест.
  it('кладёт адрес возврата в память, а не только в строку браузера', async () => {
    localStorage.clear();
    sessionStorage.clear();
    renderScreen(`?amount=298&option=11&auto=1&returnTo=${encodeURIComponent(CHECKOUT_RETURN)}`);

    await waitFor(() => expect(createTopUp).toHaveBeenCalled());
    await settle();

    // Перезапуск приложения: сессионное хранилище прежнего запуска не переживает.
    sessionStorage.clear();
    const stored = localStorage.getItem('topup_pending_payment');
    expect(stored).not.toBeNull();
    expect(JSON.parse(stored!).return_to).toBe(CHECKOUT_RETURN);
  });

  // 🔴 Второй конец шкалы: у обычного пополнения адреса возврата нет, и выдумывать его нельзя —
  // иначе человека уводило бы на кассу, куда он не собирался.
  it('у обычного пополнения адреса возврата в памяти нет', async () => {
    localStorage.clear();
    renderScreen('?amount=298&option=11&auto=1');

    await waitFor(() => expect(createTopUp).toHaveBeenCalled());
    await settle();

    const stored = localStorage.getItem('topup_pending_payment');
    expect(stored).not.toBeNull();
    expect(JSON.parse(stored!).return_to).toBeNull();
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
