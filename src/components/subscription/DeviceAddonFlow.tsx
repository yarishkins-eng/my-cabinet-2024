import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link, useNavigate } from 'react-router';

import { balanceApi } from '@/api/balance';
import {
  deviceAddonApi,
  getDeviceAddonError,
  type DeviceAddonIntent,
  type DeviceAddonQuote,
  type DeviceAddonTopupAttempt,
} from '@/api/deviceAddon';
import { useAuthStore } from '@/store/auth';
import { isInTelegramWebApp } from '@/hooks/useTelegramSDK';
import { usePlatform } from '@/platform';
import {
  bindIntentRetry,
  clearIntentRetry,
  clearTopupRetry,
  DeviceAddonPendingRetryError,
  DeviceAddonStorageUnavailableError,
  getIntentRetry,
  getOrCreateIntentRetry,
  getOrCreateTopupRetry,
} from '@/utils/deviceAddonStorage';
import { getApiErrorMessage } from '@/utils/api-error';

function formatKopeks(value: number) {
  const rubles = value / 100;
  return rubles % 1 === 0 ? `${rubles} ₽` : `${rubles.toFixed(2)} ₽`;
}

function isOutstanding(status: DeviceAddonTopupAttempt['status']) {
  return ['prepared', 'dispatching', 'creation_unknown', 'pending', 'reconciling'].includes(status);
}

function definitivelyRejectedTopup(code: string | undefined) {
  return [
    'quote_changed',
    'funding_changed',
    'funding_not_required',
    'payment_method_unavailable',
    'provider_amount_out_of_range',
    'already_purchased',
    'account_lifecycle_changed',
  ].includes(code ?? '');
}

function isExpiredQuote(quote: DeviceAddonQuote | undefined) {
  if (!quote) return false;
  const expiresAt = Date.parse(quote.quote_expires_at);
  return !Number.isFinite(expiresAt) || expiresAt <= Date.now();
}

export function DeviceAddonFlow({
  subscriptionId,
  initialDevices = 1,
  intentId: intentIdProp,
  attemptId: attemptIdProp,
  onClose,
}: {
  subscriptionId: number;
  initialDevices?: number;
  intentId?: string;
  attemptId?: string;
  onClose?: () => void;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const user = useAuthStore((state) => state.user);
  const { openLink, openTelegramLink } = usePlatform();
  const [devices, setDevices] = useState(Math.max(1, initialDevices));
  const [intent, setIntent] = useState<DeviceAddonIntent | null>(null);
  const [attempt, setAttempt] = useState<DeviceAddonTopupAttempt | null>(null);
  const [paymentUrl, setPaymentUrl] = useState<string | null>(null);
  const [selectedOption, setSelectedOption] = useState<string | null>(null);
  const inFlightRef = useRef(false);
  const intentRef = useRef<DeviceAddonIntent | null>(null);
  const paidAttemptHandledRef = useRef<string | null>(null);
  const activeIntentIdRef = useRef<string | null>(null);
  const requotedTokenRef = useRef<string | null>(null);

  const quoteQuery = useQuery({
    queryKey: ['device-addon-quote', subscriptionId, devices],
    queryFn: () => deviceAddonApi.getQuote(subscriptionId, devices),
    enabled: !intentIdProp,
    retry: 1,
  });
  const { refetch: refetchQuote } = quoteQuery;
  const intentQuery = useQuery({
    queryKey: ['device-addon-intent', intentIdProp],
    queryFn: () => deviceAddonApi.getIntent(intentIdProp!),
    enabled: Boolean(intentIdProp),
    retry: 2,
    refetchInterval: (query) => {
      const row = query.state.data;
      return row?.purchase_state === 'purchased' && row.fulfillment_status !== 'ready'
        ? 5000
        : false;
    },
  });
  const { refetch: refetchIntent } = intentQuery;

  useEffect(() => {
    if (!intentQuery.data) return;
    intentRef.current = intentQuery.data;
    setIntent(intentQuery.data);
    setDevices(intentQuery.data.devices_to_add);
    if (!attemptIdProp) {
      const attempts = intentQuery.data.topup_attempts;
      setAttempt(attempts.length ? attempts[attempts.length - 1] : null);
    }
  }, [attemptIdProp, intentQuery.data]);

  useEffect(() => {
    if (intentIdProp || !user || subscriptionId <= 0) return;
    const retry = getIntentRetry(user.id, subscriptionId);
    if (retry?.intent_id) {
      navigate(`/subscription/device-topup/${encodeURIComponent(retry.intent_id)}`, {
        replace: true,
      });
    }
  }, [intentIdProp, navigate, subscriptionId, user]);

  // An owned intent with quote:null is an intentional server denial (for
  // example, its subscription was deleted). Never revive it from an old entry
  // route cache.
  const quote: DeviceAddonQuote | undefined = intent
    ? (intent.quote ?? undefined)
    : quoteQuery.data;
  const quoteExpired = isExpiredQuote(quote);

  useEffect(() => {
    if (!quoteExpired || !quote || requotedTokenRef.current === quote.quote_token) return;
    requotedTokenRef.current = quote.quote_token;
    // This only refreshes a displayed price. It never retries a debit or an
    // invoice; the next financial POST still requires a new explicit click.
    if (intent?.id) void refetchIntent();
    else void refetchQuote();
  }, [intent?.id, quote, quoteExpired, refetchIntent, refetchQuote]);
  const needsTopup = Boolean(quote && quote.missing_kopeks > 0);
  const methodsQuery = useQuery({
    queryKey: ['payment-methods'],
    queryFn: balanceApi.getPaymentMethods,
    enabled: needsTopup,
  });
  const platega = useMemo(
    () => methodsQuery.data?.find((method) => method.id === 'platega' && method.is_available),
    [methodsQuery.data],
  );

  useEffect(() => {
    if (!platega?.options?.length || selectedOption) return;
    if (platega.options.length === 1) setSelectedOption(platega.options[0].id);
  }, [platega, selectedOption]);

  const finish = (next: DeviceAddonIntent) => {
    intentRef.current = next;
    setIntent(next);
    if (next.purchase_state === 'purchased' && user) {
      clearIntentRetry(user.id, next.subscription_id);
    }
    queryClient.invalidateQueries({ queryKey: ['subscription', next.subscription_id] });
    queryClient.invalidateQueries({ queryKey: ['subscriptions-list'] });
    queryClient.invalidateQueries({ queryKey: ['devices', next.subscription_id] });
    queryClient.invalidateQueries({ queryKey: ['device-price'] });
    queryClient.invalidateQueries({ queryKey: ['purchase-options'] });
    queryClient.invalidateQueries({ queryKey: ['balance'] });
    if (next.purchase_state === 'purchased') {
      navigate(`/subscription/device-topup/${encodeURIComponent(next.id)}`, { replace: true });
    }
  };

  const ensureIntent = async (presentedQuote: DeviceAddonQuote) => {
    if (intent) return intent;
    if (
      !quote ||
      !quote.quote_token ||
      quoteQuery.isFetching ||
      quoteQuery.isError ||
      intentQuery.isFetching ||
      intentQuery.isError ||
      !user
    ) {
      throw new Error(t('subscription.deviceAddon.freshQuoteRequired'));
    }
    const retry = getOrCreateIntentRetry(
      user.id,
      subscriptionId,
      devices,
      presentedQuote.quote_token,
    );
    if (retry.intent_id) {
      const recovered = await deviceAddonApi.getIntent(retry.intent_id);
      activeIntentIdRef.current = recovered.id;
      intentRef.current = recovered;
      setIntent(recovered);
      return recovered;
    }
    const created = await deviceAddonApi.createIntent(retry.quote_token!, retry.idempotency_key);
    activeIntentIdRef.current = created.id;
    intentRef.current = created;
    setIntent(created);
    // If the recovery write is denied after the durable POST succeeded, retain
    // the accepted intent in this live view. A retry must not create another
    // intent merely because browser storage became unavailable mid-flow.
    bindIntentRetry(user.id, subscriptionId, created.id);
    return created;
  };

  const purchaseMutation = useMutation({
    mutationFn: async (presentedQuote: DeviceAddonQuote) => {
      const current = await ensureIntent(presentedQuote);
      // The request token is the price the person just saw. Do not silently
      // replace it with a later GET quote: a 409 is the required new consent.
      return deviceAddonApi.purchase(current.id, presentedQuote.quote_token);
    },
    onSuccess: finish,
    onError: (error) => {
      const apiError = getDeviceAddonError(error);
      const quote = apiError?.quote;
      if (quote && intentRef.current) {
        const next = { ...intentRef.current, quote };
        intentRef.current = next;
        setIntent(next);
      }
      if (['quote_changed', 'quote_invalid'].includes(apiError?.code ?? '') && user) {
        clearIntentRetry(user.id, subscriptionId);
        if (intentRef.current?.id) void refetchIntent();
        else void refetchQuote();
      }
    },
  });

  const topupMutation = useMutation({
    mutationFn: async (presentedQuote: DeviceAddonQuote) => {
      const current = await ensureIntent(presentedQuote);
      if (!user || !platega || !selectedOption) {
        throw new Error(t('subscription.deviceAddon.selectPaymentMethod'));
      }
      // expected_amount is the UI's explicit price fence, not a fresh value
      // fetched after the click. The server rejects a changed amount.
      const expected = Math.max(presentedQuote.missing_kopeks, platega.min_amount_kopeks);
      const retry = getOrCreateTopupRetry(user.id, current.id, {
        subscription_id: current.subscription_id,
        devices_to_add: current.devices_to_add,
        expected_amount_kopeks: expected,
        payment_method: 'platega',
        payment_option: selectedOption,
      });
      const next = await deviceAddonApi.createTopup(current.id, {
        idempotency_key: retry.idempotency_key,
        expected_amount_kopeks: retry.expected_amount_kopeks!,
        payment_method: 'platega',
        payment_option: retry.payment_option!,
        return_surface: isInTelegramWebApp() ? 'telegram' : 'cabinet',
      });
      clearTopupRetry(user.id, current.id);
      return next;
    },
    onSuccess: (next) => {
      setAttempt(next.attempt);
      setPaymentUrl(next.attempt.can_open_payment === true ? next.payment_url : null);
      queryClient.setQueryData(['device-addon-topup', next.attempt.id], {
        attempt: next.attempt,
        intent: {
          id: next.attempt.intent_id,
          purchase_state: 'draft' as const,
          fulfillment_status: null,
        },
        payment_url: next.payment_url,
      });
      navigate(
        `/subscription/device-topup/${next.attempt.intent_id}?attempt=${encodeURIComponent(next.attempt.id)}`,
        { replace: true },
      );
    },
    onError: (error) => {
      const apiError = getDeviceAddonError(error);
      const quote = apiError?.quote;
      if (quote && intentRef.current) {
        const next = { ...intentRef.current, quote };
        intentRef.current = next;
        setIntent(next);
      }
      if (['quote_changed', 'quote_invalid'].includes(apiError?.code ?? '') && user) {
        clearIntentRetry(user.id, subscriptionId);
        if (intentRef.current?.id) void refetchIntent();
        else void refetchQuote();
      }
      if (definitivelyRejectedTopup(apiError?.code) && user && activeIntentIdRef.current) {
        clearTopupRetry(user.id, activeIntentIdRef.current);
        void refetchIntent();
      }
    },
  });

  const attemptQuery = useQuery({
    queryKey: ['device-addon-topup', attemptIdProp ?? attempt?.id],
    queryFn: () => deviceAddonApi.getTopup(attemptIdProp ?? attempt!.id),
    enabled: Boolean(attemptIdProp ?? attempt?.id),
    retry: 2,
    refetchInterval: attempt && isOutstanding(attempt.status) ? 5000 : false,
  });
  useEffect(() => {
    if (!attemptQuery.data) return;
    setAttempt(attemptQuery.data.attempt);
    setPaymentUrl(attemptQuery.data.payment_url ?? null);
    if (
      attemptQuery.data.attempt.status === 'paid' &&
      intent?.id &&
      paidAttemptHandledRef.current !== attemptQuery.data.attempt.id
    ) {
      paidAttemptHandledRef.current = attemptQuery.data.attempt.id;
      queryClient.invalidateQueries({ queryKey: ['balance'] });
      queryClient.invalidateQueries({ queryKey: ['purchase-options'] });
      queryClient.invalidateQueries({ queryKey: ['subscriptions-list'] });
      void refetchIntent();
    }
  }, [attemptQuery.data, intent?.id, queryClient, refetchIntent]);

  const error =
    purchaseMutation.error || topupMutation.error || quoteQuery.error || intentQuery.error;
  const busy = purchaseMutation.isPending || topupMutation.isPending;
  const quoteReady = Boolean(
    quote?.quote_token &&
    !quoteQuery.isFetching &&
    !quoteQuery.isError &&
    !intentQuery.isFetching &&
    !intentQuery.isError &&
    !quoteExpired,
  );
  const handlePurchase = () => {
    if (inFlightRef.current || busy || !quoteReady || !quote) return;
    inFlightRef.current = true;
    purchaseMutation.mutate(quote, { onSettled: () => (inFlightRef.current = false) });
  };
  const handleTopup = () => {
    if (inFlightRef.current || busy || !quoteReady || !quote) return;
    inFlightRef.current = true;
    topupMutation.mutate(quote, { onSettled: () => (inFlightRef.current = false) });
  };

  if (quoteQuery.isLoading || intentQuery.isLoading) {
    return (
      <div className="flex justify-center py-10">
        <span className="h-7 w-7 animate-spin rounded-full border-2 border-accent-500 border-t-transparent" />
      </div>
    );
  }

  const receipt = intent?.receipt;
  if (intent?.purchase_state === 'purchased' && receipt) {
    return (
      <div className="space-y-4 text-center">
        <h2 className="text-xl font-bold text-success-400">
          {t('subscription.deviceAddon.purchasedTitle')}
        </h2>
        <p className="text-sm text-dark-300">
          {t('subscription.deviceAddon.purchasedDescription', {
            count: receipt.devices_added,
            limit: receipt.new_device_limit,
          })}
        </p>
        <p className="text-sm text-dark-400">
          {intent.fulfillment_status === 'ready'
            ? t('subscription.deviceAddon.ready')
            : intent.fulfillment_status === 'needs_attention'
              ? t('subscription.deviceAddon.supportRequired')
              : t('subscription.deviceAddon.provisioning')}
        </p>
        {intent.fulfillment_status === 'needs_attention' && (
          <Link to="/support" className="btn-secondary block w-full py-3">
            {t('nav.support')}
          </Link>
        )}
        {onClose && (
          <button type="button" onClick={onClose} className="btn-primary w-full py-3">
            {t('common.close')}
          </button>
        )}
      </div>
    );
  }

  if (!quote) {
    return (
      <p className="py-6 text-center text-sm text-error-400">
        {getApiErrorMessage(error, t('subscription.deviceAddon.freshQuoteRequired'))}
      </p>
    );
  }

  const shownQuote = quote;
  const invoiceAmount = platega
    ? Math.max(shownQuote.missing_kopeks, platega.min_amount_kopeks)
    : shownQuote.missing_kopeks;
  const waitingForPayment = attempt && isOutstanding(attempt.status);
  const paid = attempt?.status === 'paid';
  const manualHold =
    attempt?.status === 'operator_review' || intent?.fulfillment_status === 'needs_attention';
  const canCreateAnotherAttempt = !attempt || attempt.can_create_new_attempt === true;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-dark-100">{t('subscription.deviceAddon.title')}</h2>
          <p className="text-sm text-dark-400">
            {t('subscription.deviceAddon.untilEnd', { count: shownQuote.days_left })}
          </p>
        </div>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="text-sm text-dark-400 hover:text-dark-200"
          >
            ✕
          </button>
        )}
      </div>

      <div className="flex items-center justify-center gap-6">
        <button
          type="button"
          className="btn-secondary flex h-12 w-12 items-center justify-center !p-0 text-2xl"
          disabled={devices <= 1 || Boolean(intent)}
          onClick={() => setDevices((value) => Math.max(1, value - 1))}
        >
          −
        </button>
        <div className="text-center">
          <div className="text-4xl font-bold text-dark-100">{devices}</div>
          <div className="text-sm text-dark-500">{t('subscription.deviceAddon.devices')}</div>
        </div>
        <button
          type="button"
          className="btn-secondary flex h-12 w-12 items-center justify-center !p-0 text-2xl"
          disabled={
            Boolean(intent) ||
            (shownQuote.max_device_limit !== null &&
              shownQuote.new_device_limit >= shownQuote.max_device_limit)
          }
          onClick={() => setDevices((value) => value + 1)}
        >
          +
        </button>
      </div>

      <div className="rounded-xl bg-dark-900/40 p-4 text-center">
        <div className="text-sm text-dark-400">{t('subscription.deviceAddon.total')}</div>
        <div className="mt-1 text-2xl font-bold text-accent-400">
          {formatKopeks(shownQuote.price_kopeks)}
        </div>
        {shownQuote.discount_percent > 0 && (
          <div className="mt-1 text-sm text-success-400">
            {t('subscription.deviceAddon.discount', { percent: shownQuote.discount_percent })}
          </div>
        )}
      </div>

      {!quoteReady && (
        <p className="rounded-xl bg-dark-800 p-3 text-center text-sm text-dark-300">
          {t('subscription.deviceAddon.quoteRefreshing')}
        </p>
      )}

      {manualHold && (
        <div className="space-y-3 rounded-xl bg-warning-500/10 p-3 text-center text-sm text-warning-400">
          <p>{t('subscription.deviceAddon.supportRequired')}</p>
          <Link to="/support" className="btn-secondary block w-full py-3">
            {t('nav.support')}
          </Link>
        </div>
      )}

      {needsTopup && !waitingForPayment && !manualHold && canCreateAnotherAttempt && (
        <div className="space-y-3 rounded-xl border border-accent-500/20 bg-accent-500/5 p-4">
          <p className="text-sm text-dark-200">
            {t('subscription.deviceAddon.missing', {
              amount: formatKopeks(shownQuote.missing_kopeks),
            })}
          </p>
          {platega?.options && platega.options.length > 1 && (
            <div className="grid grid-cols-2 gap-2">
              {platega.options.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => setSelectedOption(option.id)}
                  className={
                    selectedOption === option.id
                      ? 'rounded-xl bg-accent-500/20 p-3 text-sm text-accent-300 ring-1 ring-accent-400'
                      : 'rounded-xl bg-dark-800 p-3 text-sm text-dark-300'
                  }
                >
                  {option.name}
                </button>
              ))}
            </div>
          )}
          {!platega && !methodsQuery.isLoading && (
            <p className="text-sm text-error-400">
              {t('subscription.deviceAddon.paymentUnavailable')}
            </p>
          )}
          <button
            type="button"
            disabled={!quoteReady || !platega || !selectedOption || busy}
            onClick={handleTopup}
            className="btn-primary w-full py-3"
          >
            {busy
              ? t('common.loading')
              : t('subscription.deviceAddon.topup', { amount: formatKopeks(invoiceAmount) })}
          </button>
        </div>
      )}

      {needsTopup && !waitingForPayment && !manualHold && !canCreateAnotherAttempt && (
        <div className="space-y-3 rounded-xl bg-warning-500/10 p-3 text-center text-sm text-warning-400">
          <p>{t('subscription.deviceAddon.supportRequired')}</p>
          <Link to="/support" className="btn-secondary block w-full py-3">
            {t('nav.support')}
          </Link>
        </div>
      )}

      {waitingForPayment && (
        <div className="space-y-3 rounded-xl border border-dark-700 p-4 text-center">
          <p className="text-sm text-dark-300">
            {attempt.status === 'creation_unknown'
              ? t('subscription.deviceAddon.creationUnknown')
              : t('subscription.deviceAddon.awaitingPayment')}
          </p>
          {attempt.can_open_payment === true && paymentUrl && (
            <button
              type="button"
              onClick={() =>
                paymentUrl.includes('t.me/') ? openTelegramLink(paymentUrl) : openLink(paymentUrl)
              }
              className="btn-primary w-full py-3"
            >
              {t('balance.goToPayment')}
            </button>
          )}
          <button
            type="button"
            onClick={() => void attemptQuery.refetch()}
            className="btn-secondary w-full py-3"
          >
            {t('subscription.deviceAddon.checkStatus')}
          </button>
        </div>
      )}

      {paid && (
        <p className="rounded-xl bg-success-500/10 p-3 text-center text-sm text-success-400">
          {needsTopup
            ? t('subscription.deviceAddon.balanceCreditedStillMissing')
            : t('subscription.deviceAddon.balanceCredited')}
        </p>
      )}
      {!needsTopup && !manualHold ? (
        <button
          type="button"
          disabled={busy || !quoteReady}
          onClick={handlePurchase}
          className="btn-primary w-full py-3"
        >
          {busy
            ? t('common.loading')
            : t('subscription.deviceAddon.buy', { amount: formatKopeks(shownQuote.price_kopeks) })}
        </button>
      ) : null}

      {error && (
        <p className="text-center text-sm text-error-400">
          {error instanceof DeviceAddonStorageUnavailableError
            ? t('subscription.deviceAddon.storageUnavailable')
            : error instanceof DeviceAddonPendingRetryError
              ? t('subscription.deviceAddon.pendingRetry')
              : getApiErrorMessage(error, t('common.error'))}
        </p>
      )}
    </div>
  );
}
