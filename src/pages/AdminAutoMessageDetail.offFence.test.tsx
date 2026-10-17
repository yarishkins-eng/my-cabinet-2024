// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createInstance } from 'i18next';
import { Component, type ReactNode } from 'react';
import { I18nextProvider } from 'react-i18next';
import { Link, MemoryRouter, Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import en from '../locales/en.json';
import ru from '../locales/ru.json';

const { get, patch, confirm } = vi.hoisted(() => ({
  get: vi.fn(),
  patch: vi.fn(),
  confirm: vi.fn(),
}));
vi.mock('../api/autoMessages', async () => ({
  ...(await vi.importActual('../api/autoMessages')),
  autoMessagesApi: { get, patch },
}));
// Only the platform dialog boundary is replaced; translation, routing and cache are real.
vi.mock('../platform/hooks/useNativeDialog', () => ({ useDestructiveConfirm: () => confirm }));
vi.mock('../platform/hooks/usePlatform', () => ({
  usePlatform: () => ({ capabilities: { hasBackButton: true } }),
}));
import AdminAutoMessageDetail from './AdminAutoMessageDetail';

// A broken future field is an assertion failure in this UI test, not an unhandled runner error.
class CardBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? <p role="alert">Card could not render</p> : this.props.children;
  }
}

const ID = 'trial-ending-discount';
const TITLE = 'Скидка к концу пробного периода';
const carrierLabels = ['За двое суток · письмо', 'За сутки · письмо', 'Последние часы · письмо'];
const audienceLabels = ['Уже включавшие VPN', 'Все пробные клиенты'];
const prices = {
  '15': [{ period_days: 30, original_price_kopeks: 30000, price_kopeks: 17345 }],
  '25': [{ period_days: 30, original_price_kopeks: 30000, price_kopeks: 20917 }],
};

function card(overrides: Record<string, unknown> = {}) {
  return {
    id: ID,
    group: 'trial',
    title: TITLE,
    when: 'Перед концом пробного',
    control: 'toggle',
    enabled: false,
    state: 'quiet',
    quiet_reason: 'Выключено здесь',
    note: null,
    shares_switch_with: null,
    warning: null,
    params: {
      discount_percent: 15,
      valid_hours: 24,
      carrier: 24,
      audience: 1,
      post_trial_hours: 12,
    },
    limits: {
      discount_percent: [1, 50],
      valid_hours: [1, 168],
      carrier: [0, 48],
      audience: [0, 1],
      post_trial_hours: [1, 72],
    },
    choices: {
      carrier: carrierLabels.map((label, index) => ({ label, value: [48, 24, 0][index] })),
      audience: audienceLabels.map((label, index) => ({ label, value: [1, 0][index] })),
    },
    discount_prices: prices,
    discount_context: {
      carrier_id: 'trial-1d',
      percent: 15,
      enabled: false,
      legacy_enabled: false,
    },
    buttons: [],
    sent_count: 0,
    claimed_count: 0,
    claim_tracked: false,
    history: [],
    history_note: '',
    ...overrides,
  };
}

async function show(overrides: Record<string, unknown> = {}, language = 'ru') {
  let server = card(overrides);
  get.mockImplementation(async () => server);
  patch.mockImplementation(async (_id: string, payload: Record<string, unknown>) => {
    server = {
      ...server,
      ...(typeof payload.enabled === 'boolean' ? { enabled: payload.enabled } : {}),
      params: {
        ...server.params,
        ...Object.fromEntries(Object.entries(payload).filter(([key]) => key !== 'enabled')),
      },
    };
    return server;
  });
  const i18n = createInstance();
  await i18n.init({
    lng: language,
    resources: { ru: { translation: ru }, en: { translation: en } },
    interpolation: { escapeValue: false },
  });
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const rendered = render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={[`/admin/auto-messages/${server.id}`]}>
          <Routes>
            <Route
              path="/admin/auto-messages/:id"
              element={
                <CardBoundary>
                  <Link to="/admin/auto-messages/trial-discount">Move card</Link>
                  <AdminAutoMessageDetail />
                </CardBoundary>
              }
            />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </I18nextProvider>,
  );
  await screen.findByRole('heading', { name: server.title });
  await screen.findByRole('button', { name: '25 %', exact: true });
  return {
    ...rendered,
    i18n,
    client,
    setServer: (next: typeof server) => {
      server = next;
    },
  };
}

beforeEach(() => {
  get.mockReset();
  patch.mockReset();
  confirm.mockReset();
  confirm.mockResolvedValue(true);
});
afterEach(cleanup);

describe('АП-4 PR-2а: OFF consent does not survive navigation', () => {
  function pending() {
    let resolve!: (value: boolean) => void;
    confirm.mockImplementation(
      () =>
        new Promise<boolean>((done) => {
          resolve = done;
        }),
    );
    return () => resolve(true);
  }
  it('own discount OFF must not PATCH after the component unmounts', async () => {
    const { unmount } = await show({ enabled: true, state: 'live', quiet_reason: null });
    const accept = pending();
    fireEvent.click(screen.getByRole('switch'));
    await waitFor(() => expect(confirm).toHaveBeenCalledTimes(1));
    expect(confirm.mock.calls[0][0]).toBe('Выключить скидку? Выданные доработают до своего срока.');
    unmount();
    await act(async () => accept());
    expect(patch).not.toHaveBeenCalled();
  });
  it('own discount OFF must not PATCH a different card after route changes', async () => {
    await show({ enabled: true, state: 'live', quiet_reason: null });
    const accept = pending();
    fireEvent.click(screen.getByRole('switch'));
    await waitFor(() => expect(confirm).toHaveBeenCalledTimes(1));
    get.mockImplementation(async (id: string) =>
      id === ID
        ? card({ enabled: true, state: 'live', quiet_reason: null })
        : card({
            id: 'trial-discount',
            title: 'Other discount',
            enabled: true,
            params: { discount_percent: 10, valid_hours: 24 },
          }),
    );
    fireEvent.click(screen.getByRole('link', { name: 'Move card' }));
    await screen.findByRole('heading', { name: 'Other discount' });
    await act(async () => accept());
    expect(patch).not.toHaveBeenCalled();
  });
  it('carrier OFF must not PATCH a different card after route changes', async () => {
    await show({
      id: 'trial-1d',
      title: 'Carrier letter',
      enabled: true,
      state: 'live',
      quiet_reason: null,
      discount_context: {
        carrier_id: 'trial-1d',
        percent: 15,
        enabled: true,
        legacy_enabled: false,
      },
    });
    const accept = pending();
    fireEvent.click(screen.getByRole('switch'));
    await waitFor(() => expect(confirm).toHaveBeenCalledTimes(1));
    expect(confirm.mock.calls[0][0]).toBe('Выключить «Carrier letter»? Скидка в нём тоже не уйдёт.');
    get.mockImplementation(async (id: string) =>
      id === 'trial-1d'
        ? card({ id: 'trial-1d', title: 'Carrier letter', enabled: true })
        : card({
            id: 'trial-discount',
            title: 'Other discount',
            enabled: true,
            params: { discount_percent: 10, valid_hours: 24 },
          }),
    );
    fireEvent.click(screen.getByRole('link', { name: 'Move card' }));
    await screen.findByRole('heading', { name: 'Other discount' });
    await act(async () => accept());
    expect(patch).not.toHaveBeenCalled();
  });
});
