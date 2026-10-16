// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createInstance } from 'i18next';
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
vi.mock('../platform/hooks/useNativeDialog', () => ({ useDestructiveConfirm: () => confirm }));
vi.mock('../platform/hooks/usePlatform', () => ({
  usePlatform: () => ({ capabilities: { hasBackButton: true } }),
}));
import AdminAutoMessageDetail from './AdminAutoMessageDetail';

beforeEach(() => {
  get.mockReset();
  patch.mockReset();
  confirm.mockReset();
});
afterEach(cleanup);

// This card controls the offer. The selected carrier remains an independent message.
describe('АП-4 PR-2а: own discount OFF is distinct from carrier OFF', () => {
  it.each(['ru', 'en'])(
    'describes a continuing letter and existing rights; cancellation is silent (%s)',
    async (language) => {
      let server = {
        id: 'trial-ending-discount',
        group: 'trial',
        title: 'Скидка к концу пробного периода',
        when: 'Перед концом пробного',
        control: 'toggle',
        enabled: true,
        state: 'live',
        quiet_reason: null,
        note: null,
        params: null,
        buttons: [],
        sent_count: 0,
        claimed_count: 0,
        claim_tracked: false,
        history: [],
        discount_context: {
          carrier_id: 'trial-1d',
          percent: 15,
          enabled: true,
          legacy_enabled: false,
        },
      };
      get.mockImplementation(async () => server);
      patch.mockImplementation(async () => {
        server = { ...server, enabled: false };
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
      render(
        <I18nextProvider i18n={i18n}>
          <QueryClientProvider client={client}>
            <MemoryRouter initialEntries={['/admin/auto-messages/trial-ending-discount']}>
              <Routes>
                <Route path="/admin/auto-messages/:id" element={<AdminAutoMessageDetail />} />
              </Routes>
            </MemoryRouter>
          </QueryClientProvider>
        </I18nextProvider>,
      );
      await screen.findByRole('switch');
      confirm.mockResolvedValue(false);
      fireEvent.click(screen.getByRole('switch'));
      await waitFor(() => expect(confirm).toHaveBeenCalledTimes(1));
      const question = confirm.mock.calls[0][0];
      expect(i18n.exists('admin.autoMessages.discount.discountOff')).toBe(true);
      expect(question).toBe(i18n.t('admin.autoMessages.discount.discountOff'));
      // Owner-approved PR4 copy: issued discounts keep their original expiry.
      expect(question).toBe(
        language === 'ru'
          ? 'Выключить скидку? Выданные доработают до своего срока.'
          : 'Turn off the discount? Discounts already issued will last until they expire.',
      );
      expect(question.length).toBeLessThanOrEqual(240);
      expect(patch).not.toHaveBeenCalled();
      expect((screen.getByRole('switch') as HTMLButtonElement).getAttribute('aria-checked')).toBe(
        'true',
      );

      confirm.mockResolvedValue(true);
      fireEvent.click(screen.getByRole('switch'));
      await waitFor(() =>
        expect(patch).toHaveBeenCalledWith('trial-ending-discount', { enabled: false }),
      );
      expect(patch.mock.calls).toHaveLength(1);
      expect(confirm.mock.calls[1][0]).toBe(question);
    },
  );
});
