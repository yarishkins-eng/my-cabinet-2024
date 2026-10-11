// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import en from '../locales/en.json';
import ru from '../locales/ru.json';

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
  return { ...actual, useParams: () => ({ id: 'trial-started' }) };
});

vi.mock('../platform/hooks/useNativeDialog', () => ({
  useDestructiveConfirm: () => confirmOff,
}));

vi.mock('../platform/hooks/usePlatform', () => ({
  usePlatform: () => ({ capabilities: { hasBackButton: true, hasNativeDialogs: false } }),
}));

import AdminAutoMessageDetail from './AdminAutoMessageDetail';

const originalText = 'Пробный включён до {end_date}. Подключитесь за 2 минуты.';

function card(overrides: Record<string, unknown> = {}) {
  return {
    id: 'trial-started',
    group: 'trial',
    title: 'Пробный включён',
    when: 'Сразу после начала пробного',
    text: originalText,
    text_source: 'code',
    text_has_english: true,
    text_with_logo: false,
    text_markers: [{ name: 'end_date', what: 'когда закончится пробный', example: '14.10.2026' }],
    control: 'toggle',
    enabled: true,
    state: 'live',
    quiet_reason: null,
    note: null,
    shares_switch_with: null,
    warning: null,
    params: {},
    limits: {},
    buttons: [{ label: 'Подключить VPN', target: 'Подключение VPN', tracked: false }],
    sent_count: null,
    claimed_count: null,
    claim_tracked: false,
    history: [],
    history_note: '',
    ...overrides,
  };
}

async function renderCard(language = 'ru') {
  const i18n = createInstance();
  await i18n.init({
    lng: language,
    fallbackLng: 'en',
    resources: { ru: { translation: ru }, en: { translation: en } },
    interpolation: { escapeValue: false },
  });
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <I18nextProvider i18n={i18n}>
      <QueryClientProvider client={client}>
        <MemoryRouter>
          <AdminAutoMessageDetail />
        </MemoryRouter>
      </QueryClientProvider>
    </I18nextProvider>,
  );
}

describe('карточка начала пробного: текстовый канал и прежнее управление', () => {
  beforeEach(() => {
    get.mockReset();
    patch.mockReset();
    confirmOff.mockReset();
    patch.mockResolvedValue({});
  });
  afterEach(cleanup);

  it.each([
    ['ru', 'Текстовое сообщение, без картинки'],
    ['en', 'Text message, no image'],
  ])('показывает текстовый канал внутри блока текста, язык %s', async (language, label) => {
    get.mockResolvedValue(card({ text_only: true }));
    await renderCard(language);

    const hint = await screen.findByText(label);
    const dictionary = language === 'ru' ? ru : en;
    const textSection = screen.getByText(dictionary.admin.autoMessages.detail.text).parentElement
      ?.parentElement;
    expect(textSection?.contains(hint)).toBe(true);
    expect(screen.getByText('Подключить VPN')).toBeTruthy();
  });

  it.each([
    ['нет поля в старом ответе', {}],
    ['поле false', { text_only: false }],
    ['строка вместо boolean', { text_only: 'true' }],
  ])('не меняет вид карточки, если %s', async (_, fields) => {
    get.mockResolvedValue(card(fields));
    await renderCard();

    await screen.findByText(originalText);
    expect(screen.queryByText('Текстовое сообщение, без картинки')).toBeNull();
    expect(screen.getByText(ru.admin.autoMessages.detail.textEdit)).toBeTruthy();
    expect(screen.getByRole('switch')).toBeTruthy();
  });

  it.each([
    ['новый ответ', { text_only: true }],
    ['старый ответ', {}],
  ])('метки, правка, возврат и выключатель работают: %s', async (_, fields) => {
    let current = card({ text_source: 'custom', ...fields });
    get.mockImplementation(async () => ({ ...current }));
    patch.mockImplementation(async (_id, payload) => {
      if (payload.text) current = { ...current, text: payload.text };
      if (payload.reset_text) current = { ...current, text: originalText, text_source: 'code' };
      if (payload.enabled !== undefined) current = { ...current, enabled: payload.enabled };
      return current;
    });
    confirmOff.mockResolvedValue(true);
    const { container } = await renderCard();

    await screen.findByText('{end_date}');
    expect(screen.getByText(/когда закончится пробный/)).toBeTruthy();
    expect(container.querySelector('textarea')).toBeNull();
    fireEvent.click(screen.getByText(ru.admin.autoMessages.detail.textEdit));
    fireEvent.change(container.querySelector('textarea') as HTMLTextAreaElement, {
      target: { value: 'Подключите VPN до {end_date}.' },
    });
    fireEvent.click(screen.getByText(ru.admin.autoMessages.detail.textSave));
    await waitFor(() =>
      expect(patch).toHaveBeenCalledWith('trial-started', {
        text: 'Подключите VPN до {end_date}.',
      }),
    );
    await waitFor(() => expect(container.querySelector('textarea')).toBeNull());

    fireEvent.click(screen.getByText(ru.admin.autoMessages.detail.textReset));
    await waitFor(() => expect(patch).toHaveBeenCalledWith('trial-started', { reset_text: true }));
    await waitFor(() =>
      expect(screen.queryByText(ru.admin.autoMessages.detail.textReset)).toBeNull(),
    );
    expect(screen.getByText(originalText)).toBeTruthy();

    fireEvent.click(screen.getByRole('switch'));
    await waitFor(() => expect(patch).toHaveBeenCalledWith('trial-started', { enabled: false }));
    expect(confirmOff).toHaveBeenCalledTimes(2);
  });
});
