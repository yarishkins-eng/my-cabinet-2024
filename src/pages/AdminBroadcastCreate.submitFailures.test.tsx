// @vitest-environment jsdom

import { onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router';
import ru from '../locales/ru.json';
import en from '../locales/en.json';
import { useNavigationGuardStore } from '../store/navigationGuard';

const { createCombined, getFilters, getEmailFilters, getButtons, notifySuccess } = vi.hoisted(
  () => ({
    createCombined: vi.fn(),
    getFilters: vi.fn(),
    getEmailFilters: vi.fn(),
    getButtons: vi.fn(),
    notifySuccess: vi.fn(),
  }),
);

vi.mock('../api/adminBroadcasts', () => ({
  adminBroadcastsApi: {
    createCombined,
    getFilters,
    getEmailFilters,
    getButtons,
    preview: vi.fn().mockResolvedValue({ target: 'all', count: 1 }),
    previewEmail: vi.fn().mockResolvedValue({ target: 'all_email', count: 1 }),
    uploadMedia: vi.fn(),
  },
}));

vi.mock('../components/admin', () => ({
  AdminBackButton: () => null,
}));

vi.mock('../components/broadcasts/BroadcastPreview', () => ({
  TelegramPreview: () => null,
  EmailPreview: () => null,
}));

vi.mock('@/platform/hooks/useNotify', () => ({
  useNotify: () => ({ success: notifySuccess }),
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

async function fillTelegram() {
  await selectFilter('admin.broadcasts.selectFilterPlaceholder', 'Все Telegram');
  fireEvent.change(screen.getByPlaceholderText('admin.broadcasts.messageTextPlaceholder'), {
    target: { value: 'Тестовый текст' },
  });
}

async function enableAndFillEmail() {
  fireEvent.click(screen.getByRole('button', { name: 'admin.broadcasts.enableEmail' }));
  await selectFilter('admin.broadcasts.selectEmailFilterPlaceholder', 'Все Email');
  fireEvent.change(screen.getByPlaceholderText('admin.broadcasts.emailSubjectPlaceholder'), {
    target: { value: 'Тема' },
  });
  fireEvent.change(screen.getByPlaceholderText('admin.broadcasts.emailContentPlaceholder'), {
    target: { value: '<p>Письмо</p>' },
  });
}

async function fillEmailOnly() {
  fireEvent.click(screen.getByRole('button', { name: 'admin.broadcasts.enableTelegram' }));
  await enableAndFillEmail();
}

beforeEach(() => {
  for (const mock of [createCombined, getFilters, getEmailFilters, getButtons, notifySuccess]) {
    mock.mockReset();
  }
  useNavigationGuardStore.setState({ blocked: false });
  getFilters.mockResolvedValue({
    filters: [{ key: 'all', label: 'Все Telegram', count: 1, group: 'basic' }],
    tariff_filters: [],
    custom_filters: [],
  });
  getEmailFilters.mockResolvedValue({
    filters: [{ key: 'all_email', label: 'Все Email', count: 1, group: 'email' }],
  });
  getButtons.mockResolvedValue({ buttons: [] });
});

afterEach(() => {
  cleanup();
  onlineManager.setOnline(true);
});

describe('РС-10: отказы создания рассылки видны и повтор не создаёт дубль', () => {
  it.each([400, 401, 403, 422])(
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

  it('держит обязательные ID и причины в настоящих переводах', () => {
    for (const locale of [ru, en]) {
      const messages = locale.admin.broadcasts;
      expect(messages.createRejected).toContain('{{error}}');
      expect(messages.telegramRejected).toContain('{{error}}');
      expect(messages.emailRejectedAfterTelegram).toContain('{{id}}');
      expect(messages.emailRejectedAfterTelegram).toContain('{{error}}');
      expect(messages.bothCreatedWithIds).toContain('{{telegramId}}');
      expect(messages.bothCreatedWithIds).toContain('{{emailId}}');
    }
  });
});
