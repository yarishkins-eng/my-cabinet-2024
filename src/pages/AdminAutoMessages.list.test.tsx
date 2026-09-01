// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router';

const { list, patch } = vi.hoisted(() => ({ list: vi.fn(), patch: vi.fn() }));
const navigate = vi.fn();

vi.mock('../api/autoMessages', async () => {
  const actual = await vi.importActual<typeof import('../api/autoMessages')>('../api/autoMessages');
  return { ...actual, autoMessagesApi: { list, patch } };
});

vi.mock('react-router', async () => {
  const actual = await vi.importActual<typeof import('react-router')>('react-router');
  return { ...actual, useNavigate: () => navigate };
});

vi.mock('../platform/hooks/usePlatform', () => ({
  usePlatform: () => ({
    capabilities: { hasBackButton: true, hasNativeDialogs: false },
    dialog: { confirm: vi.fn(), alert: vi.fn(), popup: vi.fn() },
  }),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, vars?: Record<string, unknown>) =>
      vars ? `${key} ${Object.values(vars).join(' ')}` : key,
  }),
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
    shares_switch_with: null,
    warning: null,
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

describe('AdminAutoMessages: список ничего не переключает', () => {
  beforeEach(() => {
    list.mockReset();
    patch.mockReset();
    navigate.mockReset();
  });
  afterEach(cleanup);

  it('в списке нет ни одного переключателя', async () => {
    // 🔴 Прямое требование владельца: тумблер в строке легко задеть рукой при
    // прокрутке, а пользуются им редко. Управление живёт в карточке.
    list.mockResolvedValue(payload([item(), item({ id: 'return-wave3', title: 'Третья волна' })]));
    renderPage();

    await waitFor(() => expect(screen.getByText('Скидка на продление')).toBeTruthy());
    expect(screen.queryAllByRole('switch')).toHaveLength(0);
    expect(patch).not.toHaveBeenCalled();
  });

  it('слова «не считаем» на экране нет, и прочерков тоже', async () => {
    // Владелец: «что такое не считаем? что именно не считаем? почему?». Ответ —
    // не показывать счётчик там, где его нет, вместо загадочного прочерка.
    list.mockResolvedValue(
      payload([item({ id: 'paid-expired', sent_count: null, claim_tracked: false, params: null })]),
    );
    renderPage();

    await waitFor(() => expect(screen.getByText('Скидка на продление')).toBeTruthy());
    expect(document.body.textContent).not.toContain('notCounted');
    expect(document.body.textContent).not.toContain('—');
  });

  it('числа показываются только те, что есть', async () => {
    list.mockResolvedValue(payload([item({ claim_tracked: false, sent_count: 8 })]));
    renderPage();

    // Смотрим строку сообщения, а не плитки сверху: там свои итоги по всему разделу.
    const row = await screen.findByRole('button', { name: /Скидка на продление/ });
    expect(row.textContent).toContain('tiles.sent 8');
    expect(row.textContent).not.toContain('tiles.claimed');
  });

  it('выключенное сообщение подписано «выключено»', async () => {
    list.mockResolvedValue(
      payload([item({ enabled: false, state: 'quiet', quiet_reason: 'выключено в этом разделе' })]),
    );
    renderPage();

    await waitFor(() => expect(screen.getByText('admin.autoMessages.state.off')).toBeTruthy());
  });

  it('уточнение к работающему сообщению не выдаётся за причину молчания', async () => {
    list.mockResolvedValue(
      payload([
        item({
          id: 'low-balance',
          title: 'Низкий баланс',
          state: 'live',
          quiet_reason: null,
          note: 'уходит только тем, кто сам включил',
        }),
      ]),
    );
    renderPage();

    await waitFor(() => expect(screen.getByText('Низкий баланс')).toBeTruthy());
    expect(screen.getByText('уходит только тем, кто сам включил')).toBeTruthy();
    expect(screen.queryByText(/state\.quiet/)).toBeNull();
  });

  it('нажатие на строку ведёт в карточку', async () => {
    list.mockResolvedValue(payload([item()]));
    renderPage();

    await waitFor(() => expect(screen.getByText('Скидка на продление')).toBeTruthy());
    fireEvent.click(screen.getByText('Скидка на продление'));
    expect(navigate).toHaveBeenCalledWith('/admin/auto-messages/return-wave2');
  });

  it('у погасшей строки написано, что она погасла в паре', async () => {
    // Отвечает на вопрос «почему их две»: менеджер выключал одно.
    list.mockResolvedValue(
      payload([
        item({ enabled: false, state: 'quiet', shares_switch_with: 'Подписка закончилась' }),
      ]),
    );
    renderPage();

    await waitFor(() =>
      expect(screen.getByText('admin.autoMessages.pairShort Подписка закончилась')).toBeTruthy(),
    );
  });

  it('каждая строка сама говорит, работает она или нет', async () => {
    // 🔴 Прямое требование владельца: не заходя в каждое сообщение, видеть с главной,
    // что включено, а что нет. Цвет точки — для скорости, слово — чтобы не запоминать
    // легенду и чтобы озвучка тоже читала смысл.
    list.mockResolvedValue(
      payload([
        item({ id: 'a', title: 'Живое' }),
        item({
          id: 'b',
          title: 'Выключенное',
          enabled: false,
          state: 'quiet',
          quiet_reason: 'выключено в этом разделе',
        }),
        item({
          id: 'c',
          title: 'Молчит по чужой причине',
          state: 'quiet',
          quiet_reason: 'суточных тарифов нет',
        }),
      ]),
    );
    renderPage();

    await waitFor(() => expect(screen.getByText('Живое')).toBeTruthy());
    expect(screen.getByText('admin.autoMessages.state.live')).toBeTruthy();
    expect(screen.getByText('admin.autoMessages.state.off')).toBeTruthy();
    expect(screen.getByText(/state\.quiet: суточных тарифов нет/)).toBeTruthy();

    // Точка не должна быть единственным носителем смысла.
    const dots = screen.getAllByRole('img');
    expect(dots.map((dot) => dot.getAttribute('aria-label'))).toEqual([
      'admin.autoMessages.dot.live',
      'admin.autoMessages.dot.off',
      'admin.autoMessages.dot.quiet',
    ]);
  });

  it('крупное число отправок подписано тем, по скольким оно считано', async () => {
    // Сумма собрана не по всем сообщениям. Молчать об этом — то же самое, что и
    // прежнее «не считаем», из-за которого начался этот этап.
    list.mockResolvedValue(
      payload([item({ sent_count: 8 }), item({ id: 'paid-expired', sent_count: null })]),
    );
    renderPage();

    await waitFor(() => expect(screen.getByText(/tiles\.sentHint 1 2/)).toBeTruthy());
  });
});
