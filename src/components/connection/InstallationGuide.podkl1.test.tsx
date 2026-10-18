// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import InstallationGuide from './InstallationGuide';
import original from './fixtures/panel-20261017.json';
import proposed from './fixtures/panel-podkl1.json';
import ru from '@/locales/ru.json';
import en from '@/locales/en.json';
import type { AppConfig } from '@/types';
import { resolveStartParamPath } from '@/utils/telegramStartParam';

const { devices, copy } = vi.hoisted(() => ({ devices: vi.fn(), copy: vi.fn() }));
vi.mock('@/api/subscription', () => ({ subscriptionApi: { getDevices: devices } }));
vi.mock('@/utils/clipboard', () => ({ copyToClipboard: copy }));
const fresh = 'https://example.invalid/sub/fresh';
const stale = 'happ://crypt5/retired';
const opened = vi.fn();
const snapshot = (hwids: string[] = [], panel_ok = true, total = hwids.length, metadata = {}) => ({
  devices: hwids.map((hwid) => ({
    hwid,
    platform: undefined,
    app: undefined,
    created_at: '2099-01-01',
    ...metadata,
  })),
  total,
  panel_ok,
});

function mount(
  platform = 'ios',
  data = proposed,
  strict = false,
  language = 'ru',
  scope = 'user:321:reset1',
) {
  Object.defineProperty(navigator, 'userAgent', {
    configurable: true,
    value: platform === 'ios' ? 'iPhone' : 'Android',
  });
  const config = structuredClone(data) as unknown as AppConfig;
  config.subscriptionUrl = fresh;
  config.test_link_strict = strict;
  for (const p of Object.values(config.platforms)) {
    for (const app of p.apps || []) {
      app.deepLink = null;
      for (const block of app.blocks) {
        for (const b of block.buttons || []) {
          if (b.type === 'subscriptionLink') b.resolvedUrl = stale;
        }
      }
    }
  }
  const i18n = createInstance();
  void i18n.init({
    lng: language,
    resources: { ru: { translation: ru }, en: { translation: en } },
    initImmediate: false,
  });
  const result = render(
    <I18nextProvider i18n={i18n}>
      <InstallationGuide
        appConfig={config}
        onOpenDeepLink={opened}
        isTelegramWebApp
        onGoBack={vi.fn()}
        subscriptionId={321}
        progressScope={scope}
      />
    </I18nextProvider>,
  );
  return { ...result, config };
}
const goVisible = () => {
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
  fireEvent(document, new Event('visibilitychange'));
};
const goHidden = () => {
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
  fireEvent(document, new Event('visibilitychange'));
};
beforeEach(() => {
  localStorage.clear();
  opened.mockReset();
  copy.mockReset();
  devices.mockReset();
  devices.mockResolvedValue(snapshot());
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('real panel config, eight combinations', () => {
  for (const platform of ['ios', 'android'])
    for (const app of ['INCY', 'Happ'])
      for (const strict of [false, true]) {
        it(`${platform} / ${app} / strict=${strict}: renders import, rejects old bearer when strict`, async () => {
          mount(platform, original, strict);
          fireEvent.click(
            await screen.findByRole('button', {
              name: new RegExp(`^${app}(?: советуем| если уже стоит)?$`),
            }),
          );
          const add = screen.getByRole('button', { name: 'Добавить подписку' });
          fireEvent.click(add);
          expect(opened).toHaveBeenCalledTimes(1);
          if (strict) {
            expect(opened).not.toHaveBeenCalledWith(stale);
            expect(opened).toHaveBeenCalledWith(
              app === 'INCY' ? 'incy://import/{{SUBSCRIPTION_LINK}}' : '{{HAPP_CRYPT4_LINK}}',
            );
          } else expect(opened).toHaveBeenCalledWith(stale);
        });
      }
});

describe('approved mobile flow', () => {
  it('confirms the owner same-phone import after conn return remount using real saved progress', async () => {
    const metadata = { platform: 'iOS', app: 'INCY', created_at: '2001-01-01T00:00:00Z' };
    devices.mockResolvedValue(snapshot(['owner-phone'], true, 1, metadata));
    const first = mount();
    await act(async () => {});
    fireEvent.click(await screen.findByRole('button', { name: 'Добавить в INCY' }));
    first.unmount();
    expect(resolveStartParamPath('conn-owner-return')).toBe('/connection');
    devices.mockResolvedValue(
      snapshot(['owner-phone'], true, 1, { ...metadata, created_at: '2001-01-01T00:00:02Z' }),
    );
    mount();
    expect(await screen.findByText('INCY получил настройки')).toBeTruthy();
    expect(screen.getByText('Включите VPN')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Добавить в INCY' })).toBeNull();
  });
  it('keeps Install primary after an unsuccessful direct import without a store visit', async () => {
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'Добавить в INCY' }));
    goHidden();
    goVisible();
    expect(screen.getByRole('link', { name: 'Установить из App Store' }).className).toContain(
      'btn-primary',
    );
    expect(screen.queryByText('INCY получил настройки')).toBeNull();
  });
  it('moves the filled button only on return from the store and reopens a completed step', async () => {
    mount();
    const store = await screen.findByRole('link', { name: 'Установить из App Store' });
    expect(store.className).toContain('btn-primary');
    expect(screen.getByRole('button', { name: 'Добавить в INCY' }).className).toContain(
      'border-accent-500/40',
    );
    fireEvent.click(store);
    expect(store.className).toContain('btn-primary');
    goHidden();
    goVisible();
    expect(screen.queryByRole('link', { name: 'Установить из App Store' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Добавить в INCY' }).className).toContain(
      'btn-primary',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Установите INCY' }));
    expect(screen.getByRole('link', { name: 'Установить из App Store' }).className).toContain(
      'border-accent-500/40',
    );
    expect(
      screen.getByRole('button', { name: 'Установите INCY' }).getAttribute('aria-expanded'),
    ).toBe('true');
  });
  it('keeps a pending store action through WebView reload', async () => {
    const first = mount();
    fireEvent.click(await screen.findByRole('link', { name: 'Установить из App Store' }));
    first.unmount();
    mount();
    expect((await screen.findByRole('button', { name: 'Добавить в INCY' })).className).toContain(
      'btn-primary',
    );
  });
  it('reads devices at 0,5,15 seconds after return, scoped to subscription; ignores unchanged timestamps', async () => {
    devices.mockResolvedValue(snapshot(['old']));
    mount();
    await waitFor(() => expect(devices).toHaveBeenCalledWith(321));
    await act(async () => {});
    fireEvent.click(screen.getByRole('button', { name: 'Добавить в INCY' }));
    vi.useFakeTimers();
    devices.mockClear();
    goHidden();
    goVisible();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(devices).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4999);
    });
    expect(devices).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(devices).toHaveBeenCalledTimes(2);
    expect(screen.queryByText('INCY получил настройки')).toBeNull();
    devices.mockResolvedValue(snapshot(['old', 'new']));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10000);
    });
    expect(devices).toHaveBeenCalledTimes(3);
    expect(screen.getByText('INCY получил настройки')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Добавить в INCY' })).toBeNull();
  });
  it.each(['new hwid', 'total growth'])(
    'accepts %s only on a healthy panel response',
    async (reason) => {
      devices.mockResolvedValue(reason === 'new hwid' ? snapshot(['old']) : snapshot());
      mount();
      await act(async () => {});
      fireEvent.click(await screen.findByRole('button', { name: 'Добавить в INCY' }));
      devices.mockResolvedValue(
        reason === 'new hwid' ? snapshot(['new'], false) : snapshot([], false, 1),
      );
      vi.useFakeTimers();
      goHidden();
      goVisible();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(0);
      });
      expect(screen.queryByText('INCY получил настройки')).toBeNull();
      devices.mockResolvedValue(reason === 'new hwid' ? snapshot(['new']) : snapshot([], true, 1));
      await act(async () => {
        await vi.advanceTimersByTimeAsync(5000);
      });
      expect(screen.getByText('INCY получил настройки')).toBeTruthy();
    },
  );
  it('refreshes a saved baseline before import and freezes it once import starts', async () => {
    devices.mockResolvedValue(snapshot(['old']));
    const first = mount();
    await act(async () => {});
    first.unmount();
    devices.mockResolvedValue(snapshot(['old', 'elsewhere']));
    mount();
    await act(async () => {});
    fireEvent.click(screen.getByRole('button', { name: 'Добавить в INCY' }));
    vi.useFakeTimers();
    goHidden();
    goVisible();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.queryByText('INCY получил настройки')).toBeNull();
    devices.mockResolvedValue(snapshot(['old', 'elsewhere', 'imported']));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(screen.getByText('INCY получил настройки')).toBeTruthy();
  });
  it('never treats an idle response arriving after Add as import proof', async () => {
    devices.mockResolvedValue(snapshot(['old']));
    const first = mount();
    await act(async () => {});
    first.unmount();
    let resolveIdle!: (result: ReturnType<typeof snapshot>) => void;
    devices.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveIdle = resolve;
        }),
    );
    mount();
    await act(async () => {});
    fireEvent.click(screen.getByRole('button', { name: 'Добавить в INCY' }));
    devices.mockClear();
    devices.mockResolvedValue(snapshot(['old', 'elsewhere']));
    vi.useFakeTimers();
    goHidden();
    goVisible();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(devices).not.toHaveBeenCalled();
    await act(async () => {
      resolveIdle(snapshot(['old', 'elsewhere']));
    });
    expect(screen.queryByText('INCY получил настройки')).toBeNull();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(screen.queryByText('INCY получил настройки')).toBeNull();
    devices.mockResolvedValue(snapshot(['old', 'elsewhere', 'imported']));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10000);
    });
    expect(screen.getByText('INCY получил настройки')).toBeTruthy();
  });
  it('refreshes idle devices on return before Add without declaring success', async () => {
    devices.mockResolvedValue(snapshot(['old']));
    mount();
    await act(async () => {});
    devices.mockResolvedValue(snapshot(['old', 'elsewhere']));
    goHidden();
    goVisible();
    await act(async () => {});
    expect(screen.queryByText('INCY получил настройки')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Добавить в INCY' }));
    vi.useFakeTimers();
    goHidden();
    goVisible();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.queryByText('INCY получил настройки')).toBeNull();
    devices.mockResolvedValue(snapshot(['old', 'elsewhere', 'imported']));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(screen.getByText('INCY получил настройки')).toBeTruthy();
  });
  it('does not invent success after network failure and cancels reads while hidden/unmounted', async () => {
    const first = mount();
    await act(async () => {});
    fireEvent.click(await screen.findByRole('button', { name: 'Добавить в INCY' }));
    devices.mockRejectedValue(new Error('panel offline'));
    vi.useFakeTimers();
    goHidden();
    goVisible();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.queryByText('INCY получил настройки')).toBeNull();
    devices.mockClear();
    goHidden();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20000);
    });
    expect(devices).not.toHaveBeenCalled();
    goVisible();
    first.unmount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20000);
    });
    expect(devices).not.toHaveBeenCalled();
  });
  it('has exact iPhone Happ guidance, no obsolete stores and one filled import button', async () => {
    mount();
    fireEvent.click(await screen.findByRole('button', { name: /^Happ(?: если уже стоит)?$/ }));
    expect(
      screen
        .getByRole('link', { name: 'Есть зарубежный Apple ID? Скачать Happ' })
        .getAttribute('href'),
    ).toBe('https://apps.apple.com/app/id6504287215');
    expect(screen.queryByRole('link', { name: /App Store \(/ })).toBeNull();
    expect(screen.getByRole('button', { name: 'Добавить в Happ' }).className).toContain(
      'btn-primary',
    );
    copy.mockRejectedValue(new Error('clipboard denied after app switch'));
    fireEvent.click(screen.getByRole('button', { name: 'Скопировать мою ссылку для подключения' }));
    await act(async () => {});
    expect(screen.getByRole('alert').textContent).toBe(
      'Не скопировалось. Нажмите «Добавить в Happ».',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Нет Happ? Выбрать INCY' }));
    expect(screen.getByRole('link', { name: 'Установить из App Store' })).toBeTruthy();
  });
  it('remembers apps separately per platform and resets receipt for a different reset generation', async () => {
    let first = mount();
    fireEvent.click(await screen.findByRole('button', { name: /^Happ(?: если уже стоит)?$/ }));
    first.unmount();
    first = mount('android');
    expect((await screen.findByRole('button', { name: /^INCY советуем$/ })).className).toContain(
      'ring-1',
    );
    expect(screen.queryByText('если уже стоит')).toBeNull();
    first.unmount();
    first = mount('ios');
    expect(
      (await screen.findByRole('button', { name: /^Happ(?: если уже стоит)?$/ })).className,
    ).toContain('ring-1');
    fireEvent.click(screen.getByRole('button', { name: 'Добавить в Happ' }));
    devices.mockResolvedValue(snapshot(['new']));
    vi.useFakeTimers();
    goHidden();
    goVisible();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.getByText('Happ получил настройки')).toBeTruthy();
    first.unmount();
    vi.useRealTimers();
    mount('ios', proposed, true, 'ru', 'user:321:reset2');
    expect(screen.queryByText('Happ получил настройки')).toBeNull();
  });
  it('works when WebView storage throws', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('denied');
    });
    mount();
    fireEvent.click(await screen.findByRole('button', { name: 'INCY уже есть? Сразу к шагу 2' }));
    expect(screen.getByRole('button', { name: 'Добавить в INCY' }).className).toContain(
      'btn-primary',
    );
  });
  it('copies the fresh URL, acknowledges for two seconds, and explains a failed copy', async () => {
    copy.mockResolvedValue(undefined);
    mount('ios', proposed, true);
    await screen.findByRole('button', { name: 'Скопировать мою ссылку для подключения' });
    vi.useFakeTimers();
    fireEvent.click(screen.getByRole('button', { name: 'Скопировать мою ссылку для подключения' }));
    await act(async () => {});
    expect(copy).toHaveBeenCalledWith(fresh);
    expect(screen.getByText('Ссылка скопирована')).toBeTruthy();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(screen.queryByText('Ссылка скопирована')).toBeNull();
    copy.mockRejectedValue(new Error('clipboard denied'));
    fireEvent.click(screen.getByRole('button', { name: 'Скопировать мою ссылку для подключения' }));
    await act(async () => {});
    expect(screen.getByRole('alert').textContent).toBe(
      'Не скопировалось. Нажмите «Добавить в INCY».',
    );
  });
});
