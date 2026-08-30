// @vitest-environment jsdom

import { onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import ru from '../locales/ru.json';
import en from '../locales/en.json';
import { useNavigationGuardStore } from '../store/navigationGuard';

const {
  createCombined,
  getFilters,
  getEmailFilters,
  getButtons,
  preview,
  previewEmail,
  notifySuccess,
  notifyError,
  confirmDialog,
  uploadMedia,
} = vi.hoisted(() => ({
  createCombined: vi.fn(),
  getFilters: vi.fn(),
  getEmailFilters: vi.fn(),
  getButtons: vi.fn(),
  preview: vi.fn(),
  previewEmail: vi.fn(),
  notifySuccess: vi.fn(),
  notifyError: vi.fn(),
  confirmDialog: vi.fn(),
  uploadMedia: vi.fn(),
}));

vi.mock('../api/adminBroadcasts', () => ({
  adminBroadcastsApi: {
    createCombined,
    getFilters,
    getEmailFilters,
    getButtons,
    preview,
    previewEmail,
    uploadMedia,
  },
}));

vi.mock('../components/admin', () => ({
  AdminBackButton: () => null,
}));

vi.mock('../components/broadcasts/BroadcastPreview', () => ({
  TelegramPreview: ({ text }: { text: string }) => <div data-testid="telegram-preview">{text}</div>,
  EmailPreview: () => null,
}));

vi.mock('@/platform/hooks/useNotify', () => ({
  useNotify: () => ({ success: notifySuccess, error: notifyError }),
}));

vi.mock('@/platform/hooks/useNativeDialog', () => ({
  useNativeDialog: () => ({ confirm: confirmDialog }),
  // Отправка перешла на destructive-подтверждение: красная кнопка с названием действия
  // и заголовок, который обычный `confirm()` выбрасывает.
  useDestructiveConfirm: () => confirmDialog,
}));

vi.mock('react-i18next', async () => {
  const actual = await vi.importActual<Record<string, unknown>>('react-i18next');
  return {
    ...actual,
    useTranslation: () => ({
      t: (key: string, options?: string | Record<string, unknown>) => {
        if (typeof options === 'string') return options;
        return options ? `${key} ${JSON.stringify(options)}` : key;
      },
      i18n: { language: 'ru', changeLanguage: vi.fn() },
    }),
  };
});

import AdminBroadcastCreate from './AdminBroadcastCreate';

function LocationProbe() {
  return <div data-testid="location">{useLocation().pathname}</div>;
}

function renderPage() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const invalidateQueries = vi.spyOn(client, 'invalidateQueries');
  const view = render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/admin/broadcasts/create']}>
        <LocationProbe />
        <Routes>
          <Route path="/admin/broadcasts/create" element={<AdminBroadcastCreate />} />
          <Route path="/admin/broadcasts" element={<div>broadcast-list</div>} />
          <Route path="/admin/broadcasts/:id" element={<div>broadcast-detail</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { ...view, invalidateQueries };
}

function axiosError(status: number | undefined, detail: string) {
  return Object.assign(new Error(detail), {
    isAxiosError: true,
    response: status === undefined ? undefined : { status, data: { detail } },
  });
}

function broadcast(id: number) {
  return { id, status: 'queued' };
}

async function selectFilter(placeholder: string, label: string) {
  await waitFor(() =>
    expect(placeholder.includes('Email') ? getEmailFilters : getFilters).toHaveBeenCalled(),
  );
  fireEvent.click(screen.getByRole('button', { name: new RegExp(placeholder) }));
  fireEvent.click(await screen.findByRole('button', { name: new RegExp(label) }));
}

async function settle() {
  // Негативная проверка «не отправилось» проходит мгновенно и на пустом экране.
  // Прокручиваем несколько тиков, чтобы момент отправки действительно прошёл.
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function fillTelegram(label = 'Все Telegram', text = 'Тестовый текст') {
  await selectFilter('admin.broadcasts.selectFilterPlaceholder', label);
  fireEvent.change(screen.getByPlaceholderText('admin.broadcasts.messageTextPlaceholder'), {
    target: { value: text },
  });
  // РС-14б: «Отправить» больше не загорается без предпросмотра ИМЕННО этого текста.
  // Раньше хватало свежего счётчика получателей — то есть отправить можно было текст,
  // которого никто не видел каноническим.
  fireEvent.click(screen.getByRole('button', { name: 'Предпросмотр' }));
  await waitFor(() =>
    expect(
      (screen.getByRole('button', { name: 'admin.broadcasts.send' }) as HTMLButtonElement).disabled,
    ).toBe(false),
  );
}

async function enableAndFillEmail(label = 'Все Email') {
  fireEvent.click(screen.getByRole('button', { name: 'admin.broadcasts.enableEmail' }));
  await selectFilter('admin.broadcasts.selectEmailFilterPlaceholder', label);
  fireEvent.change(screen.getByPlaceholderText('admin.broadcasts.emailSubjectPlaceholder'), {
    target: { value: 'Тема' },
  });
  fireEvent.change(screen.getByPlaceholderText('admin.broadcasts.emailContentPlaceholder'), {
    target: { value: '<p>Письмо</p>' },
  });
  // Гарантия «уходит только то, что вы видели» теперь держится и для писем: раньше письмо
  // можно было отправить, ни разу не открыв предпросмотр, и первым его видел получатель.
  fireEvent.click(screen.getAllByRole('button', { name: 'Предпросмотр' }).at(-1)!);
  await waitFor(() =>
    expect(
      (screen.getByRole('button', { name: 'admin.broadcasts.send' }) as HTMLButtonElement).disabled,
    ).toBe(false),
  );
}

async function fillEmailOnly(label = 'Все Email') {
  fireEvent.click(screen.getByRole('button', { name: 'admin.broadcasts.enableTelegram' }));
  await enableAndFillEmail(label);
}

beforeEach(() => {
  for (const mock of [
    createCombined,
    getFilters,
    getEmailFilters,
    getButtons,
    preview,
    previewEmail,
    notifySuccess,
    notifyError,
    confirmDialog,
    uploadMedia,
  ]) {
    mock.mockReset();
  }
  useNavigationGuardStore.setState({ blocked: false });
  getFilters.mockResolvedValue({
    filters: [
      { key: 'all', label: 'Все Telegram', count: 1, group: 'basic' },
      { key: 'active', label: 'Активные Telegram', count: 1, group: 'subscription' },
    ],
    tariff_filters: [],
    custom_filters: [],
  });
  getEmailFilters.mockResolvedValue({
    filters: [
      { key: 'all_email', label: 'Все Email', count: 1, group: 'email' },
      { key: 'expired_email', label: 'Истёкшие Email', count: 1, group: 'email' },
    ],
  });
  getButtons.mockResolvedValue({ buttons: [] });
  preview.mockResolvedValue({ target: 'all', count: 1 });
  previewEmail.mockResolvedValue({ target: 'all_email', count: 1 });
  confirmDialog.mockResolvedValue(true);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  onlineManager.setOnline(true);
});

describe('РС-10: отказы создания рассылки видны и повтор не создаёт дубль', () => {
  it('не отправляет без явного подтверждения и показывает точную аудиторию с числом', async () => {
    const longTariffLabel = `Тариф ${'Очень-длинное-название-'.repeat(5)}`;
    getFilters.mockResolvedValueOnce({
      filters: [],
      tariff_filters: [
        { key: 'tariff_17', label: longTariffLabel, tariff_id: 17, count: 1, group: 'tariff' },
      ],
      custom_filters: [],
    });
    confirmDialog.mockResolvedValueOnce(false);
    renderPage();
    await fillTelegram(longTariffLabel);

    fireEvent.click(screen.getByRole('button', { name: 'admin.broadcasts.send' }));

    await waitFor(() => expect(confirmDialog).toHaveBeenCalledTimes(1));
    expect(confirmDialog.mock.calls[0][0]).toContain(`Telegram: ${longTariffLabel} — 1`);
    expect(confirmDialog.mock.calls[0][0]).toContain('admin.broadcasts.categorySystem');
    expect(createCombined).not.toHaveBeenCalled();
  });

  it('предпросмотр показывает канонический текст, который вернул backend', async () => {
    preview.mockResolvedValueOnce({ target: 'all', count: 1 }).mockResolvedValueOnce({
      target: 'all',
      count: 1,
      rendered_message_text: 'скрытые скобки ссылка',
      media_caption_separate: false,
    });
    renderPage();
    await fillTelegram();

    fireEvent.click(screen.getByRole('button', { name: 'Предпросмотр' }));

    await waitFor(() =>
      expect(screen.getByTestId('telegram-preview').textContent).toBe('скрытые скобки ссылка'),
    );
    expect(preview.mock.calls[1][0]).toEqual(
      expect.objectContaining({ message_text: 'Тестовый текст', has_media: false }),
    );
  });

  it('явно сообщает об ошибке медиа и не оставляет прежний file_id', async () => {
    uploadMedia.mockRejectedValueOnce(new Error('storage unavailable'));
    const { container } = renderPage();
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(['broken'], 'broken.pdf', { type: 'application/pdf' });

    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => expect(notifyError).toHaveBeenCalledTimes(1));
    expect(screen.queryByText('broken.pdf')).toBeNull();
    expect(input.value).toBe('');
  });

  it('показывает выбранное видео как video, а не сломанное изображение', async () => {
    const createObjectURL = vi.fn(() => 'blob:video-preview');
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', { ...URL, createObjectURL, revokeObjectURL });
    uploadMedia.mockResolvedValueOnce({ file_id: 'video-id' });
    const { container } = renderPage();
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;

    fireEvent.change(input, {
      target: { files: [new File(['video'], 'clip.mp4', { type: 'video/mp4' })] },
    });

    expect(await screen.findByText('clip.mp4')).toBeTruthy();
    expect(container.querySelector('video[src="blob:video-preview"]')).toBeTruthy();
    expect(container.querySelector('img[alt="Preview"]')).toBeNull();
  });

  it('передаёт backend-фильтр «Тест: только мне» без расширения target', async () => {
    getFilters.mockResolvedValueOnce({
      filters: [{ key: 'self', label: 'Тест: только мне', count: 1, group: 'basic' }],
      tariff_filters: [],
      custom_filters: [],
    });
    preview.mockResolvedValueOnce({ target: 'self', count: 1 });
    createCombined.mockResolvedValueOnce(broadcast(5));

    renderPage();
    await fillTelegram('Тест: только мне');

    expect(preview.mock.calls[0][0]).toEqual({ target: 'self', category: 'system' });
    fireEvent.click(screen.getByRole('button', { name: 'admin.broadcasts.send' }));
    await waitFor(() => expect(createCombined).toHaveBeenCalledTimes(1));
    expect(createCombined.mock.calls[0][0]).toEqual(
      expect.objectContaining({ channel: 'telegram', target: 'self', category: 'system' }),
    );
  });

  // 409 — отказ забора повторов РС-14г. Мутация «убрать 409 из набора» пережила весь файл,
  // пока его тут не было: без него отказ уходил в ветку «исход неизвестен» и запирал форму
  // насмерть ровно там, где сервер гарантированно ничего не создал.
  it.each([400, 401, 403, 409, 422])(
    'показывает причину однозначного HTTP %i и разрешает исправленный повтор',
    async (status) => {
      createCombined
        .mockRejectedValueOnce(axiosError(status, 'Invalid target: all'))
        .mockResolvedValueOnce(broadcast(7));
      renderPage();
      await fillTelegram();

      fireEvent.click(screen.getByRole('button', { name: 'admin.broadcasts.send' }));

      expect((await screen.findByRole('alert')).textContent).toContain('Invalid target: all');
      expect(screen.getByRole('alert').textContent).toContain('admin.broadcasts.createRejected');
      expect(
        (screen.getByRole('button', { name: 'admin.broadcasts.send' }) as HTMLButtonElement)
          .disabled,
      ).toBe(false);
      expect(screen.getByTestId('location').textContent).toBe('/admin/broadcasts/create');
      expect(createCombined.mock.calls.map(([payload]) => payload.channel)).toEqual(['telegram']);

      fireEvent.click(screen.getByRole('button', { name: 'admin.broadcasts.send' }));

      await waitFor(() =>
        expect(screen.getByTestId('location').textContent).toBe('/admin/broadcasts/7'),
      );
      expect(createCombined.mock.calls.map(([payload]) => payload.channel)).toEqual([
        'telegram',
        'telegram',
      ]);
    },
  );

  it('после Telegram success и Email 4xx повторяет только Email', async () => {
    createCombined
      .mockResolvedValueOnce(broadcast(11))
      .mockRejectedValueOnce(axiosError(400, 'Invalid email target: all_email'))
      .mockResolvedValueOnce(broadcast(12));
    const { invalidateQueries } = renderPage();
    await fillTelegram();
    await enableAndFillEmail();

    fireEvent.click(screen.getByRole('button', { name: 'admin.broadcasts.send' }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('admin.broadcasts.emailRejectedAfterTelegram');
    expect(alert.textContent).toContain('Invalid email target: all_email');
    expect(alert.textContent).toContain('11');
    expect(useNavigationGuardStore.getState().blocked).toBe(false);
    expect(
      (
        screen
          .getByPlaceholderText('admin.broadcasts.messageTextPlaceholder')
          .closest('fieldset') as HTMLFieldSetElement
      ).disabled,
    ).toBe(true);
    expect(
      (
        screen
          .getByPlaceholderText('admin.broadcasts.emailSubjectPlaceholder')
          .closest('fieldset') as HTMLFieldSetElement
      ).disabled,
    ).toBe(false);
    expect(
      (screen.getByRole('button', { name: 'admin.broadcasts.enableTelegram' }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(
      (screen.getByRole('button', { name: 'admin.broadcasts.enableEmail' }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(
      (screen.getByRole('button', { name: '⚙️ Системное' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(screen.getByTestId('location').textContent).toBe('/admin/broadcasts/create');
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: ['admin', 'broadcasts'] });
    expect(createCombined.mock.calls.map(([payload]) => payload.channel)).toEqual([
      'telegram',
      'email',
    ]);
    expect(screen.getByText(/admin\.broadcasts\.willBeSent/).textContent).not.toContain('(TG)');
    expect(screen.getByText(/admin\.broadcasts\.willBeSent/).textContent).toContain('(Email)');

    fireEvent.click(screen.getByRole('button', { name: 'admin.broadcasts.retryEmailOnly' }));

    await waitFor(() =>
      expect(screen.getByTestId('location').textContent).toBe('/admin/broadcasts'),
    );
    expect(createCombined.mock.calls.map(([payload]) => payload.channel)).toEqual([
      'telegram',
      'email',
      'email',
    ]);
    expect(notifySuccess).toHaveBeenCalledWith(expect.stringContaining('"telegramId":11'));
    expect(notifySuccess).toHaveBeenCalledWith(expect.stringContaining('"emailId":12'));
    expect(notifySuccess).toHaveBeenCalledWith(
      expect.stringContaining('admin.broadcasts.bothCreatedWithIds'),
    );
  });

  it('не помечает Telegram созданным до успешного ответа', async () => {
    createCombined
      .mockRejectedValueOnce(axiosError(400, 'Invalid target: all'))
      .mockResolvedValueOnce(broadcast(21))
      .mockResolvedValueOnce(broadcast(22));
    renderPage();
    await fillTelegram();
    await enableAndFillEmail();

    fireEvent.click(screen.getByRole('button', { name: 'admin.broadcasts.send' }));
    expect((await screen.findByRole('alert')).textContent).toContain(
      'admin.broadcasts.telegramRejected',
    );
    fireEvent.click(screen.getByRole('button', { name: 'admin.broadcasts.send' }));

    await waitFor(() =>
      expect(screen.getByTestId('location').textContent).toBe('/admin/broadcasts'),
    );
    expect(createCombined.mock.calls.map(([payload]) => payload.channel)).toEqual([
      'telegram',
      'telegram',
      'email',
    ]);
  });

  it('считает HTTP 408 неизвестным результатом и блокирует слепой повтор', async () => {
    createCombined.mockRejectedValueOnce(axiosError(408, 'Request Timeout'));
    renderPage();
    await fillTelegram();
    await enableAndFillEmail();

    fireEvent.click(screen.getByRole('button', { name: 'admin.broadcasts.send' }));

    expect((await screen.findByRole('alert')).textContent).toContain(
      'admin.broadcasts.telegramOutcomeUnknown',
    );
    expect(
      (screen.getByRole('button', { name: 'admin.broadcasts.send' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(screen.getByTestId('location').textContent).toBe('/admin/broadcasts/create');
    expect(createCombined.mock.calls.map(([payload]) => payload.channel)).toEqual(['telegram']);
  });

  it('блокирует повтор single-channel после HTTP 500 и предлагает историю', async () => {
    createCombined.mockRejectedValueOnce(axiosError(500, 'Internal Server Error'));
    renderPage();
    await fillTelegram();

    fireEvent.click(screen.getByRole('button', { name: 'admin.broadcasts.send' }));

    expect((await screen.findByRole('alert')).textContent).toContain(
      'admin.broadcasts.createOutcomeUnknown',
    );
    expect(
      (screen.getByRole('button', { name: 'admin.broadcasts.send' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(
      (
        screen.getByRole('button', {
          name: 'admin.broadcasts.openHistory',
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false);
    expect(screen.getByTestId('location').textContent).toBe('/admin/broadcasts/create');

    fireEvent.click(screen.getByRole('button', { name: 'admin.broadcasts.openHistory' }));
    await waitFor(() =>
      expect(screen.getByTestId('location').textContent).toBe('/admin/broadcasts'),
    );
  });

  it('считает потерянный HTTP-ответ неизвестным результатом', async () => {
    createCombined.mockRejectedValueOnce(axiosError(undefined, 'Network Error'));
    renderPage();
    await fillTelegram();

    fireEvent.click(screen.getByRole('button', { name: 'admin.broadcasts.send' }));

    expect((await screen.findByRole('alert')).textContent).toContain(
      'admin.broadcasts.createOutcomeUnknown',
    );
    expect(
      (screen.getByRole('button', { name: 'admin.broadcasts.send' }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it('не ставит критическую отправку в очередь без сети', async () => {
    createCombined.mockRejectedValueOnce(axiosError(undefined, 'Network Error'));
    renderPage();
    await fillTelegram();
    onlineManager.setOnline(false);

    fireEvent.click(screen.getByRole('button', { name: 'admin.broadcasts.send' }));

    expect((await screen.findByRole('alert')).textContent).toContain(
      'admin.broadcasts.createOutcomeUnknown',
    );
    expect(createCombined).toHaveBeenCalledTimes(1);
    expect(useNavigationGuardStore.getState().blocked).toBe(false);
  });

  it('после Telegram success и Email 500 блокирует повтор обоих каналов', async () => {
    createCombined
      .mockResolvedValueOnce(broadcast(31))
      .mockRejectedValueOnce(axiosError(500, 'Internal Server Error'));
    renderPage();
    await fillTelegram();
    await enableAndFillEmail();

    fireEvent.click(screen.getByRole('button', { name: 'admin.broadcasts.send' }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('admin.broadcasts.emailOutcomeUnknown');
    expect(alert.textContent).toContain('31');
    expect(
      (screen.getByRole('button', { name: 'admin.broadcasts.retryEmailOnly' }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(screen.getByTestId('location').textContent).toBe('/admin/broadcasts/create');
    expect(createCombined.mock.calls.map(([payload]) => payload.channel)).toEqual([
      'telegram',
      'email',
    ]);
  });

  it('показывает отказ Email-only и после исправления создаёт только Email', async () => {
    createCombined
      .mockRejectedValueOnce(axiosError(400, 'Invalid email target: all_email'))
      .mockResolvedValueOnce(broadcast(41));
    renderPage();
    await fillEmailOnly();

    fireEvent.click(screen.getByRole('button', { name: 'admin.broadcasts.send' }));
    expect((await screen.findByRole('alert')).textContent).toContain(
      'Invalid email target: all_email',
    );
    fireEvent.click(screen.getByRole('button', { name: 'admin.broadcasts.send' }));

    await waitFor(() =>
      expect(screen.getByTestId('location').textContent).toBe('/admin/broadcasts/41'),
    );
    expect(createCombined.mock.calls.map(([payload]) => payload.channel)).toEqual([
      'email',
      'email',
    ]);
  });

  it('синхронно гасит двойной клик и не даёт уйти во время запроса', async () => {
    let resolveCreate: ((value: ReturnType<typeof broadcast>) => void) | undefined;
    createCombined.mockImplementationOnce(
      () => new Promise((resolve) => (resolveCreate = resolve)),
    );
    renderPage();
    await fillTelegram();

    const send = screen.getByRole('button', { name: 'admin.broadcasts.send' });
    await act(async () => {
      fireEvent.click(send);
      fireEvent.click(send);
    });

    expect(createCombined).toHaveBeenCalledTimes(1);
    expect(useNavigationGuardStore.getState().blocked).toBe(true);
    expect(
      (screen.getByRole('button', { name: 'common.cancel' }) as HTMLButtonElement).disabled,
    ).toBe(true);

    resolveCreate?.(broadcast(51));
    await waitFor(() =>
      expect(screen.getByTestId('location').textContent).toBe('/admin/broadcasts/51'),
    );
    expect(useNavigationGuardStore.getState().blocked).toBe(false);
  });

  it('не разрешает Send, если фактический preview завершился ошибкой', async () => {
    preview.mockRejectedValueOnce(new Error('preview unavailable'));
    renderPage();
    await selectFilter('admin.broadcasts.selectFilterPlaceholder', 'Все Telegram');
    fireEvent.change(screen.getByPlaceholderText('admin.broadcasts.messageTextPlaceholder'), {
      target: { value: 'Тестовый текст' },
    });

    expect((await screen.findByRole('alert')).textContent).toContain(
      'admin.broadcasts.previewFailed',
    );
    const send = screen.getByRole('button', { name: 'admin.broadcasts.send' }) as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    fireEvent.click(send);
    expect(createCombined).not.toHaveBeenCalled();
  });

  it('не разрешает пустую аудиторию и не подменяет её числом из списка', async () => {
    preview.mockResolvedValueOnce({ target: 'all', count: 0 });
    renderPage();
    await selectFilter('admin.broadcasts.selectFilterPlaceholder', 'Все Telegram');
    fireEvent.change(screen.getByPlaceholderText('admin.broadcasts.messageTextPlaceholder'), {
      target: { value: 'Тестовый текст' },
    });

    expect((await screen.findByRole('alert')).textContent).toContain(
      'admin.broadcasts.recipientPreviewEmpty',
    );
    expect(
      (screen.getByRole('button', { name: 'admin.broadcasts.send' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(createCombined).not.toHaveBeenCalled();
  });

  it('смена категории инвалидирует оба preview и пересчитывает их с новым ключом', async () => {
    renderPage();
    await fillTelegram();
    await enableAndFillEmail();

    let resolveTelegramPreview: ((value: { target: string; count: number }) => void) | undefined;
    let resolveEmailPreview: ((value: { target: string; count: number }) => void) | undefined;
    preview.mockImplementationOnce(
      () => new Promise((resolve) => (resolveTelegramPreview = resolve)),
    );
    previewEmail.mockImplementationOnce(
      () => new Promise((resolve) => (resolveEmailPreview = resolve)),
    );

    fireEvent.click(screen.getByRole('button', { name: '📰 Новости' }));

    await waitFor(() => {
      expect(preview.mock.calls.at(-1)?.[0]).toEqual({ target: 'all', category: 'news' });
      expect(previewEmail.mock.calls.at(-1)?.[0]).toEqual({
        target: 'all_email',
        category: 'news',
      });
    });
    expect(
      (screen.getByRole('button', { name: 'admin.broadcasts.send' }) as HTMLButtonElement).disabled,
    ).toBe(true);

    resolveTelegramPreview?.({ target: 'all', count: 1 });
    resolveEmailPreview?.({ target: 'all_email', count: 1 });
    await waitFor(() =>
      expect(
        (screen.getByRole('button', { name: 'admin.broadcasts.send' }) as HTMLButtonElement)
          .disabled,
      ).toBe(false),
    );
    expect(getFilters).toHaveBeenCalledWith('news');
    expect(getEmailFilters).toHaveBeenCalledWith('news');
  });

  it('сохраняет видимую выбранную аудиторию, если новый каталог категории упал', async () => {
    renderPage();
    await fillTelegram();
    getFilters.mockRejectedValueOnce(new Error('catalog unavailable'));

    fireEvent.click(screen.getByRole('button', { name: '📰 Новости' }));

    await waitFor(() => expect(getFilters).toHaveBeenLastCalledWith('news'));
    await waitFor(() =>
      expect(
        (screen.getByRole('button', { name: 'admin.broadcasts.send' }) as HTMLButtonElement)
          .disabled,
      ).toBe(false),
    );
    expect(screen.getByRole('button', { name: /Все Telegram/ })).toBeTruthy();
    expect(
      screen.queryByRole('button', { name: /admin.broadcasts.selectFilterPlaceholder/ }),
    ).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /Все Telegram/ }));
    expect(await screen.findByText('admin.broadcasts.filterCatalogFailed')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'common.retry' }));
    await waitFor(() => expect(getFilters).toHaveBeenCalledTimes(3));
    expect(await screen.findByRole('button', { name: /Активные Telegram/ })).toBeTruthy();
  });

  it('не показывает старые category-counts как новый каталог во время загрузки', async () => {
    renderPage();
    await fillTelegram();
    getFilters.mockImplementationOnce(() => new Promise(() => undefined));

    fireEvent.click(screen.getByRole('button', { name: '📰 Новости' }));
    await waitFor(() => expect(getFilters).toHaveBeenLastCalledWith('news'));
    const selectedAudience = screen.getByRole('button', { name: /Все Telegram/ });
    expect(selectedAudience).toBeTruthy();
    fireEvent.click(selectedAudience);
    expect(await screen.findByText('common.loading')).toBeTruthy();
  });

  it('сохраняет видимую Email-аудиторию, если новый каталог категории упал', async () => {
    renderPage();
    await fillEmailOnly();
    getEmailFilters.mockRejectedValueOnce(new Error('email catalog unavailable'));

    fireEvent.click(screen.getByRole('button', { name: '🎁 Промо' }));

    await waitFor(() => expect(getEmailFilters).toHaveBeenLastCalledWith('promo'));
    await waitFor(() =>
      expect(
        (screen.getByRole('button', { name: 'admin.broadcasts.send' }) as HTMLButtonElement)
          .disabled,
      ).toBe(false),
    );
    expect(screen.getByRole('button', { name: /Все Email/ })).toBeTruthy();
    expect(
      screen.queryByRole('button', { name: /admin.broadcasts.selectEmailFilterPlaceholder/ }),
    ).toBeNull();
  });

  it.each([
    ['error', new Error('email preview unavailable'), 'admin.broadcasts.previewFailed'],
    ['zero', null, 'admin.broadcasts.recipientPreviewEmpty'],
  ] as const)('блокирует Email-only при preview %s', async (_case, error, messageKey) => {
    if (error) previewEmail.mockRejectedValueOnce(error);
    else previewEmail.mockResolvedValueOnce({ target: 'all_email', count: 0 });
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'admin.broadcasts.enableTelegram' }));
    fireEvent.click(screen.getByRole('button', { name: 'admin.broadcasts.enableEmail' }));
    await selectFilter('admin.broadcasts.selectEmailFilterPlaceholder', 'Все Email');
    fireEvent.change(screen.getByPlaceholderText('admin.broadcasts.emailSubjectPlaceholder'), {
      target: { value: 'Тема' },
    });
    fireEvent.change(screen.getByPlaceholderText('admin.broadcasts.emailContentPlaceholder'), {
      target: { value: '<p>Письмо</p>' },
    });

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain(messageKey);
    expect(alert.textContent).toContain('admin.broadcasts.channel.email');
    expect(
      (screen.getByRole('button', { name: 'admin.broadcasts.send' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(createCombined).not.toHaveBeenCalled();
  });

  it('в режиме оба канала ждёт Email preview и не прячет канал ошибки', async () => {
    renderPage();
    await fillTelegram();
    let rejectEmailPreview: ((reason: Error) => void) | undefined;
    previewEmail.mockImplementationOnce(
      () => new Promise((_resolve, reject) => (rejectEmailPreview = reject)),
    );
    fireEvent.click(screen.getByRole('button', { name: 'admin.broadcasts.enableEmail' }));
    await selectFilter('admin.broadcasts.selectEmailFilterPlaceholder', 'Все Email');
    fireEvent.change(screen.getByPlaceholderText('admin.broadcasts.emailSubjectPlaceholder'), {
      target: { value: 'Тема' },
    });
    fireEvent.change(screen.getByPlaceholderText('admin.broadcasts.emailContentPlaceholder'), {
      target: { value: '<p>Письмо</p>' },
    });

    expect((await screen.findByRole('status')).textContent).toContain(
      'admin.broadcasts.previewPending',
    );
    expect(
      (screen.getByRole('button', { name: 'admin.broadcasts.send' }) as HTMLButtonElement).disabled,
    ).toBe(true);

    rejectEmailPreview?.(new Error('email preview unavailable'));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('admin.broadcasts.previewFailed');
    expect(alert.textContent).toContain('admin.broadcasts.channel.email');
    expect(createCombined).not.toHaveBeenCalled();
  });

  it('показывает оба канала, если оба preview завершились ошибкой', async () => {
    preview.mockRejectedValueOnce(new Error('telegram preview unavailable'));
    previewEmail.mockRejectedValueOnce(new Error('email preview unavailable'));
    renderPage();
    await selectFilter('admin.broadcasts.selectFilterPlaceholder', 'Все Telegram');
    fireEvent.click(screen.getByRole('button', { name: 'admin.broadcasts.enableEmail' }));
    await selectFilter('admin.broadcasts.selectEmailFilterPlaceholder', 'Все Email');

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('admin.broadcasts.channel.telegram');
    expect(alert.textContent).toContain('admin.broadcasts.channel.email');
    expect(
      (screen.getByRole('button', { name: 'admin.broadcasts.send' }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it.each([
    ['system', null, 'Активные Telegram', 'Истёкшие Email', 'active', 'expired_email'],
    ['news', '📰 Новости', 'Все Telegram', 'Все Email', 'all', 'all_email'],
  ] as const)(
    'отправляет точные targets и category=%s, по которым показаны оба preview',
    async (category, categoryLabel, telegramLabel, emailLabel, telegramTarget, emailTarget) => {
      createCombined.mockResolvedValueOnce(broadcast(71)).mockResolvedValueOnce(broadcast(72));
      renderPage();
      await fillTelegram(telegramLabel);
      await enableAndFillEmail(emailLabel);
      if (categoryLabel) fireEvent.click(screen.getByRole('button', { name: categoryLabel }));
      await waitFor(() =>
        expect(
          (screen.getByRole('button', { name: 'admin.broadcasts.send' }) as HTMLButtonElement)
            .disabled,
        ).toBe(false),
      );

      fireEvent.click(screen.getByRole('button', { name: 'admin.broadcasts.send' }));
      await waitFor(() =>
        expect(screen.getByTestId('location').textContent).toBe('/admin/broadcasts'),
      );
      expect(
        createCombined.mock.calls.map(([payload]) => [
          payload.channel,
          payload.target,
          payload.category,
        ]),
      ).toEqual([
        ['telegram', telegramTarget, category],
        ['email', emailTarget, category],
      ]);
    },
  );

  it.each([
    ['telegram', 'system', null, 'Активные Telegram', 'active'],
    ['telegram', 'news', '📰 Новости', 'Все Telegram', 'all'],
    ['email', 'system', null, 'Истёкшие Email', 'expired_email'],
    ['email', 'promo', '🎁 Промо', 'Все Email', 'all_email'],
  ] as const)(
    'не теряет target в single-%s submit для category=%s',
    async (channel, category, categoryLabel, filterLabel, target) => {
      createCombined.mockResolvedValueOnce(broadcast(channel === 'telegram' ? 81 : 82));
      renderPage();
      if (channel === 'telegram') await fillTelegram(filterLabel);
      else await fillEmailOnly(filterLabel);
      if (categoryLabel) fireEvent.click(screen.getByRole('button', { name: categoryLabel }));
      await waitFor(() =>
        expect(
          (screen.getByRole('button', { name: 'admin.broadcasts.send' }) as HTMLButtonElement)
            .disabled,
        ).toBe(false),
      );

      fireEvent.click(screen.getByRole('button', { name: 'admin.broadcasts.send' }));
      await waitFor(() => expect(createCombined).toHaveBeenCalledTimes(1));
      expect(createCombined.mock.calls[0][0]).toEqual(
        expect.objectContaining({ channel, target, category }),
      );
    },
  );

  it('держит обязательные ID и причины в настоящих переводах', () => {
    for (const locale of [ru, en]) {
      const messages = locale.admin.broadcasts;
      expect(messages.createRejected).toContain('{{error}}');
      expect(messages.telegramRejected).toContain('{{error}}');
      expect(messages.emailRejectedAfterTelegram).toContain('{{id}}');
      expect(messages.emailRejectedAfterTelegram).toContain('{{error}}');
      expect(messages.bothCreatedWithIds).toContain('{{telegramId}}');
      expect(messages.bothCreatedWithIds).toContain('{{emailId}}');
      expect(messages.previewFailed).toContain('{{channels}}');
      expect(messages.recipientPreviewEmpty).toContain('{{channels}}');
      expect(messages.previewPending.length).toBeGreaterThan(0);
      expect(messages.channel.telegram.length).toBeGreaterThan(0);
      expect(messages.channel.email.length).toBeGreaterThan(0);
    }
  });

  it('РС-14б: правка текста ПОСЛЕ предпросмотра гасит «Отправить» до повторного просмотра', async () => {
    renderPage();
    await fillTelegram('Все Telegram', 'Текст A');
    const sendButton = () =>
      screen.getByRole('button', { name: 'admin.broadcasts.send' }) as HTMLButtonElement;
    expect(sendButton().disabled).toBe(false);

    // Ровно сценарий, найденный скептиком приёмки: посмотрели A, заметили опечатку, поправили на B.
    fireEvent.change(screen.getByPlaceholderText('admin.broadcasts.messageTextPlaceholder'), {
      target: { value: 'Текст B' },
    });

    await waitFor(() => expect(sendButton().disabled).toBe(true));
    expect(screen.getByText('admin.broadcasts.previewOutdated')).toBeTruthy();
    await settle();
    expect(createCombined).not.toHaveBeenCalled();

    // И не запирает навсегда: повторный предпросмотр возвращает кнопку.
    fireEvent.click(screen.getByRole('button', { name: 'Предпросмотр' }));
    await waitFor(() => expect(sendButton().disabled).toBe(false));
  });

  it('РС-14б: возврат к ровно тому же тексту не требует нового предпросмотра', async () => {
    renderPage();
    await fillTelegram('Все Telegram', 'Текст A');
    const field = screen.getByPlaceholderText('admin.broadcasts.messageTextPlaceholder');

    fireEvent.change(field, { target: { value: 'Текст B' } });
    await waitFor(() =>
      expect(
        (screen.getByRole('button', { name: 'admin.broadcasts.send' }) as HTMLButtonElement)
          .disabled,
      ).toBe(true),
    );
    fireEvent.change(field, { target: { value: 'Текст A' } });

    await waitFor(() =>
      expect(
        (screen.getByRole('button', { name: 'admin.broadcasts.send' }) as HTMLButtonElement)
          .disabled,
      ).toBe(false),
    );
  });

  it.each([
    ['пробел внутри адреса', 'https://пример.рф/акция ?utm=telegram'],
    ['обрезано до схемы', 'https://'],
    ['невидимый символ из копипасты', 'https://teplo.example/a\u200b'],
    ['хост без точки', 'https://localhost/page'],
    ['tg-схема без адреса', 'tg://'],
  ])('РС-14а: кнопку со сломанной ссылкой (%s) добавить нельзя', async (_case, broken) => {
    renderPage();
    await fillTelegram();

    fireEvent.click(screen.getByRole('button', { name: /addCustomButton/ }));
    fireEvent.click(screen.getByRole('button', { name: 'admin.broadcasts.customButtonTypeUrl' }));
    fireEvent.change(screen.getByPlaceholderText('admin.broadcasts.customButtonLabelPlaceholder'), {
      target: { value: 'Открыть' },
    });
    fireEvent.change(screen.getByPlaceholderText('admin.broadcasts.customButtonUrlPlaceholder'), {
      target: { value: broken },
    });

    const addButton = screen.getByRole('button', { name: 'common.add' }) as HTMLButtonElement;
    expect(addButton.disabled).toBe(true);
  });

  it('РС-14а: рабочая ссылка по-прежнему добавляется — забор не запирает законное', async () => {
    renderPage();
    await fillTelegram();

    fireEvent.click(screen.getByRole('button', { name: /addCustomButton/ }));
    fireEvent.click(screen.getByRole('button', { name: 'admin.broadcasts.customButtonTypeUrl' }));
    fireEvent.change(screen.getByPlaceholderText('admin.broadcasts.customButtonLabelPlaceholder'), {
      target: { value: 'Открыть' },
    });
    fireEvent.change(screen.getByPlaceholderText('admin.broadcasts.customButtonUrlPlaceholder'), {
      target: { value: 'https://t.me/teplo_VPN_bot?start=promo' },
    });

    const addButton = screen.getByRole('button', { name: 'common.add' }) as HTMLButtonElement;
    expect(addButton.disabled).toBe(false);
  });

  it('РС-14е: «Вся база» рисуется ПОСЛЕДНЕЙ группой, а не в середине списка', async () => {
    // Сервер отдаёт «Все» последней, но экран дописывает после неё тарифные и кастомные
    // фильтры — и она оказывалась десятой строкой из двадцати, рядом с «По тарифу».
    getFilters.mockResolvedValueOnce({
      filters: [
        { key: 'self', label: 'Тест: только мне', count: 1, group: 'basic' },
        { key: 'zero', label: '0 ГБ за период', count: 5, group: 'traffic' },
        { key: 'all', label: 'Все активные с Telegram', count: 304, group: 'broad' },
      ],
      tariff_filters: [
        { key: 'tariff_17', label: 'Премиум', tariff_id: 17, count: 3, group: 'tariff' },
      ],
      custom_filters: [{ key: 'custom_today', label: 'Сегодня', count: 2, group: 'registration' }],
    });
    renderPage();
    fireEvent.click(await screen.findByText('admin.broadcasts.selectFilterPlaceholder'));

    const headings = screen
      .getAllByText(/admin\.broadcasts\.filterGroups\./)
      .map((node) => node.textContent);
    expect(headings[headings.length - 1]).toBe('admin.broadcasts.filterGroups.broad');
  });

  it('РС-14е: «Все» уходит в хвост даже если бот ещё не выложен (скос версий)', async () => {
    // Пункт е разрезан по двум репозиториям с независимыми деплоями. Кабинет выкладывается
    // за 1-2 минуты, бот за 7-10 — в этом окне сервер ещё присылает старую группировку.
    getFilters.mockResolvedValueOnce({
      filters: [
        { key: 'self', label: 'Тест: только мне', count: 1, group: 'basic' },
        { key: 'all', label: 'Все активные с Telegram', count: 304, group: 'basic' },
        { key: 'zero', label: '0 ГБ за период', count: 5, group: 'traffic' },
      ],
      tariff_filters: [],
      custom_filters: [],
    });
    renderPage();
    fireEvent.click(await screen.findByText('admin.broadcasts.selectFilterPlaceholder'));

    const headings = screen
      .getAllByText(/admin\.broadcasts\.filterGroups\./)
      .map((node) => node.textContent);
    expect(headings[headings.length - 1]).toBe('admin.broadcasts.filterGroups.broad');
    // И «только мне» больше не соседняя строка: между ними встал заголовок группы.
    const rendered = screen.getAllByText(/Тест: только мне|Все активные с Telegram/);
    expect(rendered).toHaveLength(2);
  });

  it('РС-14б: письмо тоже нельзя отправить непросмотренным', async () => {
    renderPage();
    await fillEmailOnly();
    const sendButton = () =>
      screen.getByRole('button', { name: 'admin.broadcasts.send' }) as HTMLButtonElement;
    expect(sendButton().disabled).toBe(false);

    fireEvent.change(screen.getByPlaceholderText('admin.broadcasts.emailContentPlaceholder'), {
      target: { value: '<p>Совсем другое письмо</p>' },
    });

    await waitFor(() => expect(sendButton().disabled).toBe(true));
    await settle();
    expect(createCombined).not.toHaveBeenCalled();
  });

  it('РС-14б: правка ТЕМЫ письма тоже гасит «Отправить»', async () => {
    renderPage();
    await fillEmailOnly();

    fireEvent.change(screen.getByPlaceholderText('admin.broadcasts.emailSubjectPlaceholder'), {
      target: { value: 'Другая тема' },
    });

    await waitFor(() =>
      expect(
        (screen.getByRole('button', { name: 'admin.broadcasts.send' }) as HTMLButtonElement)
          .disabled,
      ).toBe(true),
    );
  });

  it('РС-14е: у ПОЧТЫ «все» тоже последней строкой, а не первой', async () => {
    // У почты нет цели «только мне» — сухой прогон письма сделать нечем, поэтому цена
    // промаха там выше. Порядок держался только на том, что ключ оказался последним
    // в словаре сервера: одна вставка после него молча вернула бы риск.
    getEmailFilters.mockResolvedValueOnce({
      filters: [
        { key: 'email_only', label: 'Только почта', count: 4, group: 'auth_type' },
        { key: 'all_email', label: 'Все с подтверждённым email', count: 13, group: 'broad' },
      ],
    });
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'admin.broadcasts.enableEmail' }));
    fireEvent.click(await screen.findByText('admin.broadcasts.selectEmailFilterPlaceholder'));

    const rows = screen.getAllByText(/Только почта|Все с подтверждённым email/);
    expect(rows[rows.length - 1].textContent).toContain('Все с подтверждённым email');
  });

  it('РС-14д: предупреждение о делении показывается ТОЛЬКО когда оно правда', async () => {
    renderPage();
    await fillTelegram('Все Telegram', 'Короткий текст');
    // Без вложения деление не грозит, даже если текст длинный — предупреждать не о чем.
    expect(screen.queryByText('admin.broadcasts.mediaCaptionSplitHint')).toBeNull();

    fireEvent.change(screen.getByPlaceholderText('admin.broadcasts.messageTextPlaceholder'), {
      target: { value: 'я'.repeat(1500) },
    });
    await settle();
    expect(screen.queryByText('admin.broadcasts.mediaCaptionSplitHint')).toBeNull();
  });

  it('РС-14д: подсказки про пределы и про кнопки видны на экране', async () => {
    renderPage();
    await screen.findByText('admin.broadcasts.mediaHint');
    expect(screen.getByText('admin.broadcasts.customButtonsHint')).toBeTruthy();
  });
});
