// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router';
import TrialStart from './TrialStart';
import type { Subscription, TrialInfo } from '../types';

/**
 * ПТ-1 «Пробный период одним нажатием» (13.09.2026), вход из бота: кнопка «Попробовать бесплатно»
 * открывает `/trial` напрямую. Раньше после «Активировать бесплатно» человек попадал на Главную и
 * должен был сам найти «Подключить»; теперь — сразу на экран подключения новой подписки.
 * Экран висящего счёта остаётся: его кнопка «Начать пробный период» тоже приземляет на подключение.
 */

const activateTrial = vi.fn();
const getTrialInfo = vi.fn();
vi.mock('@/api/subscription', () => ({
  subscriptionApi: {
    activateTrial: (...args: unknown[]) => activateTrial(...args),
    getTrialInfo: () => getTrialInfo(),
  },
}));
vi.mock('@/api/balance', () => ({
  balanceApi: { getBalance: () => Promise.resolve({ balance_kopeks: 0, balance_rubles: 0 }) },
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('@/hooks/useCurrency', () => ({
  useCurrency: () => ({ formatAmount: (value: number) => String(value), currencySymbol: '₽' }),
}));

const readyTrial: TrialInfo = {
  is_available: true,
  duration_days: 3,
  traffic_limit_gb: 10,
  device_limit: 1,
  requires_payment: false,
  price_kopeks: 0,
  price_rubles: 0,
  reason_unavailable: null,
  checkout_state: 'ready',
  checkout: null,
};

const pendingInvoiceTrial: TrialInfo = {
  ...readyTrial,
  checkout_state: 'pending_invoice',
  checkout: {
    id: 'chk-public-77',
    tariff_name: 'Базовый',
    period_days: 30,
    device_limit: 2,
    amount_kopeks: 39900,
  },
};

const createdTrial = { id: 4242, status: 'active', is_trial: true } as unknown as Subscription;

function httpError(status: number, detail?: unknown) {
  return { response: { status, data: { detail } } };
}

function Probe() {
  const location = useLocation();
  const navigate = useNavigate();
  return (
    <div>
      <span data-testid="location">{location.pathname + location.search}</span>
      <button type="button" onClick={() => navigate(-1)}>
        PROBE_BACK
      </button>
    </div>
  );
}

// Вход как из бота: `/trial` — первая и единственная запись истории.
function renderTrialStart() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  // Знание Главной, лежащее в кэше к моменту активации, — улика для инвалидации после успеха.
  queryClient.setQueryData(['subscription'], { subscription: null, has_subscription: false });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/trial']}>
        <Probe />
        <Routes>
          <Route path="/" element={<div>HOME_SCREEN</div>} />
          <Route path="/trial" element={<TrialStart />} />
          <Route path="/connection" element={<div>CONNECTION_SCREEN</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return queryClient;
}

const locationText = () => screen.getByTestId('location').textContent;

beforeEach(() => {
  activateTrial.mockReset();
  getTrialInfo.mockReset();
});
afterEach(() => cleanup());

describe('ПТ-1 · экран /trial приземляет на подключение', () => {
  it('ready: «Активировать бесплатно» → один POST → /connection?sub=<id>, «назад» ведёт на Главную', async () => {
    getTrialInfo.mockResolvedValue(readyTrial);
    activateTrial.mockResolvedValue(createdTrial);
    const queryClient = renderTrialStart();
    const button = await screen.findByRole('button', { name: 'trialStart.activateFree' });
    const reads = getTrialInfo.mock.calls.length;

    fireEvent.click(button);

    await waitFor(() => expect(locationText()).toBe('/connection?sub=4242'));
    expect(screen.getByText('CONNECTION_SCREEN')).toBeTruthy();
    expect(activateTrial).toHaveBeenCalledTimes(1);
    expect(activateTrial.mock.calls[0][0]).toMatchObject({
      resolution: 'activate',
      expectedCheckoutId: undefined,
    });

    fireEvent.click(screen.getByRole('button', { name: 'PROBE_BACK' }));
    await waitFor(() => expect(locationText()).toBe('/'));
    expect(screen.getByText('HOME_SCREEN')).toBeTruthy();
    // Оффер пробного протух вместе с подпиской: экран перечитал `trial-info` после успеха
    // (у него живой наблюдатель — инвалидация видна как повторное чтение), а знание Главной
    // о подписке помечено протухшим — она не покажет оффер человеку с живым пробным.
    await waitFor(() => expect(getTrialInfo.mock.calls.length).toBeGreaterThan(reads));
    expect(queryClient.getQueryState(['subscription'])?.isInvalidated).toBe(true);
  });

  it('пока запрос летит: кнопка погашена и занята, второй тап не даёт второго POST', async () => {
    getTrialInfo.mockResolvedValue(readyTrial);
    let finish: (value: Subscription) => void = () => {};
    activateTrial.mockImplementation(
      () =>
        new Promise<Subscription>((resolve) => {
          finish = resolve;
        }),
    );
    renderTrialStart();
    const button = await screen.findByRole('button', { name: 'trialStart.activateFree' });

    fireEvent.click(button);
    fireEvent.click(button);
    await waitFor(() => expect(button.hasAttribute('disabled')).toBe(true));
    expect(button.getAttribute('aria-busy')).toBe('true');
    expect(screen.getByRole('button', { name: 'trialStart.activating' })).toBe(button);
    fireEvent.click(button);
    expect(activateTrial).toHaveBeenCalledTimes(1);

    await act(async () => {
      finish(createdTrial);
    });
    await waitFor(() => expect(locationText()).toBe('/connection?sub=4242'));
    expect(activateTrial).toHaveBeenCalledTimes(1);
  });

  it('висящий счёт: «Начать пробный период» шлёт abandon с id заказа и тоже сажает на подключение', async () => {
    getTrialInfo.mockResolvedValue(pendingInvoiceTrial);
    activateTrial.mockResolvedValue(createdTrial);
    renderTrialStart();

    expect(await screen.findByText('trialStart.unfinishedTitle')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'trialStart.startTrial' }));

    await waitFor(() => expect(locationText()).toBe('/connection?sub=4242'));
    expect(activateTrial).toHaveBeenCalledTimes(1);
    expect(activateTrial.mock.calls[0][0]).toMatchObject({
      resolution: 'abandon_pending_invoice',
      expectedCheckoutId: 'chk-public-77',
    });
  });

  it('reconciliation_required: активировать нечем, только обновить статус или поддержка', async () => {
    getTrialInfo.mockResolvedValue({ ...readyTrial, checkout_state: 'reconciliation_required' });
    renderTrialStart();

    expect(await screen.findByText('trialStart.checkingTitle')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'trialStart.activateFree' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'trialStart.startTrial' })).toBeNull();
    expect(activateTrial).not.toHaveBeenCalled();
  });
});

describe('ПТ-1 · отказы сервера на /trial', () => {
  it('409: текст «заказ изменился», экран перечитан, человек остаётся на /trial', async () => {
    getTrialInfo.mockResolvedValue(readyTrial);
    activateTrial.mockRejectedValue(
      httpError(409, { code: 'pending_checkout_requires_resolution' }),
    );
    renderTrialStart();
    const button = await screen.findByRole('button', { name: 'trialStart.activateFree' });
    const reads = getTrialInfo.mock.calls.length;

    fireEvent.click(button);

    expect((await screen.findByText('trialStart.orderChanged')).textContent).toBe(
      'trialStart.orderChanged',
    );
    expect(locationText()).toBe('/trial');
    await waitFor(() => expect(getTrialInfo.mock.calls.length).toBeGreaterThan(reads));
  });

  it('409 test_account_reset: показывается текст сервера', async () => {
    getTrialInfo.mockResolvedValue(readyTrial);
    activateTrial.mockRejectedValue(
      httpError(409, {
        code: 'test_account_reset',
        message: 'Тестовый аккаунт сейчас сбрасывается.',
      }),
    );
    renderTrialStart();

    fireEvent.click(await screen.findByRole('button', { name: 'trialStart.activateFree' }));

    expect(await screen.findByText('Тестовый аккаунт сейчас сбрасывается.')).toBeTruthy();
    expect(locationText()).toBe('/trial');
  });

  it('403: честный текст про ограничение аккаунта', async () => {
    getTrialInfo.mockResolvedValue(readyTrial);
    activateTrial.mockRejectedValue(httpError(403, { code: 'subscription_restricted' }));
    renderTrialStart();

    fireEvent.click(await screen.findByRole('button', { name: 'trialStart.activateFree' }));

    expect(await screen.findByText('deviceFirst.errorRestricted')).toBeTruthy();
    expect(locationText()).toBe('/trial');
  });

  it('иной отказ: общий текст, кнопка снова жива, повтор идёт с тем же ключом', async () => {
    getTrialInfo.mockResolvedValue(readyTrial);
    activateTrial.mockRejectedValueOnce(httpError(500)).mockResolvedValueOnce(createdTrial);
    renderTrialStart();

    fireEvent.click(await screen.findByRole('button', { name: 'trialStart.activateFree' }));

    // Ошибка объявляется скринридеру: блок с ролью alert, а не просто текст.
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe('trialStart.activateError');
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'trialStart.activateFree' }).hasAttribute('disabled'),
      ).toBe(false),
    );
    expect(locationText()).toBe('/trial');

    fireEvent.click(screen.getByRole('button', { name: 'trialStart.activateFree' }));
    await waitFor(() => expect(locationText()).toBe('/connection?sub=4242'));
    expect(activateTrial).toHaveBeenCalledTimes(2);
    expect(activateTrial.mock.calls[1][0].idempotencyKey).toBe(
      activateTrial.mock.calls[0][0].idempotencyKey,
    );
  });
});
