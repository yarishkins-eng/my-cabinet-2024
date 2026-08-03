import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { subscriptionApi } from '@/api/subscription';
import { balanceApi } from '@/api/balance';
import PageLoader from '@/components/common/PageLoader';
import { useCurrency } from '@/hooks/useCurrency';

function activationKey(): string {
  return typeof crypto?.randomUUID === 'function'
    ? crypto.randomUUID()
    : `trial-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function isCheckoutStateConflict(error: unknown): boolean {
  return (error as { response?: { status?: unknown } })?.response?.status === 409;
}

/**
 * The dedicated intent route for Telegram's "Try for free" CTA.
 *
 * It never treats an unfinished paid order as a subscription.  The server is
 * authoritative about whether a previous invoice is safe to abandon; this
 * component merely shows that decision and sends its immutable checkout id.
 */
export default function TrialStart() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { formatAmount, currencySymbol } = useCurrency();
  const [error, setError] = useState<string | null>(null);
  const idempotencyKey = useRef(activationKey());
  const trial = useQuery({
    queryKey: ['trial-info'],
    queryFn: subscriptionApi.getTrialInfo,
    staleTime: 0,
  });
  const balance = useQuery({
    queryKey: ['balance'],
    queryFn: balanceApi.getBalance,
    enabled: Boolean(trial.data?.requires_payment),
  });

  const activate = useMutation({
    mutationFn: (resolution: 'activate' | 'abandon_pending_invoice') =>
      subscriptionApi.activateTrial({
        resolution,
        expectedCheckoutId:
          resolution === 'abandon_pending_invoice' ? trial.data?.checkout?.id : undefined,
        idempotencyKey: idempotencyKey.current,
      }),
    onSuccess: async () => {
      setError(null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['subscription'] }),
        queryClient.invalidateQueries({ queryKey: ['subscriptions-list'] }),
        queryClient.invalidateQueries({ queryKey: ['trial-info'] }),
        queryClient.invalidateQueries({ queryKey: ['device-first-open-checkout'] }),
        queryClient.invalidateQueries({ queryKey: ['balance'] }),
      ]);
      navigate('/', { replace: true });
    },
    onError: async (nextError) => {
      if (isCheckoutStateConflict(nextError)) {
        idempotencyKey.current = activationKey();
        setError(t('trialStart.orderChanged'));
        await trial.refetch();
        await queryClient.invalidateQueries({ queryKey: ['device-first-open-checkout'] });
        return;
      }
      setError(t('trialStart.activateError'));
    },
  });

  if (trial.isLoading) return <PageLoader variant="dark" />;
  if (trial.isError || !trial.data) {
    return (
      <section className="mx-auto max-w-xl space-y-5 px-4 py-8 sm:py-12">
        <h1 className="text-2xl font-bold text-dark-50">{t('trialStart.loadErrorTitle')}</h1>
        <p className="text-dark-300">{t('trialStart.loadErrorText')}</p>
        <button
          className="rounded-xl bg-accent-500 px-5 py-3 font-semibold text-white"
          onClick={() => trial.refetch()}
        >
          {t('trialStart.refresh')}
        </button>
      </section>
    );
  }

  const info = trial.data;
  const checkout = info.checkout;
  const amount = checkout
    ? `${formatAmount(checkout.amount_kopeks / 100)} ${currencySymbol}`
    : null;
  const isPendingInvoice = info.checkout_state === 'pending_invoice' && checkout;
  const isChecking = info.checkout_state === 'reconciliation_required';
  const canActivate = info.is_available && !isChecking;
  const canAffordTrial =
    !info.requires_payment || (balance.data?.balance_kopeks ?? 0) >= info.price_kopeks;

  return (
    <section className="mx-auto max-w-xl space-y-5 px-4 py-8 sm:py-12">
      {isChecking ? (
        <>
          <div className="rounded-3xl border border-warning-400/30 bg-warning-400/10 p-6">
            <p className="text-sm font-semibold text-warning-300">
              {t('trialStart.checkingEyebrow')}
            </p>
            <h1 className="mt-2 text-2xl font-bold text-dark-50">
              {t('trialStart.checkingTitle')}
            </h1>
            <p className="mt-3 text-dark-300">{t('trialStart.checkingText')}</p>
          </div>
          <button
            type="button"
            className="min-h-12 w-full rounded-xl border border-dark-50/20 px-5 py-3 font-semibold text-dark-50"
            onClick={() => {
              setError(null);
              trial.refetch();
              queryClient.invalidateQueries({ queryKey: ['device-first-open-checkout'] });
            }}
          >
            {t('trialStart.refreshStatus')}
          </button>
          <button
            type="button"
            className="w-full py-2 text-sm text-dark-300"
            onClick={() => navigate('/support')}
          >
            {t('trialStart.contactSupport')}
          </button>
        </>
      ) : isPendingInvoice ? (
        <>
          <div className="rounded-3xl border border-accent-400/30 bg-accent-500/10 p-6">
            <p className="text-sm font-semibold text-accent-200">
              {t('trialStart.unfinishedEyebrow')}
            </p>
            <h1 className="mt-2 text-2xl font-bold text-dark-50">
              {t('trialStart.unfinishedTitle')}
            </h1>
            <dl className="mt-5 space-y-2 text-dark-200">
              <div className="flex justify-between gap-4">
                <dt>{t('trialStart.tariff')}</dt>
                <dd className="font-medium text-dark-50">{checkout.tariff_name}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt>{t('trialStart.devices')}</dt>
                <dd className="font-medium text-dark-50">
                  {t('trialStart.devicesCount', { count: checkout.device_limit })}
                </dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt>{t('trialStart.period')}</dt>
                <dd className="font-medium text-dark-50">
                  {t('trialStart.daysCount', { count: checkout.period_days })}
                </dd>
              </div>
              <div className="flex justify-between gap-4 border-t border-dark-50/10 pt-2">
                <dt>{t('trialStart.total')}</dt>
                <dd className="font-semibold text-dark-50">{amount}</dd>
              </div>
            </dl>
          </div>
          <p className="rounded-2xl border border-warning-400/25 bg-warning-400/10 p-4 text-sm text-dark-200">
            {t('trialStart.abandonNotice')}
          </p>
          <button
            type="button"
            disabled={!canActivate || activate.isPending}
            className="min-h-12 w-full rounded-xl bg-accent-500 px-5 py-3 font-semibold text-white disabled:opacity-50"
            onClick={() => activate.mutate('abandon_pending_invoice')}
          >
            {activate.isPending ? t('trialStart.activating') : t('trialStart.startTrial')}
          </button>
          <button
            type="button"
            className="min-h-12 w-full rounded-xl border border-dark-50/20 px-5 py-3 font-semibold text-dark-50"
            onClick={() =>
              navigate(`/subscription/purchase?checkout=${encodeURIComponent(checkout.id)}`)
            }
          >
            {t('trialStart.returnToPayment')}
          </button>
        </>
      ) : (
        <>
          <div className="rounded-3xl border border-accent-400/30 bg-accent-500/10 p-6">
            <p className="text-sm font-semibold text-accent-200">{t('trialStart.eyebrow')}</p>
            <h1 className="mt-2 text-2xl font-bold text-dark-50">
              {info.requires_payment
                ? t('trialStart.activateTitle')
                : t('trialStart.freeTitle', { count: info.duration_days })}
            </h1>
            <p className="mt-3 text-dark-300">
              {t('trialStart.daysCount', { count: info.duration_days })} ·{' '}
              {t('trialStart.devicesCount', { count: info.device_limit })} ·{' '}
              {info.traffic_limit_gb === 0
                ? t('trialStart.unlimitedTraffic')
                : t('trialStart.trafficGb', { count: info.traffic_limit_gb })}
            </p>
            {!info.is_available && (
              <p className="mt-3 text-sm text-warning-300">{info.reason_unavailable}</p>
            )}
          </div>
          {info.is_available && canAffordTrial ? (
            <button
              type="button"
              disabled={!canActivate || activate.isPending}
              className="min-h-12 w-full rounded-xl bg-accent-500 px-5 py-3 font-semibold text-white disabled:opacity-50"
              onClick={() => activate.mutate('activate')}
            >
              {activate.isPending
                ? t('trialStart.activating')
                : info.requires_payment
                  ? t('trialStart.activateFor', {
                      amount: `${formatAmount(info.price_kopeks / 100)} ${currencySymbol}`,
                    })
                  : t('trialStart.activateFree')}
            </button>
          ) : info.is_available && info.requires_payment ? (
            <Link
              to="/balance"
              className="block min-h-12 w-full rounded-xl bg-accent-500 px-5 py-3 text-center font-semibold text-white"
            >
              {t('trialStart.topUpBalance')}
            </Link>
          ) : (
            <button
              type="button"
              className="min-h-12 w-full rounded-xl bg-accent-500 px-5 py-3 font-semibold text-white"
              onClick={() => navigate('/subscription/purchase')}
            >
              {t('trialStart.chooseTariff')}
            </button>
          )}
        </>
      )}

      {error && (
        <p className="rounded-xl border border-error-400/30 bg-error-500/10 p-3 text-sm text-error-300">
          {error}
        </p>
      )}
      <button
        type="button"
        className="w-full py-2 text-sm text-dark-300"
        onClick={() => navigate('/')}
      >
        {t('trialStart.back')}
      </button>
    </section>
  );
}
