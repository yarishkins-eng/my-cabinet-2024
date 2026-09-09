import { beforeEach, describe, expect, it, vi } from 'vitest';

const { get, post } = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn() }));
vi.mock('./client', () => ({ default: { get, post } }));

import { deviceAddonApi } from './deviceAddon';

describe('device add-on API contract', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    get.mockResolvedValue({ data: {} });
    post.mockResolvedValue({ data: {} });
  });

  it('uses the owner-scoped quote and intent endpoints with integer snake_case payloads', async () => {
    await deviceAddonApi.getQuote(44, 3);
    await deviceAddonApi.createIntent('signed-quote', 'request-uuid');
    await deviceAddonApi.purchase('intent-uuid', 'fresh-signed-quote');

    expect(get).toHaveBeenCalledWith('/cabinet/subscription/devices/quote', {
      params: { subscription_id: 44, devices: 3 },
    });
    expect(post).toHaveBeenNthCalledWith(1, '/cabinet/subscription/devices/intents', {
      quote_token: 'signed-quote',
      idempotency_key: 'request-uuid',
    });
    expect(post).toHaveBeenNthCalledWith(
      2,
      '/cabinet/subscription/devices/intents/intent-uuid/purchase',
      { quote_token: 'fresh-signed-quote' },
    );
  });

  it('creates and reads the exact Platega attempt without a provider correlation field', async () => {
    await deviceAddonApi.createTopup('intent-uuid', {
      idempotency_key: 'attempt-uuid',
      expected_amount_kopeks: 12_345,
      payment_method: 'platega',
      payment_option: '2',
      return_surface: 'cabinet',
    });
    await deviceAddonApi.getTopup('attempt-uuid');

    expect(post).toHaveBeenCalledWith('/cabinet/subscription/devices/intents/intent-uuid/topup', {
      idempotency_key: 'attempt-uuid',
      expected_amount_kopeks: 12_345,
      payment_method: 'platega',
      payment_option: '2',
      return_surface: 'cabinet',
    });
    expect(get).toHaveBeenCalledWith('/cabinet/subscription/devices/topups/attempt-uuid');
  });
});
