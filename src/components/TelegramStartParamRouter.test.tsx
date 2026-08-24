// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StrictMode } from 'react';
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router';

import { TelegramStartParamRouter } from './TelegramStartParamRouter';
import { resolveStartParamPath } from '../utils/telegramStartParam';

// 🔴 Этап В-1. Возврат из банка кнопкой платёжной системы — единственная дверь, на которой
// человек не может помочь себе сам: он в ЧУЖОМ браузере, где он не авторизован. Всё, что
// доезжает обратно, — короткая метка запуска Телеграма. Сторожа на неё до этого файла не было.

const retrieveLaunchParams = vi.hoisted(() => vi.fn());
vi.mock('@telegram-apps/sdk-react', () => ({ retrieveLaunchParams }));

function LocationProbe() {
  const location = useLocation();
  return <output data-testid="location">{location.pathname + location.search}</output>;
}

/** Кнопка, которой человек уходит с экрана результата своими руками. */
function LeaveButton() {
  const navigate = useNavigate();
  return (
    <button type="button" onClick={() => navigate('/referral')}>
      уйти
    </button>
  );
}

// 🔴 `StrictMode` — не украшение: он включён в `main.tsx`, и React исполняет каждый эффект
// ДВАЖДЫ. Проверять приземление вне него значит проверять условие, которого на боевом нет.
function renderRouter() {
  return render(
    <StrictMode>
      <MemoryRouter initialEntries={['/']}>
        <TelegramStartParamRouter />
        <LocationProbe />
        <LeaveButton />
        <Routes>
          <Route path="*" element={null} />
        </Routes>
      </MemoryRouter>
    </StrictMode>,
  );
}

/** Довести приложение до состояния, когда эффектам уже нечего ждать. */
async function settle() {
  for (let tick = 0; tick < 3; tick += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

describe('resolveStartParamPath — разбор метки запуска', () => {
  // Адрес зашит ЛИТЕРАЛОМ: сторож, собирающий ожидание тем же выражением, что и код,
  // доказывает только сам себя.
  it('успешное пополнение приземляет на экран результата', () => {
    expect(resolveStartParamPath('tup-platega-ok')).toBe(
      '/balance/top-up/result?method=platega&status=success',
    );
  });

  it('отказ приземляет туда же, но со своим исходом', () => {
    expect(resolveStartParamPath('tup-platega-fail')).toBe(
      '/balance/top-up/result?method=platega&status=failed',
    );
  });

  it('способ с подчёркиванием разбирается — такие имена сервер выдаёт', () => {
    expect(resolveStartParamPath('tup-telegram_stars-ok')).toBe(
      '/balance/top-up/result?method=telegram_stars&status=success',
    );
  });

  // ─────────────────────────────────────────────────────────────────────────────
  // 🔴 Вторая метка: возврат с ПРЯМОЙ оплаты картой. Заведена по решению владельца 24.08 —
  // до неё этап чинил дверь только тому, у кого на балансе есть деньги (145 из 285).
  // ─────────────────────────────────────────────────────────────────────────────

  // Номер заказа — настоящий `uuid4`, с дефисами: ровно на нём ломалась бы метка, собранная
  // через тот же разделитель, что у пополнения.
  const ORDER = '550e8400-e29b-41d4-a716-446655440000';

  it('успешная оплата картой возвращает человека НА ЕГО ЗАКАЗ', () => {
    expect(resolveStartParamPath(`co_${ORDER}_ok`)).toBe(
      `/subscription/purchase?checkout=${ORDER}`,
    );
  });

  it('неудачная оплата картой возвращает туда же и несёт исход', () => {
    expect(resolveStartParamPath(`co_${ORDER}_fail`)).toBe(
      `/subscription/purchase?checkout=${ORDER}&payment=failed`,
    );
  });

  // 🔴 Две метки не должны перехватывать друг друга: разделители у них разные намеренно.
  it('метки двух дорог не путаются между собой', () => {
    expect(resolveStartParamPath(`tup_platega_ok`)).toBeNull();
    expect(resolveStartParamPath(`co-${ORDER}-ok`)).toBeNull();
  });

  it.each([
    ['без исхода', `co_${ORDER}`],
    ['неизвестный исход', `co_${ORDER}_maybe`],
    ['номер с подчёркиванием', 'co_550e8400_e29b_ok'],
    ['попытка подставить адрес', `co_${ORDER}_ok/../../evil`],
    ['пустой номер', 'co__ok'],
  ])('чужую или кривую метку заказа не трогает: %s', (_name, raw) => {
    expect(resolveStartParamPath(raw)).toBeNull();
  });

  // 🔴 Метка приезжает СНАРУЖИ. Всё, что не наша грамматика, обязано остаться чужим: метки
  // заводят и другие механизмы, и молча угонять их приземление нельзя.
  it.each([
    ['пусто', ''],
    ['чужая метка', 'admin_ticket_17'],
    ['без исхода', 'tup-platega'],
    ['неизвестный исход', 'tup-platega-maybe'],
    ['способ с точкой', 'tup-plate.ga-ok'],
    ['заглавные в способе', 'tup-Platega-ok'],
    ['лишний хвост', 'tup-platega-ok-extra'],
    ['попытка подставить адрес', 'tup-platega-ok/../../evil'],
  ])('не трогает: %s', (_name, raw) => {
    expect(resolveStartParamPath(raw)).toBeNull();
  });

  it('не трогает пустое значение', () => {
    expect(resolveStartParamPath(null)).toBeNull();
    expect(resolveStartParamPath(undefined)).toBeNull();
  });
});

describe('TelegramStartParamRouter — приземление после возврата из банка', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
  });
  afterEach(cleanup);

  it('по метке возврата уводит на экран результата', async () => {
    retrieveLaunchParams.mockReturnValue({ tgWebAppStartParam: 'tup-platega-ok' });

    renderRouter();

    await waitFor(() =>
      expect(screen.getByTestId('location').textContent).toBe(
        '/balance/top-up/result?method=platega&status=success',
      ),
    );
  });

  // 🔴 Второй конец шкалы. Проверка «уводит по метке» одна прошла бы и у кода, который уводит
  // ВСЕГДА: надо убедиться, что без метки человек остаётся там, где открыл приложение.
  it('без метки не трогает человека', async () => {
    retrieveLaunchParams.mockReturnValue({});

    renderRouter();

    // Даём эффекту отработать, а не проверяем мгновенно: мгновенная проверка прошла бы и у
    // кода, который уводит с задержкой в один тик.
    await waitFor(() => expect(retrieveLaunchParams).toHaveBeenCalled());
    expect(screen.getByTestId('location').textContent).toBe('/');
  });

  // 🔴 Метка живёт в параметрах запуска ВСЮ сессию, а не гаснет после первого чтения. Без
  // замка «один раз за запуск» повторное срабатывание эффекта выдёргивало бы человека обратно
  // на экран результата с того места, куда он ушёл сам.
  it('уведя один раз, больше не выдёргивает человека обратно', async () => {
    retrieveLaunchParams.mockReturnValue({ tgWebAppStartParam: 'tup-platega-ok' });

    renderRouter();
    await waitFor(() =>
      expect(screen.getByTestId('location').textContent).toBe(
        '/balance/top-up/result?method=platega&status=success',
      ),
    );

    fireEvent.click(screen.getByText('уйти'));
    // Ждём не мгновенно: проверка сразу после клика прошла бы и у кода, который выдёргивает
    // человека обратно на следующем тике.
    await settle();

    expect(screen.getByTestId('location').textContent).toBe('/referral');
  });

  // 🔴 Метка не гаснет после прочтения: SDK держит параметры запуска в sessionStorage и
  // достаёт их снова после ПЕРЕЗАГРУЗКИ страницы. А перезагрузка здесь бывает сама собой:
  // `lazyWithRetry` зовёт `window.location.reload()`, когда после выкладки не догрузился
  // кусок кода. Без второго замка человека выдернуло бы из корзины обратно на экран
  // результата — и `replace` стёр бы корзину из истории.
  it('после перезагрузки страницы НЕ уводит второй раз', async () => {
    retrieveLaunchParams.mockReturnValue({ tgWebAppStartParam: 'tup-platega-ok' });

    const first = renderRouter();
    await waitFor(() =>
      expect(screen.getByTestId('location').textContent).toBe(
        '/balance/top-up/result?method=platega&status=success',
      ),
    );
    // Перезагрузка: живой компонент умирает, sessionStorage переживает — как в жизни.
    first.unmount();

    renderRouter();
    await waitFor(() => expect(retrieveLaunchParams).toHaveBeenCalledTimes(2));
    await settle();
    expect(screen.getByTestId('location').textContent).toBe('/');
  });

  // 🔴 Второй конец шкалы: замок держит ИМЕННО прочитанную метку. Новое пополнение в том же
  // запуске обязано приземлиться — иначе замок превратился бы в глушилку.
  it('НОВУЮ метку в том же запуске отрабатывает', async () => {
    retrieveLaunchParams.mockReturnValue({ tgWebAppStartParam: 'tup-platega-ok' });
    const first = renderRouter();
    await waitFor(() =>
      expect(screen.getByTestId('location').textContent).toContain('status=success'),
    );
    first.unmount();

    retrieveLaunchParams.mockReturnValue({ tgWebAppStartParam: 'tup-platega-fail' });
    renderRouter();

    await waitFor(() =>
      expect(screen.getByTestId('location').textContent).toBe(
        '/balance/top-up/result?method=platega&status=failed',
      ),
    );
  });

  it('чужую метку не перехватывает', async () => {
    retrieveLaunchParams.mockReturnValue({ tgWebAppStartParam: 'admin_ticket_17' });

    renderRouter();

    await waitFor(() => expect(retrieveLaunchParams).toHaveBeenCalled());
    expect(screen.getByTestId('location').textContent).toBe('/');
  });

  // Вне Телеграма чтения параметров запуска не существует — оно БРОСАЕТ. Экран обязан пережить.
  it('вне Телеграма не падает', async () => {
    retrieveLaunchParams.mockImplementation(() => {
      throw new Error('not in telegram');
    });

    expect(() => renderRouter()).not.toThrow();
    await waitFor(() => expect(retrieveLaunchParams).toHaveBeenCalled());
    expect(screen.getByTestId('location').textContent).toBe('/');
  });
});
