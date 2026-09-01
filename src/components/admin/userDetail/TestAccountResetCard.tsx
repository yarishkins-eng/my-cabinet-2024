import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { adminUsersApi, type TestAccountResetResponse } from '../../../api/adminUsers';
import { getErrorMessage } from '../../../utils/subscriptionHelpers';
import { useCurrency } from '../../../hooks/useCurrency';

// ──────────────────────────────────────────────────────────────────
// Обнуление тестового стенда.
//
// Карточка рисуется ТОЛЬКО у аккаунта из списка на сервере
// (`TEST_ACCOUNT_TELEGRAM_IDS`). Это подсказка экрану, а не защита:
// сам маршрут проверяет список заново и отбивает чужой запрос.
//
// Два нажатия намеренно. Первое ничего не меняет и спрашивает сервер,
// что именно исчезнет; второе выполняет. План и выполнение считает
// один и тот же код на сервере, поэтому прочитанное и снесённое
// не могут разойтись.
// ──────────────────────────────────────────────────────────────────

interface TestAccountResetCardProps {
  userId: number;
  onDone: () => void;
}

export function TestAccountResetCard({ userId, onDone }: TestAccountResetCardProps) {
  const { t } = useTranslation();
  const { formatWithCurrency } = useCurrency();
  const [plan, setPlan] = useState<TestAccountResetResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (confirm: boolean) => {
    setLoading(true);
    setError(null);
    try {
      const result = await adminUsersApi.testAccountReset(userId, confirm);
      setPlan(result);
      if (result.done) onDone();
    } catch (err) {
      setError(getErrorMessage(err));
      setPlan(null);
    } finally {
      setLoading(false);
    }
  };

  const rows: Array<{ label: string; value: string }> = plan
    ? [
        {
          label: t('admin.users.testReset.balance'),
          value: formatWithCurrency(plan.balance_kopeks / 100),
        },
        {
          label: t('admin.users.testReset.subscription'),
          value: plan.subscription ?? t('admin.users.testReset.nothing'),
        },
        { label: t('admin.users.testReset.orders'), value: String(plan.orders) },
        { label: t('admin.users.testReset.payments'), value: String(plan.payments) },
        { label: t('admin.users.testReset.transactions'), value: String(plan.transactions) },
        {
          label: t('admin.users.testReset.panel'),
          value: plan.panel_linked
            ? t('admin.users.testReset.panelLinked')
            : t('admin.users.testReset.nothing'),
        },
      ]
    : [];

  return (
    <div className="rounded-xl border border-accent-500/30 bg-accent-500/5 p-4">
      <div className="mb-1 text-sm font-medium text-accent-300">
        {t('admin.users.testReset.title')}
      </div>
      <div className="mb-3 text-xs text-dark-400">{t('admin.users.testReset.subtitle')}</div>

      {error && (
        <div className="mb-3 rounded-lg border border-error-500/30 bg-error-500/10 p-3 text-xs text-error-300">
          {error}
        </div>
      )}

      {plan?.done && (
        <div className="mb-3 rounded-lg border border-success-500/30 bg-success-500/10 p-3 text-xs text-success-300">
          <div className="font-medium">{t('admin.users.testReset.doneTitle')}</div>
          <div className="mt-1">{t('admin.users.testReset.doneHint')}</div>
        </div>
      )}

      {plan && !plan.done && !plan.allowed && (
        <div className="mb-3 rounded-lg border border-warning-500/30 bg-warning-500/10 p-3 text-xs text-warning-200">
          <div className="font-medium">{t('admin.users.testReset.blockedTitle')}</div>
          <div className="mt-1">{plan.blocked_reason}</div>
        </div>
      )}

      {plan && !plan.done && plan.allowed && (
        <div className="mb-3 rounded-lg border border-dark-600 bg-dark-800/60 p-3">
          <div className="mb-2 text-xs font-medium text-dark-200">
            {t('admin.users.testReset.willDelete')}
          </div>
          <div className="space-y-1">
            {rows.map((row) => (
              <div key={row.label} className="flex justify-between gap-3 text-xs">
                <span className="text-dark-400">{row.label}</span>
                <span className="text-right text-dark-100">{row.value}</span>
              </div>
            ))}
          </div>
          {plan.invited_users > 0 && (
            <div className="mt-2 border-t border-dark-700 pt-2 text-xs text-dark-400">
              {t('admin.users.testReset.invitedStay', { count: plan.invited_users })}
            </div>
          )}
          <div className="mt-2 text-xs text-dark-400">{t('admin.users.testReset.auditStays')}</div>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {plan && !plan.done && plan.allowed ? (
          <>
            <button
              onClick={() => run(true)}
              disabled={loading}
              className="rounded-lg bg-rose-500 px-3 py-2 text-sm font-medium text-white transition-all hover:bg-rose-600 disabled:opacity-50"
            >
              {loading ? t('common.loading') : t('admin.users.testReset.confirm')}
            </button>
            <button
              onClick={() => setPlan(null)}
              disabled={loading}
              className="rounded-lg bg-dark-700 px-3 py-2 text-sm font-medium text-dark-300 transition-all hover:bg-dark-600 disabled:opacity-50"
            >
              {t('common.cancel')}
            </button>
          </>
        ) : (
          <button
            onClick={() => run(false)}
            disabled={loading}
            className="rounded-lg bg-accent-500/15 px-3 py-2 text-sm font-medium text-accent-400 transition-all hover:bg-accent-500/25 disabled:opacity-50"
          >
            {loading ? t('common.loading') : t('admin.users.testReset.check')}
          </button>
        )}
      </div>
    </div>
  );
}
