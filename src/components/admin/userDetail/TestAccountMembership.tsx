import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { adminUsersApi, type UserDetailResponse } from '../../../api/adminUsers';
import { getErrorMessage } from '../../../utils/subscriptionHelpers';

export function TestAccountMembership({
  user,
  onDone,
}: {
  user: Pick<
    UserDetailResponse,
    'id' | 'telegram_id' | 'full_name' | 'is_test_account' | 'test_reset_state'
  >;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!user.telegram_id) return null;
  const resetting = user.test_reset_state === 'resetting' || user.test_reset_state === 'failed';
  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await adminUsersApi.setTestMembership(user.id, user.telegram_id!, !user.is_test_account);
      setConfirming(false);
      onDone();
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-3 rounded-xl border border-dark-600 bg-dark-800/50 p-4">
      <div className="text-sm font-medium">{t('admin.users.testReset.membershipTitle')}</div>
      <p className="text-xs text-dark-400">{t('admin.users.testReset.membershipHint')}</p>
      {error && (
        <p role="alert" className="text-sm text-error-300">
          {error}
        </p>
      )}
      {confirming && (
        <p className="text-sm text-warning-300">
          {t('admin.users.testReset.membershipConfirm', {
            name: user.full_name,
            id: user.telegram_id,
          })}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <button
          disabled={busy || resetting}
          onClick={() => (confirming ? void save() : setConfirming(true))}
          className="rounded-lg bg-accent-500/15 px-3 py-2 text-sm text-accent-300 disabled:opacity-50"
        >
          {busy
            ? t('common.loading')
            : confirming
              ? t('common.confirm')
              : user.is_test_account
                ? t('admin.users.testReset.removeTest')
                : t('admin.users.testReset.addTest')}
        </button>
        {confirming && (
          <button
            disabled={busy}
            onClick={() => setConfirming(false)}
            className="rounded-lg px-3 py-2 text-sm text-dark-300"
          >
            {t('common.cancel')}
          </button>
        )}
      </div>
      {resetting && (
        <p role="status" className="text-sm text-warning-300">
          {t('admin.users.testReset.resumeHint')}
        </p>
      )}
    </div>
  );
}
