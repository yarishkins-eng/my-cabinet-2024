// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import en from '../locales/en.json';
import ru from '../locales/ru.json';
const { get, patch, confirmOff } = vi.hoisted(() => ({
  get: vi.fn(),
  patch: vi.fn(),
  confirmOff: vi.fn(),
}));
vi.mock('../api/autoMessages', () => ({ autoMessagesApi: { get, patch } }));
vi.mock('react-router', async () => ({
  ...(await vi.importActual('react-router')),
  useParams: () => ({ id: 'trial-1d' }),
}));
vi.mock('../platform/hooks/useNativeDialog', () => ({ useDestructiveConfirm: () => confirmOff }));
vi.mock('../platform/hooks/usePlatform', () => ({
  usePlatform: () => ({ capabilities: { hasBackButton: true } }),
}));
import AdminAutoMessageDetail from './AdminAutoMessageDetail';
function card(fields: Record<string, unknown> = {}) {
  return {
    id: 'trial-1d',
    group: 'trial',
    title: 'Пробный закончится завтра',
    when: 'За день до конца',
    control: 'toggle',
    enabled: true,
    state: 'live',
    params: {},
    limits: {},
    buttons: [],
    history: [],
    history_note: '',
    ...fields,
  };
}
async function show(fields: Record<string, unknown> = {}, language = 'ru') {
  get.mockResolvedValue(card(fields));
  const i18n = createInstance();
  await i18n.init({
    lng: language,
    resources: { ru: { translation: ru }, en: { translation: en } },
    interpolation: { escapeValue: false },
  });
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <AdminAutoMessageDetail />
        </MemoryRouter>
      </QueryClientProvider>
    </I18nextProvider>,
  );
  await screen.findByText('Пробный закончится завтра');
  fireEvent.click(screen.getByRole('switch'));
}
beforeEach(() => {
  get.mockReset();
  patch.mockReset();
  confirmOff.mockReset();
  patch.mockResolvedValue({});
});
afterEach(cleanup);
it.each(['ru', 'en'])('объясняет потерю предупреждения до отключения, %s', async (language) => {
  confirmOff.mockResolvedValue(true);
  await show({ stops_reminder: true }, language);
  await waitFor(() => expect(confirmOff).toHaveBeenCalled());
  const question = confirmOff.mock.calls[0][0];
  expect(question).toContain(
    language === 'ru'
      ? 'Клиент не получит это напоминание'
      : 'The customer will not receive this reminder',
  );
  expect(question.length).toBeLessThanOrEqual(240);
  await waitFor(() => expect(patch).toHaveBeenCalledWith('trial-1d', { enabled: false }));
});
it('отмена подтверждения не отключает карточку', async () => {
  confirmOff.mockResolvedValue(false);
  await show({ stops_reminder: true });
  await waitFor(() => expect(confirmOff).toHaveBeenCalled());
  expect(patch).not.toHaveBeenCalled();
});
it.each([undefined, false, 'true'])(
  'старый или неверный флаг %s сохраняет обычное подтверждение',
  async (flag) => {
    confirmOff.mockResolvedValue(true);
    await show({ stops_reminder: flag });
    await waitFor(() => expect(confirmOff).toHaveBeenCalled());
    expect(confirmOff.mock.calls[0][0]).not.toContain('Клиент не получит это напоминание');
    await waitFor(() => expect(patch).toHaveBeenCalledWith('trial-1d', { enabled: false }));
  },
);
it('включение не требует подтверждения отключения', async () => {
  await show({ stops_reminder: true, enabled: false });
  await waitFor(() => expect(patch).toHaveBeenCalledWith('trial-1d', { enabled: true }));
  expect(confirmOff).not.toHaveBeenCalled();
});
