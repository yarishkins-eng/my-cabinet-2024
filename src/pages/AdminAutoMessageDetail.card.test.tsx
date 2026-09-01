// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router';

const { get, patch, confirmOff } = vi.hoisted(() => ({
  get: vi.fn(),
  patch: vi.fn(),
  confirmOff: vi.fn(),
}));

vi.mock('../api/autoMessages', async () => {
  const actual = await vi.importActual<typeof import('../api/autoMessages')>('../api/autoMessages');
  return { ...actual, autoMessagesApi: { get, patch } };
});

vi.mock('react-router', async () => {
  const actual = await vi.importActual<typeof import('react-router')>('react-router');
  return { ...actual, useNavigate: () => vi.fn(), useParams: () => ({ id: 'trial-2h' }) };
});

vi.mock('../platform/hooks/useNativeDialog', () => ({
  useDestructiveConfirm: () => confirmOff,
}));

vi.mock('../platform/hooks/usePlatform', () => ({
  usePlatform: () => ({ capabilities: { hasBackButton: true, hasNativeDialogs: false } }),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, vars?: Record<string, unknown>) =>
      vars ? `${key} ${Object.values(vars).join(' ')}` : key,
  }),
}));

import AdminAutoMessageDetail from './AdminAutoMessageDetail';

function card(overrides: Record<string, unknown> = {}) {
  return {
    id: 'trial-2h',
    group: 'trial',
    title: 'Пробный скоро закончится',
    when: 'За 2 часа до конца пробного периода',
    text: 'Ваша тестовая подписка истекает через 2 часа.',
    control: 'toggle',
    enabled: true,
    state: 'live',
    quiet_reason: null,
    note: null,
    shares_switch_with: null,
    warning: null,
    params: { warn_hours: 2 },
    limits: { warn_hours: [1, 48] },
    buttons: [{ label: '💎 Оформить подписку', target: 'Экран тарифов', tracked: false }],
    sent_count: 12,
    claimed_count: 0,
    claim_tracked: false,
    history: [{ sent_at: '2026-09-01T10:00:00Z', user_ref: 'id 42', claimed: false }],
    history_note: 'Отправки стираются при продлении',
    ...overrides,
  };
}

function renderCard() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <AdminAutoMessageDetail />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe('AdminAutoMessageDetail: управление живёт здесь', () => {
  beforeEach(() => {
    get.mockReset();
    patch.mockReset();
    confirmOff.mockReset();
    patch.mockResolvedValue({});
  });
  afterEach(cleanup);

  it('переключатель есть в карточке и спрашивает подтверждение перед выключением', async () => {
    get.mockResolvedValue(card());
    confirmOff.mockResolvedValue(true);
    renderCard();

    await waitFor(() => expect(screen.getByRole('switch')).toBeTruthy());
    fireEvent.click(screen.getByRole('switch'));

    await waitFor(() => expect(confirmOff).toHaveBeenCalled());
    await waitFor(() => expect(patch).toHaveBeenCalledWith('trial-2h', { enabled: false }));
  });

  it('отказ в подтверждении ничего не отправляет', async () => {
    get.mockResolvedValue(card());
    confirmOff.mockResolvedValue(false);
    renderCard();

    await waitFor(() => expect(screen.getByRole('switch')).toBeTruthy());
    fireEvent.click(screen.getByRole('switch'));

    await waitFor(() => expect(confirmOff).toHaveBeenCalled());
    expect(patch).not.toHaveBeenCalled();
  });

  it('включение обратно подтверждения не требует', async () => {
    get.mockResolvedValue(
      card({ enabled: false, state: 'quiet', quiet_reason: 'выключено здесь' }),
    );
    renderCard();

    await waitFor(() => expect(screen.getByRole('switch')).toBeTruthy());
    fireEvent.click(screen.getByRole('switch'));

    await waitFor(() => expect(patch).toHaveBeenCalledWith('trial-2h', { enabled: true }));
    expect(confirmOff).not.toHaveBeenCalled();
  });

  it('парное сообщение честно говорит, что гаснет не одно', async () => {
    // Один и тот же кусок кода пишет два письма. Молчаливый общий выключатель —
    // это ровно та ловушка, из-за которой затевался весь этап.
    get.mockResolvedValue(card({ shares_switch_with: 'Подписка закончилась' }));
    renderCard();

    await waitFor(() =>
      expect(screen.getByText(/detail\.sharesSwitch Подписка закончилась/)).toBeTruthy(),
    );
  });

  it('предупреждение о последствии показывается', async () => {
    get.mockResolvedValue(card({ warning: 'Клиент не узнает, почему пропал VPN' }));
    renderCard();

    await waitFor(() =>
      expect(screen.getByText('Клиент не узнает, почему пропал VPN')).toBeTruthy(),
    );
  });

  it('выбор значения не уходит на сервер до «Сохранить»', async () => {
    get.mockResolvedValue(card());
    renderCard();

    await waitFor(() => expect(screen.getByText('6 ч')).toBeTruthy());
    fireEvent.click(screen.getByText('6 ч'));
    expect(patch).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText('admin.autoMessages.save.action'));
    await waitFor(() => expect(patch).toHaveBeenCalledWith('trial-2h', { warn_hours: 6 }));
  });

  it('два часа — самое малое, что можно выбрать', async () => {
    // Бот спит час ПОСЛЕ обхода, значит шаг между обходами больше часа, а окно
    // поиска шириной ровно N. При одном часе часть клиентов не попадёт в него
    // вовсе — молча. Поэтому ни «1 ч», ни минут на экране нет.
    get.mockResolvedValue(card());
    renderCard();

    await waitFor(() => expect(screen.getByText('2 ч')).toBeTruthy());
    expect(screen.queryByText('1 ч')).toBeNull();
    expect(screen.queryByText('0 ч')).toBeNull();
  });

  it('молчащее сообщение не выдаётся за работающее', async () => {
    // 🔴 Список писал «не отправляется», а карточка на той же записи — «включено».
    // Врал тот экран, куда менеджер зашёл читать подробности.
    get.mockResolvedValue(
      card({ state: 'quiet', quiet_reason: 'суточных тарифов не заведено', enabled: true }),
    );
    renderCard();

    await waitFor(() =>
      expect(screen.getByText('admin.autoMessages.detail.notSending')).toBeTruthy(),
    );
    expect(screen.getByText('суточных тарифов не заведено')).toBeTruthy();
  });

  it('подтверждение называет обе стороны пары', async () => {
    // Умолчать здесь — значит дать выключить «Подписка истекла» тому, кто этого
    // не хотел: своё предупреждение о последствиях лежит на ДРУГОЙ карточке.
    get.mockResolvedValue(card({ shares_switch_with: 'Подписка закончилась' }));
    confirmOff.mockResolvedValue(false);
    renderCard();

    await waitFor(() => expect(screen.getByRole('switch')).toBeTruthy());
    fireEvent.click(screen.getByRole('switch'));

    await waitFor(() => expect(confirmOff).toHaveBeenCalled());
    expect(confirmOff.mock.calls[0][0]).toContain('Подписка закончилась');
  });

  it('начатая правка числа переживает щелчок тумблером', async () => {
    // Карточка перезапрашивается после щелчка, приходит новый объект с теми же
    // числами — и выбранное «6 ч» молча возвращалось к серверным «2 ч».
    get.mockResolvedValue(card());
    confirmOff.mockResolvedValue(true);
    renderCard();

    await waitFor(() => expect(screen.getByText('6 ч')).toBeTruthy());
    fireEvent.click(screen.getByText('6 ч'));
    fireEvent.click(screen.getByRole('switch'));

    await waitFor(() => expect(patch).toHaveBeenCalledWith('trial-2h', { enabled: false }));
    expect(screen.getByText('admin.autoMessages.save.action')).toBeTruthy();
  });

  it('«Отменить» возвращает исходное значение и убирает кнопки', async () => {
    get.mockResolvedValue(card());
    renderCard();

    await waitFor(() => expect(screen.getByText('6 ч')).toBeTruthy());
    fireEvent.click(screen.getByText('6 ч'));
    await waitFor(() => expect(screen.getByText('admin.autoMessages.save.cancel')).toBeTruthy());

    fireEvent.click(screen.getByText('admin.autoMessages.save.cancel'));
    await waitFor(() => expect(screen.queryByText('admin.autoMessages.save.action')).toBeNull());
    expect(patch).not.toHaveBeenCalled();
  });

  it('отказ сервера показывается его словами', async () => {
    get.mockResolvedValue(card());
    const axios = await import('axios');
    vi.spyOn(axios.default, 'isAxiosError').mockReturnValue(true);
    patch.mockRejectedValue({
      response: { data: { detail: 'Скидку больше 50 % ставить нельзя' } },
    });
    renderCard();

    await waitFor(() => expect(screen.getByText('6 ч')).toBeTruthy());
    fireEvent.click(screen.getByText('6 ч'));
    fireEvent.click(screen.getByText('admin.autoMessages.save.action'));

    await waitFor(() => expect(screen.getByText('Скидку больше 50 % ставить нельзя')).toBeTruthy());
  });

  it('там, где счёта нет, сказано прямо — и что это не ноль', async () => {
    get.mockResolvedValue(card({ sent_count: null, history: [] }));
    renderCard();

    await waitFor(() =>
      expect(screen.getByText('admin.autoMessages.history.notCounted')).toBeTruthy(),
    );
  });

  it('у незыблемого сообщения переключателя нет, но сказано почему', async () => {
    // Осталось ровно одно: рычаг гасит не письмо, а сам бонус в две недели VPN.
    get.mockResolvedValue(card({ control: 'server', enabled: null, params: null }));
    renderCard();

    await waitFor(() => expect(screen.getByText('admin.autoMessages.locked.hint')).toBeTruthy());
    expect(screen.queryByRole('switch')).toBeNull();
  });
});
