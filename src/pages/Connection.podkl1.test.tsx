// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
const mocks = vi.hoisted(() => ({
  open: vi.fn(),
  status: vi.fn(),
  config: vi.fn(),
  link: vi.fn(),
  branding: vi.fn(),
}));
vi.mock('../api/subscription', () => ({
  subscriptionApi: {
    getSubscription: mocks.status,
    getAppConfig: mocks.config,
    getConnectionLink: mocks.link,
  },
}));
vi.mock('../api/branding', () => ({ brandingApi: { getTelegramWidgetConfig: mocks.branding } }));
vi.mock('@telegram-apps/sdk-react', () => ({ openLink: mocks.open }));
vi.mock('../hooks/useTelegramSDK', () => ({ useTelegramSDK: () => ({ isTelegramWebApp: true }) }));
vi.mock('../platform', () => ({ useHaptic: () => ({ impact: vi.fn() }) }));
vi.mock('../store/auth', () => ({
  useAuthStore: (selector: (state: unknown) => unknown) =>
    selector({ user: { id: 17 }, isAdmin: false }),
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'ru' } }),
}));
vi.mock('../components/connection/InstallationGuide', () => ({
  default: ({
    onOpenDeepLink,
    progressScope,
    subscriptionId,
  }: {
    onOpenDeepLink: (link: string) => void;
    progressScope: string;
    subscriptionId: number;
  }) => (
    <>
      <button onClick={() => onOpenDeepLink('incy://import/fresh')}>Import</button>
      <output>{`${progressScope}|${subscriptionId}`}</output>
    </>
  ),
}));
import Connection from './Connection';
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
describe('connection page wiring with the real query client', () => {
  it.each([undefined, 51])(
    'uses canonical/selected identity and the return bot, sub=%s',
    async (selected) => {
      mocks.config.mockResolvedValue({
        hasSubscription: true,
        subscriptionUrl: 'https://example.invalid/fresh',
        platforms: { ios: { apps: [{ name: 'INCY', blocks: [] }] } },
      });
      mocks.status.mockResolvedValue({
        has_subscription: true,
        subscription: { id: 44 },
        test_reset_at: null,
      });
      mocks.link.mockResolvedValue({
        subscription_url: 'https://example.invalid/fresh',
        connect_mode: 'miniapp_custom',
        test_reset_at: null,
      });
      let resolveBranding!: (value: { bot_username: string }) => void;
      mocks.branding.mockImplementation(
        () =>
          new Promise((resolve) => {
            resolveBranding = resolve;
          }),
      );
      const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
      render(
        <QueryClientProvider client={client}>
          <MemoryRouter initialEntries={[selected ? `/connection?sub=${selected}` : '/connection']}>
            <Connection />
          </MemoryRouter>
        </QueryClientProvider>,
      );
      await waitFor(() => expect(client.getQueryData(['subscription', selected])).toBeTruthy());
      expect(screen.queryByRole('button', { name: 'Import' })).toBeNull();
      await act(async () => resolveBranding({ bot_username: 'teplo_VPN_bot' }));
      await waitFor(() =>
        expect(screen.getByText(`17:${selected ?? 44}:|${selected ?? 44}`)).toBeTruthy(),
      );
      await waitFor(() =>
        expect(client.getQueryData(['telegram-widget-config'])).toEqual({
          bot_username: 'teplo_VPN_bot',
        }),
      );
      fireEvent.click(screen.getByRole('button', { name: 'Import' }));
      expect(mocks.open).toHaveBeenCalledTimes(1);
      const redirect = new URL(mocks.open.mock.calls[0][0]);
      expect(redirect.pathname).toBe('/miniapp/redirect.html');
      expect(redirect.searchParams.get('url')).toBe('incy://import/fresh');
      expect(redirect.searchParams.get('bot')).toBe('teplo_VPN_bot');
      expect(redirect.searchParams.get('lang')).toBe('ru');
      expect(mocks.status).toHaveBeenCalledWith(selected);
      client.clear();
    },
  );
});
