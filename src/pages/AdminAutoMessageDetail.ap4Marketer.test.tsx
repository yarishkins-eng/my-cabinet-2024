// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createInstance } from 'i18next';
import { Component, type ReactNode } from 'react';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter, Route, Routes } from 'react-router';
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
  if (server.params && Object.keys(server.params).length)
    await waitFor(() =>
      expect(screen.getByText(i18n.t('admin.autoMessages.detail.when'))).toBeTruthy(),
    );
  return { ...rendered, i18n, client };
}

function action(language: string, verb: 'save' | 'cancel' = 'save') {
  return screen.getByRole('button', {
    name:
      verb === 'save'
        ? language === 'ru'
          ? 'Сохранить'
          : 'Save'
        : language === 'ru'
          ? 'Отменить'
          : 'Cancel',
    exact: true,
  });
}
function normalizedText() {
  return document.body.textContent?.replace(/[\s\u00a0\u202f]+/g, ' ') ?? '';
}
function enableButton(language: string) {
  return screen.getByRole('button', { name: language === 'ru' ? /Включить/ : /Enable/i });
}

beforeEach(() => {
  get.mockReset();
  patch.mockReset();
  confirm.mockReset();
  confirm.mockResolvedValue(true);
});
afterEach(cleanup);

describe('АП-4 PR-2а: маркетолог видит решение до включения', () => {
  it('неизвестное числовое поле без limits не ломает карточку и не попадает в PATCH', async () => {
    await show({
      params: { valid_hours: 24, future_backend_number: 99 },
      limits: { valid_hours: [1, 168] },
    });
    expect(screen.queryByText(/future_backend_number/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '48 ч' }));
    fireEvent.click(action('ru'));
    await waitFor(() => expect(patch).toHaveBeenCalledWith(ID, { valid_hours: 48 }));
  });

  it.each(['ru', 'en'])(
    'серверные подписи выбирают числовые carrier и audience (%s)',
    async (language) => {
      await show({}, language);
      carrierLabels.forEach((label) =>
        expect(screen.getByRole('button', { name: label })).toBeTruthy(),
      );
      fireEvent.click(screen.getByRole('button', { name: carrierLabels[0] }));
      fireEvent.click(screen.getByRole('button', { name: audienceLabels[1] }));
      expect(patch).not.toHaveBeenCalled();
      fireEvent.click(action(language));
      await waitFor(() => expect(patch).toHaveBeenCalledWith(ID, { carrier: 48, audience: 0 }));
    },
  );

  it('carrier=0 остаётся числом ноль, без замены ложного значения на сутки', async () => {
    await show();
    fireEvent.click(screen.getByRole('button', { name: carrierLabels[2] }));
    fireEvent.click(action('ru'));
    await waitFor(() => expect(patch).toHaveBeenCalledWith(ID, { carrier: 0 }));
  });

  it('после пробного сохраняется числовое число часов, без преждевременного PATCH', async () => {
    await show();
    fireEvent.click(screen.getByRole('button', { name: '+' }));
    expect(patch).not.toHaveBeenCalled();
    fireEvent.click(action('ru'));
    await waitFor(() => expect(patch).toHaveBeenCalledWith(ID, { post_trial_hours: 13 }));
  });

  it.each(['ru', 'en'])(
    'первый щелчок даёт «Проверьте», сохранённые сегменты и серверную цену (%s)',
    async (language) => {
      const { i18n } = await show({}, language);
      fireEvent.click(screen.getByRole('switch'));
      expect(patch).not.toHaveBeenCalled();
      expect(confirm).not.toHaveBeenCalled();
      expect(i18n.exists('admin.autoMessages.discount.checkTitle')).toBe(true);
      expect(screen.getByText(i18n.t('admin.autoMessages.discount.checkTitle'))).toBeTruthy();
      expect(normalizedText()).toContain(carrierLabels[1]);
      expect(normalizedText()).toContain(audienceLabels[0]);
      expect(normalizedText()).toMatch(/173[,.]45/);
      fireEvent.click(enableButton(language));
      await waitFor(() => expect(patch).toHaveBeenCalledWith(ID, { enabled: true }));
    },
  );

  it('отмена проверки не меняет сервер и закрывает проверку', async () => {
    const { i18n } = await show();
    fireEvent.click(screen.getByRole('switch'));
    expect(screen.getByText(i18n.t('admin.autoMessages.discount.checkTitle'))).toBeTruthy();
    fireEvent.click(
      screen.getByRole('button', {
        name: i18n.t('admin.autoMessages.discount.cancel'),
        exact: true,
      }),
    );
    expect(patch).not.toHaveBeenCalled();
    expect(screen.queryByText(i18n.t('admin.autoMessages.discount.checkTitle'))).toBeNull();
  });

  it('черновик нельзя включить; после сохранения проверка показывает новую серверную настройку', async () => {
    const { i18n, client } = await show();
    fireEvent.click(screen.getByRole('button', { name: carrierLabels[0] }));
    expect((screen.getByRole('switch') as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(i18n.t('admin.autoMessages.discount.saveFirst'))).toBeTruthy();
    fireEvent.click(screen.getByRole('switch'));
    expect(patch).not.toHaveBeenCalled();
    fireEvent.click(action('ru'));
    await waitFor(() => expect(patch).toHaveBeenCalledWith(ID, { carrier: 48 }));
    await waitFor(() =>
      expect((screen.getByRole('switch') as HTMLButtonElement).disabled).toBe(false),
    );
    expect(
      client.getQueryData<{ params: { carrier: number } }>(['admin-auto-message', ID])?.params
        .carrier,
    ).toBe(48);
    fireEvent.click(screen.getByRole('switch'));
    const check = screen.getByText(i18n.t('admin.autoMessages.discount.checkTitle')).parentElement;
    expect(check?.textContent).toContain(carrierLabels[0]);
    expect(patch.mock.calls).toHaveLength(1);
  });

  it.each(['ru', 'en'])(
    'сохранение >20 подтверждает выбранный процент и его серверную цену (%s)',
    async (language) => {
      await show({}, language);
      confirm.mockResolvedValue(false);
      fireEvent.click(screen.getByRole('button', { name: '25 %' }));
      fireEvent.click(action(language));
      await waitFor(() => expect(confirm).toHaveBeenCalled());
      expect(confirm.mock.calls[0][0]).toMatch(/25\s*%/);
      expect(confirm.mock.calls[0][0]).toMatch(/209[,.]17/);
      expect(confirm.mock.calls[0][0]).not.toMatch(/173[,.]45/);
      expect(patch).not.toHaveBeenCalled();
      confirm.mockResolvedValue(true);
      fireEvent.click(action(language));
      await waitFor(() => expect(patch).toHaveBeenCalledWith(ID, { discount_percent: 25 }));
    },
  );

  it('20% сохраняется без высокой проверки', async () => {
    await show();
    fireEvent.click(screen.getByRole('button', { name: '20 %' }));
    fireEvent.click(action('ru'));
    await waitFor(() => expect(patch).toHaveBeenCalledWith(ID, { discount_percent: 20 }));
    expect(confirm).not.toHaveBeenCalled();
  });

  it('включение сохранённых 25% требует отдельного согласия, отказ не включает', async () => {
    await show({ params: { ...card().params, discount_percent: 25 } });
    confirm.mockResolvedValue(false);
    fireEvent.click(screen.getByRole('switch'));
    fireEvent.click(enableButton('ru'));
    await waitFor(() => expect(confirm).toHaveBeenCalled());
    expect(confirm.mock.calls[0][0]).toMatch(/25\s*%/);
    expect(confirm.mock.calls[0][0]).toMatch(/209[,.]17/);
    expect(patch).not.toHaveBeenCalled();
    confirm.mockResolvedValue(true);
    if (!screen.queryByRole('button', { name: /Включить/ }))
      fireEvent.click(screen.getByRole('switch'));
    fireEvent.click(enableButton('ru'));
    await waitFor(() => expect(patch).toHaveBeenCalledWith(ID, { enabled: true }));
  });

  it.each([
    ['нет поля', undefined],
    ['нет выбранного процента', { '15': prices['15'] }],
    ['пустая таблица', { '25': [] }],
    [
      'NaN в цене',
      { '25': [{ period_days: 30, original_price_kopeks: 30000, price_kopeks: NaN }] },
    ],
    [
      'отрицательная цена',
      { '25': [{ period_days: 30, original_price_kopeks: 30000, price_kopeks: -1 }] },
    ],
    [
      'нецелые копейки',
      { '25': [{ period_days: 30, original_price_kopeks: 30000, price_kopeks: 20917.5 }] },
    ],
  ])('%s: высокий процент нельзя сохранить или включить без достоверной цены', async (_, table) => {
    const { i18n } = await show({
      params: { discount_percent: 15, valid_hours: 24 },
      discount_prices: table,
    });
    fireEvent.click(screen.getByRole('button', { name: '25 %' }));
    fireEvent.click(action('ru'));
    expect(patch).not.toHaveBeenCalled();
    expect(confirm).not.toHaveBeenCalled();
    expect(screen.getByText(i18n.t('admin.autoMessages.discount.missingPrices'))).toBeTruthy();
    cleanup();
    await show({ params: { discount_percent: 25, valid_hours: 24 }, discount_prices: table });
    fireEvent.click(screen.getByRole('switch'));
    if (screen.queryByRole('button', { name: /Включить/ })) fireEvent.click(enableButton('ru'));
    expect(patch).not.toHaveBeenCalled();
  });

  it('старое API и старый скидочный выключатель включаются напрямую', async () => {
    // Actual legacy card ID: bot-code/app/cabinet/routes/admin_auto_messages.py:339.
    await show({
      id: 'trial-discount',
      params: { discount_percent: 25, valid_hours: 24 },
      discount_context: undefined,
      discount_prices: undefined,
      choices: undefined,
    });
    fireEvent.click(screen.getByRole('switch'));
    await waitFor(() => expect(patch).toHaveBeenCalledWith('trial-discount', { enabled: true }));
    expect(confirm).not.toHaveBeenCalled();
  });

  it.each(['ru', 'en'])(
    'price_lines вне тела описаны как автоматический хвост (%s)',
    async (language) => {
      const { i18n } = await show(
        {
          id: 'trial-1d',
          params: {},
          text: 'Осталось {hours_text}.',
          text_inserts: [
            {
              name: 'price_lines',
              variants: [{ when: 'Скидка активна', text: 'Серверная цена 173,45 ₽' }],
            },
          ],
        },
        language,
      );
      expect(i18n.exists('admin.autoMessages.discount.autoTail')).toBe(true);
      expect(screen.getByText(i18n.t('admin.autoMessages.discount.autoTail'))).toBeTruthy();
      expect(screen.getByText(/Серверная цена 173,45/)).toBeTruthy();
      expect(screen.getByText(/Осталось \{hours_text\}/)).toBeTruthy();
      expect(screen.queryByText(i18n.t('admin.autoMessages.detail.textInserts'))).toBeNull();
    },
  );

  it('price_lines в теле сохраняет обычное объяснение подстановки', async () => {
    const { i18n } = await show({
      id: 'trial-1d',
      params: {},
      text: 'Осталось {hours_text}.\n{price_lines}',
      text_inserts: [
        {
          name: 'price_lines',
          variants: [{ when: 'Скидка активна', text: 'Серверная цена 173,45 ₽' }],
        },
      ],
    });
    expect(screen.getByText(i18n.t('admin.autoMessages.detail.textInserts'))).toBeTruthy();
    expect(screen.queryByText(i18n.t('admin.autoMessages.discount.autoTail'))).toBeNull();
  });

  it.each(['ru', 'en'])(
    'отключение носителя предупреждает о потере скидки в доступном диалоге (%s)',
    async (language) => {
      await show(
        {
          id: 'trial-1d',
          title: 'Пробный закончится завтра',
          enabled: true,
          state: 'live',
          stops_reminder: true,
          params: {},
          discount_context: {
            carrier_id: 'trial-1d',
            percent: 15,
            enabled: true,
            legacy_enabled: false,
          },
        },
        language,
      );
      confirm.mockResolvedValue(false);
      fireEvent.click(screen.getByRole('switch'));
      await waitFor(() => expect(confirm).toHaveBeenCalled());
      expect(confirm.mock.calls[0][0]).toMatch(language === 'ru' ? /скидк/i : /discount/i);
      expect(confirm.mock.calls[0][0].length).toBeLessThanOrEqual(240);
      expect(patch).not.toHaveBeenCalled();
    },
  );

  it('два включённых механизма и старая карточка ясно предупреждают о замене', async () => {
    const { i18n } = await show({
      id: 'trial-discount',
      params: { discount_percent: 15 },
      discount_context: {
        carrier_id: 'trial-1d',
        percent: 15,
        enabled: true,
        legacy_enabled: true,
      },
    });
    expect(screen.getByText(i18n.t('admin.autoMessages.discount.bothEnabled'))).toBeTruthy();
    expect(screen.getByText(i18n.t('admin.autoMessages.discount.replacesLegacy'))).toBeTruthy();
    expect(
      screen
        .getByRole('link', { name: i18n.t('admin.autoMessages.discount.configure') })
        .getAttribute('href'),
    ).toContain(ID);
  });

  it.each(['trial-1d', 'trial-2d'])(
    'метка скидки есть только у выбранного носителя (%s)',
    async (id) => {
      const { i18n } = await show({
        id,
        params: {},
        enabled: true,
        state: 'live',
        discount_context: {
          carrier_id: 'trial-1d',
          percent: 15,
          enabled: true,
          legacy_enabled: false,
        },
      });
      const attachment = i18n.t('admin.autoMessages.discount.attachment', { percent: 15 });
      expect(i18n.exists('admin.autoMessages.discount.attachment')).toBe(true);
      if (id === 'trial-1d') expect(screen.getByText(attachment)).toBeTruthy();
      else expect(screen.queryByText(attachment)).toBeNull();
    },
  );
});
