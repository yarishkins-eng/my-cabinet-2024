// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
// Mock only API and native platform boundaries. Router, cache, translations and UI are real.
vi.mock('../platform/hooks/useNativeDialog', () => ({
  useDestructiveConfirm: () => confirm,
}));
vi.mock('../platform/hooks/usePlatform', () => ({
  usePlatform: () => ({ capabilities: { hasBackButton: true } }),
}));
import AdminAutoMessageDetail from './AdminAutoMessageDetail';

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
const context = {
  carrier_id: 'trial-1d',
  percent: 15,
  enabled: true,
  legacy_enabled: false,
  rollout_note: 'Пока только тестовым аккаунтам',
};
const prices = {
  '15': [{ period_days: 30, price_kopeks: 17345 }],
  '25': [{ period_days: 30, price_kopeks: 20917 }],
  '30': [{ period_days: 30, price_kopeks: 15432 }],
  '40': [{ period_days: 30, price_kopeks: 12567 }],
  '50': [{ period_days: 30, price_kopeks: 11111 }],
};
const clients: QueryClient[] = [];

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
      carrier: carrierLabels.map((label, index) => ({
        label,
        value: [48, 24, 0][index],
      })),
      audience: audienceLabels.map((label, index) => ({
        label,
        value: [1, 0][index],
      })),
    },
    discount_prices: prices,
    discount_context: { ...context, enabled: false },
    buttons: [],
    sent_count: 0,
    claimed_count: 0,
    claim_tracked: false,
    history: [],
    history_note: '',
    ...overrides,
  };
}

async function show(
  overrides: Record<string, unknown> = {},
  language = 'ru',
  otherCards: ReturnType<typeof card>[] = [],
) {
  const first = card(overrides);
  const server = new Map([first, ...otherCards].map((item) => [item.id, item]));
  get.mockImplementation(async (id: string) => {
    const item = server.get(id);
    if (!item) throw new Error(`Unexpected card request: ${id}`);
    return item;
  });
  patch.mockImplementation(async (id: string, payload: Record<string, unknown>) => {
    const previous = server.get(id);
    if (!previous) throw new Error(`Unexpected card patch: ${id}`);
    const numbers = Object.fromEntries(
      Object.entries(payload).filter(([key]) => !['enabled', 'text', 'reset_text'].includes(key)),
    );
    const next = {
      ...previous,
      ...(typeof payload.enabled === 'boolean' ? { enabled: payload.enabled } : {}),
      ...(typeof payload.text === 'string' ? { text: payload.text } : {}),
      params: { ...previous.params, ...numbers },
    };
    server.set(id, next);
    return next;
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
  clients.push(client);
  const rendered = render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={[`/admin/auto-messages/${first.id}`]}>
          <Routes>
            <Route
              path="/admin/auto-messages/:id"
              element={
                <CardBoundary>
                  <Link to="/admin/auto-messages/trial-discount">Move to other card</Link>
                  <AdminAutoMessageDetail />
                </CardBoundary>
              }
            />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </I18nextProvider>,
  );
  await screen.findByRole('heading', { name: first.title });
  if (first.params && Object.keys(first.params).length)
    await screen.findByText(
      i18n.t(
        first.id === ID
          ? 'admin.autoMessages.discount.settingsTitle'
          : 'admin.autoMessages.detail.when',
      ),
    );
  return {
    ...rendered,
    i18n,
    client,
    setServer: (next: ReturnType<typeof card>) => server.set(next.id, next),
  };
}

function action(language = 'ru', verb: 'save' | 'cancel' = 'save') {
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
function enableButton(language = 'ru') {
  return screen.getByRole('button', {
    name: language === 'ru' ? 'Включить скидку' : 'Enable discount',
    exact: true,
  });
}
function review(language = 'ru') {
  return screen.getByRole('region', {
    name: language === 'ru' ? /^Включить скидку \d+%\?$/ : /^Enable a \d+% discount\?$/,
  });
}
function normalize(node: HTMLElement) {
  return node.textContent?.replace(/[\s\u00a0\u202f]+/g, ' ') ?? '';
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
// React intentionally suppresses disabled DOM clicks. This one dispatch-boundary probe invokes
// the actual registered handler too, so deleting its busy guard cannot survive behind disabled.
function invokeRegisteredClick(button: HTMLElement) {
  const key = Object.keys(button).find((name) => name.startsWith('__reactProps$'));
  expect(key).toBeTruthy();
  const props = (button as unknown as Record<string, { onClick?: () => unknown }>)[key as string];
  expect(props.onClick).toBeTypeOf('function');
  act(() => {
    void props.onClick?.();
  });
}
function invalidPercent(i18n: ReturnType<typeof createInstance>) {
  expect(i18n.exists('admin.autoMessages.discount.invalidPercent')).toBe(true);
  const message = i18n.t('admin.autoMessages.discount.invalidPercent');
  expect(message).toMatch(/30/);
  expect(screen.getByText(message)).toBeTruthy();
  expect(screen.queryByText(i18n.t('admin.autoMessages.discount.missingPrices'))).toBeNull();
}

beforeEach(() => {
  get.mockReset();
  patch.mockReset();
  confirm.mockReset();
  confirm.mockResolvedValue(true);
});
afterEach(() => {
  cleanup();
  clients.splice(0).forEach((client) => client.clear());
});

describe('АП-4 PR-2а поправки: карточки изолированы при настоящем переходе Link', () => {
  const carrierText = 'Текст только письма-носителя.';
  const ownText = 'Собственный текст карточки скидки.';
  function carrier() {
    return card({
      id: 'trial-1d',
      title: 'Письмо-носитель',
      text: carrierText,
      discount_context: context,
    });
  }
  async function configure(i18n: ReturnType<typeof createInstance>) {
    fireEvent.click(
      screen.getByRole('link', {
        name: i18n.t('admin.autoMessages.discount.configure'),
      }),
    );
    await screen.findByRole('heading', { name: TITLE });
  }

  it.each(['ru', 'en'])(
    'P2: открытый чужой черновик сбрасывается, свой текст сохраняется своим ID (%s)',
    async (language) => {
      const { i18n } = await show(carrier(), language, [card({ text: ownText })]);
      fireEvent.click(
        screen.getByRole('button', {
          name: i18n.t('admin.autoMessages.detail.textEdit'),
        }),
      );
      fireEvent.change(screen.getByRole('textbox'), {
        target: { value: 'Чужой несохранённый черновик.' },
      });
      await configure(i18n);
      expect(screen.queryByRole('textbox')).toBeNull();
      expect(screen.queryByText('Чужой несохранённый черновик.')).toBeNull();
      fireEvent.click(
        screen.getByRole('button', {
          name: i18n.t('admin.autoMessages.detail.textEdit'),
        }),
      );
      expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe(ownText);
      expect(
        (
          screen.getByRole('button', {
            name: i18n.t('admin.autoMessages.detail.textSave'),
          }) as HTMLButtonElement
        ).disabled,
      ).toBe(true);
      fireEvent.change(screen.getByRole('textbox'), {
        target: { value: 'Новый собственный текст.' },
      });
      fireEvent.click(
        screen.getByRole('button', {
          name: i18n.t('admin.autoMessages.detail.textSave'),
        }),
      );
      await waitFor(() =>
        expect(patch).toHaveBeenCalledWith(ID, {
          text: 'Новый собственный текст.',
        }),
      );
      expect(patch).toHaveBeenCalledTimes(1);
    },
  );

  it('P2: textWarning и «Сохранено» не переезжают из успешной правки носителя', async () => {
    const { i18n, setServer } = await show(carrier(), 'ru', [card({ text: ownText })]);
    patch.mockImplementationOnce(async () => {
      const updated = card({
        ...carrier(),
        text: 'Сохранённый текст носителя.',
        text_warning: 'Старое предупреждение о логотипе.',
      });
      setServer(updated);
      return updated;
    });
    fireEvent.click(
      screen.getByRole('button', {
        name: i18n.t('admin.autoMessages.detail.textEdit'),
      }),
    );
    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: 'Сохранённый текст носителя.' },
    });
    fireEvent.click(
      screen.getByRole('button', {
        name: i18n.t('admin.autoMessages.detail.textSave'),
      }),
    );
    await screen.findByText('Старое предупреждение о логотипе.');
    expect(screen.getByText(i18n.t('admin.autoMessages.save.done'))).toBeTruthy();
    await configure(i18n);
    expect(screen.queryByText('Старое предупреждение о логотипе.')).toBeNull();
    expect(screen.queryByText(i18n.t('admin.autoMessages.save.done'))).toBeNull();
    expect(screen.queryByRole('textbox')).toBeNull();
    fireEvent.click(screen.getByRole('switch'));
    expect((enableButton() as HTMLButtonElement).disabled).toBe(false);
  });

  it('P2: отказ старого редактора исчезает; отказ новой карточки виден', async () => {
    const { i18n } = await show(carrier(), 'ru', [card({ text: ownText })]);
    patch.mockRejectedValueOnce({
      isAxiosError: true,
      response: { data: { detail: 'Ошибка старого письма.' } },
    });
    fireEvent.click(
      screen.getByRole('button', {
        name: i18n.t('admin.autoMessages.detail.textEdit'),
      }),
    );
    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: 'Несохранённый старый текст.' },
    });
    fireEvent.click(
      screen.getByRole('button', {
        name: i18n.t('admin.autoMessages.detail.textSave'),
      }),
    );
    await screen.findByText('Ошибка старого письма.');
    await configure(i18n);
    expect(screen.queryByText('Ошибка старого письма.')).toBeNull();
    patch.mockRejectedValueOnce({
      isAxiosError: true,
      response: { data: { detail: 'Ошибка новой скидки.' } },
    });
    fireEvent.click(screen.getByRole('switch'));
    expect((enableButton() as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(enableButton());
    await screen.findByText('Ошибка новой скидки.');
    expect(patch.mock.calls[1]).toEqual([ID, { enabled: true }]);
  });

  it('P2: поздний ответ старой текстовой PATCH не меняет новое состояние', async () => {
    const { i18n } = await show(carrier(), 'ru', [card({ text: ownText })]);
    const pending = deferred<ReturnType<typeof card>>();
    patch.mockReturnValueOnce(pending.promise);
    fireEvent.click(
      screen.getByRole('button', {
        name: i18n.t('admin.autoMessages.detail.textEdit'),
      }),
    );
    fireEvent.change(screen.getByRole('textbox'), {
      target: { value: 'Ожидающий старый текст.' },
    });
    fireEvent.click(
      screen.getByRole('button', {
        name: i18n.t('admin.autoMessages.detail.textSave'),
      }),
    );
    await waitFor(() => expect(patch).toHaveBeenCalledTimes(1));
    await configure(i18n);
    await act(async () =>
      pending.resolve(card({ ...carrier(), text_warning: 'Позднее старое предупреждение.' })),
    );
    expect(screen.queryByText('Позднее старое предупреждение.')).toBeNull();
    expect(screen.queryByText(i18n.t('admin.autoMessages.save.done'))).toBeNull();
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.getByText(ownText)).toBeTruthy();
    expect(patch.mock.calls).toEqual([['trial-1d', { text: 'Ожидающий старый текст.' }]]);
  });

  it('настоящая configure-Link сохраняет async fence: согласие OFF прежнего носителя не отправляет PATCH', async () => {
    const { i18n } = await show({ ...carrier(), enabled: true, state: 'live' }, 'ru', [
      card({ text: ownText }),
    ]);
    const pending = deferred<boolean>();
    confirm.mockReturnValueOnce(pending.promise);
    fireEvent.click(screen.getByRole('switch'));
    await waitFor(() => expect(confirm).toHaveBeenCalledTimes(1));
    await configure(i18n);
    await act(async () => pending.resolve(true));
    expect(patch).not.toHaveBeenCalled();
    expect(screen.getByRole('heading', { name: TITLE })).toBeTruthy();
  });
});

describe('АП-4 PR-2а поправки: содержание и доступный отказ рядом с сохранением', () => {
  it.each(['ru', 'en'])(
    'Решение16.10: окно содержит сохранённый процент, аудиторию и цену без четырёхполевого повтора (%s)',
    async (language) => {
      const { i18n } = await show({}, language);
      fireEvent.click(screen.getByRole('switch'));
      const panel = review(language);
      expect(
        within(panel).getByText(i18n.t('admin.autoMessages.discount.checkTitle', { percent: 15 })),
      ).toBeTruthy();
      expect(normalize(panel)).toContain(i18n.t('admin.autoMessages.discount.vpnAudience'));
      expect(normalize(panel)).toContain(
        i18n.t('admin.autoMessages.discount.testAudienceScope').trim(),
      );
      expect(normalize(panel)).toMatch(/173[,.]45/);
      expect(normalize(panel)).not.toContain(carrierLabels[1]);
      expect(normalize(panel)).not.toContain(audienceLabels[0]);
      expect(normalize(panel)).not.toContain('12 ч');
      expect(patch).not.toHaveBeenCalled();
    },
  );

  it.each(['ru', 'en'])(
    'Решение16.10: старыйAPI без фразы тестового этапа работает без неё (%s)',
    async (language) => {
      const { i18n } = await show({ discount_context: undefined, choices: undefined }, language);
      fireEvent.click(screen.getByRole('switch'));
      const panel = review(language);
      expect(normalize(panel)).toContain(i18n.t('admin.autoMessages.discount.vpnAudience'));
      expect(normalize(panel)).not.toContain(
        i18n.t('admin.autoMessages.discount.testAudienceScope').trim(),
      );
      expect(normalize(panel)).not.toContain('Кому: 1');
    },
  );

  it.each([false, true])(
    'P3-2: saveFirst относится только к выключенной скидке (enabled=%s)',
    async (enabled) => {
      const { i18n } = await show({
        enabled,
        state: enabled ? 'live' : 'quiet',
      });
      fireEvent.click(screen.getByRole('button', { name: carrierLabels[0] }));
      const hint = screen.queryByText(i18n.t('admin.autoMessages.discount.saveFirst'));
      if (enabled) expect(hint).toBeNull();
      else expect(hint).toBeTruthy();
      expect(patch).not.toHaveBeenCalled();
    },
  );

  it.each([
    ['отсутствующие', 'ru', undefined],
    ['не-массивные', 'en', { carrier: { value: 24, label: 'Broken carrier' }, audience: 'broken' }],
  ])(
    'P3-1/7: %s enum choices не дают редактировать числовые коды; другое поле сохраняется (%s)',
    async (_, language, choices) => {
      const { i18n } = await show({ choices }, language as string);
      const fallback = language === 'ru' ? 'Нет подписи варианта' : 'Option label unavailable';
      for (const [field, value] of [
        ['carrier', 24],
        ['audience', 1],
      ] as const) {
        const container = screen.getByText(i18n.t(`admin.autoMessages.discount.${field}`), {
          exact: true,
        }).parentElement as HTMLElement;
        expect(within(container).getByText(fallback, { exact: true })).toBeTruthy();
        expect(within(container).queryByRole('button', { name: '+' })).toBeNull();
        expect(within(container).queryByRole('button', { name: '−' })).toBeNull();
        expect(within(container).queryAllByRole('button')).toHaveLength(0);
        expect(within(container).queryByText(new RegExp(`^${value}(?:\\s*(?:ч|h))?$`))).toBeNull();
      }
      expect(patch).not.toHaveBeenCalled();
      fireEvent.click(screen.getByRole('button', { name: '48 ч' }));
      fireEvent.click(action(language as string));
      await waitFor(() => expect(patch.mock.calls).toEqual([[ID, { valid_hours: 48 }]]));
      expect(confirm).not.toHaveBeenCalled();
    },
  );

  it.each(['ru', 'en'])(
    'P3-4: клиентский отказ role=alert находится после полей рядом с Save (%s)',
    async (language) => {
      const { i18n } = await show({ discount_prices: { '15': prices['15'] } }, language);
      fireEvent.click(screen.getByRole('button', { name: '25 %' }));
      fireEvent.click(action(language));
      const alert = screen.getByRole('alert');
      expect(alert.textContent).toBe(i18n.t('admin.autoMessages.discount.missingPrices'));
      const settings = screen.getByText(i18n.t('admin.autoMessages.discount.settingsTitle'))
        .parentElement as HTMLElement;
      expect(settings.contains(alert)).toBe(true);
      expect(settings.contains(action(language))).toBe(true);
      const lastField = screen.getByRole('button', { name: '+' });
      expect(
        lastField.compareDocumentPosition(alert) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
      expect(
        alert.compareDocumentPosition(action(language)) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
      expect(patch).not.toHaveBeenCalled();
    },
  );

  it('P3-4: серверный отказ Save тоже виден внутри панели параметров как alert', async () => {
    const { i18n } = await show();
    patch.mockRejectedValueOnce({
      isAxiosError: true,
      response: { data: { detail: 'Параметры не приняты сервером.' } },
    });
    fireEvent.click(screen.getByRole('button', { name: carrierLabels[0] }));
    fireEvent.click(action());
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe('Параметры не приняты сервером.');
    const settings = screen.getByText(i18n.t('admin.autoMessages.discount.settingsTitle'))
      .parentElement as HTMLElement;
    expect(settings.contains(alert)).toBe(true);
    expect(patch).toHaveBeenCalledWith(ID, { carrier: 48 });
  });

  it.each(['ru', 'en'])(
    'P3-5: отсутствие цены показано самостоятельной фразой, без склейки checkHint (%s)',
    async (language) => {
      const { i18n } = await show({ discount_prices: undefined }, language);
      fireEvent.click(screen.getByRole('switch'));
      const panel = review(language);
      const message = i18n.t('admin.autoMessages.discount.missingPrices');
      expect(within(panel).getByText(message, { exact: true })).toBeTruthy();
      expect(normalize(panel)).not.toContain(
        i18n.t('admin.autoMessages.discount.checkHint', { price: message }),
      );
      expect(normalize(panel)).not.toContain('..');
      expect((enableButton(language) as HTMLButtonElement).disabled).toBe(true);
      fireEvent.click(enableButton(language));
      expect(patch).not.toHaveBeenCalled();
    },
  );

  it.each(['trial-2d', 'trial-1d', 'trial-2h', 'trial-discount', ID])(
    'Решение16.10: одна строка обеих скидок только на старой карточке (%s)',
    async (id) => {
      const { i18n } = await show({
        id,
        title: id,
        params: null,
        discount_context: { ...context, legacy_enabled: true },
      });
      const warning = screen.queryByText(i18n.t('admin.autoMessages.discount.bothEnabled'));
      if (id === 'trial-discount') expect(warning).toBeTruthy();
      else expect(warning).toBeNull();
    },
  );
  it.each(['low-balance', 'wave2', 'paid-3d'])(
    'P3-6: ошибочный discount_context не предупреждает о скидках чужую карточку %s',
    async (id) => {
      const { i18n } = await show({
        id,
        title: id,
        params: null,
        discount_context: { ...context, carrier_id: id, legacy_enabled: true },
      });
      expect(screen.queryByText(i18n.t('admin.autoMessages.discount.bothEnabled'))).toBeNull();
      expect(screen.queryByRole('status')).toBeNull();
    },
  );

  it.each([
    [
      'объект choices',
      {
        carrier: { value: 24, label: 'Broken carrier' },
        audience: { value: 1, label: 'Broken audience' },
      },
      prices,
    ],
    ['строка choices', { carrier: 'broken', audience: 'broken' }, prices],
    ['объект строки цены', card().choices, { '15': { period_days: 30, price_kopeks: 17345 } }],
    ['строка строки цены', card().choices, { '15': 'broken' }],
  ])(
    'P3-7: %s не падает и не отправляет PATCH при простом открытии',
    async (_, choices, discountPrices) => {
      const { i18n } = await show({ choices, discount_prices: discountPrices });
      expect(screen.queryByText('Card could not render')).toBeNull();
      fireEvent.click(screen.getByRole('switch'));
      expect(review()).toBeTruthy();
      expect(screen.queryByText('Card could not render')).toBeNull();
      if (!Array.isArray((discountPrices as Record<string, unknown>)['15'])) {
        expect(
          within(review()).getByText(i18n.t('admin.autoMessages.discount.missingPrices')),
        ).toBeTruthy();
        expect((enableButton() as HTMLButtonElement).disabled).toBe(true);
      }
      expect(patch).not.toHaveBeenCalled();
    },
  );

  it.each([
    [
      'ru',
      'Личная скидка на любой срок и число устройств. Кому уже выдана другая личная скидка, новая не выдаётся — их скидка остаётся.',
    ],
    [
      'en',
      'A personal discount for any duration and device count. Clients who already have another personal discount are not issued a new one. Their existing discount stays in place.',
    ],
  ])('P3-8: точная понятная подсказка процента (%s)', async (language, hint) => {
    const { i18n } = await show({}, language);
    expect(i18n.t('admin.autoMessages.discount.percentHint')).toBe(hint);
    expect(screen.getByText(hint, { exact: true })).toBeTruthy();
  });
});

describe('АП-4 PR-2а P3-9: постоянные assertions для семи прежних survivors', () => {
  it.each([15, 40])(
    'MA/P3-3: варианты выше 30 процентов не появляются даже при backend limit50 и saved%s',
    async (percent) => {
      await show({ params: { ...card().params, discount_percent: percent } });
      expect(screen.getByRole('button', { name: '30 %' })).toBeTruthy();
      expect(screen.queryByRole('button', { name: '40 %' })).toBeNull();
      expect(screen.queryByRole('button', { name: '50 %' })).toBeNull();
    },
  );

  it.each(['ru', 'en'])(
    'MA/P3-3: сохранённые 40 процентов не дают сохранить другое поле; отдельная причина invalidPercent (%s)',
    async (language) => {
      const { i18n } = await show({ params: { ...card().params, discount_percent: 40 } }, language);
      fireEvent.click(screen.getByRole('button', { name: carrierLabels[0] }));
      fireEvent.click(action(language));
      invalidPercent(i18n);
      expect(confirm).not.toHaveBeenCalled();
      expect(patch).not.toHaveBeenCalled();
    },
  );

  it.each(['ru', 'en'])(
    'MA/P3-3: сохранённые 40 процентов не включаются даже при достоверной цене40 (%s)',
    async (language) => {
      const { i18n } = await show({ params: { ...card().params, discount_percent: 40 } }, language);
      fireEvent.click(screen.getByRole('switch'));
      fireEvent.click(enableButton(language));
      invalidPercent(i18n);
      expect(confirm).not.toHaveBeenCalled();
      expect(patch).not.toHaveBeenCalled();
    },
  );

  it('MA: ровно30% сохраняется и отдельно включается с согласиями и серверной ценой', async () => {
    await show();
    fireEvent.click(screen.getByRole('button', { name: '30 %' }));
    fireEvent.click(action());
    await waitFor(() => expect(patch).toHaveBeenCalledWith(ID, { discount_percent: 30 }));
    await waitFor(() =>
      expect((screen.getByRole('switch') as HTMLButtonElement).disabled).toBe(false),
    );
    fireEvent.click(screen.getByRole('switch'));
    fireEvent.click(enableButton());
    await waitFor(() => expect(patch).toHaveBeenCalledWith(ID, { enabled: true }));
    expect(confirm).toHaveBeenCalledTimes(2);
    confirm.mock.calls.forEach(([question]) => expect(question).toMatch(/30.*154,32/));
  });

  it('MA: legacy trial-discount сохраняет прежние варианты40/50 и не получает новый потолок', async () => {
    await show({
      id: 'trial-discount',
      discount_context: undefined,
      params: { discount_percent: 40, valid_hours: 24 },
    });
    expect(screen.getByRole('button', { name: '40 %' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '50 %' }));
    fireEvent.click(action());
    await waitFor(() =>
      expect(patch).toHaveBeenCalledWith('trial-discount', {
        discount_percent: 50,
      }),
    );
    expect(confirm).not.toHaveBeenCalled();
  });

  it('MB: неизвестное поле скрыто даже с собственными limits+choices и не попадает в PATCH', async () => {
    await show({
      params: { valid_hours: 24, future_backend_number: 99 },
      limits: { valid_hours: [1, 168], future_backend_number: [1, 999] },
      choices: {
        future_backend_number: [
          { value: 99, label: 'Unknown current choice' },
          { value: 123, label: 'Unknown changed choice' },
        ],
      },
    });
    expect(screen.queryByText(/future_backend_number/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Unknown current choice' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Unknown changed choice' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '48 ч' }));
    fireEvent.click(action());
    await waitFor(() => expect(patch.mock.calls).toEqual([[ID, { valid_hours: 48 }]]));
  });

  it.each([
    ['carrier', 24, 'carrier'],
    ['audience', 1, 'audience'],
    ['post_trial_hours', 12, 'postTrialHours'],
  ])(
    'MC: поле %s без обязательных limits полностью скрыто и не PATCHится',
    async (field, value, label) => {
      const { i18n } = await show({
        params: { valid_hours: 24, [field]: value },
        limits: { valid_hours: [1, 168] },
      });
      expect(
        screen.queryByText(i18n.t(`admin.autoMessages.discount.${label}`), {
          exact: true,
        }),
      ).toBeNull();
      expect(screen.queryByText('Card could not render')).toBeNull();
      if (field === 'carrier')
        carrierLabels.forEach((name) => expect(screen.queryByRole('button', { name })).toBeNull());
      if (field === 'audience')
        audienceLabels.forEach((name) => expect(screen.queryByRole('button', { name })).toBeNull());
      if (field === 'post_trial_hours')
        expect(screen.queryByRole('button', { name: '+' })).toBeNull();
      fireEvent.click(screen.getByRole('button', { name: '48 ч' }));
      fireEvent.click(action());
      await waitFor(() => expect(patch.mock.calls).toEqual([[ID, { valid_hours: 48 }]]));
    },
  );

  it('MD: тумблер не открывает enable-review во время deferred native-confirm; handler защищён сам', async () => {
    await show();
    const pending = deferred<boolean>();
    confirm.mockReturnValueOnce(pending.promise);
    fireEvent.click(screen.getByRole('button', { name: '25 %' }));
    fireEvent.click(action());
    await waitFor(() => expect(confirm).toHaveBeenCalledTimes(1));
    const toggle = screen.getByRole('switch');
    expect((toggle as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(toggle);
    invokeRegisteredClick(toggle);
    expect(screen.queryByRole('region', { name: 'Проверьте перед включением' })).toBeNull();
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(patch).not.toHaveBeenCalled();
    await act(async () => pending.resolve(false));
  });

  it('MD: pending PATCH блокирует и disabled click, и прямой вызов toggle-handler', async () => {
    await show();
    const pending = deferred<ReturnType<typeof card>>();
    patch.mockReturnValueOnce(pending.promise);
    fireEvent.click(screen.getByRole('button', { name: carrierLabels[0] }));
    fireEvent.click(action());
    await waitFor(() => expect(patch).toHaveBeenCalledTimes(1));
    const toggle = screen.getByRole('switch');
    expect((toggle as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(toggle);
    invokeRegisteredClick(toggle);
    expect(screen.queryByRole('region', { name: 'Проверьте перед включением' })).toBeNull();
    expect(confirm).not.toHaveBeenCalled();
    expect(patch.mock.calls).toEqual([[ID, { carrier: 48 }]]);
    await act(async () => pending.resolve(card({ params: { ...card().params, carrier: 48 } })));
  });

  it('ME: Choices, Stepper и отмена черновика отключены на всё время подтверждения', async () => {
    await show();
    const pending = deferred<boolean>();
    confirm.mockReturnValueOnce(pending.promise);
    fireEvent.click(screen.getByRole('button', { name: '25 %' }));
    fireEvent.click(action());
    await waitFor(() => expect(confirm).toHaveBeenCalledTimes(1));
    [carrierLabels[0], audienceLabels[1], '30 %', '48 ч', '+', '−'].forEach((name) => {
      const button = screen.getByRole('button', {
        name,
        exact: true,
      }) as HTMLButtonElement;
      expect(button.disabled).toBe(true);
      fireEvent.click(button);
    });
    expect((action('ru', 'cancel') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(action('ru', 'cancel'));
    expect(screen.getByRole('button', { name: '25 %' }).getAttribute('aria-pressed')).toBe('true');
    expect(patch).not.toHaveBeenCalled();
    await act(async () => pending.resolve(false));
    expect(
      (
        screen.getByRole('button', {
          name: carrierLabels[0],
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false);
    expect((screen.getByRole('button', { name: '+' }) as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(action('ru', 'cancel'));
    expect(screen.queryByRole('button', { name: 'Сохранить', exact: true })).toBeNull();
    expect(screen.getByRole('button', { name: '15 %' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('MH: черновик блокирует включение даже если review открыта раньше; отмена разрешает сохранённые условия', async () => {
    await show();
    fireEvent.click(screen.getByRole('switch'));
    expect((enableButton() as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: carrierLabels[0] }));
    expect(review()).toBeTruthy();
    expect(normalize(review())).toContain('Включить скидку 15%?');
    expect((enableButton() as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(enableButton());
    invokeRegisteredClick(enableButton());
    expect(patch).not.toHaveBeenCalled();
    expect(confirm).not.toHaveBeenCalled();
    fireEvent.click(action('ru', 'cancel'));
    expect((enableButton() as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(enableButton());
    await waitFor(() => expect(patch.mock.calls).toEqual([[ID, { enabled: true }]]));
  });

  it('MN: review и высокое подтверждение выбирают именно30дневную цену, даже если другой период раньше', async () => {
    const table = {
      ...prices,
      '25': [
        { period_days: 365, price_kopeks: 99999 },
        { period_days: 30, price_kopeks: 20917 },
      ],
    };
    await show({
      params: { ...card().params, discount_percent: 25 },
      discount_prices: table,
    });
    fireEvent.click(screen.getByRole('switch'));
    expect(normalize(review())).toContain('209,17');
    expect(normalize(review())).not.toContain('999,99');
    fireEvent.click(enableButton());
    await waitFor(() => expect(patch).toHaveBeenCalledWith(ID, { enabled: true }));
    expect(confirm.mock.calls[0][0]).toMatch(/25.*209,17/);
    expect(confirm.mock.calls[0][0]).not.toMatch(/999[,.]99/);
  });

  it('MN: пригодная цена другого периода не разрешает Save/Enable, если цены30дней нет', async () => {
    const { i18n } = await show({
      discount_prices: {
        ...prices,
        '25': [{ period_days: 365, price_kopeks: 99999 }],
      },
    });
    fireEvent.click(screen.getByRole('button', { name: '25 %' }));
    fireEvent.click(action());
    expect(screen.getByRole('alert').textContent).toBe(
      i18n.t('admin.autoMessages.discount.missingPrices'),
    );
    expect(confirm).not.toHaveBeenCalled();
    expect(patch).not.toHaveBeenCalled();
    cleanup();
    await show({
      params: { ...card().params, discount_percent: 25 },
      discount_prices: { '25': [{ period_days: 365, price_kopeks: 99999 }] },
    });
    fireEvent.click(screen.getByRole('switch'));
    expect((enableButton() as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(enableButton());
    expect(confirm).not.toHaveBeenCalled();
    expect(patch).not.toHaveBeenCalled();
  });
});

describe('АП4.PR4: согласованные состояния и короткие окна', () => {
  it.each(['ru', 'en'])(
    'OFF без повторной причины, ON с фразой только из контекста (%s)',
    async (language) => {
      const { i18n } = await show({}, language);
      expect(screen.getByText(i18n.t('admin.autoMessages.discount.switchOff'))).toBeTruthy();
      expect(screen.queryByText('Выключено здесь')).toBeNull();
      expect(screen.queryByText(i18n.t('admin.autoMessages.discount.standsNote'))).toBeNull();
      expect(screen.getByText(i18n.t('admin.autoMessages.discount.audienceHint'))).toBeTruthy();
      expect(
        screen.getByText(i18n.t('admin.autoMessages.discount.postTrialHoursHint')),
      ).toBeTruthy();
    },
  );

  it.each([undefined, null, 'Пока только тестовым аккаунтам'])(
    'ON и условная фраза этапа (%s)',
    async (note) => {
      const { i18n } = await show({
        enabled: true,
        state: 'live',
        discount_context: { ...context, rollout_note: note },
      });
      expect(screen.getByText(i18n.t('admin.autoMessages.discount.switchOn'))).toBeTruthy();
      expect(Boolean(screen.queryByText(i18n.t('admin.autoMessages.discount.standsNote')))).toBe(
        Boolean(note),
      );
      expect(screen.queryByText(i18n.t('admin.autoMessages.detail.switchOn'))).toBeNull();
    },
  );

  it.each([undefined, null])(
    'Обе скидки после тестового этапа не дают прежний совет (%s)',
    async (note) => {
      const { i18n } = await show({
        id: 'trial-discount',
        discount_context: { ...context, legacy_enabled: true, rollout_note: note },
      });
      expect(screen.queryByText(i18n.t('admin.autoMessages.discount.bothEnabled'))).toBeNull();
    },
  );

  it('выключение носителя содержит его настоящее название, одной фразой', async () => {
    const title = 'Пробный закончится завтра';
    const { i18n } = await show(
      card({
        id: 'trial-1d',
        title,
        params: null,
        enabled: true,
        state: 'live',
        discount_context: context,
      }),
    );
    confirm.mockResolvedValue(false);
    fireEvent.click(screen.getByRole('switch'));
    await waitFor(() => expect(confirm).toHaveBeenCalled());
    expect(confirm.mock.calls[0][0]).toBe(
      i18n.t('admin.autoMessages.discount.carrierOff', { title }),
    );
    expect(patch).not.toHaveBeenCalled();
  });
});
