// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router';

const { list, patch } = vi.hoisted(() => ({ list: vi.fn(), patch: vi.fn() }));

vi.mock('../api/autoMessages', async () => {
  const actual = await vi.importActual<typeof import('../api/autoMessages')>('../api/autoMessages');
  return { ...actual, autoMessagesApi: { list, patch } };
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

import AdminAutoMessages from './AdminAutoMessages';

function item(overrides: Record<string, unknown> = {}) {
  return {
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
    limits: { discount_percent: [1, 50], valid_hours: [1, 168] },
    ...overrides,
  };
}

function payload(items: ReturnType<typeof item>[]) {
  return {
    summary: {
      total_count: items.length,
      live_count: items.filter((entry) => entry.state === 'live').length,
      configurable_count: items.filter((entry) => entry.control === 'toggle').length,
      sent_total: 8,
      claimed_total: 3,
      global_enabled: true,
      global_affects: 5,
      global_editable_here: false,
      last_cycle_at: null,
    },
    items,
  };
}

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <AdminAutoMessages />
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

describe('AdminAutoMessages: честность управления', () => {
  beforeEach(() => {
    list.mockReset();
    patch.mockReset();
  });
  afterEach(cleanup);

  it('у сообщения без настроек переключателя нет — только замок', async () => {
    list.mockResolvedValue(
      payload([
        item({ id: 'trial-2h', control: 'locked', enabled: null, title: 'Пробный истекает' }),
        item(),
      ]),
    );
    renderPage();

    await waitFor(() => expect(screen.getByText('Пробный истекает')).toBeTruthy());
    // Переключатель ровно один — у управляемого сообщения. У «locked» его быть не должно,
    // иначе менеджер нажмёт то, что ничего не делает.
    expect(screen.getAllByRole('switch')).toHaveLength(1);
  });

  it('общий выключатель показан справкой, а не кнопкой', async () => {
    list.mockResolvedValue(payload([item({ control: 'locked', enabled: null })]));
    renderPage();

    await waitFor(() => expect(screen.getByText('admin.autoMessages.master.where')).toBeTruthy());
    // Ни одного переключателя: общий живёт в настройках бота и отсюда не меняется.
    expect(screen.queryAllByRole('switch')).toHaveLength(0);
    // Статус показан текстом, а не органом управления — блок разбит на несколько узлов.
    expect(document.body.textContent).toContain('admin.autoMessages.master.on');
  });

  it('уточнение к работающему сообщению не выдаётся за причину молчания', async () => {
    list.mockResolvedValue(
      payload([
        item({
          id: 'low-balance',
          control: 'locked',
          enabled: null,
          state: 'live',
          quiet_reason: null,
          note: 'уходит только тем, кто сам включил',
          title: 'Низкий баланс',
        }),
      ]),
    );
    renderPage();

    await waitFor(() => expect(screen.getByText('Низкий баланс')).toBeTruthy());
    expect(screen.getByText('admin.autoMessages.state.live')).toBeTruthy();
    expect(screen.getByText('уходит только тем, кто сам включил')).toBeTruthy();
    expect(screen.queryByText('admin.autoMessages.state.quiet')).toBeNull();
  });

  it('прочерк вместо нуля там, где отправки не считаются', async () => {
    list.mockResolvedValue(
      payload([
        item({
          id: 'paid-expired',
          control: 'locked',
          enabled: null,
          sent_count: null,
          claim_tracked: false,
        }),
      ]),
    );
    renderPage();

    await waitFor(() => expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(2));
    await settle();
    // Ноль сказал бы «письмо не работает». Прочерк говорит «мы это не считаем».
    expect(patch).not.toHaveBeenCalled();
  });
});
