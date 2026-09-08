// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { adminUsersApi } from '../../../api/adminUsers';
import { TestAccountMembership } from './TestAccountMembership';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, values?: { name?: string; id?: number }) =>
      key === 'admin.users.testReset.membershipConfirm'
        ? `${key}:${values?.name}:${values?.id}`
        : key,
  }),
  initReactI18next: { type: '3rdParty', init: () => {} },
}));

vi.mock('../../../api/adminUsers', () => ({
  adminUsersApi: { setTestMembership: vi.fn(), testAccountReset: vi.fn() },
}));

const tester = {
  id: 196,
  telegram_id: 7749231125,
  full_name: 'Тестовый пользователь',
  is_test_account: false,
  test_reset_state: null,
};

describe('TestAccountMembership', () => {
  beforeEach(() => {
    vi.mocked(adminUsersApi.setTestMembership).mockReset();
    vi.mocked(adminUsersApi.testAccountReset).mockReset();
    vi.mocked(adminUsersApi.setTestMembership).mockResolvedValue(undefined);
  });

  afterEach(cleanup);

  it('enrolls only after the confirmation naming the exact Telegram ID, without a reset', async () => {
    const onDone = vi.fn();
    render(<TestAccountMembership user={tester} onDone={onDone} />);

    fireEvent.click(screen.getByRole('button', { name: 'admin.users.testReset.addTest' }));

    expect(screen.getByText(/admin\.users\.testReset\.membershipConfirm/)).toBeTruthy();
    expect(screen.getByText(/7749231125/)).toBeTruthy();
    expect(adminUsersApi.setTestMembership).not.toHaveBeenCalled();
    expect(adminUsersApi.testAccountReset).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'common.confirm' }));

    await waitFor(() =>
      expect(adminUsersApi.setTestMembership).toHaveBeenCalledWith(196, 7749231125, true),
    );
    expect(adminUsersApi.testAccountReset).not.toHaveBeenCalled();
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('removes membership only after the same exact-ID confirmation, without a reset', async () => {
    const onDone = vi.fn();
    render(<TestAccountMembership user={{ ...tester, is_test_account: true }} onDone={onDone} />);

    fireEvent.click(screen.getByRole('button', { name: 'admin.users.testReset.removeTest' }));
    expect(screen.getByText(/7749231125/)).toBeTruthy();
    expect(adminUsersApi.setTestMembership).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'common.confirm' }));

    await waitFor(() =>
      expect(adminUsersApi.setTestMembership).toHaveBeenCalledWith(196, 7749231125, false),
    );
    expect(adminUsersApi.testAccountReset).not.toHaveBeenCalled();
    expect(onDone).toHaveBeenCalledTimes(1);
  });
});
