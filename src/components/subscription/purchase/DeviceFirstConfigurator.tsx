import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useSearchParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import {
  deviceFirstApi,
  type DeviceFirstCheckout,
  type DeviceFirstOptions,
} from '@/api/deviceFirst';
import { getGlassColors } from '@/utils/glassTheme';
import { useTheme } from '@/hooks/useTheme';
import { useCurrency } from '@/hooks/useCurrency';

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
  const { formatAmount, currencySymbol } = useCurrency();
  const g = getGlassColors(isDark);
  const [period, setPeriod] = useState(
    options.default_period_days ?? options.period_options?.[0] ?? 30,
  );
  const [devices, setDevices] = useState(options.device_options?.[0] ?? 1);
  const [checkout, setCheckout] = useState<DeviceFirstCheckout | null>(fixtureCheckout ?? null);
  const checkoutUiState = checkout?.ui_state;
  const modalOpen =
    fixtureCheckout === undefined &&
    !!checkoutUiState &&
    ['configuration', 'confirmation', 'awaiting_payment'].includes(checkoutUiState);
  const [methodKey, setMethodKey] = useState('sbp');
  const pollStartedAt = useRef(Date.now());
  const dialogRef = useRef<HTMLDivElement>(null);
  const sectionRef = useRef<HTMLElement>(null);
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

  const price = useMemo(
    () =>
      options.price_matrix
        ?.find((row) => row.period_days === period)
        ?.prices.find((item) => item.device_limit === devices),
    [options.price_matrix, period, devices],
  );

  const statusQuery = useQuery({
    queryKey: ['device-first-checkout', checkout?.id],
    queryFn: () => deviceFirstApi.get(checkout!.id),
    enabled:
      fixtureCheckout === undefined &&
      !!checkout &&
      ['awaiting_payment', 'processing', 'provisioning'].includes(checkout.ui_state),
    refetchInterval: (query) => {
      if (Date.now() - pollStartedAt.current > 2 * 60 * 1000) return false;
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
    enabled: fixtureMethods === undefined && checkout?.ui_state === 'awaiting_payment',
  });
  const acceptCheckout = (next: DeviceFirstCheckout) => {
    setCheckout(next);
    if (fixtureCheckout === undefined) {
      const nextParams = new URLSearchParams(searchParams);
      nextParams.set('checkout', next.id);
      setSearchParams(nextParams, { replace: true });
    }
  };

  const createMutation = useMutation({
    mutationFn: () => deviceFirstApi.create(period, devices),
    onSuccess: acceptCheckout,
  });
  const confirmMutation = useMutation({
    mutationFn: () => deviceFirstApi.confirm(checkout!.id),
    onSuccess: acceptCheckout,
  });
  const armMutation = useMutation({
    mutationFn: () => deviceFirstApi.arm(checkout!.id),
    onSuccess: acceptCheckout,
  });
  const paymentMutation = useMutation({
    mutationFn: () => deviceFirstApi.createPaymentAttempt(checkout!.id, methodKey),
    onSuccess: (attempt) => {
      window.location.assign(attempt.redirect_url);
    },
  });
  const cancelMutation = useMutation({
    mutationFn: () => deviceFirstApi.cancel(checkout!.id),
    onSuccess: acceptCheckout,
  });

  useEffect(() => {
    if (checkout?.ui_state === 'ready') {
      queryClient.invalidateQueries({ queryKey: ['subscription'] });
      queryClient.invalidateQueries({ queryKey: ['balance'] });
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
      const section = sectionRef.current;
      const siblings = section?.parentElement
        ? Array.from(section.parentElement.children).filter((child) => child !== section)
        : [];
      siblings.forEach((element) => {
        if (element instanceof HTMLElement) element.inert = true;
      });
      dialogRef.current?.focus();
      return () => {
        siblings.forEach((element) => {
          if (element instanceof HTMLElement) element.inert = false;
        });
        previousFocusRef.current?.focus();
      };
    }
    return undefined;
  }, [modalOpen]);

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

  const formatPrice = (kopeks: number) => `${formatAmount(kopeks / 100)} ${currencySymbol}`;
  const periodLabel = (days: number) =>
    days % 30 === 0
      ? t('deviceFirst.periodMonths', { count: days / 30 })
      : t('deviceFirst.periodDays', { count: days });
  const error =
    createMutation.error ||
    confirmMutation.error ||
    armMutation.error ||
    paymentMutation.error ||
    cancelMutation.error;
  const isPending =
    createMutation.isPending ||
    confirmMutation.isPending ||
    armMutation.isPending ||
    paymentMutation.isPending ||
    cancelMutation.isPending;
  const choiceClass =
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-300 focus-visible:ring-offset-2 focus-visible:ring-offset-dark-950';

  return (
    <section
      ref={sectionRef}
      data-testid="device-first-configurator"
      aria-busy={isPending}
      className="relative overflow-hidden rounded-3xl p-4 pb-[max(1rem,env(safe-area-inset-bottom))] min-[360px]:p-5 sm:p-7"
      style={{ background: g.cardBg, border: `1px solid ${g.cardBorder}`, boxShadow: g.shadow }}
    >
      <div className="mb-6" aria-hidden={modalOpen || undefined} inert={modalOpen || undefined}>
        <div className="mb-2 text-xs font-semibold uppercase tracking-[0.16em] text-accent-400">
          {t('deviceFirst.eyebrow')}
        </div>
        <h2 className="text-xl font-bold text-dark-50">{options.tariff?.name}</h2>
        <p className="mt-2 text-sm text-dark-400">{t('deviceFirst.description')}</p>
      </div>

      {!checkout && initialCheckoutId && restoredCheckout.isLoading && (
        <StateMessage title={t('deviceFirst.processing')} text={t('deviceFirst.processingText')} />
      )}
      {!checkout && initialCheckoutId && restoredCheckout.isError && (
        <StateMessage title={t('deviceFirst.refreshTitle')} text={t('deviceFirst.refreshText')} />
      )}
      {!checkout && !initialCheckoutId && (
        <div className="space-y-6">
          <fieldset>
            <legend className="mb-3 text-sm font-medium text-dark-200">
              {t('deviceFirst.periodQuestion')}
            </legend>
            <div className="grid grid-cols-2 gap-2">
              {options.period_options?.map((value) => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={period === value}
                  aria-pressed={period === value}
                  onClick={() => setPeriod(value)}
                  className={`rounded-2xl border px-3 py-3 text-sm font-semibold transition ${choiceClass} ${
                    period === value
                      ? 'border-accent-400 bg-accent-500/15 text-accent-300'
                      : 'border-dark-700 bg-dark-800/45 text-dark-300'
                  }`}
                >
                  {periodLabel(value)}
                  {period === value && (
                    <span className="ml-2 inline-flex rounded-full bg-accent-400/15 px-2 py-0.5 text-[10px] uppercase">
                      ✓ {t('deviceFirst.selected')}
                    </span>
                  )}
                </button>
              ))}
            </div>
          </fieldset>
          <fieldset>
            <legend className="mb-3 text-sm font-medium text-dark-200">
              {t('deviceFirst.devicesQuestion')}
            </legend>
            <div className="grid max-w-3xl grid-cols-1 gap-2 min-[360px]:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
              {options.device_options?.map((value) => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={devices === value}
                  aria-pressed={devices === value}
                  onClick={() => setDevices(value)}
                  className={`rounded-2xl border px-2 py-4 text-center transition ${choiceClass} ${
                    devices === value
                      ? 'border-accent-400 bg-accent-500/15 text-accent-300'
                      : 'border-dark-700 bg-dark-800/45 text-dark-300'
                  }`}
                >
                  <span className="block text-xl font-bold">{value}</span>
                  <span className="text-xs">{t('deviceFirst.deviceShort', { count: value })}</span>
                  {devices === value && (
                    <span className="ml-2 inline-flex rounded-full bg-accent-400/15 px-2 py-0.5 text-[10px] uppercase">
                      ✓ {t('deviceFirst.selected')}
                    </span>
                  )}
                </button>
              ))}
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
            className={`sticky bottom-2 w-full rounded-2xl bg-accent-500 px-5 py-3.5 font-semibold text-white disabled:opacity-50 ${choiceClass}`}
          >
            {t('deviceFirst.review')}
          </button>
        </div>
      )}

      {checkout?.ui_state === 'configuration' && (
        <div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-label={t('deviceFirst.review')}
          tabIndex={-1}
          onKeyDown={trapDialogFocus}
          className={`space-y-4 focus:outline-none ${
            fixtureCheckout === undefined
              ? 'max-sm:fixed max-sm:inset-x-0 max-sm:bottom-0 max-sm:z-50 max-sm:rounded-t-3xl max-sm:border max-sm:border-dark-700 max-sm:bg-dark-950 max-sm:p-5 max-sm:pb-[max(1.25rem,env(safe-area-inset-bottom))]'
              : ''
          }`}
        >
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
          {error && (
            <p role="alert" className="text-sm text-error-400">
              {t('deviceFirst.error')}
            </p>
          )}
        </div>
      )}

      {checkout?.ui_state === 'confirmation' && (
        <div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-label={t('deviceFirst.confirm')}
          tabIndex={-1}
          onKeyDown={trapDialogFocus}
          className={`space-y-4 focus:outline-none ${
            fixtureCheckout === undefined
              ? 'max-sm:fixed max-sm:inset-x-0 max-sm:bottom-0 max-sm:z-50 max-sm:rounded-t-3xl max-sm:border max-sm:border-dark-700 max-sm:bg-dark-950 max-sm:p-5 max-sm:pb-[max(1.25rem,env(safe-area-inset-bottom))]'
              : ''
          }`}
        >
          <Summary checkout={checkout} formatPrice={formatPrice} />
          <p className="text-xs text-dark-400">{t('deviceFirst.chargeNotice')}</p>
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
          <button
            type="button"
            disabled={cancelMutation.isPending}
            onClick={() => cancelMutation.mutate()}
            className={`min-h-11 w-full rounded-xl px-4 py-2 text-sm text-dark-500 hover:text-dark-300 disabled:opacity-50 ${choiceClass}`}
          >
            {t('deviceFirst.cancel')}
          </button>
          {error && (
            <p role="alert" className="text-sm text-error-400">
              {t('deviceFirst.error')}
            </p>
          )}
        </div>
      )}

      {checkout?.ui_state === 'awaiting_payment' && (
        <div
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-label={t('deviceFirst.needTopup')}
          tabIndex={-1}
          onKeyDown={trapDialogFocus}
          className={`space-y-4 focus:outline-none ${
            fixtureCheckout === undefined
              ? 'max-sm:fixed max-sm:inset-x-0 max-sm:bottom-0 max-sm:z-50 max-sm:max-h-[85vh] max-sm:overflow-y-auto max-sm:rounded-t-3xl max-sm:border max-sm:border-dark-700 max-sm:bg-dark-950 max-sm:p-5 max-sm:pb-[max(1.25rem,env(safe-area-inset-bottom))]'
              : ''
          }`}
        >
          <h3 className="text-lg font-bold text-dark-50">{t('deviceFirst.needTopup')}</h3>
          <Summary checkout={checkout} formatPrice={formatPrice} />
          <p className="text-sm text-dark-400">{t('deviceFirst.armedNotice')}</p>
          {(checkout.shortage_kopeks ?? 0) > 0 ? (
            <>
              <div className="grid gap-2">
                {methods.data?.methods.map((method) => (
                  <button
                    key={method.key}
                    type="button"
                    role="radio"
                    aria-checked={methodKey === method.key}
                    onClick={() => setMethodKey(method.key)}
                    className={`rounded-xl border p-3 text-left text-sm ${choiceClass} ${
                      methodKey === method.key
                        ? 'border-accent-400 bg-accent-500/10 text-accent-300'
                        : 'border-dark-700 text-dark-300'
                    }`}
                  >
                    {method.key === 'sbp'
                      ? t('deviceFirst.sbp')
                      : method.key === 'cards_ru'
                        ? t('deviceFirst.cards')
                        : t('deviceFirst.crypto')}
                  </button>
                ))}
              </div>
              {methods.data && methods.data.methods.length === 0 && (
                <p role="status" className="text-sm text-warning-400">
                  {t('deviceFirst.noMethods')}
                </p>
              )}
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
          <button
            type="button"
            disabled={cancelMutation.isPending}
            onClick={() => cancelMutation.mutate()}
            className={`min-h-11 w-full rounded-xl px-4 py-2 text-sm text-dark-500 hover:text-dark-300 disabled:opacity-50 ${choiceClass}`}
          >
            {t('deviceFirst.cancel')}
          </button>
          {error && (
            <p role="alert" className="text-sm text-error-400">
              {t('deviceFirst.error')}
            </p>
          )}
        </div>
      )}

      {checkout && ['processing', 'provisioning'].includes(checkout.ui_state) && (
        <StateMessage title={t('deviceFirst.processing')} text={t('deviceFirst.processingText')} />
      )}
      {checkout?.ui_state === 'ready' && (
        <div className="space-y-4">
          <StateMessage title={t('deviceFirst.ready')} text={t('deviceFirst.readyText')} />
          <button
            type="button"
            onClick={() => navigate('/', { replace: true })}
            className="w-full rounded-2xl bg-accent-500 px-5 py-3.5 font-semibold text-white"
          >
            {t('deviceFirst.home')}
          </button>
        </div>
      )}
      {checkout &&
        ['reprice_required', 'conflict', 'expired', 'failed', 'cancelled'].includes(
          checkout.ui_state,
        ) && (
          <StateMessage title={t('deviceFirst.refreshTitle')} text={t('deviceFirst.refreshText')} />
        )}

      {error && !modalOpen && (
        <p role="alert" className="mt-4 text-sm text-error-400">
          {t('deviceFirst.error')}
        </p>
      )}
    </section>
  );
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
    checkout.period_days % 30 === 0
      ? t('deviceFirst.periodMonths', { count: checkout.period_days / 30 })
      : t('deviceFirst.periodDays', { count: checkout.period_days });
  return (
    <div className="space-y-3 rounded-2xl border border-dark-700 bg-dark-900/35 p-4">
      <div className="flex justify-between text-sm text-dark-300">
        <span>{t('deviceFirst.devices')}</span>
        <strong>
          {checkout.current_device_limit
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
      {checkout.shortage_kopeks !== null && checkout.shortage_kopeks > 0 && (
        <div className="flex justify-between text-sm text-warning-300">
          <span>{t('deviceFirst.shortage')}</span>
          <strong>{formatPrice(checkout.shortage_kopeks)}</strong>
        </div>
      )}
      <div className="flex justify-between border-t border-dark-700 pt-3 text-dark-50">
        <span>{t('deviceFirst.total')}</span>
        <strong>{formatPrice(checkout.quoted_price_kopeks)}</strong>
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
