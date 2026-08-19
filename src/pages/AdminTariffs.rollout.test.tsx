// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router';
import { PlatformProvider } from '../platform';

/**
 * 🔴 Пункт 3.2. Раскатка серверов на выданные подписки — операция, которая трогает
 * ВСЕХ действующих клиентов тарифа разом. Сторожим не «есть ли кнопка на экране»
 * (урок 18.08: экран открывается и у мёртвой кнопки), а что НАЖАТИЕ доводит дело
 * до конца: сухой прогон → числа перед глазами → подтверждение → раскатка.
 */

// vi.mock поднимается выше объявлений, поэтому моки заводим через vi.hoisted.
const {
  previewSquadRollout,
  runSquadRollout,
  restoreSquadRollout,
  confirmSpy,
  notifyError,
  notifySuccess,
  getTariffs,
} = vi.hoisted(() => ({
  previewSquadRollout: vi.fn(),
  runSquadRollout: vi.fn(),
  restoreSquadRollout: vi.fn(),
  confirmSpy: vi.fn(),
  notifyError: vi.fn(),
  notifySuccess: vi.fn(),
  getTariffs: vi.fn(),
}));

vi.mock('../api/tariffs', () => ({
  SQUAD_ROLLOUT_PORTION: 25,
  tariffsApi: {
    getTariffs,
    previewSquadRollout,
    runSquadRollout,
    restoreSquadRollout,
    deleteTariff: vi.fn(),
    toggleTariff: vi.fn(),
    toggleTrial: vi.fn(),
    updateOrder: vi.fn(),
  },
}));

// i18n в тестах не инициализирован и отдаёт ключи. Возвращаем ключ ВМЕСТЕ с
// параметрами: иначе нельзя проверить, что владельцу показали именно числа.
vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('react-i18next');
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, params?: Record<string, unknown>) =>
        params ? `${key} ${JSON.stringify(params)}` : key,
      i18n: { language: 'ru', changeLanguage: vi.fn() },
    }),
  };
});

vi.mock('@/platform', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('@/platform');
  return {
    ...actual,
    useDestructiveConfirm: () => confirmSpy,
    useNotify: () => ({ error: notifyError, success: notifySuccess, info: vi.fn() }),
  };
});

import AdminTariffs from './AdminTariffs';

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <PlatformProvider>
        <MemoryRouter>
          <AdminTariffs />
        </MemoryRouter>
      </PlatformProvider>
    </QueryClientProvider>,
  );
}

async function clickByTitle(match: RegExp) {
  const button = await waitFor(() => {
    const found = screen
      .getAllByRole('button')
      .find((el) => match.test(el.getAttribute('title') || ''));
    if (!found) throw new Error(`кнопка ${match} не найдена`);
    return found;
  });
  fireEvent.click(button);
  return button;
}

describe('кнопка раскатки серверов', () => {
  beforeEach(() => {
    for (const spy of [
      getTariffs,
      previewSquadRollout,
      runSquadRollout,
      restoreSquadRollout,
      confirmSpy,
      notifyError,
      notifySuccess,
    ]) {
      spy.mockReset();
    }
    getTariffs.mockResolvedValue({
      tariffs: [
        {
          id: 4,
          name: 'Team',
          is_active: true,
          is_trial_available: false,
          show_in_gift: false,
          is_daily: false,
          daily_price_kopeks: 0,
          traffic_limit_gb: 100,
          device_limit: 3,
          servers_count: 3,
          subscriptions_count: 30,
          display_order: 1,
          description: '',
        },
      ],
      total: 1,
    });
    confirmSpy.mockResolvedValue(true);
    previewSquadRollout.mockResolvedValue({
      tariff_id: 4,
      squads_to_set: ['de', 'nl', 'pl'],
      candidates: 30,
      would_change: 28,
      would_change_ids: [],
      skipped_traffic_risk_ids: [],
      shared_account_ids: [],
    });
    runSquadRollout.mockResolvedValue({
      tariff_id: 4,
      rollout_id: 'r1',
      total: 28,
      synced: 28,
      batches_done: 2,
      failed_ids: [],
      skipped_traffic_risk_ids: [],
      url_mismatch_ids: [],
      unrestorable_ids: [],
      shared_account_ids: [],
      moved_on_ids: [],
      remaining: 0,
      stopped_early: false,
      message: 'Готово: 28 из 28.',
    });
  });

  afterEach(cleanup);

  it('сначала считает сухим прогоном, и только потом спрашивает', async () => {
    renderPage();
    await clickByTitle(/^admin\.tariffs\.rolloutTitle$/);

    await waitFor(() => expect(previewSquadRollout).toHaveBeenCalledWith(4));
    await waitFor(() => expect(confirmSpy).toHaveBeenCalled());

    // Владелец обязан увидеть ЧИСЛА до нажатия, а не после.
    const shownText = String(confirmSpy.mock.calls[0][0]);
    expect(shownText).toContain('admin.tariffs.rolloutConfirmText');
    expect(shownText).toContain('"count":28');
    expect(shownText).toContain('"skipped":0');
    // Владелец должен знать, что за нажатие уедет ПОРЦИЯ, а не всё сразу.
    expect(shownText).toContain('"portion":25');

    await waitFor(() => expect(runSquadRollout).toHaveBeenCalledWith(4));
    expect(notifySuccess).toHaveBeenCalledWith('Готово: 28 из 28.');
  });

  it('пока операция идёт, на кнопке крутится индикатор', async () => {
    // Раскатка длится секунды-минуты; статичная затемнённая иконка неотличима
    // от зависшего экрана, а владелец в этот момент решает, жать ли ещё раз.
    let release: (value: unknown) => void = () => {};
    runSquadRollout.mockReturnValue(
      new Promise((resolve) => {
        release = resolve;
      }),
    );
    renderPage();
    // 🔴 Ищем индикатор ВНУТРИ самой кнопки раскатки: в ряду есть соседняя кнопка
    // со своим спиннером, и поиск по всему экрану был бы зелёным даже без нашего.
    const rolloutButton = await clickByTitle(/^admin\.tariffs\.rolloutTitle$/);

    await waitFor(() => expect(runSquadRollout).toHaveBeenCalled());
    await waitFor(() => expect(rolloutButton.querySelector('.animate-spin')).not.toBeNull());

    release({
      tariff_id: 4,
      rollout_id: 'r1',
      total: 1,
      synced: 1,
      batches_done: 1,
      failed_ids: [],
      skipped_traffic_risk_ids: [],
      url_mismatch_ids: [],
      unrestorable_ids: [],
      shared_account_ids: [],
      moved_on_ids: [],
      remaining: 0,
      stopped_early: false,
      message: 'Готово: 1 из 1.',
    });
    await waitFor(() => expect(rolloutButton.querySelector('.animate-spin')).toBeNull());
  });

  it('отказ владельца в диалоге ничего не раскатывает', async () => {
    confirmSpy.mockResolvedValue(false);
    renderPage();
    await clickByTitle(/^admin\.tariffs\.rolloutTitle$/);

    await waitFor(() => expect(confirmSpy).toHaveBeenCalled());
    expect(runSquadRollout).not.toHaveBeenCalled();
  });

  it('когда менять нечего — не спрашивает и не раскатывает', async () => {
    previewSquadRollout.mockResolvedValue({
      tariff_id: 4,
      squads_to_set: ['de'],
      candidates: 30,
      would_change: 0,
      would_change_ids: [],
      skipped_traffic_risk_ids: [],
      shared_account_ids: [],
    });
    renderPage();
    await clickByTitle(/^admin\.tariffs\.rolloutTitle$/);

    await waitFor(() => expect(previewSquadRollout).toHaveBeenCalled());
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(runSquadRollout).not.toHaveBeenCalled();
  });

  it('остановленную на полпути раскатку показывает ошибкой, а не успехом', async () => {
    runSquadRollout.mockResolvedValue({
      tariff_id: 4,
      rollout_id: 'r1',
      total: 28,
      synced: 4,
      batches_done: 1,
      failed_ids: [],
      skipped_traffic_risk_ids: [],
      url_mismatch_ids: [11, 12],
      unrestorable_ids: [],
      shared_account_ids: [],
      moved_on_ids: [],
      remaining: 24,
      stopped_early: true,
      message: 'Раскатка остановлена на полпути — проверьте отчёт ниже, снимок сохранён.',
    });
    renderPage();
    await clickByTitle(/^admin\.tariffs\.rolloutTitle$/);

    await waitFor(() => expect(notifyError).toHaveBeenCalled());
    expect(notifySuccess).not.toHaveBeenCalled();
  });

  it('причину отказа с сервера показывает словами, а не «status code 409»', async () => {
    previewSquadRollout.mockRejectedValue(
      new Error('У тарифа не выбрано ни одного сервера — раскатывать нечего.'),
    );
    renderPage();
    await clickByTitle(/^admin\.tariffs\.rolloutTitle$/);

    await waitFor(() =>
      expect(notifyError).toHaveBeenCalledWith(
        'У тарифа не выбрано ни одного сервера — раскатывать нечего.',
      ),
    );
  });

  it('невосстановимые подписки показываются ошибкой, а не зелёным «Готово»', async () => {
    runSquadRollout.mockResolvedValue({
      tariff_id: 4,
      rollout_id: 'r1',
      total: 5,
      synced: 3,
      batches_done: 1,
      failed_ids: [],
      skipped_traffic_risk_ids: [],
      url_mismatch_ids: [],
      unrestorable_ids: [8, 9],
      shared_account_ids: [],
      moved_on_ids: [],
      remaining: 0,
      stopped_early: false,
      message: 'Готово: 3 из 5. Нельзя вернуть (пустой снимок): 2.',
    });
    renderPage();
    await clickByTitle(/^admin\.tariffs\.rolloutTitle$/);

    await waitFor(() => expect(notifyError).toHaveBeenCalled());
    expect(notifySuccess).not.toHaveBeenCalled();
  });

  it('возврат по снимку спрашивает подтверждение и зовёт возврат', async () => {
    restoreSquadRollout.mockResolvedValue({
      tariff_id: 4,
      rollout_id: 'r1',
      total: 28,
      synced: 28,
      batches_done: 2,
      failed_ids: [],
      skipped_traffic_risk_ids: [],
      url_mismatch_ids: [],
      unrestorable_ids: [],
      shared_account_ids: [],
      moved_on_ids: [],
      remaining: 0,
      stopped_early: false,
      message: 'Готово: 28 из 28.',
    });
    renderPage();
    await clickByTitle(/^admin\.tariffs\.rolloutRestoreTitle$/);

    await waitFor(() => expect(confirmSpy).toHaveBeenCalled());
    await waitFor(() => expect(restoreSquadRollout).toHaveBeenCalledWith(4));
    // Возврат не должен молча запускать прямую раскатку.
    expect(runSquadRollout).not.toHaveBeenCalled();
  });
});

describe('тексты диалогов', () => {
  it('умещаются в лимит Telegram (256 символов) при любых числах', async () => {
    // 🔴 Диалог в Telegram — showPopup, у него жёсткий лимит 256 символов, при
    // превышении он не показывается вовсе и молча деградирует в системное окно.
    // Прошлая версия текста давала 258 символов ПРИ ЛЮБЫХ числах.
    const ru = (await import('../locales/ru.json')).default as Record<string, never>;
    const en = (await import('../locales/en.json')).default as Record<string, never>;
    for (const bundle of [ru, en]) {
      const tariffs = (bundle as never as { admin: { tariffs: Record<string, string> } }).admin
        .tariffs;
      for (const key of [
        'rolloutConfirmText',
        'rolloutRestoreConfirmText',
        'rolloutNothingToDo',
        'rolloutFailed',
      ]) {
        const filled = tariffs[key]
          .replace('{{count}}', '9999')
          .replace('{{skipped}}', '9999')
          .replace('{{portion}}', '9999');
        expect(filled.length, `${key}: ${filled.length} символов`).toBeLessThanOrEqual(256);
      }
    }
  });
});

describe('честность частичного результата', () => {
  beforeEach(() => {
    for (const spy of [
      getTariffs,
      previewSquadRollout,
      runSquadRollout,
      restoreSquadRollout,
      confirmSpy,
      notifyError,
      notifySuccess,
    ]) {
      spy.mockReset();
    }
    getTariffs.mockResolvedValue({
      tariffs: [
        {
          id: 4,
          name: 'Team',
          is_active: true,
          is_trial_available: false,
          show_in_gift: false,
          is_daily: false,
          daily_price_kopeks: 0,
          traffic_limit_gb: 100,
          device_limit: 3,
          servers_count: 3,
          subscriptions_count: 30,
          display_order: 1,
          description: '',
        },
      ],
      total: 1,
    });
    confirmSpy.mockResolvedValue(true);
    previewSquadRollout.mockResolvedValue({
      tariff_id: 4,
      squads_to_set: ['de'],
      candidates: 30,
      would_change: 28,
      would_change_ids: [],
      skipped_traffic_risk_ids: [],
      shared_account_ids: [],
    });
  });

  afterEach(cleanup);

  const partialCases: Array<[string, Record<string, number[]>]> = [
    ['трафик исчерпан', { skipped_traffic_risk_ids: [7, 9] }],
    ['вторая подписка у клиента', { shared_account_ids: [5] }],
    ['клиент сам сменил серверы', { moved_on_ids: [6] }],
    ['пустой снимок', { unrestorable_ids: [8] }],
    ['часть не удалась', { failed_ids: [4] }],
  ];

  it.each(partialCases)(
    '«%s» показывается ошибкой, а не зелёным «Готово»',
    async (_name, extra) => {
      runSquadRollout.mockResolvedValue({
        tariff_id: 4,
        rollout_id: 'r1',
        total: 28,
        synced: 26,
        batches_done: 2,
        failed_ids: [],
        skipped_traffic_risk_ids: [],
        url_mismatch_ids: [],
        unrestorable_ids: [],
        shared_account_ids: [],
        moved_on_ids: [],
        remaining: 0,
        stopped_early: false,
        message: 'Готово: 26 из 28.',
        ...extra,
      });
      renderPage();
      await clickByTitle(/^admin\.tariffs\.rolloutTitle$/);

      await waitFor(() => expect(notifyError).toHaveBeenCalled());
      expect(notifySuccess).not.toHaveBeenCalled();
    },
  );
});

describe('кнопка «Изменить» во время раскатки', () => {
  beforeEach(() => {
    for (const spy of [
      getTariffs,
      previewSquadRollout,
      runSquadRollout,
      restoreSquadRollout,
      confirmSpy,
      notifyError,
      notifySuccess,
    ]) {
      spy.mockReset();
    }
    getTariffs.mockResolvedValue({
      tariffs: [
        {
          id: 4,
          name: 'Team',
          is_active: true,
          is_trial_available: false,
          show_in_gift: false,
          is_daily: false,
          daily_price_kopeks: 0,
          traffic_limit_gb: 100,
          device_limit: 3,
          servers_count: 3,
          subscriptions_count: 30,
          display_order: 1,
          description: '',
        },
      ],
      total: 1,
    });
    confirmSpy.mockResolvedValue(true);
    previewSquadRollout.mockResolvedValue({
      tariff_id: 4,
      squads_to_set: ['de'],
      candidates: 30,
      would_change: 28,
      would_change_ids: [],
      skipped_traffic_risk_ids: [],
      shared_account_ids: [],
    });
  });

  afterEach(cleanup);

  it('гаснет, пока идёт операция — правка тарифа сорвала бы оставшиеся порции', async () => {
    let release: (value: unknown) => void = () => {};
    runSquadRollout.mockReturnValue(
      new Promise((resolve) => {
        release = resolve;
      }),
    );
    renderPage();
    await clickByTitle(/^admin\.tariffs\.rolloutTitle$/);
    await waitFor(() => expect(runSquadRollout).toHaveBeenCalled());

    const editButton = screen
      .getAllByRole('button')
      .find((el) => el.getAttribute('title') === 'admin.tariffs.edit');
    expect(editButton).toBeTruthy();
    expect((editButton as HTMLButtonElement).disabled).toBe(true);

    release({
      tariff_id: 4,
      rollout_id: 'r1',
      total: 1,
      synced: 1,
      batches_done: 1,
      failed_ids: [],
      skipped_traffic_risk_ids: [],
      url_mismatch_ids: [],
      unrestorable_ids: [],
      shared_account_ids: [],
      moved_on_ids: [],
      remaining: 0,
      stopped_early: false,
      message: 'Готово: 1 из 1.',
    });
    await waitFor(() => expect((editButton as HTMLButtonElement).disabled).toBe(false));
  });
});
