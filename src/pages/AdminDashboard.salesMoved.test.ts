import { describe, expect, it } from 'vitest';

import dashboardSource from './AdminDashboard.tsx?raw';

/** СП-1, решение владельца «убрать старые числа, сервера оставить»: на «Статистике» не остаётся чисел о деньгах и
 * подписках, которые спорят с «Платят / На пробном», а путь к ним — видимой ссылкой (ревью C2-3, C4-2, C4-3). */
describe('AdminDashboard — деньги и подписки уехали на «Статистику продаж»', () => {
  it('has no old money or subscription numbers', () => {
    expect(dashboardSource).not.toContain('systemInfo.activeSubs');
    expect(dashboardSource).not.toContain('systemInfo.users');
    expect(dashboardSource).not.toContain('recentPayments.today');
    expect(dashboardSource).not.toContain('recentPayments.week');
  });

  it('points to the sales screen', () => {
    expect(dashboardSource).toContain("navigate('/admin/sales-stats')");
    expect(dashboardSource).toContain("t('adminDashboard.salesLink')");
  });
});
