// @vitest-environment jsdom
/**
 * «Поделиться» на экране «Заработок» отправляет ссылку НА БОТА (решение владельца 19.09.2026).
 *
 * Почему это сторож на нажатие, а не на текст: кабинетная ссылка ведёт на веб-вход, и
 * ступенчатый онбординг бота (приветствие → «Подключить VPN» → добор) человека не касается.
 * Правильная ссылка приходит с сервера как `bot_referral_link`; если её нет — уходит
 * кабинетная, как раньше.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router';
import Referral from './Referral';

const { getReferralInfo, openTelegramLink } = vi.hoisted(() => ({
  getReferralInfo: vi.fn(),
  openTelegramLink: vi.fn(),
}));

vi.mock('../api/referral', () => ({
  referralApi: {
    getReferralInfo,
    getReferralTerms: vi.fn().mockResolvedValue({
      minimum_topup_rubles: 100,
      first_topup_bonus_rubles: 100,
      first_topup_bonus_kopeks: 10000,
      inviter_bonus_kopeks: 10000,
      commission_percent: 25,
      is_enabled: true,
    }),
    getReferralList: vi.fn().mockResolvedValue({ items: [], total: 0 }),
    getReferralEarnings: vi.fn().mockResolvedValue({ items: [], total: 0 }),
  },
}));
vi.mock('../api/branding', () => ({
  brandingApi: { getBranding: vi.fn().mockResolvedValue({ name: 'Teplo VPN' }) },
}));
vi.mock('../api/partners', () => ({
  partnerApi: { getStatus: vi.fn().mockResolvedValue({ is_partner: false }) },
}));
vi.mock('../api/withdrawals', () => ({
  withdrawalApi: {
    getBalance: vi.fn().mockResolvedValue({ balance_kopeks: 0 }),
    getHistory: vi.fn().mockResolvedValue({ items: [], total: 0 }),
  },
}));
vi.mock('../platform', () => ({
  usePlatform: () => ({ openTelegramLink, capabilities: { hasBackButton: false } }),
}));
vi.mock('../hooks/useCurrency', () => ({
  useCurrency: () => ({
    formatAmount: (value: number) => String(value),
    formatPositive: (value: number) => `+${value}`,
    currencySymbol: '₽',
  }),
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const BOT_LINK = 'https://t.me/teplo_VPN_bot?start=refjivETKNC';
const CABINET_LINK = `${window.location.origin}/login?ref=refjivETKNC`;

function info(botLink: string | undefined) {
  return {
    referral_code: 'refjivETKNC',
    referral_link: CABINET_LINK,
    bot_referral_link: botLink,
    referrals_count: 0,
    total_earned_kopeks: 0,
    commission_percent: 25,
  };
}

async function renderAndShare() {
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter>
        <Referral />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  const button = await screen.findByText('referral.shareButton');
  await waitFor(() => expect((button.closest('button') as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(button.closest('button') as HTMLButtonElement);
}

describe('«Поделиться» на экране «Заработок»', () => {
  beforeEach(() => {
    openTelegramLink.mockReset();
  });
  afterEach(() => {
    cleanup();
    Reflect.deleteProperty(navigator, 'share');
  });

  it('через системное окно отправляет ссылку на бота', async () => {
    getReferralInfo.mockResolvedValue(info(BOT_LINK));
    const share = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'share', { value: share, configurable: true });

    await renderAndShare();

    expect(share).toHaveBeenCalledTimes(1);
    expect(share.mock.calls[0][0].url).toBe(BOT_LINK);
    expect(openTelegramLink).not.toHaveBeenCalled();
  });

  it('без системного окна отправляет ссылку на бота через t.me/share', async () => {
    getReferralInfo.mockResolvedValue(info(BOT_LINK));

    await renderAndShare();

    expect(openTelegramLink).toHaveBeenCalledTimes(1);
    const sent = new URL(openTelegramLink.mock.calls[0][0] as string);
    expect(sent.origin + sent.pathname).toBe('https://t.me/share/url');
    expect(sent.searchParams.get('url')).toBe(BOT_LINK);
  });

  it('если сервер не отдал ссылку на бота — уходит кабинетная, как раньше', async () => {
    getReferralInfo.mockResolvedValue(info(undefined));
    const share = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'share', { value: share, configurable: true });

    await renderAndShare();

    expect(share.mock.calls[0][0].url).toBe(CABINET_LINK);
  });
});
