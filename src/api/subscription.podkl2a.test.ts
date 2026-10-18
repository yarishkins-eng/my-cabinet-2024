// @vitest-environment jsdom
import { beforeEach, expect, it, vi } from 'vitest';
import apiClient from './client';
import { subscriptionApi } from './subscription';

vi.mock('./client', () => ({ default: { get: vi.fn() } }));
beforeEach(() => {
  vi.mocked(apiClient.get)
    .mockReset()
    .mockResolvedValue({ data: { total: 1 } });
});

it.each([undefined, 321])(
  'opts into traffic only when requested, with subscription %s',
  async (id) => {
    await subscriptionApi.getDevices(id);
    await subscriptionApi.getDevices(id, false);
    await subscriptionApi.getDevices(id, true);
    const params = id === undefined ? {} : { subscription_id: id };
    expect(vi.mocked(apiClient.get).mock.calls).toEqual([
      ['/cabinet/subscription/devices', { params }],
      ['/cabinet/subscription/devices', { params }],
      ['/cabinet/subscription/devices', { params: { ...params, traffic: 1 } }],
    ]);
  },
);
