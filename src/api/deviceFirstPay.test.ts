// @vitest-environment jsdom

import { beforeEach, describe, expect, it, vi } from 'vitest';
import apiClient from './client';
import { deviceFirstApi, type DeviceFirstDirectCommitRequest } from './deviceFirst';

vi.mock('./client', () => ({
  default: { post: vi.fn() },
}));

const postMock = vi.mocked(apiClient.post);

const walletRequest: DeviceFirstDirectCommitRequest = {
  period_days: 30,
  selected_device_limit: 2,
  funding_mode: 'wallet',
  method_key: null,
  expected_tariff_total_kopeks: 45000,
};

const plategaRequest: DeviceFirstDirectCommitRequest = {
  ...walletRequest,
  funding_mode: 'platega',
  method_key: 'sbp',
};

function idempotencyKeyOf(call: number): string {
  const config = postMock.mock.calls[call][2] as { headers: Record<string, string> };
  return config.headers['Idempotency-Key'];
}

describe('device-first pay-time api', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
  });

  it('posts the fused wallet payload to the top-level commit route', async () => {
    postMock.mockResolvedValue({ data: { checkout: { id: 'c1' } } });

    const result = await deviceFirstApi.payDirect(walletRequest);

    expect(postMock).toHaveBeenCalledTimes(1);
    const [url, body] = postMock.mock.calls[0];
    expect(url).toBe('/cabinet/device-first/commit');
    expect(body).toEqual(walletRequest);
    expect(result.checkout).toEqual({ id: 'c1' });
    expect(idempotencyKeyOf(0).length).toBeLessThanOrEqual(128);
  });

  it('posts the fused native launch to its own route with the same body', async () => {
    postMock.mockResolvedValue({
      data: { checkout: { id: 'c1' }, redirect_url: 'https://pay.example' },
    });

    const result = await deviceFirstApi.nativeLaunchDirect(plategaRequest);

    const [url, body] = postMock.mock.calls[0];
    expect(url).toBe('/cabinet/device-first/native-launch');
    expect(body).toEqual(plategaRequest);
    expect(result.redirect_url).toBe('https://pay.example');
  });

  it('reuses the same idempotency key after an ambiguous network failure', async () => {
    postMock.mockRejectedValue(new Error('Network Error'));

    await expect(deviceFirstApi.payDirect(walletRequest)).rejects.toThrow();
    await expect(deviceFirstApi.payDirect(walletRequest)).rejects.toThrow();

    // No definitive server answer arrived: the retry must replay the exact
    // same mutation under the exact same key.
    expect(postMock).toHaveBeenCalledTimes(2);
    expect(idempotencyKeyOf(0)).toBe(idempotencyKeyOf(1));
  });

  it('keeps the key on a 5xx so the retry re-enters the same server mutation', async () => {
    postMock.mockRejectedValue({ response: { status: 500 } });

    await expect(deviceFirstApi.payDirect(walletRequest)).rejects.toThrow();
    await expect(deviceFirstApi.payDirect(walletRequest)).rejects.toThrow();

    expect(idempotencyKeyOf(0)).toBe(idempotencyKeyOf(1));
  });

  it('rotates the key after a definitive 4xx so the retry is never a stored replay', async () => {
    // The server stores business errors under the idempotency key and replays
    // them verbatim; after e.g. wallet_insufficient the same key would be a
    // dead end even after a top-up.
    postMock.mockRejectedValue({
      response: { status: 422, data: { detail: { code: 'wallet_insufficient' } } },
    });

    await expect(deviceFirstApi.payDirect(walletRequest)).rejects.toThrow();
    await expect(deviceFirstApi.payDirect(walletRequest)).rejects.toThrow();

    expect(postMock).toHaveBeenCalledTimes(2);
    expect(idempotencyKeyOf(0)).not.toBe(idempotencyKeyOf(1));
  });

  it('sends a reprice retry with the new price as a new intent under a new key', async () => {
    postMock.mockRejectedValueOnce({
      response: { status: 409, data: { detail: { code: 'reprice_required' } } },
    });

    await expect(deviceFirstApi.payDirect(plategaRequest)).rejects.toThrow();

    const repricedRequest = { ...plategaRequest, expected_tariff_total_kopeks: 46000 };
    postMock.mockResolvedValue({ data: { checkout: { id: 'c2' } } });
    await deviceFirstApi.payDirect(repricedRequest);

    expect(postMock).toHaveBeenCalledTimes(2);
    expect(postMock.mock.calls[1][1]).toEqual(repricedRequest);
    expect(idempotencyKeyOf(1)).not.toBe(idempotencyKeyOf(0));
  });
});
