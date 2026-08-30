// @vitest-environment jsdom

/**
 * РС-14д, вторая половина: «Стоп» на карточке кампании тоже переспрашивает.
 *
 * Ревью нашло, что оба теста подтверждения жили в тесте ЛЕНТЫ, а карточка ехала без сети —
 * при том, что подтверждение туда добавлено тем же коммитом.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// vi.mock поднимается наверх файла, поэтому фабрики не видят обычных переменных.
const { get, stop, confirmDialog } = vi.hoisted(() => ({
  get: vi.fn(),
  stop: vi.fn(),
  confirmDialog: vi.fn(),
}));

vi.mock('../api/adminBroadcasts', () => ({
  adminBroadcastsApi: { get, stop },
}));

vi.mock('../platform/hooks/usePlatform', () => ({
  usePlatform: () => ({
    capabilities: { hasBackButton: true, hasNativeDialogs: false },
    dialog: { confirm: confirmDialog, alert: vi.fn(), popup: vi.fn() },
  }),
}));

vi.mock('../platform/hooks/useNativeDialog', () => ({
  useNativeDialog: () => ({ confirm: confirmDialog }),
  useDestructiveConfirm: () => confirmDialog,
}));

vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('react-i18next');
  return {
    ...actual,
    useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'ru' } }),
  };
});

import AdminBroadcastDetail from './AdminBroadcastDetail';

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/admin/broadcasts/17']}>
        <Routes>
          <Route path="/admin/broadcasts/:id" element={<AdminBroadcastDetail />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

async function settle() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  get.mockReset();
  stop.mockReset();
  confirmDialog.mockReset();
  confirmDialog.mockResolvedValue(true);
  get.mockResolvedValue({
    id: 17,
    target_type: 'custom_week',
    target_label: 'Регистрация за неделю',
    category: 'promo',
    message_text: 'Контрольная рассылка',
    status: 'in_progress',
    sent_count: 12,
    failed_count: 0,
    blocked_count: 0,
    total_count: 40,
    progress_percent: 30,
    created_at: '2026-08-30T10:00:00Z',
    completed_at: null,
    admin_name: 'owner',
    channel: 'telegram',
  });
});

afterEach(() => cleanup());

describe('РС-14д: остановка с карточки кампании', () => {
  it('без подтверждения кампания не останавливается', async () => {
    renderPage();
    await screen.findByRole('button', { name: /admin\.broadcasts\.stop/ });

    confirmDialog.mockResolvedValueOnce(false);
    fireEvent.click(screen.getByRole('button', { name: /admin\.broadcasts\.stop/ }));

    await waitFor(() => expect(confirmDialog).toHaveBeenCalledTimes(1));
    await settle();
    expect(stop).not.toHaveBeenCalled();
  });

  it('диалог называет, какую именно кампанию останавливаем', async () => {
    renderPage();
    await screen.findByRole('button', { name: /admin\.broadcasts\.stop/ });

    fireEvent.click(screen.getByRole('button', { name: /admin\.broadcasts\.stop/ }));

    await waitFor(() => expect(confirmDialog).toHaveBeenCalled());
    const message = confirmDialog.mock.calls[0][0] as string;
    expect(message).toContain('#17');
    expect(message).toContain('Регистрация за неделю');
    expect(message).toContain('12/40');
  });

  it('после согласия остановка уходит', async () => {
    renderPage();
    await screen.findByRole('button', { name: /admin\.broadcasts\.stop/ });

    fireEvent.click(screen.getByRole('button', { name: /admin\.broadcasts\.stop/ }));

    await waitFor(() => expect(stop).toHaveBeenCalled());
    expect(stop.mock.calls[0][0]).toBe(17);
  });
});
