// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import InstallationGuide from './InstallationGuide';
import config from './fixtures/panel-podkl1.json';
import { useConnectionProgress } from './blocks/useConnectionProgress';
import ru from '@/locales/ru.json';
import en from '@/locales/en.json';
import zh from '@/locales/zh.json';
import fa from '@/locales/fa.json';
import type { AppConfig } from '@/types';

const { devices } = vi.hoisted(() => ({ devices: vi.fn() }));
vi.mock('@/api/subscription', () => ({ subscriptionApi: { getDevices: devices } }));
const key = 'connection:podkl2a:ios:INCY';
const flow = {
  platform: 'ios',
  app: 'INCY',
  scope: 'podkl2a',
  subscriptionId: 321,
  selectIncy: vi.fn(),
};
const response = (vpn_working?: boolean | null, total = 1) => ({
  devices: [{ hwid: 'phone', platform: 'iOS', app: 'INCY', created_at: '2001-01-01T00:00:00Z' }],
  total,
  panel_ok: true,
  ...(vpn_working === undefined ? {} : { vpn_working }),
});
const seed = (received = true, working = false) =>
  localStorage.setItem(key, JSON.stringify({ received, working, installed: true }));
const tick = (ms = 0) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
const mountHook = () => renderHook(() => useConnectionProgress(flow));
const returned = () => act(() => fireEvent(document, new Event('visibilitychange')));

function mountScreen(language = 'ru') {
  const i18n = createInstance();
  void i18n.init({
    lng: language,
    resources: { ru: { translation: ru }, en: { translation: en } },
    initImmediate: false,
  });
  render(
    <I18nextProvider i18n={i18n}>
      <InstallationGuide
        appConfig={structuredClone(config) as unknown as AppConfig}
        onOpenDeepLink={vi.fn()}
        isTelegramWebApp
        onGoBack={vi.fn()}
        subscriptionId={321}
        progressScope="podkl2a"
      />
    </I18nextProvider>,
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-18T20:00:00Z'));
  localStorage.clear();
  devices.mockReset().mockResolvedValue(response(false));
  Object.defineProperty(navigator, 'userAgent', { configurable: true, value: 'iPhone' });
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('VPN working evidence', () => {
  it.each([
    [true, true, 1, true],
    [true, true, 2, false],
    [true, false, 1, false],
    [true, null, 1, false],
    [true, undefined, 1, false],
    [false, true, 1, false],
  ])(
    'received=%s traffic=%s total=%s => working=%s',
    async (received, traffic, total, expected) => {
      seed(received);
      devices.mockResolvedValue(response(traffic, total));
      const h = mountHook();
      await tick();
      expect(!!JSON.parse(localStorage.getItem(key)!).working).toBe(expected);
      expect(h.result.current.active === 3).toBe(expected);
    },
  );
  it('reads traffic on mount with a stored receipt before the non-importing early return', async () => {
    seed();
    devices.mockResolvedValue(response(true));
    mountHook();
    await tick();
    expect(devices).toHaveBeenCalledExactlyOnceWith(321, true);
    expect(JSON.parse(localStorage.getItem(key)!).working).toBe(true);
  });
  it.each(['mount', 'return'])(
    'polls at 0/5/15/45/90/180s after %s and then stops',
    async (mode) => {
      seed();
      mountHook();
      if (mode === 'return') {
        await tick(1000);
        devices.mockClear();
        returned();
      }
      const start = Date.now();
      const observed: number[] = [];
      devices.mockImplementation(async () => {
        observed.push(Date.now() - start);
        return response(false);
      });
      for (const delta of [0, 5000, 10000, 30000, 45000, 90000]) await tick(delta);
      expect(observed).toEqual([0, 5000, 15000, 45000, 90000, 180000]);
      expect(devices.mock.calls.every((args) => args.length === 2 && args[1] === true)).toBe(true);
      expect(vi.getTimerCount()).toBe(0);
      await tick(600000);
      expect(observed).toHaveLength(6);
    },
  );
  it('clears every outstanding timer when working is proven, and survives unmount/mount', async () => {
    seed();
    const h = mountHook();
    await tick();
    devices.mockResolvedValue(response(true));
    await tick(5000);
    expect(h.result.current.active).toBe(3);
    const count = devices.mock.calls.length;
    await tick(600000);
    expect(devices).toHaveBeenCalledTimes(count);
    h.unmount();
    devices.mockClear();
    const next = mountHook();
    await tick();
    expect(next.result.current.active).toBe(3);
    expect(devices).toHaveBeenCalledExactlyOnceWith(321);
  });
  it('ordinary reads do not opt into traffic and never prove working without received', async () => {
    devices.mockResolvedValue(response(true));
    const h = mountHook();
    await tick();
    returned();
    await tick();
    expect(devices.mock.calls).toEqual([[321], [321]]);
    expect(h.result.current.active).toBe(0);
    expect(JSON.parse(localStorage.getItem(key)!).working).toBeUndefined();
  });
  it('after receipt in this import, the next scheduled read opts into traffic', async () => {
    const h = mountHook();
    await tick();
    act(() => h.result.current.action('subscriptionLink'));
    devices.mockResolvedValue({
      ...response(true),
      devices: [{ ...response().devices[0], hwid: 'new-phone' }],
    });
    returned();
    await tick();
    expect(h.result.current.received).toBe(true);
    expect(h.result.current.active).toBe(2);
    await tick(5000);
    expect(devices).toHaveBeenLastCalledWith(321, true);
    expect(h.result.current.active).toBe(3);
  });
  it('unmount and hiding cancel scheduled reads', async () => {
    seed();
    const h = mountHook();
    await tick();
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    returned();
    h.unmount();
    await tick(600000);
    expect(devices).toHaveBeenCalledTimes(1);
  });
  it.each(['ru', 'en'])(
    'renders the completed third step and approved %s text',
    async (language) => {
      seed();
      devices.mockResolvedValue(response(true));
      mountScreen(language);
      await tick();
      const text =
        language === 'ru' ? 'VPN работает — можно пользоваться' : "VPN is working — you're all set";
      expect(screen.getByText(text).className).toContain('text-success-400');
      const title = screen.getByRole('button', {
        name: language === 'ru' ? 'Включите VPN' : 'Turn on VPN',
      });
      expect(title.className).toContain('text-dark-400');
      expect(screen.queryByText('3')).toBeNull();
    },
  );
  it.each([false, null, undefined])(
    'unknown/false=%s leaves the instruction without error text',
    async (traffic) => {
      seed();
      devices.mockResolvedValue(response(traffic));
      mountScreen();
      await tick();
      expect(screen.getByText('Включите VPN')).toBeTruthy();
      expect(screen.getByText('3')).toBeTruthy();
      expect(screen.queryByText('VPN работает — можно пользоваться')).toBeNull();
      expect(screen.queryByRole('alert')).toBeNull();
    },
  );
  it('all four dictionaries supply a translated working status', () => {
    for (const dictionary of [ru, en, zh, fa]) {
      expect(
        (dictionary.subscription.connection as Record<string, string>).vpnWorking?.length,
      ).toBeGreaterThan(10);
    }
  });
});
