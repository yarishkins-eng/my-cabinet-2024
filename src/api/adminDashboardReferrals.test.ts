import { beforeEach, describe, expect, it, vi } from 'vitest';

const { get } = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('./client', () => ({ default: { get } }));

import { statsApi } from './admin';

/** РЕФ-2: экранные тесты подменяют весь statsApi, поэтому адрес ручки и «вернуть response.data» нигде не проверяются —
 * опечатка в адресе дала бы на экране вечное «Не удалось загрузить приглашения», а тесты остались бы зелёными (ревью W2-M2). */
describe('РЕФ-2: ручка приглашений на «Статистике»', () => {
  beforeEach(() => vi.clearAllMocks());

  it('reads exactly /cabinet/admin/stats/referrals/overview with GET and returns the body', async () => {
    const body = {
      months: [],
      new_people_month: 0,
      money_month_kopeks: 0,
      came_pct: null,
      money_pct: null,
    };
    get.mockResolvedValue({ data: body });

    await expect(statsApi.getDashboardReferrals()).resolves.toBe(body);

    expect(get).toHaveBeenCalledTimes(1);
    expect(get).toHaveBeenCalledWith('/cabinet/admin/stats/referrals/overview');
  });
});
