import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import { createPortal } from 'react-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import {
  deviceFirstApi,
  type DeviceFirstCheckout,
  type DeviceFirstOptions,
  type DeviceFirstPaymentAttempt,
} from '@/api/deviceFirst';
import { getGlassColors } from '@/utils/glassTheme';
import { useTheme } from '@/hooks/useTheme';

interface Props {
  options: DeviceFirstOptions;
  initialCheckoutId?: string | null;
  fixtureCheckout?: DeviceFirstCheckout | null;
  fixtureMethods?: Array<{ key: string; provider_code: number }>;
}

export function DeviceFirstConfigurator({
  options,
  initialCheckoutId,
  fixtureCheckout,
  fixtureMethods,
}: Props) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const queryClient = useQueryClient();
  const { isDark } = useTheme();
  const g = getGlassColors(isDark);
  const [period, setPeriod] = useState(
    options.default_period_days ?? options.period_options?.[0] ?? 30,
  );
  const [devices, setDevices] = useState(options.device_options?.[0] ?? 1);
  const [checkout, setCheckout] = useState<DeviceFirstCheckout | null>(fixtureCheckout ?? null);
  const [actionError, setActionError] = useState<unknown>(null);
  const [autoConfirming, setAutoConfirming] = useState(false);
  const [existingPaymentAttempt, setExistingPaymentAttempt] =
    useState<DeviceFirstPaymentAttempt | null>(null);
  const checkoutUiState = checkout?.ui_state;
  const modalOpen =
    fixtureCheckout === undefined &&
    !!checkoutUiState &&
    ['configuration', 'confirmation', 'awaiting_payment'].includes(checkoutUiState);
  const [methodKey, setMethodKey] = useState('sbp');
  const nativeLaunchMethod = searchParams.get('method');
  const nativeAutostart = searchParams.get('autostart') === '1';
  const nativeLaunchRef = useRef<string | null>(null);
  const pollStartedAt = useRef(Date.now());
  const dialogRef = useRef<HTMLDivElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);

  const restoredCheckout = useQuery({
    queryKey: ['device-first-checkout', initialCheckoutId],
    queryFn: () => deviceFirstApi.get(initialCheckoutId!),
    enabled: fixtureCheckout === undefined && !!initialCheckoutId && !checkout,
    retry: false,
  });
  useEffect(() => {
    if (restoredCheckout.data) setCheckout(restoredCheckout.data);
  }, [restoredCheckout.data]);
  useEffect(() => {
    // Browser Back from C2 removes the checkout query parameter. Preserve the
    // selected term/device state, but return the person to C1 rather than
    // leaving an invisible checkout dialog open in component state.
    if (fixtureCheckout === undefined && !initialCheckoutId) {
      setCheckout(null);
      setActionError(null);
      setExistingPaymentAttempt(null);
    }
  }, [fixtureCheckout, initialCheckoutId]);

  const priceFor = (days: number, deviceLimit: number) =>
    options.price_matrix
      ?.find((row) => row.period_days === days)
      ?.prices.find((item) => item.device_limit === deviceLimit);
  const price = priceFor(period, devices);

  const statusQuery = useQuery({
    queryKey: ['device-first-checkout', checkout?.id],
    queryFn: () => deviceFirstApi.get(checkout!.id),
    enabled:
      fixtureCheckout === undefined &&
      !!checkout &&
      ['awaiting_payment', 'processing', 'provisioning'].includes(checkout.ui_state),
    refetchInterval: (query) => {
      const providerDeadline =
        checkout?.settlement_mode === 'direct_purchase_v2' && checkout.expires_at
          ? Date.parse(checkout.expires_at)
          : Number.NaN;
      // A direct invoice remains customer-visible for the provider-owned
      // payment window, not an arbitrary two-minute browser interval. The
      // server remains authoritative; this merely lets an open screen notice
      // its canonical terminal result without asking the person to reload.
      if (Number.isFinite(providerDeadline)) {
        if (Date.now() > providerDeadline + 30_000) return false;
      } else if (Date.now() - pollStartedAt.current > 2 * 60 * 1000) {
        return false;
      }
      const updates = query.state.dataUpdateCount;
      return updates > 12 ? 10_000 : updates > 4 ? 5_000 : 2_500;
    },
  });
  useEffect(() => {
    if (statusQuery.data) setCheckout(statusQuery.data);
  }, [statusQuery.data]);

  const methods = useQuery({
    queryKey: ['device-first-payment-methods'],
    queryFn: deviceFirstApi.paymentMethods,
    initialData: fixtureMethods ? { methods: fixtureMethods } : undefined,
    enabled:
      fixtureMethods === undefined &&
      !!checkout &&
      (checkout.ui_state === 'awaiting_payment' ||
        (checkout.ui_state === 'confirmation' &&
          checkout.settlement_mode === 'direct_purchase_v2')),
  });
  useEffect(() => {
    const availableKeys = methods.data?.methods.map((method) => method.key) ?? [];
    // A user can have only card or crypto enabled. Never submit the hard-coded
    // initial SBP value when it is not among the methods supplied by the server.
    if (availableKeys.length && !availableKeys.includes(methodKey)) {
      setMethodKey(availableKeys[0]);
    }
  }, [methodKey, methods.data]);
  const acceptCheckout = (next: DeviceFirstCheckout) => {
    setCheckout(next);
    if (fixtureCheckout === undefined) {
      const nextParams = new URLSearchParams(searchParams);
      nextParams.set('checkout', next.id);
      // The Telegram launch query is deliberately single-use.  The durable
      // checkout id remains for recovery, while browser Back/reload cannot
      // automatically submit another payment command.
      nextParams.delete('method');
      nextParams.delete('autostart');
      // The initial C1 → C2 transition is a real user navigation, so Back
      // returns to the configuration. State refreshes for that same checkout
      // replace instead of growing the history on every poll.
      setSearchParams(nextParams, { replace: searchParams.has('checkout') });
    }
  };
  const returnToConfiguration = useCallback(() => {
    // A server-confirmed pre-payment cancellation is complete: retain the
    // person's selected term/devices, but drop only the abandoned quote and
    // its URL. Confirmation/payment intent keys remain untouched elsewhere.
    deviceFirstApi.clearCreateIntents();
    setActionError(null);
    setExistingPaymentAttempt(null);
    setCheckout(null);
    if (fixtureCheckout === undefined) {
      const nextParams = new URLSearchParams(searchParams);
      nextParams.delete('checkout');
      setSearchParams(nextParams, { replace: true });
    }
  }, [fixtureCheckout, searchParams, setSearchParams]);
  const consumeNativeLaunchParams = useCallback(() => {
    if (fixtureCheckout !== undefined) return;
    const nextParams = new URLSearchParams(searchParams);
    nextParams.delete('method');
    nextParams.delete('autostart');
    setSearchParams(nextParams, { replace: true });
  }, [fixtureCheckout, searchParams, setSearchParams]);

  const createMutation = useMutation({
    mutationFn: () => deviceFirstApi.create(period, devices),
    onMutate: () => setActionError(null),
    onSuccess: async (created) => {
      setAutoConfirming(true);
      acceptCheckout(created);
      try {
        // This is a non-financial state transition. It removes the duplicate
        // "Confirm" screen while retaining its own durable idempotency key.
        acceptCheckout(await deviceFirstApi.confirm(created.id));
      } catch (error) {
        // Keep the owned draft + confirmation key. A retry resumes the same
        // order and can never create a second quote or provider invoice.
        setActionError(error);
      } finally {
        setAutoConfirming(false);
      }
    },
    onError: async (error) => {
      if (deviceFirstErrorCode(error) === 'open_checkout_exists') {
        try {
          acceptCheckout(await deviceFirstApi.getOpen());
          return;
        } catch (recoveryError) {
          // Only a canonical 404 from the server proves that the old order is
          // gone. A network failure must retain the original key so a retry
          // remains idempotent and can resume the same order later.
          if (deviceFirstErrorCode(recoveryError) === 'no_open_checkout') {
            deviceFirstApi.clearCreateIntents();
          }
          setActionError({
            response: { data: { detail: { code: 'open_checkout_recovery_failed' } } },
          });
          return;
        }
      }
      setActionError(error);
    },
  });
  const confirmMutation = useMutation({
    mutationFn: () => deviceFirstApi.confirm(checkout!.id),
    onMutate: () => setActionError(null),
    onSuccess: acceptCheckout,
    onError: setActionError,
  });
  const armMutation = useMutation({
    mutationFn: () => deviceFirstApi.arm(checkout!.id),
    onMutate: () => setActionError(null),
    onSuccess: acceptCheckout,
    onError: setActionError,
  });
  const recoverAmbiguousCheckout = async (error: unknown) => {
    setActionError(error);
    if (deviceFirstErrorCode(error) === 'invoice_terminal') {
      // The server archived a provider-verified cancelled/expired invoice.
      // It has no active money path, so return straight to a fresh choice
      // instead of trapping the customer on a technical error screen.
      returnToConfiguration();
      return;
    }
    if (deviceFirstErrorCode(error) !== 'reconciliation_required' || !checkout) return;
    try {
      // Invoice creation may have committed before a timeout. The owned server
      // state is authoritative and exposes recovery controls without creating
      // another invoice.
      acceptCheckout(await deviceFirstApi.get(checkout.id));
    } catch {
      // Keep the original reconciliation error; support remains available.
    }
  };
  const commitMutation = useMutation({
    mutationFn: ({
      fundingMode,
      selectedMethodKey,
    }: {
      fundingMode: 'wallet' | 'platega';
      selectedMethodKey?: string;
    }) =>
      deviceFirstApi.commit(
        checkout!.id,
        fundingMode,
        fundingMode === 'platega' ? selectedMethodKey : undefined,
      ),
    onMutate: () => setActionError(null),
    onSuccess: (result) => {
      acceptCheckout(result.checkout);
      if (result.redirect_url) window.location.assign(result.redirect_url);
    },
    onError: recoverAmbiguousCheckout,
  });
  const nativeLaunchMutation = useMutation({
    mutationFn: ({ checkoutId, method }: { checkoutId: string; method: string }) =>
      deviceFirstApi.nativeLaunch(checkoutId, method),
    onMutate: () => setActionError(null),
    onSuccess: (result) => {
      acceptCheckout(result.checkout);
      if (result.redirect_url) window.location.replace(result.redirect_url);
    },
    onError: recoverAmbiguousCheckout,
  });
  const paymentMutation = useMutation({
    mutationFn: () => deviceFirstApi.createPaymentAttempt(checkout!.id, methodKey),
    onMutate: () => {
      setActionError(null);
      setExistingPaymentAttempt(null);
    },
    onSuccess: (attempt) => {
      if (attempt.method_key !== methodKey) {
        setExistingPaymentAttempt(attempt);
        return;
      }
      window.location.assign(attempt.redirect_url);
    },
    onError: recoverAmbiguousCheckout,
  });
  const resumeInvoiceMutation = useMutation({
    mutationFn: () => deviceFirstApi.resumeInvoice(checkout!.id, methodKey),
    onMutate: () => setActionError(null),
    onSuccess: (result) => {
      acceptCheckout(result.checkout);
      if (result.redirect_url) window.location.assign(result.redirect_url);
    },
    onError: recoverAmbiguousCheckout,
  });
  const cancelMutation = useMutation({
    mutationFn: () => deviceFirstApi.cancel(checkout!.id),
    onMutate: () => setActionError(null),
    onSuccess: (next) => {
      if (next.ui_state === 'cancelled') {
        returnToConfiguration();
        return;
      }
      acceptCheckout(next);
    },
    onError: setActionError,
  });
  useEffect(() => {
    if (
      checkout?.ui_state === 'cancelled' &&
      checkout.terminal_reason?.startsWith('provider_terminal:')
    ) {
      returnToConfiguration();
    }
  }, [checkout?.terminal_reason, checkout?.ui_state, returnToConfiguration]);
  const pendingPayment = useQuery({
    queryKey: ['device-first-pending-payment', checkout?.id],
    queryFn: () => deviceFirstApi.getPendingPayment(checkout!.id),
    enabled:
      fixtureCheckout === undefined &&
      checkout?.settlement_mode === 'direct_purchase_v2' &&
      checkout.ui_state === 'awaiting_payment',
    retry: false,
  });

  useEffect(() => {
    if (
      fixtureCheckout !== undefined ||
      !nativeAutostart ||
      !nativeLaunchMethod ||
      !checkout ||
      checkout.settlement_mode !== 'direct_purchase_v2' ||
      checkout.ui_state !== 'confirmation' ||
      methods.isLoading
    ) {
      return;
    }

    const launchKey = `${checkout.id}:${nativeLaunchMethod}`;
    if (nativeLaunchRef.current === launchKey) return;
    nativeLaunchRef.current = launchKey;

    const availableMethods = methods.data?.methods.map((method) => method.key) ?? [];
    consumeNativeLaunchParams();
    if (methods.isError) {
      setActionError({
        response: { data: { detail: { code: 'payment_methods_load_failed' } } },
      });
      return;
    }
    if (!availableMethods.includes(nativeLaunchMethod)) {
      setActionError({
        response: { data: { detail: { code: 'payment_method_unavailable' } } },
      });
      return;
    }

    // This is the only automatic financial call.  The native endpoint requires
    // signed current Telegram initData, owner-scopes the checkout and reuses
    // the same durable idempotency/one-invoice protections as a manual commit.
    nativeLaunchMutation.mutate({ checkoutId: checkout.id, method: nativeLaunchMethod });
  }, [
    checkout,
    consumeNativeLaunchParams,
    fixtureCheckout,
    methods.data?.methods,
    methods.isError,
    methods.isLoading,
    nativeAutostart,
    nativeLaunchMethod,
    nativeLaunchMutation,
  ]);

  useEffect(() => {
    if (checkout?.ui_state === 'ready') {
      queryClient.invalidateQueries({ queryKey: ['subscription'] });
      queryClient.invalidateQueries({ queryKey: ['subscriptions-list'] });
      queryClient.invalidateQueries({ queryKey: ['devices'] });
      queryClient.invalidateQueries({ queryKey: ['balance'] });
      queryClient.invalidateQueries({ queryKey: ['user'] });
    }
  }, [checkout?.ui_state, queryClient]);
  useEffect(() => {
    if (
      checkoutUiState &&
      ['awaiting_payment', 'processing', 'provisioning'].includes(checkoutUiState)
    ) {
      pollStartedAt.current = Date.now();
    }
  }, [checkoutUiState]);
  useEffect(() => {
    if (modalOpen) {
      previousFocusRef.current = document.activeElement as HTMLElement | null;
      // Checkout content is portalled outside #root, so this makes the whole
      // application (including its global header and bottom navigation) inert
      // while an explicit checkout decision is on screen.
      const appRoot = document.getElementById('root');
      const wasInert = appRoot?.inert ?? false;
      if (appRoot) appRoot.inert = true;
      dialogRef.current?.focus();
      return () => {
        if (appRoot) appRoot.inert = wasInert;
        previousFocusRef.current?.focus();
      };
    }
    return undefined;
  }, [checkoutUiState, modalOpen]);

  const trapDialogFocus = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Tab') return;
    const focusable = Array.from(
      event.currentTarget.querySelectorAll<HTMLElement>(
        'button:not([disabled]), a[href], input:not([disabled])',
      ),
    );
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  // Checkout amounts are server-owned Russian kopeks. Do not apply the
  // display-currency converter here: it would show an estimate in another
  // currency while the payment and debit are still fixed in RUB. The UI
  // preserves non-zero kopeks, so it never conceals the exact amount the
  // server uses during confirmation and payment.
  const formatPrice = (kopeks: number) => {
    const sign = kopeks < 0 ? '-' : '';
    const absolute = Math.abs(kopeks);
    const rubles = Math.floor(absolute / 100).toLocaleString('ru-RU');
    const remainder = absolute % 100;
    return `${sign}${rubles}${remainder ? `,${String(remainder).padStart(2, '0')}` : ''} ₽`;
  };
  const pricePerDeviceMonth = (kopeks: number, deviceLimit: number, periodDays: number) => {
    // This is a compact comparison aid only. The full server-provided matrix
    // price above remains the amount used for confirmation and payment.
    const months = periodDays === 365 ? 12 : periodDays / 30;
    if (!Number.isFinite(months) || months <= 0 || deviceLimit <= 0) return null;

    return Math.round(kopeks / 100 / deviceLimit / months);
  };
  const periodLabel = (days: number) =>
    days === 365
      ? t('deviceFirst.periodYear')
      : days % 30 === 0
        ? t('deviceFirst.periodMonths', { count: days / 30 })
        : t('deviceFirst.periodDays', { count: days });
  const errorMessage = actionError ? deviceFirstErrorMessage(t, actionError) : null;
  const actionErrorCode = deviceFirstErrorCode(actionError);
  const requiresReconciliation = actionErrorCode === 'reconciliation_required';
  const isPending =
    createMutation.isPending ||
    autoConfirming ||
    confirmMutation.isPending ||
    armMutation.isPending ||
    commitMutation.isPending ||
    nativeLaunchMutation.isPending ||
    paymentMutation.isPending ||
    resumeInvoiceMutation.isPending ||
    cancelMutation.isPending;
  const choiceClass =
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-300 focus-visible:ring-offset-2 focus-visible:ring-offset-dark-950';
  const changeChoiceWithArrows = <Value extends string | number>(
    event: KeyboardEvent<HTMLButtonElement>,
    values: Value[],
    current: Value,
    change: (next: Value) => void,
  ) => {
    if (!values.length) return;
    const isRtl = document.documentElement.dir === 'rtl';
    const direction =
      event.key === 'ArrowDown' ||
      (event.key === 'ArrowRight' && !isRtl) ||
      (event.key === 'ArrowLeft' && isRtl)
        ? 1
        : event.key === 'ArrowUp' ||
            (event.key === 'ArrowLeft' && !isRtl) ||
            (event.key === 'ArrowRight' && isRtl)
          ? -1
          : 0;
    const home = event.key === 'Home';
    const end = event.key === 'End';
    if (!direction && !home && !end) return;
    event.preventDefault();
    const index = Math.max(0, values.indexOf(current));
    const nextIndex = home
      ? 0
      : end
        ? values.length - 1
        : (index + direction + values.length) % values.length;
    change(values[nextIndex]);
    const radios = Array.from(
      event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="radio"]') ??
        [],
    ).filter((radio) => !radio.disabled);
    radios?.[nextIndex]?.focus();
  };
  const startNewQuote = () => {
    // A prior conflicting create can belong to a different selection than the
    // resumed checkout. This explicit "start over" action clears every local
    // create key, but never confirmation/payment idempotency keys.
    returnToConfiguration();
  };
  const refreshCheckout = () => {
    void statusQuery.refetch();
    void pendingPayment.refetch();
  };
  const paymentMethodLabel = (key: string) =>
    key === 'sbp'
      ? t('deviceFirst.sbp')
      : key === 'cards_ru'
        ? t('deviceFirst.cards')
        : key === 'crypto'
          ? t('deviceFirst.crypto')
          : t('deviceFirst.paymentMethodUnknown');
  const paymentMethodAmountLabel = (key: string, amount: string) =>
    t('deviceFirst.paymentMethodAmount', { method: paymentMethodLabel(key), amount });
  const invoiceDeadline = checkout?.expires_at
    ? new Intl.DateTimeFormat(undefined, { dateStyle: 'short', timeStyle: 'short' }).format(
        new Date(checkout.expires_at),
      )
    : null;

  return (
    <section
      data-testid="device-first-configurator"
      aria-busy={isPending}
      className="relative rounded-3xl p-4 pb-28 min-[360px]:p-5 min-[360px]:pb-28 sm:p-7 sm:pb-7"
      style={{ background: g.cardBg, border: `1px solid ${g.cardBorder}`, boxShadow: g.shadow }}
    >
      <div className="mb-6" aria-hidden={modalOpen || undefined} inert={modalOpen || undefined}>
        <h2 className="text-xl font-bold text-dark-50">{options.tariff?.name}</h2>
        <p className="mt-2 text-sm text-dark-400">{t('deviceFirst.description')}</p>
      </div>

      {!checkout && initialCheckoutId && restoredCheckout.isLoading && (
        <StateMessage title={t('deviceFirst.processing')} text={t('deviceFirst.processingText')} />
      )}
      {!checkout && initialCheckoutId && restoredCheckout.isError && (
        <div className="space-y-4">
          <StateMessage title={t('deviceFirst.refreshTitle')} text={t('deviceFirst.refreshText')} />
          <button
            type="button"
            onClick={startNewQuote}
            className={`w-full rounded-2xl bg-accent-500 px-5 py-3.5 font-semibold text-white ${choiceClass}`}
          >
            {t('deviceFirst.startNew')}
          </button>
        </div>
      )}
      {!checkout && !initialCheckoutId && (
        <div className="space-y-6">
          <fieldset>
            <legend className="mb-3 text-sm font-medium text-dark-200">
              {t('deviceFirst.periodQuestion')}
            </legend>
            <div
              role="radiogroup"
              aria-label={t('deviceFirst.periodQuestion')}
              className="grid grid-cols-2 gap-2 md:grid-cols-4"
            >
              {options.period_options?.map((value) =>
                (() => {
                  const optionPrice = priceFor(value, devices);
                  const isSelected = period === value;
                  return (
                    <button
                      key={value}
                      type="button"
                      role="radio"
                      aria-checked={isSelected}
                      tabIndex={isSelected ? 0 : -1}
                      disabled={!optionPrice || isPending}
                      onKeyDown={(event) =>
                        changeChoiceWithArrows(
                          event,
                          (options.period_options ?? []).filter((candidate) =>
                            Boolean(priceFor(candidate, devices)),
                          ),
                          period,
                          setPeriod,
                        )
                      }
                      onClick={() => setPeriod(value)}
                      className={`flex min-h-16 items-center justify-center rounded-2xl border-2 px-3 py-2 text-center transition disabled:cursor-not-allowed disabled:opacity-45 ${choiceClass} ${
                        isSelected
                          ? 'border-accent-400 bg-accent-500/15 text-accent-200 shadow-[0_0_0_1px_rgba(96,165,250,0.25)]'
                          : 'border-dark-700 bg-dark-800/45 text-dark-300'
                      }`}
                    >
                      <span className="text-sm font-semibold">
                        {optionPrice
                          ? periodLabel(value)
                          : `${periodLabel(value)} · ${t('deviceFirst.unavailable')}`}
                      </span>
                      {isSelected && <span className="sr-only">{t('deviceFirst.selected')}</span>}
                    </button>
                  );
                })(),
              )}
            </div>
          </fieldset>
          <fieldset>
            <legend className="mb-3 text-sm font-medium text-dark-200">
              {t('deviceFirst.devicesQuestion')}
            </legend>
            <div
              role="radiogroup"
              aria-label={t('deviceFirst.devicesQuestion')}
              className="grid max-w-3xl grid-cols-1 gap-2 min-[360px]:grid-cols-2 md:grid-cols-3 lg:grid-cols-4"
            >
              {options.device_options?.map((value) =>
                (() => {
                  const optionPrice = priceFor(period, value);
                  const deviceMonthlyRate = optionPrice
                    ? pricePerDeviceMonth(optionPrice.price_kopeks, value, period)
                    : null;
                  const isSelected = devices === value;
                  return (
                    <button
                      key={value}
                      type="button"
                      role="radio"
                      aria-checked={isSelected}
                      tabIndex={isSelected ? 0 : -1}
                      disabled={!optionPrice || isPending}
                      onKeyDown={(event) =>
                        changeChoiceWithArrows(
                          event,
                          (options.device_options ?? []).filter((candidate) =>
                            Boolean(priceFor(period, candidate)),
                          ),
                          devices,
                          setDevices,
                        )
                      }
                      onClick={() => setDevices(value)}
                      className={`flex min-h-28 flex-col items-center justify-center rounded-2xl border-2 px-2 py-3 text-center transition disabled:cursor-not-allowed disabled:opacity-45 ${choiceClass} ${
                        isSelected
                          ? 'border-accent-400 bg-accent-500/15 text-accent-200 shadow-[0_0_0_1px_rgba(96,165,250,0.25)]'
                          : 'border-dark-700 bg-dark-800/45 text-dark-300'
                      }`}
                    >
                      <span className="text-base font-semibold leading-tight">
                        {t('deviceFirst.deviceCount', { count: value })}
                      </span>
                      <span className="mt-2 text-lg font-bold tabular-nums text-dark-100">
                        {optionPrice
                          ? formatPrice(optionPrice.price_kopeks)
                          : t('deviceFirst.unavailable')}
                      </span>
                      {deviceMonthlyRate !== null && (
                        <span className="mt-1 text-xs leading-4 text-dark-400">
                          {t('deviceFirst.perDeviceMonth', { amount: deviceMonthlyRate })}
                        </span>
                      )}
                      {isSelected && <span className="sr-only">{t('deviceFirst.selected')}</span>}
                    </button>
                  );
                })(),
              )}
            </div>
          </fieldset>
          <div className="rounded-2xl border border-dark-700 bg-dark-900/35 p-4">
            <div className="flex items-end justify-between gap-4">
              <div>
                <div className="text-xs text-dark-500">{t('deviceFirst.total')}</div>
                <div className="mt-1 text-2xl font-bold text-dark-50">
                  {price ? formatPrice(price.price_kopeks) : '—'}
                </div>
              </div>
              <div className="text-right text-xs text-dark-400">
                {t('deviceFirst.deviceShort', { count: devices })} · {periodLabel(period)}
              </div>
            </div>
          </div>
          <button
            type="button"
            disabled={!price || createMutation.isPending}
            onClick={() => createMutation.mutate()}
            className={`mt-2 w-full rounded-2xl bg-accent-500 px-5 py-3.5 font-semibold text-white disabled:opacity-50 ${choiceClass}`}
          >
            {t('deviceFirst.review')}
          </button>
          <p className="-mt-3 text-center text-xs text-dark-500">{t('deviceFirst.reviewHint')}</p>
        </div>
      )}

      {checkout?.ui_state === 'configuration' && (
        <CheckoutSurface
          label={t('deviceFirst.review')}
          portal={fixtureCheckout === undefined}
          dialogRef={dialogRef}
          onKeyDown={trapDialogFocus}
        >
          {autoConfirming ? (
            <StateMessage
              title={t('deviceFirst.preparingCheckout')}
              text={t('deviceFirst.preparingCheckoutText')}
            />
          ) : (
            <>
              <Summary checkout={checkout} formatPrice={formatPrice} />
              <button
                type="button"
                disabled={confirmMutation.isPending}
                onClick={() => confirmMutation.mutate()}
                className={`w-full rounded-2xl bg-accent-500 px-5 py-3.5 font-semibold text-white disabled:opacity-50 ${choiceClass}`}
              >
                {t('deviceFirst.confirm')}
              </button>
              <button
                type="button"
                disabled={cancelMutation.isPending}
                onClick={() => cancelMutation.mutate()}
                className={`min-h-11 w-full rounded-xl px-4 py-2 text-sm text-dark-500 hover:text-dark-300 disabled:opacity-50 ${choiceClass}`}
              >
                {t('deviceFirst.cancel')}
              </button>
            </>
          )}
          {errorMessage && (
            <p role="alert" className="text-sm text-error-400">
              {errorMessage}
            </p>
          )}
        </CheckoutSurface>
      )}

      {checkout?.ui_state === 'confirmation' && (
        <CheckoutSurface
          label={t('deviceFirst.confirm')}
          portal={fixtureCheckout === undefined}
          dialogRef={dialogRef}
          onKeyDown={trapDialogFocus}
        >
          <Summary checkout={checkout} formatPrice={formatPrice} />
          <p className="text-xs text-dark-400">{t('deviceFirst.chargeNotice')}</p>
          {checkout.settlement_mode === 'direct_purchase_v2' ? (
            nativeLaunchMutation.isPending ? (
              <StateMessage
                title={t('deviceFirst.openingPayment')}
                text={t('deviceFirst.openingPaymentText')}
              />
            ) : (
              <>
                {(checkout.balance_kopeks ?? 0) < checkout.tariff_total_kopeks && (
                  <>
                    <p className="text-sm text-dark-300">
                      {t('deviceFirst.paymentMethodsAvailable')}
                    </p>
                    {methods.isLoading ? (
                      <p role="status" className="text-sm text-dark-400">
                        {t('deviceFirst.paymentMethodsLoading')}
                      </p>
                    ) : methods.isError ? (
                      <div className="space-y-2">
                        <p role="alert" className="text-sm text-error-400">
                          {t('deviceFirst.errorPaymentMethodsLoad')}
                        </p>
                        <button
                          type="button"
                          onClick={() => void methods.refetch()}
                          className={`w-full rounded-xl border border-dark-600 px-4 py-3 text-sm font-semibold text-dark-100 ${choiceClass}`}
                        >
                          {t('deviceFirst.retry')}
                        </button>
                        <button
                          type="button"
                          onClick={() => navigate('/support')}
                          className={`min-h-11 w-full rounded-xl px-4 py-2 text-sm text-dark-400 hover:text-dark-200 ${choiceClass}`}
                        >
                          {t('deviceFirst.contactSupport')}
                        </button>
                      </div>
                    ) : methods.data?.methods.length ? (
                      <div className="grid gap-2">
                        {methods.data.methods.map((method) => (
                          <button
                            key={method.key}
                            type="button"
                            disabled={commitMutation.isPending}
                            onClick={() =>
                              commitMutation.mutate({
                                fundingMode: 'platega',
                                selectedMethodKey: method.key,
                              })
                            }
                            className={`min-h-12 rounded-xl border border-dark-700 px-4 py-3 text-left text-sm font-semibold text-dark-100 transition hover:border-accent-400 hover:bg-accent-500/10 disabled:opacity-50 ${choiceClass}`}
                          >
                            {paymentMethodAmountLabel(
                              method.key,
                              formatPrice(checkout.tariff_total_kopeks),
                            )}
                          </button>
                        ))}
                      </div>
                    ) : (
                      <div className="space-y-2">
                        <p role="status" className="text-sm text-warning-400">
                          {t('deviceFirst.noMethods')}
                        </p>
                        <button
                          type="button"
                          onClick={() => navigate('/support')}
                          className={`min-h-11 w-full rounded-xl px-4 py-2 text-sm text-dark-400 hover:text-dark-200 ${choiceClass}`}
                        >
                          {t('deviceFirst.contactSupport')}
                        </button>
                      </div>
                    )}
                  </>
                )}
                {(checkout.balance_kopeks ?? 0) >= checkout.tariff_total_kopeks && (
                  <button
                    type="button"
                    disabled={commitMutation.isPending}
                    onClick={() =>
                      commitMutation.mutate({ fundingMode: 'wallet' })
                    }
                    className={`w-full rounded-2xl bg-accent-500 px-5 py-3.5 font-semibold text-white disabled:opacity-50 ${choiceClass}`}
                  >
                    {t('deviceFirst.payAndOrder', {
                      amount: formatPrice(checkout.tariff_total_kopeks),
                    })}
                  </button>
                )}
              </>
            )
          ) : (
            <button
              type="button"
              disabled={armMutation.isPending}
              onClick={() => armMutation.mutate()}
              className={`w-full rounded-2xl bg-accent-500 px-5 py-3.5 font-semibold text-white disabled:opacity-50 ${choiceClass}`}
            >
              {(checkout.shortage_kopeks ?? 0) > 0
                ? t('deviceFirst.topUpAndOrder', {
                    amount: formatPrice(checkout.shortage_kopeks ?? 0),
                  })
                : t('deviceFirst.payAndOrder', {
                    amount: formatPrice(checkout.quoted_price_kopeks),
                  })}
            </button>
          )}
          {!nativeLaunchMutation.isPending && (
            <button
              type="button"
              disabled={cancelMutation.isPending}
              onClick={() => cancelMutation.mutate()}
              className={`min-h-11 w-full rounded-xl px-4 py-2 text-sm text-dark-500 hover:text-dark-300 disabled:opacity-50 ${choiceClass}`}
            >
              {t('deviceFirst.cancel')}
            </button>
          )}
          {errorMessage && (
            <p role="alert" className="text-sm text-error-400">
              {errorMessage}
            </p>
          )}
        </CheckoutSurface>
      )}

      {checkout?.ui_state === 'awaiting_payment' && (
        <CheckoutSurface
          label={t('deviceFirst.needTopup')}
          portal={fixtureCheckout === undefined}
          dialogRef={dialogRef}
          onKeyDown={trapDialogFocus}
        >
          <h3 className="text-lg font-bold text-dark-50">
            {checkout.settlement_mode === 'direct_purchase_v2'
              ? t('deviceFirst.paymentChecking')
              : t('deviceFirst.needTopup')}
          </h3>
          <Summary checkout={checkout} formatPrice={formatPrice} />
          <p className="text-sm text-dark-400">
            {checkout.settlement_mode === 'direct_purchase_v2'
              ? t('deviceFirst.paymentCheckingText')
              : t('deviceFirst.armedNotice')}
          </p>
          {checkout.settlement_mode === 'direct_purchase_v2' &&
            pendingPayment.data?.redirect_url &&
            invoiceDeadline && (
            <p className="text-sm text-dark-300">
              {t('deviceFirst.invoiceValidUntil', { date: invoiceDeadline })}
            </p>
          )}
          {checkout.settlement_mode !== 'direct_purchase_v2' &&
            (checkout.top_up_surplus_kopeks ?? 0) > 0 && (
              <p role="status" className="text-sm text-dark-300">
                {t('deviceFirst.topUpSurplusHint', {
                  amount: formatPrice(checkout.top_up_surplus_kopeks ?? 0),
                })}
              </p>
            )}
          {checkout.settlement_mode === 'direct_purchase_v2' ? (
            <>
              {pendingPayment.data?.redirect_url && (
                <button
                  type="button"
                  onClick={() => {
                    const redirectUrl = pendingPayment.data?.redirect_url;
                    if (redirectUrl) window.location.assign(redirectUrl);
                  }}
                  className={`w-full rounded-2xl bg-accent-500 px-5 py-3.5 font-semibold text-white ${choiceClass}`}
                >
                  {t('deviceFirst.continueExistingInvoice')}
                </button>
              )}
              {pendingPayment.data?.resume_allowed && (
                <button
                  type="button"
                  disabled={resumeInvoiceMutation.isPending || !methodKey}
                  onClick={() => resumeInvoiceMutation.mutate()}
                  className={`w-full rounded-2xl bg-accent-500 px-5 py-3.5 font-semibold text-white disabled:opacity-50 ${choiceClass}`}
                >
                  {t('deviceFirst.resumeInvoice')}
                </button>
              )}
              <button
                type="button"
                onClick={refreshCheckout}
                className={`w-full rounded-2xl border border-dark-600 px-5 py-3.5 font-semibold text-dark-100 ${choiceClass}`}
              >
                {t('deviceFirst.refreshStatus')}
              </button>
            </>
          ) : requiresReconciliation ? (
            <>
              <StateMessage
                title={t('deviceFirst.paymentChecking')}
                text={t('deviceFirst.paymentCheckingText')}
              />
              <button
                type="button"
                onClick={refreshCheckout}
                className={`w-full rounded-2xl border border-dark-600 px-5 py-3.5 font-semibold text-dark-100 ${choiceClass}`}
              >
                {t('deviceFirst.refreshStatus')}
              </button>
              <button
                type="button"
                onClick={() => navigate('/support')}
                className={`min-h-11 w-full rounded-xl px-4 py-2 text-sm text-dark-400 hover:text-dark-200 ${choiceClass}`}
              >
                {t('deviceFirst.contactSupport')}
              </button>
            </>
          ) : existingPaymentAttempt ? (
            <>
              <p role="status" className="text-sm text-warning-300">
                {t('deviceFirst.existingInvoice', {
                  method: paymentMethodLabel(existingPaymentAttempt.method_key),
                })}
              </p>
              <button
                type="button"
                onClick={() => window.location.assign(existingPaymentAttempt.redirect_url)}
                className={`w-full rounded-2xl bg-accent-500 px-5 py-3.5 font-semibold text-white ${choiceClass}`}
              >
                {t('deviceFirst.continueExistingInvoice')}
              </button>
              <button
                type="button"
                onClick={() => navigate('/support')}
                className={`min-h-11 w-full rounded-xl px-4 py-2 text-sm text-dark-400 hover:text-dark-200 ${choiceClass}`}
              >
                {t('deviceFirst.contactSupport')}
              </button>
            </>
          ) : (checkout.shortage_kopeks ?? 0) > 0 ? (
            <>
              {methods.isError ? (
                <div className="space-y-2">
                  <p role="alert" className="text-sm text-error-400">
                    {t('deviceFirst.errorPaymentMethodsLoad')}
                  </p>
                  <button
                    type="button"
                    onClick={() => void methods.refetch()}
                    className={`w-full rounded-2xl border border-dark-600 px-5 py-3.5 font-semibold text-dark-100 ${choiceClass}`}
                  >
                    {t('deviceFirst.retry')}
                  </button>
                  <button
                    type="button"
                    onClick={() => navigate('/support')}
                    className={`min-h-11 w-full rounded-xl px-4 py-2 text-sm text-dark-400 hover:text-dark-200 ${choiceClass}`}
                  >
                    {t('deviceFirst.contactSupport')}
                  </button>
                </div>
              ) : methods.data && methods.data.methods.length === 0 ? (
                <div className="space-y-2">
                  <p role="status" className="text-sm text-warning-400">
                    {t('deviceFirst.noMethods')}
                  </p>
                  <button
                    type="button"
                    onClick={() => navigate('/support')}
                    className={`min-h-11 w-full rounded-xl px-4 py-2 text-sm text-dark-400 hover:text-dark-200 ${choiceClass}`}
                  >
                    {t('deviceFirst.contactSupport')}
                  </button>
                </div>
              ) : (
                <>
                  <div
                    role="radiogroup"
                    aria-label={t('deviceFirst.paymentMethodQuestion')}
                    className="grid gap-2"
                  >
                    {methods.data?.methods.map((method) => {
                      const isSelected = methodKey === method.key;
                      const availableKeys = methods.data?.methods.map((item) => item.key) ?? [];
                      return (
                        <button
                          key={method.key}
                          type="button"
                          role="radio"
                          aria-checked={isSelected}
                          tabIndex={isSelected ? 0 : -1}
                          onKeyDown={(event) =>
                            changeChoiceWithArrows(event, availableKeys, methodKey, setMethodKey)
                          }
                          onClick={() => setMethodKey(method.key)}
                          className={`rounded-xl border p-3 text-left text-sm ${choiceClass} ${
                            isSelected
                              ? 'border-accent-400 bg-accent-500/10 text-accent-300'
                              : 'border-dark-700 text-dark-300'
                          }`}
                        >
                          {paymentMethodLabel(method.key)}
                        </button>
                      );
                    })}
                  </div>
                  <button
                    type="button"
                    disabled={paymentMutation.isPending || !methods.data?.methods.length}
                    onClick={() => paymentMutation.mutate()}
                    className={`w-full rounded-2xl bg-accent-500 px-5 py-3.5 font-semibold text-white disabled:opacity-50 ${choiceClass}`}
                  >
                    {t('deviceFirst.topUpAmount', {
                      amount: formatPrice(checkout.shortage_kopeks ?? 0),
                    })}
                  </button>
                </>
              )}
            </>
          ) : (
            <button
              type="button"
              disabled={armMutation.isPending}
              onClick={() => armMutation.mutate()}
              className={`w-full rounded-2xl bg-accent-500 px-5 py-3.5 font-semibold text-white disabled:opacity-50 ${choiceClass}`}
            >
              {t('deviceFirst.continueAndOrder')}
            </button>
          )}
          {checkout.settlement_mode !== 'direct_purchase_v2' &&
            !requiresReconciliation &&
            !existingPaymentAttempt && (
              <button
                type="button"
                disabled={cancelMutation.isPending}
                onClick={() => cancelMutation.mutate()}
                className={`min-h-11 w-full rounded-xl px-4 py-2 text-sm text-dark-500 hover:text-dark-300 disabled:opacity-50 ${choiceClass}`}
              >
                {t('deviceFirst.cancel')}
              </button>
            )}
          {errorMessage && (
            <p role="alert" className="text-sm text-error-400">
              {errorMessage}
            </p>
          )}
        </CheckoutSurface>
      )}

      {checkout && ['processing', 'provisioning'].includes(checkout.ui_state) && (
        <div className="space-y-4">
          <StateMessage
            title={t('deviceFirst.processing')}
            text={t('deviceFirst.processingText')}
          />
          <button
            type="button"
            onClick={refreshCheckout}
            className={`w-full rounded-2xl border border-dark-600 px-5 py-3.5 font-semibold text-dark-100 ${choiceClass}`}
          >
            {t('deviceFirst.refreshStatus')}
          </button>
          <button
            type="button"
            onClick={() => navigate('/support')}
            className={`min-h-11 w-full rounded-xl px-4 py-2 text-sm text-dark-400 hover:text-dark-200 ${choiceClass}`}
          >
            {t('deviceFirst.contactSupport')}
          </button>
        </div>
      )}
      {checkout?.ui_state === 'ready' && (
        <div className="space-y-4">
          <StateMessage title={t('deviceFirst.ready')} text={t('deviceFirst.readyText')} />
          <button
            type="button"
            onClick={() => navigate('/connection')}
            className="w-full rounded-2xl bg-accent-500 px-5 py-3.5 font-semibold text-white"
          >
            {t('deviceFirst.connectVpn')}
          </button>
          <button
            type="button"
            onClick={() => navigate('/', { replace: true })}
            className={`min-h-11 w-full rounded-xl px-4 py-2 text-sm text-dark-400 hover:text-dark-200 ${choiceClass}`}
          >
            {t('deviceFirst.home')}
          </button>
        </div>
      )}
      {checkout &&
        [
          'reprice_required',
          'conflict',
          'expired',
          'failed',
          'cancelled',
          'operator_review',
        ].includes(checkout.ui_state) && (
          <div className="space-y-4">
            <StateMessage
              title={
                checkout.ui_state === 'operator_review' ||
                checkout.terminal_reason === 'payment_amount_mismatch'
                  ? t('deviceFirst.paymentMismatchTitle')
                  : t('deviceFirst.refreshTitle')
              }
              text={
                checkout.ui_state === 'operator_review' ||
                checkout.terminal_reason === 'payment_amount_mismatch'
                  ? t('deviceFirst.paymentMismatchText')
                  : t('deviceFirst.refreshText')
              }
            />
            {checkout.ui_state === 'operator_review' ? (
              <button
                type="button"
                onClick={() => navigate('/support')}
                className={`w-full rounded-2xl bg-accent-500 px-5 py-3.5 font-semibold text-white ${choiceClass}`}
              >
                {t('deviceFirst.contactSupport')}
              </button>
            ) : (
              <button
                type="button"
                onClick={startNewQuote}
                className={`w-full rounded-2xl bg-accent-500 px-5 py-3.5 font-semibold text-white ${choiceClass}`}
              >
                {t('deviceFirst.startNew')}
              </button>
            )}
          </div>
        )}

      {errorMessage && !modalOpen && (
        <p role="alert" className="mt-4 text-sm text-error-400">
          {errorMessage}
        </p>
      )}
    </section>
  );
}

function CheckoutSurface({
  label,
  portal,
  dialogRef,
  onKeyDown,
  children,
}: {
  label: string;
  portal: boolean;
  dialogRef: RefObject<HTMLDivElement | null>;
  onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void;
  children: ReactNode;
}) {
  const dialog = (
    <div
      ref={dialogRef}
      role="dialog"
      aria-modal={portal || undefined}
      aria-label={label}
      tabIndex={-1}
      onKeyDown={onKeyDown}
      className="max-h-[calc(100dvh-1.5rem)] w-full max-w-lg space-y-4 overflow-y-auto rounded-3xl border border-dark-700 bg-dark-950 p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] shadow-2xl focus:outline-none"
    >
      {children}
    </div>
  );
  if (!portal) return <div className="space-y-4">{children}</div>;
  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-end bg-black/70 p-0 sm:items-center sm:justify-center sm:p-6">
      {dialog}
    </div>,
    document.body,
  );
}

function deviceFirstErrorCode(error: unknown): string | null {
  if (!error || typeof error !== 'object') return null;
  const response = (error as { response?: { data?: { detail?: unknown } } }).response;
  const detail = response?.data?.detail;
  if (!detail || typeof detail !== 'object') return null;
  const code = (detail as { code?: unknown }).code;
  return typeof code === 'string' ? code : null;
}

function deviceFirstErrorMessage(
  t: (key: string, options?: Record<string, unknown>) => string,
  error: unknown,
): string {
  const messages: Record<string, string> = {
    open_checkout_exists: 'deviceFirst.errorResumeOrder',
    open_checkout_recovery_failed: 'deviceFirst.errorResumeUnavailable',
    device_limit_decrease_not_allowed: 'deviceFirst.errorDeviceLimitDecrease',
    subscription_restricted: 'deviceFirst.errorRestricted',
    invalid_selection: 'deviceFirst.errorSelectionChanged',
    rate_limited: 'deviceFirst.errorRateLimited',
    idempotency_conflict: 'deviceFirst.errorRetryQuote',
    reconciliation_required: 'deviceFirst.errorPaymentChecking',
    external_invoice_active: 'deviceFirst.errorPaymentChecking',
    payment_method_unavailable: 'deviceFirst.errorPaymentMethod',
    payment_methods_load_failed: 'deviceFirst.errorPaymentMethodsLoad',
    provider_amount_out_of_range: 'deviceFirst.errorProviderAmount',
    feature_disabled: 'deviceFirst.errorUnavailable',
    legacy_only: 'deviceFirst.errorUnavailable',
    invalid_state: 'deviceFirst.errorOrderUpdated',
  };
  return t(messages[deviceFirstErrorCode(error) ?? ''] ?? 'deviceFirst.error');
}

function Summary({
  checkout,
  formatPrice,
}: {
  checkout: DeviceFirstCheckout;
  formatPrice: (value: number) => string;
}) {
  const { t } = useTranslation();
  const periodText =
    checkout.period_days === 365
      ? t('deviceFirst.periodYearExact')
      : checkout.period_days % 30 === 0
        ? t('deviceFirst.periodMonths', { count: checkout.period_days / 30 })
        : t('deviceFirst.periodDays', { count: checkout.period_days });
  return (
    <div className="space-y-3 rounded-2xl border border-dark-700 bg-dark-900/35 p-4">
      <div className="flex justify-between text-sm text-dark-300">
        <span>{t('deviceFirst.devices')}</span>
        <strong>
          {checkout.current_device_limit !== null &&
          checkout.current_subscription_is_trial === false
            ? `${checkout.current_device_limit} → ${checkout.selected_device_limit}`
            : checkout.selected_device_limit}
        </strong>
      </div>
      <div className="flex justify-between text-sm text-dark-300">
        <span>{t('deviceFirst.period')}</span>
        <strong>{periodText}</strong>
      </div>
      <div className="flex justify-between text-sm text-dark-300">
        <span>{t('deviceFirst.endsAt')}</span>
        <strong>
          {new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(
            new Date(checkout.estimated_end_at),
          )}
        </strong>
      </div>
      {checkout.balance_kopeks !== null && (
        <div className="flex justify-between text-sm text-dark-300">
          <span>{t('deviceFirst.balance')}</span>
          <strong>{formatPrice(checkout.balance_kopeks)}</strong>
        </div>
      )}
      {checkout.settlement_mode !== 'direct_purchase_v2' &&
        checkout.shortage_kopeks !== null &&
        checkout.shortage_kopeks > 0 && (
          <div className="flex justify-between text-sm text-warning-300">
            <span>{t('deviceFirst.shortage')}</span>
            <strong>{formatPrice(checkout.shortage_kopeks)}</strong>
          </div>
        )}
      <div className="flex justify-between border-t border-dark-700 pt-3 text-dark-50">
        <span>{t('deviceFirst.total')}</span>
        <strong>{formatPrice(checkout.tariff_total_kopeks || checkout.quoted_price_kopeks)}</strong>
      </div>
    </div>
  );
}

function StateMessage({ title, text }: { title: string; text: string }) {
  return (
    <div role="status" aria-live="polite" className="py-8 text-center">
      <div className="mx-auto mb-4 h-12 w-12 rounded-full bg-accent-500/15 ring-1 ring-accent-400/30" />
      <h3 className="text-lg font-bold text-dark-50">{title}</h3>
      <p className="mx-auto mt-2 max-w-sm text-sm text-dark-400">{text}</p>
    </div>
  );
}
