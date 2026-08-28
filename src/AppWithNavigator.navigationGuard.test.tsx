// @vitest-environment jsdom

import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Link, MemoryRouter, useLocation, useNavigate } from 'react-router';
import { useNavigationGuardStore } from './store/navigationGuard';

const {
  hideBackButton,
  showBackButton,
  onBackButtonClick,
  getSubscriptions,
  setClosingConfirmation,
  isInTelegramWebApp,
} = vi.hoisted(() => ({
  hideBackButton: vi.fn(),
  showBackButton: vi.fn(),
  onBackButtonClick: vi.fn(),
  getSubscriptions: vi.fn(),
  setClosingConfirmation: vi.fn(),
  isInTelegramWebApp: vi.fn(),
}));

vi.mock('@telegram-apps/sdk-react', () => ({
  hideBackButton,
  showBackButton,
  onBackButtonClick,
  offBackButtonClick: vi.fn(),
}));

vi.mock('./hooks/useTelegramSDK', () => ({
  isInTelegramWebApp,
  closeTelegramApp: vi.fn(),
}));

vi.mock('./App', () => ({ default: () => <div data-testid="app-root" /> }));
vi.mock('./components/ErrorBoundary', () => ({
  ErrorBoundary: ({ children }: { children: ReactNode }) => children,
}));
vi.mock('./platform/PlatformProvider', () => ({
  PlatformProvider: ({ children }: { children: ReactNode }) => children,
}));
vi.mock('./providers/ThemeColorsProvider', () => ({
  ThemeColorsProvider: ({ children }: { children: ReactNode }) => children,
}));
vi.mock('./hooks/useTheme', () => ({
  ThemeProvider: ({ children }: { children: ReactNode }) => children,
}));
vi.mock('./providers/WebSocketProvider', () => ({
  WebSocketProvider: ({ children }: { children: ReactNode }) => children,
}));
vi.mock('./components/Toast', () => ({
  ToastProvider: ({ children }: { children: ReactNode }) => children,
}));
vi.mock('./components/primitives/Tooltip', () => ({
  TooltipProvider: ({ children }: { children: ReactNode }) => children,
}));
vi.mock('react-twemoji', () => ({
  default: ({ children }: { children: ReactNode }) => children,
}));

vi.mock('./platform/hooks/usePlatform', () => ({
  usePlatform: () => ({ setClosingConfirmation }),
}));

vi.mock('./api/subscription', () => ({
  subscriptionApi: { getSubscriptions },
}));

import { AppWithNavigator, GlobalInteractionGuard, TelegramBackButton } from './AppWithNavigator';

function LocationProbe() {
  return <div data-testid="location">{useLocation().pathname}</div>;
}

function GlobalGuardHarness() {
  const navigate = useNavigate();
  return (
    <>
      <GlobalInteractionGuard />
      <Link to="/balance">toast-link</Link>
      <button onClick={() => navigate('/balance')}>modal-action</button>
      <LocationProbe />
    </>
  );
}

function renderGuard() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/admin/broadcasts/create']}>
        <TelegramBackButton />
        <LocationProbe />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  isInTelegramWebApp.mockReturnValue(true);
  getSubscriptions.mockResolvedValue({ multi_tariff_enabled: false, subscriptions: [] });
  useNavigationGuardStore.setState({ blocked: true });
});

afterEach(() => {
  cleanup();
  useNavigationGuardStore.setState({ blocked: false });
});

describe('глобальный замок навигации во время критического POST', () => {
  it('скрывает Telegram Back и игнорирует его нажатие до снятия замка', async () => {
    renderGuard();

    await waitFor(() => expect(hideBackButton).toHaveBeenCalled());
    const handler = onBackButtonClick.mock.calls[0][0] as () => void;

    act(() => handler());
    expect(screen.getByTestId('location').textContent).toBe('/admin/broadcasts/create');

    act(() => useNavigationGuardStore.getState().setBlocked(false));
    await waitFor(() => expect(showBackButton).toHaveBeenCalled());
    act(() => handler());

    await waitFor(() =>
      expect(screen.getByTestId('location').textContent).toBe('/admin/broadcasts'),
    );
  });

  it('блокирует любые click-переходы и предупреждает о закрытии', async () => {
    render(
      <MemoryRouter initialEntries={['/admin/broadcasts/create']}>
        <GlobalGuardHarness />
      </MemoryRouter>,
    );

    await screen.findByTestId('global-interaction-guard');
    const linkClick = new MouseEvent('click', { bubbles: true, cancelable: true });
    act(() => screen.getByText('toast-link').dispatchEvent(linkClick));
    fireEvent.click(screen.getByText('modal-action'));

    expect(linkClick.defaultPrevented).toBe(true);
    expect(screen.getByTestId('location').textContent).toBe('/admin/broadcasts/create');
    expect(setClosingConfirmation).toHaveBeenCalledWith(true);

    act(() => useNavigationGuardStore.getState().setBlocked(false));
    await waitFor(() => expect(screen.queryByTestId('global-interaction-guard')).toBeNull());
    fireEvent.click(screen.getByText('modal-action'));

    await waitFor(() => expect(screen.getByTestId('location').textContent).toBe('/balance'));
    expect(setClosingConfirmation).toHaveBeenCalledWith(false);
  });

  it('подключает guard в боевом корне приложения', async () => {
    isInTelegramWebApp.mockReturnValue(false);

    render(<AppWithNavigator />);

    expect(await screen.findByTestId('global-interaction-guard')).not.toBeNull();
    expect(screen.getByTestId('app-root')).not.toBeNull();
    expect(setClosingConfirmation).toHaveBeenCalledWith(true);
  });
});
