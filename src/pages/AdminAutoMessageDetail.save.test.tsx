// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes } from 'react-router';

const { get, patch } = vi.hoisted(() => ({ get: vi.fn(), patch: vi.fn() }));

vi.mock('../api/autoMessages', async () => {
  const actual = await vi.importActual<typeof import('../api/autoMessages')>('../api/autoMessages');
  return { ...actual, autoMessagesApi: { get, patch } };
});

vi.mock('../platform/hooks/usePlatform', () => ({
  usePlatform: () => ({
    capabilities: { hasBackButton: true, hasNativeDialogs: false },
    dialog: { confirm: vi.fn(), alert: vi.fn(), popup: vi.fn() },
  }),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

import AdminAutoMessageDetail from './AdminAutoMessageDetail';

const DETAIL = {
  id: 'return-wave2',
  group: 'return',
  title: 'Скидка на продление',
  when: 'На 2-й или 3-й день',
  control: 'toggle',
  enabled: true,
  state: 'live',
  quiet_reason: null,
  note: null,
  params: { discount_percent: 10, valid_hours: 24 },
  sent_count: 8,
  claimed_count: 3,
  claim_tracked: true,
  buttons: [{ label: '🎁 Получить скидку', target: 'Выдаёт скидку', tracked: true }],
  history: [],
  history_note: 'Строки исчезают при продлении',
};

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/admin/auto-messages/return-wave2']}>
        <Routes>
          <Route path="/admin/auto-messages/:id" element={<AdminAutoMessageDetail />} />
        </Routes>
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
    await Promise.resolve();
  });
}

describe('AdminAutoMessageDetail: черновик и сохранение', () => {
  beforeEach(() => {
    get.mockReset();
    patch.mockReset();
    get.mockResolvedValue(DETAIL);
  });
  afterEach(cleanup);

  it('изменение степпера НЕ уходит на сервер до «Сохранить»', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('Скидка на продление')).toBeTruthy());

    fireEvent.click(screen.getAllByLabelText('+')[0]);
    await settle();

    // Ровно тот недостаток чат-админки, ради которого экран и делается:
    // там число применяется вживую сразу, без подтверждения.
    expect(patch).not.toHaveBeenCalled();
    expect(screen.getByText('admin.autoMessages.save.action')).toBeTruthy();
  });

  it('«Сохранить» отправляет только изменённое поле', async () => {
    patch.mockResolvedValue({ ...DETAIL, params: { discount_percent: 15, valid_hours: 24 } });
    renderPage();
    await waitFor(() => expect(screen.getByText('Скидка на продление')).toBeTruthy());

    fireEvent.click(screen.getAllByLabelText('+')[0]);
    fireEvent.click(screen.getByText('admin.autoMessages.save.action'));
    await waitFor(() => expect(patch).toHaveBeenCalledTimes(1));

    expect(patch).toHaveBeenCalledWith('return-wave2', { discount_percent: 15 });
  });

  it('«Отменить» возвращает исходное значение и убирает кнопки', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('Скидка на продление')).toBeTruthy());

    fireEvent.click(screen.getAllByLabelText('+')[0]);
    await waitFor(() => expect(screen.getByText('admin.autoMessages.save.cancel')).toBeTruthy());

    fireEvent.click(screen.getByText('admin.autoMessages.save.cancel'));
    await settle();

    expect(screen.queryByText('admin.autoMessages.save.action')).toBeNull();
    expect(patch).not.toHaveBeenCalled();
  });

  it('отказ сервера показывается его словами и откатывает поле', async () => {
    patch.mockRejectedValue({
      isAxiosError: true,
      response: { data: { detail: 'Скидка сообщения не может быть больше 50%' } },
    });
    renderPage();
    await waitFor(() => expect(screen.getByText('Скидка на продление')).toBeTruthy());

    fireEvent.click(screen.getAllByLabelText('+')[0]);
    fireEvent.click(screen.getByText('admin.autoMessages.save.action'));

    await waitFor(() =>
      expect(screen.getByText('Скидка сообщения не может быть больше 50%')).toBeTruthy(),
    );
    // Поле вернулось к серверному значению — «сохранено» не показано.
    expect(screen.queryByText('admin.autoMessages.save.done')).toBeNull();
  });

  it('у кнопки письма честно написано, считается ли нажатие', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('🎁 Получить скидку')).toBeTruthy());
    expect(screen.getByText('admin.autoMessages.btn.tracked')).toBeTruthy();
  });
});
