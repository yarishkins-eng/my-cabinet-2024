// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import TopUpResult from './TopUpResult';
import { balanceApi } from '../api/balance';
import type { PendingPayment } from '../types';

// 🔴 Этап Б-1. До этого файла у экрана результата пополнения НЕ БЫЛО НИ ОДНОГО ТЕСТА, и весь
// пункт 2 этапа (возврат человека на кассу) не был прикрыт ничем: мутационный прогон показал,
// что откат любого из трёх поведений — «Готово» на кассу, «Назад» на кассу, гашение кэша кассы —
// проходит весь набор из 265 тестов чисто. Зелёный набор про этот экран не говорил ничего.

vi.mock('../api/balance', () => ({
  balanceApi: {
    getPendingPayment: vi.fn(),
    getLatestPayment: vi.fn(),
  },
}));

const refreshUser = vi.fn();
vi.mock('../store/auth', () => ({
  useAuthStore: (selector: (s: { refreshUser: () => void }) => unknown) =>
    selector({ refreshUser }),
}));

// 🔴 Хаптик наблюдаем НАМЕРЕННО: он сообщает человеку исход платежа телом, а не глазами,
// и врал ровно там, где экран сам себя поправляет. Прежний мок создавал новую заглушку на
// каждый вызов — проверить по нему было нечего.
const hapticNotification = vi.hoisted(() => vi.fn());
vi.mock('@/platform', () => ({
  useHaptic: () => ({ notification: hapticNotification, impact: vi.fn() }),
}));

vi.mock('../hooks/useCurrency', () => ({
  useCurrency: () => ({
    formatAmount: (value: number) => value.toFixed(2),
    currencySymbol: '₽',
  }),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => (typeof fallback === 'string' ? key : key),
  }),
}));

vi.mock('framer-motion', () => ({
  motion: new Proxy(
    {},
    {
      get:
        (_t, tag: string) =>
        ({ children, ...rest }: { children?: React.ReactNode; [k: string]: unknown }) => {
          const Tag = tag as 'div';
          const safe = Object.fromEntries(
            Object.entries(rest).filter(
              ([k]) => !['initial', 'animate', 'exit', 'transition'].includes(k),
            ),
          );
          return <Tag {...safe}>{children}</Tag>;
        },
    },
  ),
}));

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{location.pathname + location.search}</output>;
}

// Адрес, который кладёт касса. Зашит ЛИТЕРАЛОМ намеренно: сторож, собирающий адрес тем же
// выражением, что и проверяемый код, доказывает только сам себя.
const CHECKOUT_RETURN = '/subscription/purchase?from=checkout&period=90&devices=5';

/**
 * Записать память о начатом пополнении так, как её кладёт экран суммы. Именно эта запись —
 * единственный источник адреса возврата после того, как Телеграм перезапустил мини-приложение.
 * Ключ и форма зашиты ЛИТЕРАЛАМИ: сторож, зовущий `saveTopUpPendingInfo`, проверял бы сам себя.
 */
function seedPendingInfo(returnTo: string | null) {
  localStorage.setItem(
    'topup_pending_payment',
    JSON.stringify({
      amount_kopeks: 6000,
      method_id: 'platega',
      method_name: 'Platega',
      payment_id: '4242',
      created_at: Date.now(),
      return_to: returnTo,
    }),
  );
}

/** Ответ сервера «счёт оплачен» — только по нему экран вправе объявить успех. */
function paidPayment(): PendingPayment {
  return { ...pendingPayment(), status: 'succeeded', is_paid: true };
}

/** Ответ платёжной системы «счёт ещё не оплачен» — экран обязан остаться в ожидании. */
function pendingPayment(): PendingPayment {
  return {
    id: 4242,
    method: 'platega',
    method_display: 'Platega',
    identifier: '4242',
    amount_kopeks: 6000,
    amount_rubles: 60,
    status: 'pending',
    status_emoji: '⏳',
    status_text: 'pending',
    is_paid: false,
    is_checkable: true,
    created_at: new Date(0).toISOString(),
    expires_at: null,
    payment_url: null,
  };
}

/** Довести экран до состояния, когда эффектам и запросам уже нечего ждать. */
async function settle() {
  for (let tick = 0; tick < 3; tick += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

function renderResult(search: string, seed?: (client: QueryClient) => void) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  // Кэш заполняется ДО рендера: гашение стоит в эффекте, который отрабатывает один раз при
  // монтировании, поэтому запись после render() он бы уже не застал.
  seed?.(queryClient);
  const utils = render(
    <MemoryRouter initialEntries={['/balance/top-up/result' + search]}>
      <QueryClientProvider client={queryClient}>
        <LocationProbe />
        <Routes>
          <Route path="/balance/top-up/result" element={<TopUpResult />} />
          <Route path="*" element={<output data-testid="elsewhere" />} />
        </Routes>
      </QueryClientProvider>
    </MemoryRouter>,
  );
  return { ...utils, queryClient };
}

describe('TopUpResult — возврат на кассу после пополнения (этап Б-1)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    // 🔴 Этап В-1: память о пополнении переехала в localStorage (обязана пережить перезапуск
    // мини-приложения). Без этой строки запись протекала бы между тестами.
    localStorage.clear();
  });
  afterEach(cleanup);

  it('после успешной доплаты возвращает человека НА КАССУ, а не на Главную', async () => {
    renderResult('?status=success&returnTo=' + encodeURIComponent(CHECKOUT_RETURN));

    const done = await screen.findByRole('button');
    fireEvent.click(done);

    await waitFor(() => expect(screen.getByTestId('location').textContent).toBe(CHECKOUT_RETURN));
  });

  // 🔴 Подпись обещает то, что произойдёт. «Перейти к подписке» для кассы — ложь ровно в ту
  // секунду, когда деньги уже взяты: подписки ещё нет, пополнение ничего не оформило.
  // 🔴 Этап В-1 переписал ожидание (мина EI): Б-1 брал ключ `deviceFirst.review`, но им же
  // подписана ГЛАВНАЯ кнопка самой кассы — человек нажимал «Перейти к оформлению» и видел ту
  // же надпись второй раз. Ключ кассы зашит здесь ЛИТЕРАЛОМ намеренно: сторож обязан краснеть,
  // если кто-то вернёт совпадение подписей, а не следить за переменной, которую тот же кто-то
  // и поменяет.
  it('на кассу зовёт СВОЕЙ подписью, а не той же, что у кнопки самой кассы', async () => {
    renderResult('?status=success&returnTo=' + encodeURIComponent(CHECKOUT_RETURN));

    const label = (await screen.findByRole('button')).textContent;
    expect(label).toBe('balance.topUpResult.backToOrder');
    expect(label).not.toBe('deviceFirst.review');
  });

  // 🔴 Граница исключения. Соседние экраны (продление, докупка, смена тарифа) кладут в returnTo
  // адрес БЕЗ метки кассы, и у них корзина на сервере исполняется сама — их обязано уводить
  // на Главную, как и до этапа.
  it('НЕ трогает соседние экраны: без метки кассы уводит на Главную, как раньше', async () => {
    renderResult('?status=success&returnTo=' + encodeURIComponent('/subscription/purchase'));

    const done = await screen.findByRole('button');
    // 🔴 Этап В-1: и подпись обязана совпадать с назначением. Раньше здесь стоял ключ
    // уведомлений `successNotification.goToSubscription` — в персидском и китайском он
    // говорит «перейти к подписке», хотя кнопка ведёт на Главную. Ключ зашит ЛИТЕРАЛОМ.
    expect(done.textContent).toBe('balance.topUpResult.goToHome');
    fireEvent.click(done);

    await waitFor(() => expect(screen.getByTestId('location').textContent).toBe('/'));
  });

  it('обычное пополнение без адреса возврата уводит на баланс', async () => {
    renderResult('?status=success');

    const done = await screen.findByRole('button');
    fireEvent.click(done);

    await waitFor(() => expect(screen.getByTestId('location').textContent).toBe('/balance'));
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 🔴 Этап В-1. Возврат из банка кнопкой провайдера: мини-приложение запускается ЗАНОВО,
  // и адрес возврата в строке браузера отсутствует физически.
  // ─────────────────────────────────────────────────────────────────────────────

  it('после перезапуска берёт адрес возврата из памяти, когда его нет в строке', async () => {
    seedPendingInfo(CHECKOUT_RETURN);
    vi.mocked(balanceApi.getPendingPayment).mockResolvedValue(paidPayment());
    // Ровно та строка, которую соберёт кабинет по метке запуска `tup-platega-ok`:
    // способ и статус есть, адреса возврата нет.
    renderResult('?method=platega&status=success');

    // 🔴 Ждём именно ЭКРАН УСПЕХА, а не «первую попавшуюся кнопку»: пока сервер молчит, на
    // экране стоит ожидание — и у него тоже есть кнопка. Проверка «первой кнопки» проходила
    // бы по кнопке ожидания, то есть доказывала бы не то.
    await screen.findByText('balance.topUpResult.success');
    const done = screen.getByRole('button');
    expect(done.textContent).toBe('balance.topUpResult.backToOrder');
    fireEvent.click(done);

    await waitFor(() => expect(screen.getByTestId('location').textContent).toBe(CHECKOUT_RETURN));
  });

  // 🔴 Забор памяти. Запись в localStorage человек может подменить руками, поэтому она проходит
  // ту же проверку, что и адрес из строки: чужой адрес не уводит с кассы никуда.
  it('подменённый адрес в памяти не уводит наружу', async () => {
    seedPendingInfo('https://evil.example/steal');
    vi.mocked(balanceApi.getPendingPayment).mockResolvedValue(paidPayment());
    renderResult('?method=platega&status=success');

    // Дожидаемся успеха: у экрана ожидания выход ведёт туда же, на Главную, — проверка без
    // этого ожидания прошла бы по совпадению, а не по забору.
    await screen.findByText('balance.topUpResult.success');
    fireEvent.click(screen.getByRole('button'));

    await waitFor(() => expect(screen.getByTestId('location').textContent).toBe('/'));
  });

  // 🔴 Мина EB: у экрана отказа был ОДИН выход — на баланс. Тот, кто шёл доплатить за
  // конкретную покупку, оставался без дороги обратно к своему живому заказу.
  it('отказ оплаты даёт дверь назад к покупке, а не только на баланс', async () => {
    renderResult('?status=failed&returnTo=' + encodeURIComponent(CHECKOUT_RETURN));

    const back = await screen.findByText('balance.topUpResult.backToOrder');
    fireEvent.click(back);

    await waitFor(() => expect(screen.getByTestId('location').textContent).toBe(CHECKOUT_RETURN));
  });

  // 🔴 Граница той же правки: без метки кассы дверь назад НЕ появляется. У соседних экранов
  // покупки корзина не сохраняется, и звать их обратно — обещать несбыточное.
  it('без метки кассы у отказа остаётся ровно одна кнопка — прежняя', async () => {
    renderResult('?status=failed&returnTo=' + encodeURIComponent('/subscription/purchase'));

    const buttons = await screen.findAllByRole('button');
    expect(buttons).toHaveLength(1);
    expect(buttons[0].textContent).toBe('balance.topUpResult.tryAgain');
  });

  // 🔴 Мина EH: десять минут спиннера без единой кнопки. Уйти отсюда безопасно — деньги
  // зачисляет уведомление платёжной системы, а не этот экран.
  it('в ожидании есть выход, и он ведёт туда, что написано на кнопке', async () => {
    seedPendingInfo(CHECKOUT_RETURN);
    vi.mocked(balanceApi.getLatestPayment).mockResolvedValue(pendingPayment());
    renderResult('?method=platega');

    const leave = await screen.findByRole('button');
    // 🔴 Мина EG: пока исход платежа неизвестен, уводим НЕ на кассу (она покажет несвежий
    // баланс), а на Главную — и подпись обязана говорить именно это.
    expect(leave.textContent).toBe('balance.topUpResult.goToHome');
    fireEvent.click(leave);

    await waitFor(() => expect(screen.getByTestId('location').textContent).toBe('/'));
  });

  // 🔴 Уход с экрана ожидания НЕ означает, что платёж закончился: человек мог уже нажать
  // оплату в банке. Память о пополнении несёт единственный уцелевший адрес возврата на кассу —
  // сотрём её здесь, и возврат кнопкой платёжной системы приземлит человека «на баланс»,
  // то есть этап сломает сам себя.
  it('уход из ожидания НЕ стирает адрес возврата', async () => {
    seedPendingInfo(CHECKOUT_RETURN);
    vi.mocked(balanceApi.getLatestPayment).mockResolvedValue(pendingPayment());
    renderResult('?method=platega');

    fireEvent.click(await screen.findByRole('button'));

    await waitFor(() => expect(screen.getByTestId('location').textContent).toBe('/'));
    const kept = localStorage.getItem('topup_pending_payment');
    expect(kept).not.toBeNull();
    expect(JSON.parse(kept!).return_to).toBe(CHECKOUT_RETURN);
  });

  // 🔴 Второй конец той же шкалы. Проверка «подпись = На главную» одна прошла бы и при
  // зашитой намертво надписи: надо убедиться, что у обычного пополнения подпись ДРУГАЯ.
  it('у обычного пополнения выход из ожидания подписан балансом и ведёт на баланс', async () => {
    vi.mocked(balanceApi.getLatestPayment).mockResolvedValue(pendingPayment());
    renderResult('?method=platega');

    const leave = await screen.findByRole('button');
    expect(leave.textContent).toBe('balance.topUpResult.goToBalance');
    fireEvent.click(leave);

    await waitFor(() => expect(screen.getByTestId('location').textContent).toBe('/balance'));
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 🔴 Этап В-1, вторая волна. Кто на этом экране главный — сервер, а не адресная строка.
  // До этапа возврат провайдера приземлялся во внешнем браузере и экран не показывался
  // вовсе; В-1 сделал этот путь основным — значит слово провайдера стало решающим, и это
  // надо было закрыть.
  // ─────────────────────────────────────────────────────────────────────────────

  it('не объявляет успех по одной лишь метке в адресе, пока сервер молчит', async () => {
    seedPendingInfo(CHECKOUT_RETURN);
    vi.mocked(balanceApi.getPendingPayment).mockResolvedValue(pendingPayment());

    renderResult('?method=platega&status=success');

    // Экран остаётся в ожидании: заголовка успеха нет, есть заголовок проверки.
    await waitFor(() => expect(balanceApi.getPendingPayment).toHaveBeenCalled());
    await settle();
    expect(screen.queryByText('balance.topUpResult.success')).toBeNull();
    expect(screen.getByText('balance.topUpResult.awaitingPayment')).toBeTruthy();
  });

  // 🔴 Обратный случай: провайдер увёл на «отказ», а деньги всё же подтвердились. Раньше
  // метка отказа выключала опрос НАСОВСЕМ, и человек, которому сказали «не прошло», платил
  // второй раз. Теперь опрос продолжается и экран сам себя поправляет.
  it('поправляет себя, если провайдер сказал «отказ», а сервер говорит «оплачено»', async () => {
    seedPendingInfo(CHECKOUT_RETURN);
    vi.mocked(balanceApi.getPendingPayment).mockResolvedValue(paidPayment());

    renderResult('?method=platega&status=failed');

    await screen.findByText('balance.topUpResult.success');
    expect(screen.queryByText('balance.topUpResult.failed')).toBeNull();
  });

  // 🔴 Второй конец шкалы: когда спросить некого (ни записи в памяти, ни способа в адресе),
  // метка провайдера остаётся единственным словом — и мы его принимаем, как и раньше.
  it('без единого источника данных верит метке, как и до этапа', async () => {
    renderResult('?status=success&returnTo=' + encodeURIComponent(CHECKOUT_RETURN));

    await screen.findByText('balance.topUpResult.success');
    expect(balanceApi.getPendingPayment).not.toHaveBeenCalled();
    expect(balanceApi.getLatestPayment).not.toHaveBeenCalled();
  });

  // 🔴 Чужая ссылка `t.me/<бот>?startapp=tup-platega-ok` открывает мини-приложение сразу на
  // экране исхода. Денег это не двигает, но раньше гасило память о ЖИВОМ платеже — то есть
  // чужая ссылка стирала адрес возврата на кассу.
  it('исход, о котором сказал только адрес, не стирает память о платеже', async () => {
    seedPendingInfo(CHECKOUT_RETURN);
    vi.mocked(balanceApi.getPendingPayment).mockResolvedValue(pendingPayment());

    renderResult('?method=platega&status=failed');

    await screen.findByText('balance.topUpResult.failed');
    await settle();
    const kept = localStorage.getItem('topup_pending_payment');
    expect(kept).not.toBeNull();
    expect(JSON.parse(kept!).return_to).toBe(CHECKOUT_RETURN);
  });

  // 🔴 ПЕРЕПИСАН 24.08.2026 после живого прохода владельца. Прежний сторож требовал гасить
  // память по ФАКТУ исхода — и закреплял ровно тот дефект, который владелец увидел: пока
  // человек ещё стоит на экране, запись ему нужна, а стёртая подменяла подпись кнопки.
  // Теперь память гасится, когда человек УХОДИТ с известным исходом.
  it('память гасится при уходе с экрана, а не по факту исхода', async () => {
    seedPendingInfo(CHECKOUT_RETURN);
    vi.mocked(balanceApi.getPendingPayment).mockResolvedValue(paidPayment());

    renderResult('?method=platega&status=success');
    await screen.findByText('balance.topUpResult.success');
    await settle();

    // Пока человек на экране — запись на месте.
    expect(localStorage.getItem('topup_pending_payment')).not.toBeNull();

    // Ушёл — запись убрана.
    fireEvent.click(screen.getByRole('button'));
    await waitFor(() => expect(localStorage.getItem('topup_pending_payment')).toBeNull());
  });

  // 🔴 «Попробовать снова» уводило на ОБЗОР баланса: ни повтора, ни выбора способа, хотя
  // текст над кнопкой обещает ровно это. Ведёт на выбор способа и несёт адрес возврата,
  // чтобы после удачной оплаты человек попал к своей покупке, а не «на баланс».
  it('«Попробовать снова» ведёт к выбору способа и несёт адрес возврата', async () => {
    renderResult('?status=failed&returnTo=' + encodeURIComponent(CHECKOUT_RETURN));

    fireEvent.click(await screen.findByText('balance.topUpResult.tryAgain'));

    await waitFor(() =>
      expect(screen.getByTestId('location').textContent).toBe(
        '/balance/top-up?returnTo=' + encodeURIComponent(CHECKOUT_RETURN),
      ),
    );
  });

  // 🔴 Сумма недостачи обязана уехать вместе с человеком: набирая её заново, он ошибётся
  // в меньшую сторону и вернётся на кассу всё с тем же «не хватает».
  it('«Попробовать снова» несёт и сумму, когда она известна', async () => {
    seedPendingInfo(CHECKOUT_RETURN);
    vi.mocked(balanceApi.getPendingPayment).mockResolvedValue({
      ...pendingPayment(),
      status: 'canceled',
    });

    renderResult('?method=platega&status=failed');

    fireEvent.click(await screen.findByText('balance.topUpResult.tryAgain'));

    await waitFor(() =>
      expect(screen.getByTestId('location').textContent).toBe(
        '/balance/top-up?returnTo=' + encodeURIComponent(CHECKOUT_RETURN) + '&amount=60',
      ),
    );
  });

  it('без адреса возврата «Попробовать снова» ведёт к выбору способа без хвоста', async () => {
    renderResult('?status=failed');

    fireEvent.click(await screen.findByText('balance.topUpResult.tryAgain'));

    await waitFor(() => expect(screen.getByTestId('location').textContent).toBe('/balance/top-up'));
  });

  // 🔴 Сервер умеет отвечать НЕ про все способы оплаты: для части он отдаёт 404. Пока метка
  // в адресе выключала опрос, это было незаметно; после В-1 такой человек застрял бы в
  // спиннере на десять минут вместо мгновенного «Баланс пополнен». Слово провайдера обязано
  // снова становиться единственным, когда сервер ответить не смог.
  it('когда сервер не умеет ответить про этот платёж, слово провайдера снова в силе', async () => {
    seedPendingInfo(CHECKOUT_RETURN);
    vi.mocked(balanceApi.getPendingPayment).mockRejectedValue(new Error('404'));

    renderResult('?method=platega&status=success');

    // Запрос настроен на две повторные попытки с растущей паузой, поэтому ждём дольше
    // обычного: сторож обязан дожидаться момента, когда сервер ОКОНЧАТЕЛЬНО не ответил,
    // а не первой неудачи.
    await screen.findByText('balance.topUpResult.success', undefined, { timeout: 15000 });
    // И память при этом НЕ гасим: сервер ничего не подтверждал.
    expect(localStorage.getItem('topup_pending_payment')).not.toBeNull();
  }, 20000);

  // 🔴 Второй конец шкалы: пока сервер ещё отвечает «ждём», слово адреса силы не имеет.
  it('пока сервер отвечает, слово адреса силы не имеет', async () => {
    seedPendingInfo(CHECKOUT_RETURN);
    vi.mocked(balanceApi.getPendingPayment).mockResolvedValue(pendingPayment());

    renderResult('?method=platega&status=success');

    await waitFor(() => expect(balanceApi.getPendingPayment).toHaveBeenCalled());
    await settle();
    expect(screen.queryByText('balance.topUpResult.success')).toBeNull();
  });

  // 🔴 Телефон вибрировал «ошибкой» на платёж, который ПРОШЁЛ. Ветка самокоррекции появилась
  // в этом же этапе: провайдер уводит на «отказ», сервер потом подтверждает оплату, экран
  // переключается на успех — а замок хаптика был уже поставлен, и вибрация успеха молчала.
  it('вибрирует успехом, когда экран сам себя поправил с отказа на оплату', async () => {
    seedPendingInfo(CHECKOUT_RETURN);
    vi.mocked(balanceApi.getPendingPayment).mockResolvedValue(paidPayment());

    renderResult('?method=platega&status=failed');

    await screen.findByText('balance.topUpResult.success');
    await waitFor(() => expect(hapticNotification).toHaveBeenCalledWith('success'));
  });

  // 🔴 Второй конец шкалы: успех не вибрирует ДВАЖДЫ, а отказ, оставшийся отказом, вибрирует
  // ошибкой ровно один раз. Проверка «успех был» одна прошла бы и у кода без замка вовсе.
  it('на подтверждённом отказе вибрирует ошибкой один раз и успехом не вибрирует', async () => {
    seedPendingInfo(CHECKOUT_RETURN);
    vi.mocked(balanceApi.getPendingPayment).mockResolvedValue({
      ...pendingPayment(),
      status: 'canceled',
    });

    renderResult('?method=platega&status=failed');

    await screen.findByText('balance.topUpResult.failed');
    await settle();
    expect(hapticNotification).toHaveBeenCalledWith('error');
    expect(hapticNotification).not.toHaveBeenCalledWith('success');
    expect(hapticNotification).toHaveBeenCalledTimes(1);
  });

  // 🔴 Экран «Дольше, чем обычно» был ФИЗИЧЕСКИ НЕДОСТИЖИМ: проверка десяти минут стояла НИЖЕ
  // раннего выхода «ответа ещё нет», и пока сервер не ответил ни разу, срок не наступал никогда.
  // Человек оставался в спиннере без конца и без кнопки «Повторить». Сторож промотывает
  // столько времени, сколько проходит В ЖИЗНИ, — проверка на удобных 100 мс прошла бы и у
  // сломанного кода.
  it('после десяти минут молчания сервера показывает выход, а не вечный спиннер', async () => {
    vi.useFakeTimers();
    try {
      vi.mocked(balanceApi.getLatestPayment).mockRejectedValue(new Error('нет ответа'));
      renderResult('?method=platega');

      // Одиннадцать минут: больше порога в десять, но без запаса «на всякий случай».
      await vi.advanceTimersByTimeAsync(11 * 60 * 1000);

      expect(screen.getByText('balance.topUpResult.timeout')).toBeTruthy();
      expect(screen.getByText('common.retry')).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });

  // 🔴 ПОЙМАНО ЖИВЫМ ПРОХОДОМ ВЛАДЕЛЬЦА 24.08.2026, 20:38. На экране «Баланс пополнен» кнопка
  // САМА поменялась с «Вернуться к покупке» на «Перейти к балансу» — то есть человек, дошедший
  // до конца, потерял дорогу к своей покупке, стоя на месте. Причина: экран перемонтировался,
  // а память о пополнении к этому моменту уже была стёрта эффектом исхода. Сумма при этом
  // осталась (её отдаёт сервер), а адрес возврата сервер не знает — отсюда и подмена подписи.
  it('переживает перемонтирование: адрес возврата не теряется после подтверждения оплаты', async () => {
    seedPendingInfo(CHECKOUT_RETURN);
    vi.mocked(balanceApi.getPendingPayment).mockResolvedValue(paidPayment());

    const first = renderResult('?method=platega&status=success');
    await screen.findByText('balance.topUpResult.success');
    expect(screen.getByRole('button').textContent).toBe('balance.topUpResult.backToOrder');
    await settle();
    first.unmount();

    // Второе монтирование — то же самое, что видел владелец на седьмом скриншоте.
    renderResult('?method=platega&status=success');
    await screen.findByText('balance.topUpResult.success');
    expect(screen.getByRole('button').textContent).toBe('balance.topUpResult.backToOrder');
  });

  // 🔴 Касса берёт баланс СВОИМ запросом. Без гашения этого кэша вернувшийся видит первым кадром
  // старый баланс и прежнее «не хватает» — ровно то, ради чего уходил платить.
  //
  // 🔴 ЭТАП РЕК-3 УСИЛИЛ ЭТОТ СТОРОЖ, И ВОТ ПОЧЕМУ. Прежняя редакция проверяла ПОМЕТКУ
  // (`isInvalidated`), и она была зелёной на коде, который беду НЕ лечит: `invalidateQueries`
  // перезапрашивает только АКТИВНЫЕ запросы, а кассы в этот момент на экране нет — запись
  // остаётся в кэше и отдаётся на следующем монтировании синхронно. Пока приземление вело на
  // экран выбора, старый баланс был невиден (там его не печатают). С приземлением РЕК-3 на
  // подтверждение тот же кадр стал денежным: «Не хватает N» и залитая кнопка «Доплатить N» —
  // на сумму, которую человек только что заплатил. Три линзы ревью нашли это независимо, одна
  // воспроизвела прогоном. Поэтому сторож проверяет теперь ИСХОД, а не механизм: записи в
  // кэше не осталось, значит нарисовать старые деньги физически не из чего.
  it('сносит кэш кассы, иначе вернувшийся увидит старый баланс', async () => {
    const { queryClient } = renderResult(
      '?status=success&returnTo=' + encodeURIComponent(CHECKOUT_RETURN),
      (client) => client.setQueryData(['device-first-options'], { balance_kopeks: 0 }),
    );

    await waitFor(() => expect(queryClient.getQueryData(['device-first-options'])).toBeUndefined());
  });
});

describe('TopUpResult — экран перестаёт врать про деньги (этап ДВ-3, мина IC)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    localStorage.clear();
  });
  afterEach(cleanup);

  /** Оплаченный счёт с вердиктом бота про оставшийся шаг. */
  function paidWithVerdict(purchaseStepPending: boolean | undefined): PendingPayment {
    return { ...paidPayment(), purchase_step_pending: purchaseStepPending };
  }

  // 🔴 ГЛАВНЫЙ СТОРОЖ ПОРЯДКА ВЫКЛАДКИ. Кабинет уезжает на боевой ПЕРВЫМ и сутки живёт против
  // старого бота, который поля не отдаёт вовсе. Молчание в этом случае — не вежливость, а
  // защита: обещать оставшийся шаг тому, за кого деньги потратит автопокупка или автоплатёж,
  // значит толкнуть человека купить ВТОРОЙ период поверх оплаченного.
  it('без поля от бота показывает ПРЕЖНИЙ текст и не заводит новой кнопки', async () => {
    seedPendingInfo(null);
    vi.mocked(balanceApi.getPendingPayment).mockResolvedValue(paidWithVerdict(undefined));

    renderResult('?method=platega&status=success');
    await screen.findByText('balance.topUpResult.success');
    await settle();

    expect(screen.getByText('balance.topUpResult.successDesc')).toBeTruthy();
    expect(screen.queryByText('balance.topUpResult.purchaseStepPending')).toBeNull();
    // Точное число, а не «больше нуля»: так ловится собственное непонимание экрана.
    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(1);
    expect(buttons[0].textContent).toBe('balance.topUpResult.goToBalance');
  });

  // 🔴 Молчит чат — молчит и экран. Вердикт один на две поверхности; если бы кабинет решал
  // сам, подписчик с запасом читал бы «оформите подписку» там, где бот справедливо молчит.
  it('когда бот молчит, экран оставляет прежний текст', async () => {
    seedPendingInfo(null);
    vi.mocked(balanceApi.getPendingPayment).mockResolvedValue(paidWithVerdict(false));

    renderResult('?method=platega&status=success');
    await screen.findByText('balance.topUpResult.success');
    await settle();

    expect(screen.getByText('balance.topUpResult.successDesc')).toBeTruthy();
    expect(screen.getAllByRole('button')).toHaveLength(1);
  });

  // 🔴 Ветка клиента 106: пополнил не из покупки, выхода к подписке не было вовсе.
  it('называет оставшийся шаг и даёт дверь к подписке тому, у кого её не было', async () => {
    seedPendingInfo(null);
    vi.mocked(balanceApi.getPendingPayment).mockResolvedValue(paidWithVerdict(true));

    renderResult('?method=platega&status=success');
    await screen.findByText('balance.topUpResult.successWithStep');
    await settle();

    expect(screen.getByText('balance.topUpResult.purchaseStepPending')).toBeTruthy();
    expect(screen.queryByText('balance.topUpResult.successDesc')).toBeNull();

    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(2);
    // Порядок значим: главной становится дверь к подписке, прежняя уходит второй и тихой.
    expect(buttons[0].textContent).toBe('balance.topUpResult.choosePlan');
    expect(buttons[1].textContent).toBe('balance.topUpResult.goToBalance');
  });

  // 🔴 Нашёл скептик волны 2 мутацией: я убрал условный класс у прежней кнопки — и все
  // 33 сторожа остались зелёными. Порядок в разметке они проверяли, а ИЕРАРХИЮ нет, то есть
  // «две одинаково яркие кнопки подряд» прошли бы мимо. Проверяем свойство: там, где рядом
  // появилась дверь к подписке, прежняя кнопка обязана перестать быть акцентной.
  it('рядом с дверью к подписке прежняя кнопка становится тихой', async () => {
    seedPendingInfo(null);
    vi.mocked(balanceApi.getPendingPayment).mockResolvedValue(paidWithVerdict(true));

    renderResult('?method=platega&status=success');
    await screen.findByText('balance.topUpResult.successWithStep');
    await settle();

    const [primary, secondary] = screen.getAllByRole('button');
    expect(primary.className).toContain('bg-accent-500');
    expect(secondary.className).not.toContain('bg-accent-500');
  });

  // 🔴 И обратная половина того же свойства: когда двери нет, единственная кнопка обязана
  // ОСТАТЬСЯ акцентной. Без этой проверки сторож выше проходил бы и на правке, которая
  // просто выкрасила все кнопки экрана в серое.
  it('без двери единственная кнопка остаётся акцентной', async () => {
    seedPendingInfo(null);
    vi.mocked(balanceApi.getPendingPayment).mockResolvedValue(paidWithVerdict(false));

    renderResult('?method=platega&status=success');
    await screen.findByText('balance.topUpResult.success');
    await settle();

    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(1);
    expect(buttons[0].className).toContain('bg-accent-500');
  });

  // 🔴 Дверь обязана ВЕСТИ туда, что обещает подпись. Проверяем действие, а не надпись:
  // подпись без перехода — это ровно та ложь, которую этап убирает.
  it('дверь к подписке действительно открывает экран покупки', async () => {
    seedPendingInfo(null);
    vi.mocked(balanceApi.getPendingPayment).mockResolvedValue(paidWithVerdict(true));

    renderResult('?method=platega&status=success');
    await screen.findByText('balance.topUpResult.successWithStep');
    await settle();

    fireEvent.click(screen.getAllByRole('button')[0]);

    await waitFor(() =>
      expect(screen.getByTestId('location').textContent).toBe('/subscription/purchase'),
    );
  });

  // 🔴 Ветка, которую независимо назвали ТРИ линзы ревью: человек пришёл с обычного
  // покупочного экрана (метка `returnTo` есть, метки кассы нет). Двери к покупке тут
  // намеренно нет — тем же путём сюда попадает тот, кто шёл докупить устройства или трафик,
  // и предлагать ему подписку было бы подменой его же намерения. Проверяем ОБА утверждения
  // сразу: правду говорим, второй кнопки не рисуем, выход остаётся на Главную.
  it('пришедшему с обычной покупки говорит правду, но двери к тарифам не открывает', async () => {
    seedPendingInfo('/subscription/devices');
    vi.mocked(balanceApi.getPendingPayment).mockResolvedValue(paidWithVerdict(true));

    renderResult('?method=platega&status=success');
    await screen.findByText('balance.topUpResult.successWithStep');
    await settle();

    expect(screen.getByText('balance.topUpResult.purchaseStepPending')).toBeTruthy();
    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(1);
    expect(buttons[0].textContent).toBe('balance.topUpResult.goToHome');
  });

  // 🔴 Заголовок и галочка — те самые два элемента, которые клиент 106 прочитала как
  // «сделка закрыта». Сторож на подпись под ними не заметил бы, если бы заголовок остался
  // прежним: оговорка мелким шрифтом под жирным «Баланс пополнен!» — это не починка.
  it('меняет и ЗАГОЛОВОК, а не только подпись под ним', async () => {
    seedPendingInfo(null);
    vi.mocked(balanceApi.getPendingPayment).mockResolvedValue(paidWithVerdict(true));

    renderResult('?method=platega&status=success');
    await screen.findByText('balance.topUpResult.successWithStep');
    await settle();

    expect(screen.queryByText('balance.topUpResult.success')).toBeNull();
  });

  // 🔴 Второй двери там, где дверь уже есть, быть не должно. У пришедшего с кассы кнопка
  // «Вернуться к покупке» ведёт к его собственному выбору срока и устройств — увести его
  // на общий экран тарифов значило бы потерять то, что он уже набрал.
  it('пришедшему с кассы новой кнопки не рисует, но правду говорит', async () => {
    seedPendingInfo(CHECKOUT_RETURN);
    vi.mocked(balanceApi.getPendingPayment).mockResolvedValue(paidWithVerdict(true));

    renderResult('?method=platega&status=success');
    await screen.findByText('balance.topUpResult.successWithStep');
    await settle();

    expect(screen.getByText('balance.topUpResult.purchaseStepPending')).toBeTruthy();
    const buttons = screen.getAllByRole('button');
    expect(buttons).toHaveLength(1);
    expect(buttons[0].textContent).toBe('balance.topUpResult.backToOrder');
  });
});
