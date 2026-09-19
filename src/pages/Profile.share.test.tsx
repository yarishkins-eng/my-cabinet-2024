// @vitest-environment jsdom
/**
 * «Поделиться» на экране «Профиль» — вторая копия той же логики, что на «Заработке».
 * Сторож нужен отдельный: одну копию поправят, вторая молча разъедется.
 */
import type { ReactNode } from 'react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router';
import Profile from './Profile';

const { getReferralInfo, openTelegramLink, copyToClipboard } = vi.hoisted(() => ({
  getReferralInfo: vi.fn(),
  openTelegramLink: vi.fn(),
  copyToClipboard: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../utils/clipboard', () => ({ copyToClipboard }));

vi.mock('../api/referral', () => ({
  referralApi: {
    getReferralInfo,
    getReferralTerms: vi.fn().mockResolvedValue({
      minimum_topup_rubles: 100,
      first_topup_bonus_rubles: 100,
      first_topup_bonus_kopeks: 10000,
      commission_percent: 25,
      is_enabled: true,
    }),
  },
}));
vi.mock('../api/branding', () => ({
  brandingApi: {
    getBranding: vi.fn().mockResolvedValue({ name: 'Teplo VPN' }),
    getEmailAuthEnabled: vi.fn().mockResolvedValue({ enabled: false }),
  },
}));
vi.mock('../api/auth', () => ({
  authApi: { resendVerification: vi.fn(), requestEmailChange: vi.fn(), getMe: vi.fn() },
}));
vi.mock('../api/notifications', () => ({
  notificationsApi: {
    getSettings: vi.fn().mockResolvedValue({}),
    updateSettings: vi.fn(),
  },
}));
vi.mock('../store/auth', () => {
  const state = {
    user: { id: 10, telegram_id: 1010, first_name: 'Новичок', username: 'newbie', language: 'ru' },
    setUser: vi.fn(),
  };
  return { useAuthStore: (selector: (s: typeof state) => unknown) => selector(state) };
});
vi.mock('../platform', () => ({
  usePlatform: () => ({
    openTelegramLink,
    haptic: { impact: vi.fn(), notification: vi.fn(), selection: vi.fn() },
    capabilities: { hasBackButton: false },
  }),
}));
vi.mock('framer-motion', () => ({
  motion: new Proxy(
    {},
    {
      get:
        (_t, tag: string) =>
        ({ children, ...rest }: { children?: ReactNode; [k: string]: unknown }) => {
          const Tag = tag as 'div';
          const safe = Object.fromEntries(
            Object.entries(rest).filter(
              ([k]) =>
                ![
                  'initial',
                  'animate',
                  'exit',
                  'transition',
                  'variants',
                  'whileHover',
                  'whileTap',
                ].includes(k),
            ),
          );
          return <Tag {...safe}>{children}</Tag>;
        },
    },
  ),
  AnimatePresence: ({ children }: { children?: ReactNode }) => <>{children}</>,
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    // Настоящий шаблон из ru.json с настоящей подстановкой — иначе сырые {{…}} не видны.
    t: (key: string, vars?: Record<string, unknown>) => {
      const template = key
        .split('.')
        .reduce<unknown>(
          (node, part) => (node as Record<string, unknown> | undefined)?.[part],
          ruLocale,
        );
      if (typeof template !== 'string') return key;
      return template.replace(/\{\{(\w+)\}\}/g, (whole: string, v: string) =>
        vars && v in vars ? String(vars[v]) : whole,
      );
    },
    i18n: { language: 'ru' },
  }),
}));

const ruLocale = JSON.parse(
  readFileSync(join(process.cwd(), 'src', 'locales', 'ru.json'), 'utf8'),
) as Record<string, unknown>;

const BOT_LINK = 'https://t.me/teplo_VPN_bot?start=refjivETKNC';
const CABINET_LINK = `${window.location.origin}/login?ref=refjivETKNC`;

async function renderAndShare(botLink: string | undefined) {
  getReferralInfo.mockResolvedValue({
    referral_code: 'refjivETKNC',
    referral_link: CABINET_LINK,
    bot_referral_link: botLink,
    referrals_count: 0,
    total_earned_kopeks: 0,
    commission_percent: 25,
  });
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <MemoryRouter>
        <Profile />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  const label = await screen.findByText((ruLocale.referral as Record<string, string>).shareButton);
  const button = label.closest('button') as HTMLButtonElement;
  await waitFor(() => expect(button.disabled).toBe(false));
  fireEvent.click(button);
}

describe('«Поделиться» на экране «Профиль»', () => {
  beforeEach(() => openTelegramLink.mockReset());
  afterEach(() => {
    cleanup();
    Reflect.deleteProperty(navigator, 'share');
  });

  it('отправляет ссылку на бота', async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'share', { value: share, configurable: true });

    await renderAndShare(BOT_LINK);

    expect(share.mock.calls[0][0].url).toBe(BOT_LINK);
    expect(share.mock.calls[0][0].text).not.toContain('{{');
  });

  it('без системного окна — ссылка на бота через t.me/share', async () => {
    await renderAndShare(BOT_LINK);

    const sent = new URL(openTelegramLink.mock.calls[0][0] as string);
    expect(sent.searchParams.get('url')).toBe(BOT_LINK);
    expect(openTelegramLink.mock.calls[0][0]).toContain(`url=${encodeURIComponent(BOT_LINK)}&`);
    expect(decodeURIComponent(sent.searchParams.get('text') ?? '')).not.toContain('{{');
  });

  it('без ссылки на бота — кабинетная, как раньше', async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'share', { value: share, configurable: true });

    await renderAndShare(undefined);

    expect(share.mock.calls[0][0].url).toBe(CABINET_LINK);
  });

  // Решение владельца 19.09.2026 (мина MT): в поле — та же ссылка, которую отправляет «Поделиться»,
  // и «Копировать» копирует её же; у «Поделиться» на телефоне видна подпись.
  it('в поле — ссылка на бота, «Копировать» копирует её, подпись «Поделиться» не спрятана', async () => {
    copyToClipboard.mockClear();
    getReferralInfo.mockResolvedValue({
      referral_code: 'refjivETKNC',
      referral_link: CABINET_LINK,
      bot_referral_link: BOT_LINK,
      referrals_count: 0,
      total_earned_kopeks: 0,
      commission_percent: 25,
    });
    render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <MemoryRouter>
          <Profile />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    const locale = ruLocale.referral as Record<string, string>;

    expect(await screen.findByDisplayValue(BOT_LINK)).toBeTruthy();
    expect(screen.queryByDisplayValue(CABINET_LINK)).toBeNull();

    fireEvent.click(screen.getByText(locale.copyLink).closest('button') as HTMLButtonElement);
    expect(copyToClipboard).toHaveBeenCalledWith(BOT_LINK);

    const shareLabel = screen.getByText(locale.shareButton);
    expect(shareLabel.className).not.toMatch(/\bhidden\b/);
  });

  it('без ссылки на бота в поле — кабинетная, и копируется она', async () => {
    copyToClipboard.mockClear();
    getReferralInfo.mockResolvedValue({
      referral_code: 'refjivETKNC',
      referral_link: CABINET_LINK,
      bot_referral_link: undefined,
      referrals_count: 0,
      total_earned_kopeks: 0,
      commission_percent: 25,
    });
    render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <MemoryRouter>
          <Profile />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    const locale = ruLocale.referral as Record<string, string>;

    expect(await screen.findByDisplayValue(CABINET_LINK)).toBeTruthy();
    fireEvent.click(screen.getByText(locale.copyLink).closest('button') as HTMLButtonElement);
    expect(copyToClipboard).toHaveBeenCalledWith(CABINET_LINK);
  });
});
