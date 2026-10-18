// @vitest-environment jsdom
import { act, cleanup, fireEvent, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useConnectionProgress } from './useConnectionProgress';

const { devices } = vi.hoisted(() => ({ devices: vi.fn() }));
vi.mock('@/api/subscription', () => ({ subscriptionApi: { getDevices: devices } }));
const key = 'connection:owner:ios:INCY';
const old = '2001-01-01T00:00:00Z';
const newer = '2001-01-01T00:00:02Z'; // Panel clock deliberately differs from the phone clock.
type Device = {
  hwid: string;
  platform?: string | null;
  app?: string | null;
  created_at?: string | null;
};
const phone = (patch: Partial<Device> = {}): Device => ({
  hwid: 'same',
  platform: 'iOS',
  app: 'INCY',
  created_at: old,
  ...patch,
});
const response = (rows = [phone()], panel_ok = true, total = rows.length) => ({
  devices: rows,
  panel_ok,
  total,
});
const flush = () => act(async () => {});
function mount(platform = 'ios', app = 'INCY') {
  return renderHook(() =>
    useConnectionProgress({
      platform,
      app,
      scope: 'owner',
      subscriptionId: 665,
      selectIncy: vi.fn(),
    }),
  );
}
async function poll() {
  act(() => fireEvent(document, new Event('visibilitychange')));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
}
function deferred() {
  let resolve!: (value: ReturnType<typeof response>) => void;
  const promise = new Promise<ReturnType<typeof response>>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-18T10:00:00Z'));
  localStorage.clear();
  devices.mockReset().mockResolvedValue(response());
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('repeat import receipt', () => {
  it.each([null, undefined, ''])(
    'rejects an unknown hwid %s in both observations',
    async (hwid) => {
      devices.mockResolvedValue(response([{ ...phone(), hwid } as unknown as Device]));
      const h = mount();
      await flush();
      act(() => h.result.current.action('subscriptionLink'));
      devices.mockResolvedValue(
        response([{ ...phone({ created_at: newer }), hwid } as unknown as Device]),
      );
      await poll();
      expect(h.result.current.received).toBeFalsy();
    },
  );
  it.each([
    ['iOS', 'INCY', 'ios', 'INCY', true],
    ['IOS', 'incy', 'ios', 'INCY', true],
    ['iOS', 'Happ', 'ios', 'Happ', true],
    ['Android', 'INCY', 'android', 'INCY', true],
    ['Unknown', 'INCY', 'ios', 'INCY', false],
    [null, 'INCY', 'ios', 'INCY', false],
    [undefined, 'INCY', 'ios', 'INCY', false],
    ['iPadOS', 'INCY', 'ios', 'INCY', false],
    ['iOS-extra', 'INCY', 'ios', 'INCY', false],
    ['AndroidTV', 'INCY', 'android', 'INCY', false],
    ['iOS', 'Happ', 'ios', 'INCY', false],
    ['iOS', null, 'ios', 'INCY', false],
    ['iOS', undefined, 'ios', 'INCY', false],
  ])('%s/%s on %s/%s => %s', async (platform, app, screenPlatform, selected, expected) => {
    devices.mockResolvedValue(response([phone({ platform, app })]));
    const h = mount(screenPlatform!, selected!);
    await flush();
    act(() => h.result.current.action('subscriptionLink'));
    devices.mockResolvedValue(response([phone({ platform, app, created_at: newer })]));
    await poll();
    expect(!!h.result.current.received).toBe(expected);
  });
  it.each([null, undefined, 'bad-date', old, '2000-01-01T00:00:00Z'])(
    'rejects current timestamp %s',
    async (created_at) => {
      const h = mount();
      await flush();
      act(() => h.result.current.action('subscriptionLink'));
      devices.mockResolvedValue(response([phone({ created_at })]));
      await poll();
      expect(h.result.current.received).toBeFalsy();
    },
  );
  it.each([null, undefined, 'bad-date'])('rejects snapshot timestamp %s', async (created_at) => {
    devices.mockResolvedValue(response([phone({ created_at })]));
    const h = mount();
    await flush();
    act(() => h.result.current.action('subscriptionLink'));
    devices.mockResolvedValue(response([phone({ created_at: newer })]));
    await poll();
    expect(h.result.current.received).toBeFalsy();
  });
  it.each(['before', 'after'])('requires uniqueness in %s', async (side) => {
    const second = phone({ hwid: 'second' });
    devices.mockResolvedValue(response(side === 'before' ? [phone(), second] : [phone()]));
    const h = mount();
    await flush();
    act(() => h.result.current.action('subscriptionLink'));
    // For the after case keep total constant and make the second hwid part of baseline:
    // it was foreign before the tap, then became a second matching app.
    if (side === 'after') {
      h.unmount();
      localStorage.clear();
      devices.mockResolvedValue(response([phone(), phone({ hwid: 'second', app: 'Happ' })]));
      const next = mount();
      await flush();
      act(() => next.result.current.action('subscriptionLink'));
      devices.mockResolvedValue(response([phone({ created_at: newer }), second]));
      await poll();
      expect(next.result.current.received).toBeFalsy();
    } else {
      devices.mockResolvedValue(response([phone({ created_at: newer })]));
      await poll();
      expect(h.result.current.received).toBeFalsy();
    }
  });
  it('uses the tap snapshot, not an older idle baseline', async () => {
    const h = mount();
    await flush();
    act(() => h.result.current.action('subscriptionLink'));
    devices.mockResolvedValue(response([phone({ created_at: newer })], false));
    await poll();
    expect(h.result.current.received).toBeFalsy();
    // A healthy pre-tap read in a new opening is newer than saved baseline/tap.
    h.unmount();
    const pending = deferred();
    devices.mockReturnValueOnce(pending.promise);
    const next = mount();
    act(() => next.result.current.action('subscriptionLink'));
    await act(async () => pending.resolve(response([phone({ created_at: newer })])));
    devices.mockResolvedValue(response([phone({ created_at: newer })]));
    await poll();
    expect(next.result.current.received).toBeFalsy();
    devices.mockResolvedValue(response([phone({ created_at: '2001-01-01T00:00:03Z' })]));
    await poll();
    expect(next.result.current.received).toBe(true);
  });
  it('does not use an old baseline instead of the most recent tap snapshot', async () => {
    const h = mount();
    await flush();
    act(() => h.result.current.action('subscriptionLink'));
    devices.mockResolvedValue(response([phone({ created_at: newer, app: 'Happ' })]));
    await poll();
    act(() => h.result.current.action('subscriptionLink'));
    devices.mockResolvedValue(response([phone({ created_at: newer })]));
    await poll();
    expect(h.result.current.received).toBeFalsy();
  });
  it('replaces a saved tap with undefined on a new Add before a fresh successful read', async () => {
    const h = mount();
    await flush();
    act(() => h.result.current.action('subscriptionLink'));
    h.unmount();
    const pending = deferred();
    devices.mockReturnValueOnce(pending.promise);
    const next = mount();
    act(() => next.result.current.action('subscriptionLink'));
    expect(JSON.parse(localStorage.getItem(key)!).tapSnapshot).toBeUndefined();
    next.unmount();
  });
  it('does not adopt a baseline after the first read failed', async () => {
    localStorage.setItem(key, JSON.stringify({ baseline: { hwids: ['same'], total: 1 } }));
    devices.mockRejectedValueOnce(new Error('offline'));
    const h = mount();
    await flush();
    act(() => h.result.current.action('subscriptionLink'));
    devices.mockResolvedValue(response([phone({ created_at: newer })]));
    await poll();
    expect(h.result.current.received).toBeFalsy();
  });
  it('treats a pre-tap pending read as baseline/tap only, then requires a further shift', async () => {
    const h = mount();
    await flush();
    const pending = deferred();
    devices.mockReturnValueOnce(pending.promise);
    await poll();
    act(() => h.result.current.action('subscriptionLink'));
    await act(async () => pending.resolve(response([phone({ created_at: newer })])));
    expect(h.result.current.received).toBeFalsy();
    expect(JSON.parse(localStorage.getItem(key)!).tapSnapshot[0].created_at).toBe(newer);
    devices.mockResolvedValue(response([phone({ created_at: newer })]));
    await poll();
    expect(h.result.current.received).toBeFalsy();
    devices.mockResolvedValue(response([phone({ created_at: '2001-01-01T00:00:03Z' })]));
    await poll();
    expect(h.result.current.received).toBe(true);
  });
  it('rejects a request of a previous Add even if the next Add has the same millisecond', async () => {
    const h = mount();
    await flush();
    act(() => h.result.current.action('subscriptionLink'));
    const pending = deferred();
    devices.mockReturnValueOnce(pending.promise);
    await poll();
    act(() => h.result.current.action('subscriptionLink'));
    await act(async () => pending.resolve(response([phone({ created_at: newer })])));
    expect(h.result.current.received).toBeFalsy();
  });
  it('requires the unique matching device to keep the same hwid', async () => {
    devices.mockResolvedValue(response([phone(), phone({ hwid: 'second', app: 'Happ' })]));
    const h = mount();
    await flush();
    act(() => h.result.current.action('subscriptionLink'));
    devices.mockResolvedValue(
      response([phone({ app: 'Happ' }), phone({ hwid: 'second', created_at: newer })]),
    );
    await poll();
    expect(h.result.current.received).toBeFalsy();
  });
  it('copying alone never starts waiting', async () => {
    const h = mount();
    await flush();
    devices.mockResolvedValue(response([phone({ created_at: newer })]));
    await poll();
    expect(h.result.current.received).toBeFalsy();
    expect(localStorage.getItem(key)).not.toContain('"importing":true');
  });
});

describe('window and legacy new-device rule', () => {
  it.each([0, 900000, 901000])('applies the window to BOTH rules at %d ms', async (age) => {
    for (const rule of ['repeat', 'new', 'total']) {
      localStorage.clear();
      devices.mockResolvedValue(response());
      const h = mount();
      await flush();
      act(() => h.result.current.action('subscriptionLink'));
      vi.setSystemTime(Date.now() + age);
      devices.mockResolvedValue(
        rule === 'repeat'
          ? response([phone({ created_at: newer })])
          : rule === 'new'
            ? response([phone({ hwid: 'new' })])
            : response([phone()], true, 2),
      );
      await poll();
      expect(!!h.result.current.received).toBe(age <= 900000);
      if (age > 900000) expect(JSON.parse(localStorage.getItem(key)!).importing).toBe(false);
      h.unmount();
    }
  });
  it.each([undefined, null, '2026', 'NaN', 'Infinity', Date.parse('2026-10-18T10:00:01Z')])(
    'resets invalid importingAt %s',
    async (importingAt) => {
      localStorage.setItem(
        key,
        JSON.stringify({
          importing: true,
          importingAt,
          baseline: { hwids: [], total: 0 },
          tapSnapshot: null,
        }),
      );
      const h = mount();
      await flush();
      expect(h.result.current.received).toBeFalsy();
      const saved = JSON.parse(localStorage.getItem(key)!);
      expect(saved.importing).toBe(false);
      expect(saved.baseline.hwids).toEqual(['same']);
    },
  );
  it('resets a non-finite numeric importingAt from legacy storage', async () => {
    localStorage.setItem(key, '{"importing":true,"importingAt":1e999,"tapSnapshot":null}');
    const h = mount();
    await flush();
    expect(h.result.current.received).toBeFalsy();
    expect(JSON.parse(localStorage.getItem(key)!).importing).toBe(false);
  });
  it('resets an expectation if a request completes after expiry', async () => {
    const h = mount();
    await flush();
    act(() => h.result.current.action('subscriptionLink'));
    const pending = deferred();
    devices.mockReturnValueOnce(pending.promise);
    await poll();
    vi.setSystemTime(Date.now() + 901000);
    await act(async () => pending.resolve(response([phone({ created_at: newer })])));
    expect(h.result.current.received).toBeFalsy();
    expect(JSON.parse(localStorage.getItem(key)!).importing).toBe(false);
  });
  it.each([
    [{}, true],
    [{ platform: null, app: null }, true],
    [{ platform: null, app: 'Happ' }, false],
    [{ platform: 'iPadOS', app: null }, false],
    [{ platform: 'iOS', app: 'Happ' }, false],
    [{ platform: 'Android', app: 'INCY' }, false],
    [{ platform: 'iOS', app: 'INCY' }, true],
  ])('filters new hwid with metadata %j => %s, even if total grew', async (metadata, expected) => {
    const h = mount();
    await flush();
    act(() => h.result.current.action('subscriptionLink'));
    devices.mockResolvedValue(response([phone(), { hwid: 'new', ...metadata }]));
    await poll();
    expect(!!h.result.current.received).toBe(expected);
  });
});
