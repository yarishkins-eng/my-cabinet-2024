// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter, Route, Routes, useParams } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import en from '../locales/en.json';
import ru from '../locales/ru.json';

const { list, patch } = vi.hoisted(() => ({ list: vi.fn(), patch: vi.fn() }));
vi.mock('../api/autoMessages', async () => ({
  ...(await vi.importActual('../api/autoMessages')),
  autoMessagesApi: { list, patch },
}));
vi.mock('../platform/hooks/usePlatform', () => ({
  usePlatform: () => ({ capabilities: { hasBackButton: true } }),
}));
import AdminAutoMessages from './AdminAutoMessages';

const context = { carrier_id: 'trial-1d', percent: 15, enabled: true, legacy_enabled: false };
function item(id: string, title: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    title,
    group: 'trial',
    when: 'Перед концом пробного',
    control: 'toggle',
    enabled: true,
    state: 'live',
    quiet_reason: null,
    note: null,
    shares_switch_with: null,
    warning: null,
    params: null,
    limits: null,
    sent_count: null,
    claimed_count: null,
    claim_tracked: false,
    discount_context: context,
    ...overrides,
  };
}
function OpenedCard() {
  const { id } = useParams();
  return <p>Opened {id}</p>;
}
async function show(items: ReturnType<typeof item>[], language = 'ru') {
  const server = {
    items,
    summary: {
      total_count: items.length,
      live_count: items.length,
      configurable_count: items.length,
      sent_total: 0,
      claimed_total: 0,
      global_enabled: true,
      global_affects: 5,
      global_editable_here: false,
      last_cycle_at: null,
    },
  };
  list.mockResolvedValue(server);
  const i18n = createInstance();
  await i18n.init({
    lng: language,
    resources: { ru: { translation: ru }, en: { translation: en } },
    interpolation: { escapeValue: false },
  });
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={['/admin/auto-messages']}>
          <Routes>
            <Route path="/admin/auto-messages" element={<AdminAutoMessages />} />
            <Route path="/admin/auto-messages/:id" element={<OpenedCard />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </I18nextProvider>,
  );
  await screen.findByRole('button', { name: new RegExp(items[0].title) });
  return { i18n, client, server };
}

beforeEach(() => {
  list.mockReset();
  patch.mockReset();
});
afterEach(cleanup);

describe('АП-4 PR-2а: список не путает скидку и письма', () => {
  it.each(['ru', 'en'])(
    'отметка процента только у выбранного носителя, не у соседнего письма (%s)',
    async (language) => {
      const { i18n, client, server } = await show(
        [
          item('trial-1d', 'Завтра'),
          item('trial-2d', 'Послезавтра'),
          item('trial-ending-discount', 'Настройки скидки'),
        ],
        language,
      );
      expect(i18n.exists('admin.autoMessages.discount.attachment')).toBe(true);
      const badge = i18n.t('admin.autoMessages.discount.attachment', { percent: 15 });
      const carrier = screen.getByRole('button', { name: /^.*Завтра/ });
      expect(within(carrier).getByText(badge)).toBeTruthy();
      expect(
        within(screen.getByRole('button', { name: /Послезавтра/ })).queryByText(badge),
      ).toBeNull();
      expect(
        within(screen.getByRole('button', { name: /Настройки скидки/ })).queryByText(badge),
      ).toBeNull();
      expect(client.getQueryData(['admin-auto-messages'])).toEqual(server);
      expect(screen.queryAllByRole('switch')).toHaveLength(0);
      expect(patch).not.toHaveBeenCalled();
    },
  );

  it.each(['ru', 'en'])(
    'старое письмо объясняет замену и ведёт в собственную карточку (%s)',
    async (language) => {
      // Actual legacy ID: bot-code/app/cabinet/routes/admin_auto_messages.py:339.
      const { i18n } = await show([item('trial-discount', 'Старое предложение')], language);
      expect(i18n.exists('admin.autoMessages.discount.replacesLegacy')).toBe(true);
      expect(screen.getByText(i18n.t('admin.autoMessages.discount.replacesLegacy'))).toBeTruthy();
      fireEvent.click(screen.getByRole('button', { name: /Старое предложение/ }));
      await screen.findByText('Opened trial-discount');
      expect(patch).not.toHaveBeenCalled();
    },
  );

  it.each([false, undefined, 'true'])(
    'неактивная или неверная enabled=%s не подписывает носитель действующей скидкой',
    async (enabled) => {
      const { i18n } = await show([
        item('trial-1d', 'Завтра', { discount_context: { ...context, enabled } }),
      ]);
      expect(
        screen.queryByText(i18n.t('admin.autoMessages.discount.attachment', { percent: 15 })),
      ).toBeNull();
      expect(patch).not.toHaveBeenCalled();
    },
  );

  it('старый API без контекста остаётся читаемым и открывает привычную карточку', async () => {
    await show([item('trial-discount', 'Старое предложение', { discount_context: undefined })]);
    const row = screen.getByRole('button', { name: /Старое предложение/ });
    expect(row.textContent).not.toMatch(/скидкой|replacesLegacy|replacement/i);
    fireEvent.click(row);
    await waitFor(() => expect(screen.getByText('Opened trial-discount')).toBeTruthy());
    expect(patch).not.toHaveBeenCalled();
  });
});
