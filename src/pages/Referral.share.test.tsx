// @vitest-environment jsdom
/**
 * «Поделиться» на экране «Заработок» отправляет ссылку НА БОТА (решение владельца 19.09.2026).
 *
 * Почему это сторож на нажатие, а не на текст: кабинетная ссылка ведёт на веб-вход, и
 * ступенчатый онбординг бота (приветствие → «Подключить VPN» → добор) человека не касается.
 * Правильная ссылка приходит с сервера как `bot_referral_link`; если её нет — уходит
 * кабинетная, как раньше.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
  const button = await screen.findByText((ruLocale.referral as Record<string, string>).shareButton);
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
    expect(share.mock.calls[0][0].text).not.toContain('{{');
    expect(openTelegramLink).not.toHaveBeenCalled();
  });

  it('без системного окна отправляет ссылку на бота через t.me/share', async () => {
    getReferralInfo.mockResolvedValue(info(BOT_LINK));

    await renderAndShare();

    expect(openTelegramLink).toHaveBeenCalledTimes(1);
    const sent = new URL(openTelegramLink.mock.calls[0][0] as string);
    expect(sent.origin + sent.pathname).toBe('https://t.me/share/url');
    expect(sent.searchParams.get('url')).toBe(BOT_LINK);
    expect(openTelegramLink.mock.calls[0][0]).toContain(`url=${encodeURIComponent(BOT_LINK)}&`);
    expect(decodeURIComponent(sent.searchParams.get('text') ?? '')).not.toContain('{{');
  });

  it('если сервер не отдал ссылку на бота — уходит кабинетная, как раньше', async () => {
    getReferralInfo.mockResolvedValue(info(undefined));
    const share = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'share', { value: share, configurable: true });

    await renderAndShare();

    expect(share.mock.calls[0][0].url).toBe(CABINET_LINK);
  });

  // Решение владельца 19.09.2026 (мина MT): кнопка стоит под той ссылкой, которую отправляет.
  it('«Поделиться» стоит в ряду ссылки на бота, а не кабинета', async () => {
    getReferralInfo.mockResolvedValue(info(BOT_LINK));
    render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <MemoryRouter>
          <Referral />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    const shareLabel = (ruLocale.referral as Record<string, string>).shareButton;
    const botRow = (await screen.findByDisplayValue(BOT_LINK)).parentElement as HTMLElement;
    const cabinetRow = screen.getByDisplayValue(CABINET_LINK).parentElement as HTMLElement;

    expect(within(botRow).getByText(shareLabel)).toBeTruthy();
    expect(within(cabinetRow).queryByText(shareLabel)).toBeNull();
    expect(screen.getAllByText(shareLabel)).toHaveLength(1);

    // Порядок в ряду бота: «Копировать», потом «Поделиться» — как в ряду кабинета.
    const copyLabel = (ruLocale.referral as Record<string, string>).copyLink;
    const botButtons = within(botRow).getAllByRole('button');
    expect(botButtons.map((b) => b.textContent)).toEqual([copyLabel, shareLabel]);

    // Ширина на телефоне (jsdom пикселей не меряет — сторожим классы отрендеренных кнопок):
    // px-3 и sm:px-4 у всех кнопок обоих рядов, у подписей нет лишнего ml-2, ряд с gap-2.
    for (const button of [...botButtons, ...within(cabinetRow).getAllByRole('button')]) {
      expect(button.className).toMatch(/\bpx-3\b/);
      expect(button.className).toMatch(/\bsm:px-4\b/);
      for (const span of Array.from(button.querySelectorAll('span'))) {
        expect(span.className).not.toMatch(/\bml-2\b/);
      }
    }
    expect((botButtons[0].parentElement as HTMLElement).className).toMatch(/\bgap-2\b/);
  });

  it('без ссылки на бота ряд бота не рисуется, а «Поделиться» остаётся у кабинетной', async () => {
    getReferralInfo.mockResolvedValue(info(undefined));
    render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <MemoryRouter>
          <Referral />
        </MemoryRouter>
      </QueryClientProvider>,
    );
    const shareLabel = (ruLocale.referral as Record<string, string>).shareButton;
    const cabinetRow = (await screen.findByDisplayValue(CABINET_LINK)).parentElement as HTMLElement;

    expect(screen.queryByText((ruLocale.referral as Record<string, string>).botLink)).toBeNull();
    expect(within(cabinetRow).getByText(shareLabel)).toBeTruthy();
  });
});
