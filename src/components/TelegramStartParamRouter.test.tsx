// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';

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

function renderRouter() {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <TelegramStartParamRouter />
      <LocationProbe />
      <Routes>
        <Route path="*" element={null} />
      </Routes>
    </MemoryRouter>,
  );
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
  beforeEach(() => vi.clearAllMocks());
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
