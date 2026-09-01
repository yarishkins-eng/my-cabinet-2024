// @vitest-environment jsdom

import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { UserDetailResponse, UserListItem } from '../../../api/adminUsers';
import en from '../../../locales/en.json';
import fa from '../../../locales/fa.json';
import ru from '../../../locales/ru.json';
import zh from '../../../locales/zh.json';
import { InfoTab, type InfoTabProps } from './InfoTab';

vi.mock('react-router', () => ({ useNavigate: () => vi.fn() }));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) =>
      ({
        'admin.users.detail.referral.earned': 'Заработано',
        'admin.bulkActions.columns.spent': 'Потрачено',
      })[key] ?? key,
  }),
  // InfoTab тянет общий разборщик ошибок, а тот — настоящий i18n.
  initReactI18next: { type: '3rdParty', init: () => {} },
}));
vi.mock('../../../hooks/useCurrency', () => ({
  useCurrency: () => ({ formatWithCurrency: (value: number) => `${value.toFixed(2)} ₽` }),
}));

afterEach(() => cleanup());

describe('Суммы по каждому рефералу', () => {
  it('однозначно подписывает заработок владельца и траты реферала', () => {
    const user = {
      status: 'active',
      language: 'ru',
      created_at: '2026-08-01T00:00:00Z',
      total_spent_kopeks: 0,
      purchase_count: 0,
      referral: { referrals_count: 1, total_earnings_kopeks: 26_575, commission_percent: 35 },
    } as unknown as UserDetailResponse;
    const referrals = [
      {
        id: 129,
        first_name: 'G',
        full_name: 'genidze',
        created_at: '2026-08-02T00:00:00Z',
        referral_earned_kopeks: 26_575,
        total_spent_kopeks: 76_233,
      },
    ] as UserListItem[];
    const props = {
      user,
      referrals,
      referralsLoading: false,
      hasPermission: () => false,
      formatDate: (date: string | null) => date ?? '-',
      locale: 'ru',
      panelInfo: null,
      panelInfoLoading: false,
      userSubscriptions: [],
      activeSubscriptionId: null,
      promoGroups: [],
      editingPromoGroup: false,
      editingReferralCommission: false,
      referralCommissionValue: '',
      actionLoading: false,
      confirmingAction: null,
      onActiveSubscriptionChange: vi.fn(),
      onToggleEditingPromoGroup: vi.fn(),
      onChangePromoGroup: vi.fn(),
      onSetReferralCommissionValue: vi.fn(),
      onToggleEditingReferralCommission: vi.fn(),
      onUpdateReferralCommission: vi.fn(),
      onBlockUser: vi.fn(),
      onUnblockUser: vi.fn(),
      onInlineConfirm: vi.fn(),
      onResetTrial: vi.fn(),
      onResetSubscription: vi.fn(),
      onDisableUser: vi.fn(),
      onFullDeleteUser: vi.fn(),
    } as unknown as InfoTabProps;

    render(<InfoTab {...props} />);

    expect(screen.getByText('Заработано: 265.75 ₽').className).toContain('text-dark-100');
    expect(screen.getByText('Потрачено: 762.33 ₽').className).toContain('text-dark-500');
  });

  it('имеет обе подписи во всех четырёх словарях', () => {
    for (const locale of [ru, en, fa, zh]) {
      expect(locale.admin.users.detail.referral.earned).toBeTruthy();
      expect(locale.admin.bulkActions.columns.spent).toBeTruthy();
    }
  });
});
