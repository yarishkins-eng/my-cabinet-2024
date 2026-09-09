import { useEffect, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link, useSearchParams } from 'react-router';
import { subscriptionApi } from '../api/subscription';
import { WebBackButton } from '../components/WebBackButton';
import { getGlassColors } from '../utils/glassTheme';
import { useTheme } from '../hooks/useTheme';
import type { Tariff, ClassicPurchaseOptions } from '../types';
import { useCloseOnSuccessNotification } from '../store/successNotification';
import { SwitchTariffSheet } from '../components/subscription/sheets/SwitchTariffSheet';
import { TariffPurchaseForm } from '../components/subscription/purchase/TariffPurchaseForm';
import { TariffPickerGrid } from '../components/subscription/purchase/TariffPickerGrid';
import { ClassicPurchaseWizard } from '../components/subscription/purchase/ClassicPurchaseWizard';
import { ExclamationIcon, SparklesIcon } from '@/components/icons';
import { deviceFirstApi, type DeviceFirstOptions } from '@/api/deviceFirst';
import { DeviceFirstConfigurator } from '@/components/subscription/purchase/DeviceFirstConfigurator';

export default function SubscriptionPurchase() {
  const { t } = useTranslation();
  const [searchParams] = useSearchParams();
  const subscriptionId = searchParams.get('subscriptionId')
    ? parseInt(searchParams.get('subscriptionId')!, 10)
    : undefined;
  const deviceFirstCheckoutId = searchParams.get('checkout');
  const { isDark } = useTheme();
  const g = getGlassColors(isDark);

  // Subscription query (shares cache with /subscription page)
  const { data: subscriptionResponse, isLoading } = useQuery({
    queryKey: ['subscription', subscriptionId],
    queryFn: () => subscriptionApi.getSubscription(subscriptionId),
    retry: false,
    staleTime: 0,
    refetchOnMount: 'always',
  });
  const subscription = subscriptionResponse?.subscription ?? null;

  const {
    data: deviceFirstOptions,
    isPending: deviceFirstPending,
    isFetching: deviceFirstFetching,
    isFetchedAfterMount: deviceFirstFetched,
    fetchStatus: deviceFirstFetchStatus,
    isError: deviceFirstError,
    refetch: refetchDeviceFirst,
  } = useQuery({
    queryKey: ['device-first-options'],
    queryFn: deviceFirstApi.getOptions,
    // Retry brief failures, but a 30-second transport timeout needs an explicit retry.
    retry: (failureCount, error) => {
      const code = (error as { code?: string } | null | undefined)?.code;
      const timedOut = code === 'ECONNABORTED' || code === 'ETIMEDOUT';
      return failureCount < 2 && !timedOut;
    },
    retryDelay: 300,
    staleTime: 0,
    refetchOnMount: 'always',
  });

  // Purchase options
  const {
    data: purchaseOptions,
    isLoading: optionsLoading,
    isError: optionsError,
    isFetching: optionsFetching,
    isFetchedAfterMount: optionsFetched,
    fetchStatus: optionsFetchStatus,
    refetch: refetchOptions,
  } = useQuery({
    queryKey: ['purchase-options', subscriptionId],
    queryFn: () => subscriptionApi.getPurchaseOptions(subscriptionId),
    staleTime: 0,
    refetchOnMount: 'always',
  });

  // Sales mode detection
  const isTariffsMode = purchaseOptions?.sales_mode === 'tariffs';
  const classicOptions = !isTariffsMode ? (purchaseOptions as ClassicPurchaseOptions) : null;
  const tariffs =
    isTariffsMode && purchaseOptions && 'tariffs' in purchaseOptions
      ? purchaseOptions.tariffs.filter((tariff) => tariff.legacy_purchase_allowed === true)
      : [];

  // Multi-tariff: check via subscriptions list query
  const { data: multiSubData } = useQuery({
    queryKey: ['subscriptions-list'],
    queryFn: () => subscriptionApi.getSubscriptions(),
    staleTime: 60_000,
  });
  const isMultiTariff = multiSubData?.multi_tariff_enabled ?? false;

  // (active promo discount + applyPromoDiscount live in usePromoDiscount;
  //  consumed directly by the sub-components, not threaded as props)

  // (classic-mode state moved into <ClassicPurchaseWizard>)

  // Tariffs mode state
  const [selectedTariff, setSelectedTariff] = useState<Tariff | null>(null);
  const [showTariffPurchase, setShowTariffPurchase] = useState(false);
  const [legacyRejected, setLegacyRejected] = useState(false);
  const currentSelectedTariff = tariffs.find((tariff) => tariff.id === selectedTariff?.id);
  // (selectedTariffPeriod / customDays / customTrafficGb / useCustomDays /
  //  useCustomTraffic moved into <TariffPurchaseForm>; form remounts with
  //  fresh state via key=tariff.id when the parent picks a new tariff)

  // (tariffPurchaseRef moved into <TariffPurchaseForm>; switch-modal ref
  //  moved into <SwitchTariffSheet>)

  // Tariff switch
  const [switchTariffId, setSwitchTariffId] = useState<number | null>(null);

  // Auto-close all modals on success notification
  const handleCloseAllModals = () => {
    // setShowPurchaseForm moved into <ClassicPurchaseWizard>'s own useCloseOnSuccessNotification
    setShowTariffPurchase(false);
    setSwitchTariffId(null);

    setSelectedTariff(null);
    // (selectedTariffPeriod lives inside <TariffPurchaseForm> now; unmount clears it)
  };
  useCloseOnSuccessNotification(handleCloseAllModals);

  // (switch preview query + switchTariffMutation moved into <SwitchTariffSheet>)

  // (tariffPurchaseMutation moved into <TariffPurchaseForm>)
  // (auto-scroll effects: switch-modal into <SwitchTariffSheet>,
  //  tariff-purchase into <TariffPurchaseForm>)

  // (classic-mode helpers moved into <ClassicPurchaseWizard>)

  const hasDeviceFirst = deviceFirstOptions?.eligible === true;
  const legacyAllowed =
    !legacyRejected &&
    deviceFirstOptions?.eligible === false &&
    (!isTariffsMode || deviceFirstOptions.legacy_tariff_purchase_allowed === true);

  // Keep an already admitted configurator mounted during a failed background
  // refresh. Its local selection and in-flight payment must survive retry.
  // A cached response or first failed fetch can never admit a configurator.
  const [validatedDeviceFirst, setValidatedDeviceFirst] = useState<DeviceFirstOptions | null>(null);
  useEffect(() => {
    if (deviceFirstFetched && !deviceFirstFetching && !deviceFirstError) {
      setValidatedDeviceFirst(deviceFirstOptions?.eligible === true ? deviceFirstOptions : null);
    }
  }, [deviceFirstFetched, deviceFirstFetching, deviceFirstError, deviceFirstOptions]);

  const retryCheckout = () => {
    setShowTariffPurchase(false);
    setSelectedTariff(null);
    setSwitchTariffId(null);
    void refetchDeviceFirst();
    void refetchOptions();
  };
  const handleCheckoutRequired = () => {
    // A definitive server rejection takes precedence even if the next options
    // response still permits legacy generally (for example, an AP-only tariff).
    setLegacyRejected(true);
    retryCheckout();
  };

  // A failed or missing response is not an eligibility decision. Cached legacy
  // permission is also unusable until its background refresh completes.
  // Existing invoices always keep their independent recovery path.
  let availability: ReactNode = null;
  if (!deviceFirstCheckoutId) {
    const offline =
      deviceFirstFetchStatus === 'paused' || (!hasDeviceFirst && optionsFetchStatus === 'paused');
    const loadFailed =
      offline ||
      deviceFirstError ||
      (!deviceFirstPending && typeof deviceFirstOptions?.eligible !== 'boolean') ||
      (!hasDeviceFirst && optionsError);
    const loading =
      deviceFirstPending ||
      !deviceFirstFetched ||
      (!hasDeviceFirst && deviceFirstFetching) ||
      (!hasDeviceFirst && (isLoading || optionsLoading || optionsFetching || !optionsFetched));
    if (loading && !loadFailed) {
      availability = (
        <div className="flex min-h-64 items-center justify-center" role="status">
          <span className="sr-only">{t('common.loading')}</span>
          <div className="h-10 w-10 animate-spin rounded-full border-2 border-accent-500 border-t-transparent" />
        </div>
      );
    }

    if (
      !availability &&
      (loadFailed || (!hasDeviceFirst && (!legacyAllowed || !purchaseOptions)))
    ) {
      availability = (
        <div className="space-y-6">
          <WebBackButton to="/subscriptions" />
          <h1 className="text-2xl font-bold text-dark-50 sm:text-3xl">
            {t('subscription.getSubscription')}
          </h1>
          <div
            className="rounded-3xl p-6 text-center"
            style={{ background: g.cardBg, border: `1px solid ${g.cardBorder}` }}
          >
            <p className="mb-4 text-dark-300" role="alert">
              {t(
                loadFailed ? 'subscription.checkoutLoadError' : 'subscription.checkoutUnavailable',
              )}
            </p>
            <button
              onClick={retryCheckout}
              disabled={deviceFirstFetching}
              className="rounded-xl bg-accent-500 px-6 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-600 disabled:opacity-50"
            >
              {t('common.retry')}
            </button>
            <Link to="/support" className="ml-4 text-accent-400">
              {t('nav.support')}
            </Link>
          </div>
        </div>
      );
    }
  }

  return (
    <div className="space-y-6">
      {availability}
      {/* Header */}
      {!availability && (
        <div className="flex items-center gap-3">
          <WebBackButton
            to={subscriptionId ? `/subscriptions/${subscriptionId}` : '/subscriptions'}
          />
          <h1 className="text-2xl font-bold text-dark-50 sm:text-3xl">
            {isMultiTariff && !subscriptionId
              ? t('subscription.newTariff', 'Новый тариф')
              : !isMultiTariff && subscription?.is_daily && !subscription?.is_trial
                ? t('subscription.switchTariff.title')
                : subscription && !subscription.is_trial
                  ? t('subscription.extend')
                  : t('subscription.getSubscription')}
          </h1>
        </div>
      )}

      {(deviceFirstCheckoutId ||
        (!availability && hasDeviceFirst) ||
        (validatedDeviceFirst &&
          (deviceFirstError || deviceFirstFetching || deviceFirstFetchStatus === 'paused'))) && (
        <div hidden={!!availability} inert={!!availability}>
          <DeviceFirstConfigurator
            options={deviceFirstOptions ?? validatedDeviceFirst ?? { eligible: true }}
            initialCheckoutId={deviceFirstCheckoutId}
          />
        </div>
      )}

      {/* Tariffs Section */}
      {!availability &&
        legacyAllowed &&
        !deviceFirstCheckoutId &&
        isTariffsMode &&
        tariffs.length > 0 && (
          <div
            className="relative overflow-hidden rounded-3xl"
            style={{
              background: g.cardBg,
              border: `1px solid ${g.cardBorder}`,
              boxShadow: g.shadow,
              padding: '24px 28px',
            }}
          >
            {/* Trial upgrade prompt — hidden when expired banner is active */}
            {subscription?.is_trial &&
              !(
                isTariffsMode &&
                purchaseOptions &&
                'subscription_is_expired' in purchaseOptions &&
                purchaseOptions.subscription_is_expired
              ) && (
                <div
                  className="mb-6 rounded-[14px] p-4"
                  style={{
                    background:
                      'linear-gradient(135deg, rgba(255,184,0,0.08), rgba(var(--color-accent-400),0.06))',
                    border: '1px solid rgba(255,184,0,0.15)',
                  }}
                >
                  <div className="flex items-start gap-3">
                    <div
                      className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-[10px]"
                      style={{
                        background: 'rgba(255,184,0,0.12)',
                        color: 'rgb(var(--color-urgent-400))',
                      }}
                    >
                      <SparklesIcon className="h-4 w-4" />
                    </div>
                    <div>
                      <div
                        className="text-sm font-semibold"
                        style={{ color: 'rgb(var(--color-urgent-400))' }}
                      >
                        {t('subscription.trialUpgrade.title')}
                      </div>
                      <div className="mt-1 text-[12px] text-dark-50/40">
                        {t('subscription.trialUpgrade.description')}
                      </div>
                    </div>
                  </div>
                </div>
              )}

            {/* Expired subscription notice */}
            {isTariffsMode &&
              purchaseOptions &&
              'subscription_is_expired' in purchaseOptions &&
              purchaseOptions.subscription_is_expired && (
                <div
                  className="mb-6 rounded-[14px] p-4"
                  style={{
                    background:
                      'linear-gradient(135deg, rgba(255,59,92,0.08), rgba(255,184,0,0.06))',
                    border: '1px solid rgba(255,59,92,0.15)',
                  }}
                >
                  <div className="flex items-start gap-3">
                    <div
                      className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-[10px]"
                      style={{
                        background: 'rgba(255,59,92,0.12)',
                        color: 'rgb(var(--color-critical-500))',
                      }}
                    >
                      <ExclamationIcon className="h-4 w-4" />
                    </div>
                    <div>
                      <div
                        className="text-sm font-semibold"
                        style={{ color: 'rgb(var(--color-critical-500))' }}
                      >
                        {t('subscription.expiredBanner.title')}
                      </div>
                      <div className="mt-1 text-[12px] text-dark-50/40">
                        {t('subscription.expiredBanner.selectTariff')}
                      </div>
                    </div>
                  </div>
                </div>
              )}

            {/* Legacy subscription notice */}
            {subscription && !subscription.is_trial && !subscription.tariff_id && (
              <div className="mb-6 rounded-xl border border-accent-500/30 bg-accent-500/10 p-4">
                <div className="mb-2 font-medium text-accent-400">
                  {t('subscription.legacy.selectTariffTitle')}
                </div>
                <div className="text-sm text-dark-300">
                  {t('subscription.legacy.selectTariffDescription')}
                </div>
                <div className="mt-2 text-xs text-dark-500">
                  {t('subscription.legacy.currentSubContinues')}
                </div>
              </div>
            )}

            {/* Switch Tariff Preview Modal */}
            <SwitchTariffSheet
              open={switchTariffId !== null}
              tariffId={switchTariffId}
              subscriptionId={subscriptionId}
              tariffs={tariffs}
              onClose={() => setSwitchTariffId(null)}
              onExpiredFallback={(tariff) => {
                setSelectedTariff(tariff);
                setShowTariffPurchase(true);
              }}
            />

            {!showTariffPurchase || !currentSelectedTariff ? (
              <TariffPickerGrid
                tariffs={tariffs}
                subscription={subscription}
                purchaseOptions={purchaseOptions}
                isTariffsMode={isTariffsMode}
                isMultiTariff={isMultiTariff}
                onSelectTariff={(tariff) => {
                  setSelectedTariff(tariff);
                  setShowTariffPurchase(true);
                }}
                onSwitchTariff={(tariffId) => setSwitchTariffId(tariffId)}
              />
            ) : (
              currentSelectedTariff && (
                /* Tariff Purchase Form (extracted into its own component) */
                <TariffPurchaseForm
                  key={currentSelectedTariff.id}
                  tariff={currentSelectedTariff}
                  subscriptionId={subscriptionId}
                  balanceKopeks={purchaseOptions?.balance_kopeks}
                  onCheckoutRequired={handleCheckoutRequired}
                  onBack={() => {
                    setShowTariffPurchase(false);
                    setSelectedTariff(null);
                  }}
                />
              )
            )}
          </div>
        )}

      {/* Purchase/Extend Section - Classic Mode */}
      {!availability &&
        legacyAllowed &&
        !deviceFirstCheckoutId &&
        classicOptions &&
        classicOptions.periods.length > 0 && (
          <ClassicPurchaseWizard
            classicOptions={classicOptions}
            subscription={subscription}
            subscriptionId={subscriptionId}
          />
        )}

      {/* No options available fallback */}
      {!availability &&
        legacyAllowed &&
        !deviceFirstCheckoutId &&
        purchaseOptions &&
        !optionsLoading &&
        !(isTariffsMode && tariffs.length > 0) &&
        !(classicOptions && classicOptions.periods.length > 0) && (
          <div
            className="rounded-3xl p-6 text-center"
            style={{
              background: g.cardBg,
              border: `1px solid ${g.cardBorder}`,
            }}
          >
            <p className="mb-4 text-dark-300">
              {t('subscription.noOptionsAvailable', 'Нет доступных вариантов подписки')}
            </p>
            <button
              onClick={retryCheckout}
              className="rounded-xl bg-accent-500 px-6 py-2 text-sm font-medium text-white transition-colors hover:bg-accent-600"
            >
              {t('common.retry')}
            </button>
          </div>
        )}
    </div>
  );
}
