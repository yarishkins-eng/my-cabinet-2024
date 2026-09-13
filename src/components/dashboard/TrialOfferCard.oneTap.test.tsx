// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router';
import TrialOfferCard from './TrialOfferCard';
import type { Subscription, TrialInfo } from '../../types';

/**
 * ПТ-1 «Пробный период одним нажатием» (13.09.2026).
 *
 * До 03.08.2026 карточка активировала пробный сама; коммит `f0be4d8d` сделал кнопку ссылкой на
 * экран `/trial` с той же кнопкой, и человек нажимал «Активировать бесплатно» дважды. Забор от
 * активации поверх незавершённого счёта живёт на сервере (409), поэтому карточка снова
 * активирует сама — но только когда `trial-info` сказал, что мешать нечему.
 *
 * Роутер здесь настоящий (не мок `navigate`): сторожа смотрят на итоговый адрес и на то, куда
 * ведёт «назад» — форма истории и есть предмет проверки.
 */

const activateTrial = vi.fn();
vi.mock('@/api/subscription', () => ({
  subscriptionApi: {
    activateTrial: (...args: unknown[]) => activateTrial(...args),
    getTrialInfo: () => Promise.reject(new Error('not used here')),
  },
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));
vi.mock('../../hooks/useTheme', () => ({ useTheme: () => ({ isDark: true }) }));
vi.mock('../../hooks/useCurrency', () => ({
  useCurrency: () => ({ formatAmount: (value: number) => String(value), currencySymbol: '₽' }),
}));

const freeTrial: TrialInfo = {
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

// Число нарочно НЕ совпадает ни с одним умолчанием соседнего кода.
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
      <button type="button" onClick={() => navigate('/balance')}>
        PROBE_BALANCE
      </button>
    </div>
  );
}

function renderCard(trialInfo: TrialInfo, balanceKopeks = 0) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  // То, что знает Главная к моменту нажатия: инвалидацию этих ключей и проверяем как улику.
  queryClient.setQueryData(['trial-info'], trialInfo);
  queryClient.setQueryData(['subscription'], { subscription: null, has_subscription: false });
  queryClient.setQueryData(['subscriptions-list'], {
    subscriptions: [],
    multi_tariff_enabled: false,
  });
  render(
    <QueryClientProvider client={queryClient}>
      {/* Под Главной лежит ещё одна запись: «назад» с подключения обязан привести ровно на
          Главную, а не глубже. Сам `replace` на этом входе — подмена «/» на «/», здесь его
          не отличить от отсутствия; его доказывает тест `/trial` (вход с глубины 0). */}
      <MemoryRouter initialEntries={['/before', '/']} initialIndex={1}>
        <Probe />
        <Routes>
          <Route
            path="/"
            element={
              <TrialOfferCard
                trialInfo={trialInfo}
                balanceKopeks={balanceKopeks}
                balanceRubles={balanceKopeks / 100}
              />
            }
          />
          <Route path="/trial" element={<div>TRIAL_SCREEN</div>} />
          <Route path="/connection" element={<div>CONNECTION_SCREEN</div>} />
          <Route path="/balance" element={<div>BALANCE_SCREEN</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return queryClient;
}

const locationText = () => screen.getByTestId('location').textContent;
const activateButton = () => screen.getByRole('button', { name: 'subscription.trial.activate' });

beforeEach(() => {
  activateTrial.mockReset();
  try {
    localStorage.clear();
  } catch {
    /* jsdom без хранилища — подсказка тогда гасится в памяти */
  }
});
afterEach(() => cleanup());

describe('ПТ-1 · карточка активирует пробный одним нажатием', () => {
  it('ready: один POST с resolution=activate → экран подключения новой подписки', async () => {
    activateTrial.mockResolvedValue(createdTrial);
    const queryClient = renderCard(freeTrial);
    expect(locationText()).toBe('/');
    expect(queryClient.getQueryState(['subscription'])?.isInvalidated).toBe(false);

    fireEvent.click(activateButton());

    await waitFor(() => expect(locationText()).toBe('/connection?sub=4242'));
    expect(screen.getByText('CONNECTION_SCREEN')).toBeTruthy();
    expect(activateTrial).toHaveBeenCalledTimes(1);
    expect(activateTrial.mock.calls[0][0]).toMatchObject({
      resolution: 'activate',
      expectedCheckoutId: undefined,
    });
    expect(typeof activateTrial.mock.calls[0][0].idempotencyKey).toBe('string');
    // Знание Главной и списка подписок протухло: при возврате «назад» они перечитаются.
    await waitFor(() =>
      expect(queryClient.getQueryState(['subscription'])?.isInvalidated).toBe(true),
    );
    expect(queryClient.getQueryState(['subscriptions-list'])?.isInvalidated).toBe(true);
    // И оффер пробного тоже: иначе он залипает на Главной у человека с уже живым пробным.
    expect(queryClient.getQueryState(['trial-info'])?.isInvalidated).toBe(true);
  });

  it('discardable_quote: черновик без счёта не мешает — активируем прямо с карточки', async () => {
    activateTrial.mockResolvedValue(createdTrial);
    renderCard({ ...freeTrial, checkout_state: 'discardable_quote' });

    fireEvent.click(activateButton());

    await waitFor(() => expect(locationText()).toBe('/connection?sub=4242'));
    expect(activateTrial).toHaveBeenCalledTimes(1);
  });

  it('«назад» с экрана подключения ведёт на Главную, а не на экран пробного', async () => {
    activateTrial.mockResolvedValue(createdTrial);
    renderCard(freeTrial);
    fireEvent.click(activateButton());
    await waitFor(() => expect(locationText()).toBe('/connection?sub=4242'));

    fireEvent.click(screen.getByRole('button', { name: 'PROBE_BACK' }));

    await waitFor(() => expect(locationText()).toBe('/'));
    expect(screen.queryByText('TRIAL_SCREEN')).toBeNull();
    // Ещё одно «назад» — и только теперь запись, лежавшая под Главной.
    fireEvent.click(screen.getByRole('button', { name: 'PROBE_BACK' }));
    await waitFor(() => expect(locationText()).toBe('/before'));
  });

  it('после успеха подсказка «Подключить» для этой подписки погашена', async () => {
    activateTrial.mockResolvedValue(createdTrial);
    renderCard(freeTrial);
    expect(localStorage.getItem('app_device_hint_seen_4242')).toBeNull();

    fireEvent.click(activateButton());

    await waitFor(() => expect(locationText()).toBe('/connection?sub=4242'));
    expect(localStorage.getItem('app_device_hint_seen_4242')).toBe('true');
  });

  it.each([
    ['pending_invoice', { ...freeTrial, checkout_state: 'pending_invoice' as const }],
    [
      'reconciliation_required',
      { ...freeTrial, checkout_state: 'reconciliation_required' as const },
    ],
    ['без поля checkout_state', { ...freeTrial, checkout_state: undefined }],
  ])('%s: без запроса на сервер уводит на экран /trial с решением', async (_name, trialInfo) => {
    renderCard(trialInfo);

    fireEvent.click(activateButton());

    await waitFor(() => expect(locationText()).toBe('/trial'));
    expect(screen.getByText('TRIAL_SCREEN')).toBeTruthy();
    expect(activateTrial).not.toHaveBeenCalled();
  });

  it('второе нажатие, пока первый запрос в полёте, не создаёт второго POST', async () => {
    let finish: (value: Subscription) => void = () => {};
    activateTrial.mockImplementation(
      () =>
        new Promise<Subscription>((resolve) => {
          finish = resolve;
        }),
    );
    renderCard(freeTrial);

    const button = activateButton();
    fireEvent.click(button);
    fireEvent.click(button);
    // Кнопка гаснет только после планировщика react-query — третий тап ловит уже её `disabled`.
    await waitFor(() => expect(button.hasAttribute('disabled')).toBe(true));
    fireEvent.click(button);
    expect(screen.getByRole('button', { name: 'trialStart.activating' })).toBe(button);
    expect(activateTrial).toHaveBeenCalledTimes(1);

    await act(async () => {
      finish(createdTrial);
    });
    await waitFor(() => expect(locationText()).toBe('/connection?sub=4242'));
    expect(activateTrial).toHaveBeenCalledTimes(1);
  });
});

describe('ПТ-1 · человек ушёл с экрана, пока сервер думал', () => {
  it('ответ пришёл после ухода: без призрачного перехода, но пробный учтён', async () => {
    let finish: (value: Subscription) => void = () => {};
    activateTrial.mockImplementation(
      () =>
        new Promise<Subscription>((resolve) => {
          finish = resolve;
        }),
    );
    const queryClient = renderCard(freeTrial);

    fireEvent.click(activateButton());
    // Сервер ждёт панель до 10 с — человек нажал «Баланс» в нижней навигации.
    fireEvent.click(screen.getByRole('button', { name: 'PROBE_BALANCE' }));
    await waitFor(() => expect(locationText()).toBe('/balance'));

    await act(async () => {
      finish(createdTrial);
    });

    // Никуда не перебросило: он на балансе, куда шёл.
    await waitFor(() =>
      expect(queryClient.getQueryState(['subscription'])?.isInvalidated).toBe(true),
    );
    expect(locationText()).toBe('/balance');
    expect(screen.getByText('BALANCE_SCREEN')).toBeTruthy();
    // Но следы активации на месте: подсказка погашена, кэш Главной перечитается.
    expect(localStorage.getItem('app_device_hint_seen_4242')).toBe('true');
    expect(queryClient.getQueryState(['trial-info'])?.isInvalidated).toBe(true);
  });
});

describe('ПТ-1 · отказы сервера с карточки', () => {
  it('409: человек остаётся на Главной с сообщением, знание Главной перечитывается, ключ меняется', async () => {
    activateTrial
      .mockRejectedValueOnce(httpError(409, { code: 'pending_checkout_requires_resolution' }))
      .mockResolvedValueOnce(createdTrial);
    const queryClient = renderCard(freeTrial);
    expect(queryClient.getQueryState(['trial-info'])?.isInvalidated).toBe(false);

    fireEvent.click(activateButton());

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe('trialStart.orderChanged');
    expect(locationText()).toBe('/');
    expect(queryClient.getQueryState(['trial-info'])?.isInvalidated).toBe(true);
    expect(queryClient.getQueryState(['subscription'])?.isInvalidated).toBe(true);
    // В многотарифном режиме «подписки нет» судят по списку — его тоже перечитываем.
    expect(queryClient.getQueryState(['subscriptions-list'])?.isInvalidated).toBe(true);

    // Повтор идёт с НОВЫМ ключом идемпотентности: старый закреплён за отвергнутым запросом.
    await waitFor(() => expect(activateButton().hasAttribute('disabled')).toBe(false));
    fireEvent.click(activateButton());
    await waitFor(() => expect(activateTrial).toHaveBeenCalledTimes(2));
    expect(activateTrial.mock.calls[1][0].idempotencyKey).not.toBe(
      activateTrial.mock.calls[0][0].idempotencyKey,
    );
  });

  it('409 test_account_reset: показывается текст сервера, а не «заказ изменился»', async () => {
    activateTrial.mockRejectedValue(
      httpError(409, {
        code: 'test_account_reset',
        message: 'Тестовый аккаунт сейчас сбрасывается.',
      }),
    );
    renderCard(freeTrial);

    fireEvent.click(activateButton());

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe('Тестовый аккаунт сейчас сбрасывается.');
    expect(locationText()).toBe('/');
  });

  it('403: честный текст про ограничение аккаунта, а не «попробуйте ещё раз»', async () => {
    activateTrial.mockRejectedValue(httpError(403, { code: 'subscription_restricted' }));
    renderCard(freeTrial);

    fireEvent.click(activateButton());

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe('deviceFirst.errorRestricted');
    expect(locationText()).toBe('/');
  });

  it('403 с другим кодом (например, подписка на канал) — общий текст, не про ограничение аккаунта', async () => {
    activateTrial.mockRejectedValue(httpError(403, { code: 'channel_subscription_required' }));
    renderCard(freeTrial);

    fireEvent.click(activateButton());

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe('trialStart.activateError');
  });

  it('иной отказ: текст ошибки под кнопкой, кнопка снова жива, человек на Главной', async () => {
    activateTrial.mockRejectedValueOnce(httpError(500)).mockResolvedValueOnce(createdTrial);
    renderCard(freeTrial);

    fireEvent.click(activateButton());

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe('trialStart.activateError');
    expect(locationText()).toBe('/');
    await waitFor(() => expect(activateButton().hasAttribute('disabled')).toBe(false));

    // Повтор по совету текста работает: ошибка гаснет СРАЗУ, ещё до ответа, посадка на подключение.
    fireEvent.click(activateButton());
    expect(screen.queryByRole('alert')).toBeNull();
    await waitFor(() => expect(locationText()).toBe('/connection?sub=4242'));
    expect(activateTrial).toHaveBeenCalledTimes(2);
    // Ключ идемпотентности НЕ сменился: сервер мог уже выполнить первый запрос, и повтор с тем
    // же ключом — безопасный реплей, а не вторая активация. Меняется он только после 409.
    expect(activateTrial.mock.calls[1][0].idempotencyKey).toBe(
      activateTrial.mock.calls[0][0].idempotencyKey,
    );
  });
});

describe('ПТ-1 · платный пробный не тронут', () => {
  const paidTrial: TrialInfo = {
    ...freeTrial,
    requires_payment: true,
    price_kopeks: 9900,
    price_rubles: 99,
  };

  it('хватает баланса: ссылка на экран /trial, без прямой активации', () => {
    renderCard(paidTrial, 10_000);
    const link = screen.getByRole('link', { name: 'subscription.trial.payAndActivate' });
    expect(link.getAttribute('href')).toBe('/trial');
    expect(screen.queryByRole('button', { name: 'subscription.trial.activate' })).toBeNull();
  });

  it('не хватает баланса: ссылка на пополнение', () => {
    renderCard(paidTrial, 100);
    const link = screen.getByRole('link', { name: 'subscription.trial.topUpToActivate' });
    expect(link.getAttribute('href')).toBe('/balance');
    expect(activateTrial).not.toHaveBeenCalled();
  });
});
