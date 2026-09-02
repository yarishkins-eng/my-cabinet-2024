// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router';

const { list, stop } = vi.hoisted(() => ({ list: vi.fn(), stop: vi.fn() }));

vi.mock('../api/adminBroadcasts', () => ({
  adminBroadcastsApi: { list, stop },
}));

const confirmDialog = vi.fn();

vi.mock('../platform/hooks/usePlatform', () => ({
  // РС-14д: «Стоп» стал необратимым действием с подтверждением, поэтому фейку платформы
  // теперь нужен и диалог — без него хук подтверждения падает на пустом `dialog`.
  usePlatform: () => ({
    capabilities: { hasBackButton: true, hasNativeDialogs: false },
    dialog: { confirm: confirmDialog, alert: vi.fn(), popup: vi.fn() },
  }),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

import AdminBroadcasts from './AdminBroadcasts';

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <AdminBroadcasts />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

async function settle() {
  // Негативная проверка проходит мгновенно и на пустом экране, поэтому ей нужен
  // прокрут нескольких тиков: иначе она подтверждает «не вызвано» до того, как могло быть вызвано.
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  list.mockReset();
  stop.mockReset();
  confirmDialog.mockReset();
  confirmDialog.mockResolvedValue(true);
  list.mockResolvedValue({
    total: 3,
    limit: 20,
    offset: 0,
    items: [
      {
        id: 17,
        target_type: 'custom_week',
        target_label: 'Регистрация за неделю',
        message_text: 'Контрольная рассылка',
        has_media: false,
        media_type: null,
        total_count: 10,
        sent_count: 3,
        failed_count: 0,
        blocked_count: 0,
        status: 'in_progress',
        progress_percent: 30,
        category: 'news',
        created_at: '2026-08-29T20:00:00Z',
        completed_at: null,
      },
      {
        id: 18,
        target_type: 'all',
        target_label: 'Все активные с Telegram',
        message_text: 'Останавливается',
        has_media: false,
        media_type: null,
        total_count: 10,
        sent_count: 4,
        failed_count: 0,
        blocked_count: 0,
        status: 'cancelling',
        progress_percent: 40,
        category: 'system',
        created_at: '2026-08-29T20:01:00Z',
        completed_at: null,
      },
      {
        id: 19,
        target_type: 'tariff_17',
        target_label: 'Тариф «Премиум»',
        message_text: 'Завершена',
        has_media: false,
        media_type: null,
        total_count: 20,
        sent_count: 12,
        failed_count: 2,
        blocked_count: 6,
        status: 'partial',
        progress_percent: 100,
        category: 'promo',
        created_at: '2026-08-29T20:02:00Z',
        completed_at: '2026-08-29T20:03:00Z',
      },
    ],
  });
  stop.mockResolvedValue({ id: 17, status: 'cancelling' });
});

afterEach(cleanup);

describe('РС-12: история рассылок', () => {
  it('показывает понятную аудиторию и категорию и даёт остановить с карточки', async () => {
    renderPage();

    expect(await screen.findByText('Регистрация за неделю')).toBeTruthy();
    expect(screen.queryByText('custom_week')).toBeNull();
    expect(screen.getByText('admin.broadcasts.categoryNews')).toBeTruthy();
    expect(screen.getByText('Тариф «Премиум»')).toBeTruthy();
    expect(screen.getByText(/admin\.broadcasts\.completedAt:/)).toBeTruthy();
    expect(screen.getByText(/12\/20/)).toBeTruthy();
    expect(screen.getByText(/6 admin\.broadcasts\.blockedShort/)).toBeTruthy();
    expect(screen.getByText(/2 admin\.broadcasts\.failedShort/)).toBeTruthy();

    const stopButtons = screen.getAllByRole('button', { name: 'admin.broadcasts.stop' });
    expect(stopButtons).toHaveLength(2);
    expect((stopButtons[1] as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(stopButtons[0]);
    await waitFor(() => expect(stop.mock.calls[0]?.[0]).toBe(17));
  });

  it('РС-14д: «Стоп» в ленте не срабатывает без подтверждения', async () => {
    renderPage();
    await screen.findByText('Регистрация за неделю');

    confirmDialog.mockResolvedValueOnce(false);
    fireEvent.click(screen.getAllByRole('button', { name: 'admin.broadcasts.stop' })[0]);

    await waitFor(() => expect(confirmDialog).toHaveBeenCalledTimes(1));
    // Улика, что момент прошёл: диалог отработал, а остановка так и не ушла.
    await settle();
    expect(stop).not.toHaveBeenCalled();
  });

  it('РС-14д: после согласия остановка уходит — забор не запирает кнопку насовсем', async () => {
    renderPage();
    await screen.findByText('Регистрация за неделю');

    confirmDialog.mockResolvedValueOnce(true);
    fireEvent.click(screen.getAllByRole('button', { name: 'admin.broadcasts.stop' })[0]);

    await waitFor(() => expect(stop).toHaveBeenCalled());
    expect(stop.mock.calls[0][0]).toBe(17);
  });
});
