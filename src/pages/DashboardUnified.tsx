import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useAuthStore } from '../store/auth';
import { displayName } from '../utils/displayName';
import { subscriptionApi } from '../api/subscription';
import { balanceApi } from '../api/balance';
import TrialOfferCard from '../components/dashboard/TrialOfferCard';
import SubscriptionListCard from '../components/subscription/SubscriptionListCard';
import { API } from '../config/constants';
import { useTrafficRefresh } from '../hooks/useTrafficRefresh';
import { usePullToRefresh } from '../hooks/usePullToRefresh';
import { useScreenState, type ScreenStateInput } from '../hooks/useScreenState';
import { useTheme } from '../hooks/useTheme';
import { useCurrency } from '../hooks/useCurrency';
import { useHaptic } from '../platform';
import HeroZone from '../components/home/HeroZone';
import StatusCard from '../components/home/StatusCard';
import { formatUntil, graceDays } from '../utils/format';
import OverlayBanner from '../components/home/OverlayBanner';
import { HomeSkeleton, HomeError, PanelDownNotice } from '../components/home/HomeStates';
import ConnectionLinkCard from '../components/home/ConnectionLinkCard';
import DevicesPanel from '../components/home/DevicesPanel';
import type { HomeMeta, HomeActions } from '../components/home/types';
import DeviceHintOverlay from '../components/home/DeviceHintOverlay';
import { getDeviceHintSeen, setDeviceHintSeen } from '../utils/deviceHintTracking';
import { isDeviceHintEligible } from '../utils/deviceHintEligibility';
import { useSuccessNotification } from '../store/successNotification';
import { deviceFirstApi } from '../api/deviceFirst';
import {
  deviceFirstRecoveryVariant,
  isMoneyInFlightRecovery,
  shouldHideRecoveryCard,
} from '../components/home/deviceFirstRecovery';

// Шторки докупки — отдельный lazy-чанк: код шторок (+ их зависимости) НЕ попадает в
// eager-бандл «/» (§19 п.4). Грузится только при первом открытии шторки.
const HomeTopupSheets = lazy(() => import('../components/home/HomeTopupSheets'));

/**
 * Объединённый экран кабинета (редизайн «Главная + Подписка», Чат 3). С 24.06.2026 —
 * единственный экран на «/» (go-live; флаг-рубильник убран, старый `Dashboard` припаркован).
 *
 * Здесь: приветствие (БЕЗ бейджа сегмента) → баннеры/статус-строки (`OverlayBanner`) →
 * зона действия (`HeroZone`) → карточка статуса (`StatusCard`). Всё рисуется по решению
 * `useScreenState` (Чат 2). НИЗ экрана (ссылка, устройства, шторки, StatsGrid) — Чат 3b;
 * вкладка/роуты/аналитика/WS — Чат 4.
 *
 * 🔴 Data-слой намеренно повторяет `Dashboard` (Чат 2): id-ключи кэша
 * (`['subscription', id]`/`['devices', id]`), bootstrap под голым ключом ради id,
 * `useTrafficRefresh`. Не ломать — иначе вернётся рассинхрон со шторками/деталью.
 */
export default function DashboardUnified() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const user = useAuthStore((state) => state.user);
  const refreshUser = useAuthStore((state) => state.refreshUser);
  const queryClient = useQueryClient();
  const { isDark } = useTheme();
  const { formatAmount, currencySymbol } = useCurrency();
  const haptic = useHaptic();
  const [showDeviceHint, setShowDeviceHint] = useState(false);
  const connectButtonRef = useRef<HTMLButtonElement>(null);
  const successModalOpen = useSuccessNotification((state) => state.isOpen);
  // Реф-флаг: предотвращает повторный запуск таймера при ре-рендерах
  const deviceHintTriggered = useRef(false);

  // Состояние шторок докупки (открытость + выбор) — живёт на странице, чтобы hero-кнопки
  // могли их открыть. Сами шторки + cross-sheet-reset — в lazy HomeTopupSheets.
  const [showDeviceTopup, setShowDeviceTopup] = useState(false);
  const [showTrafficTopup, setShowTrafficTopup] = useState(false);
  const [devicesToAdd, setDevicesToAdd] = useState(1);
  const [selectedTrafficPackage, setSelectedTrafficPackage] = useState<number | null>(null);

  useEffect(() => {
    refreshUser();
  }, [refreshUser]);

  const { data: balanceData } = useQuery({
    queryKey: ['balance'],
    queryFn: balanceApi.getBalance,
    staleTime: API.BALANCE_STALE_TIME_MS,
    refetchOnMount: 'always',
  });

  // One owned server-side checkout is always resumable from Home.  A 404 is
  // simply the normal no-checkout state, never a reason to create a duplicate.
  const { data: openDeviceFirstCheckout } = useQuery({
    queryKey: ['device-first-open-checkout'],
    queryFn: deviceFirstApi.getOpen,
    retry: false,
    staleTime: 0,
  });
  // A direct ``ready`` checkout is historical completion, not a recovery
  // action. Error/operator terminal states remain visible and route only to
  // their owned checkout, so a post-paid hold cannot be bypassed by Home.
  const deviceFirstRecovery =
    openDeviceFirstCheckout &&
    !(
      openDeviceFirstCheckout.settlement_mode === 'direct_purchase_v2' &&
      openDeviceFirstCheckout.ui_state === 'ready'
    )
      ? openDeviceFirstCheckout
      : null;
  const recoveryVariant = deviceFirstRecovery
    ? deviceFirstRecoveryVariant(deviceFirstRecovery.ui_state)
    : null;

  // Multi-tariff: список подписок (управление через /subscriptions).
  const { data: multiSubData } = useQuery({
    queryKey: ['subscriptions-list'],
    queryFn: () => subscriptionApi.getSubscriptions(),
    staleTime: 60_000,
  });
  const isMultiTariff = multiSubData?.multi_tariff_enabled ?? false;

  // КОРЕНЬ (§19): роут «/» без параметра — id узнаём из ОТВЕТА bootstrap.
  const {
    data: bootstrapResponse,
    isLoading: subLoading,
    isError: subError,
    refetch: refetchBootstrap,
  } = useQuery({
    queryKey: ['subscription'],
    queryFn: () => subscriptionApi.getSubscription(),
    retry: false,
    staleTime: API.BALANCE_STALE_TIME_MS,
    refetchOnMount: 'always',
    enabled: !isMultiTariff,
  });

  const subscriptionId = bootstrapResponse?.subscription?.id;

  // Каноническая подписка под id-ключом (тем же, что у шторок/детали/WS/refreshTraffic).
  const { data: subscriptionResponse } = useQuery({
    queryKey: ['subscription', subscriptionId],
    queryFn: () => subscriptionApi.getSubscription(subscriptionId),
    retry: false,
    staleTime: API.BALANCE_STALE_TIME_MS,
    enabled: !isMultiTariff && subscriptionId != null,
    initialData: subscriptionId != null ? bootstrapResponse : undefined,
    initialDataUpdatedAt: () => queryClient.getQueryState(['subscription'])?.dataUpdatedAt,
  });

  const subscription =
    subscriptionResponse?.subscription ?? bootstrapResponse?.subscription ?? null;

  const { data: trialInfo, isLoading: trialLoading } = useQuery({
    queryKey: ['trial-info'],
    queryFn: () => subscriptionApi.getTrialInfo(),
    enabled: !subscription && !subLoading,
  });

  const { data: devicesData, isLoading: devicesLoading } = useQuery({
    queryKey: ['devices', subscriptionId],
    queryFn: () => subscriptionApi.getDevices(subscriptionId),
    enabled: !!subscription && !isMultiTariff && subscriptionId != null,
    staleTime: API.BALANCE_STALE_TIME_MS,
  });

  // Свежий трафик — общий хук (тот же, что у детальной; без дубля).
  const { trafficData, refreshTrafficMutation, trafficRefreshCooldown } = useTrafficRefresh({
    subscriptionId,
    enabled: !!subscription,
  });

  // Pull-to-refresh: «потянуть вниз» обновляет экран целиком (вместо отдельной кнопки трафика).
  // Трафик бьёт по VPN-панели и имеет остывание — если оно идёт, панель повторно НЕ дёргаем,
  // только перечитываем кэш (подписка/устройства/баланс). Жест выключаем при открытой шторке.
  const handlePullRefresh = async () => {
    haptic.impact('light');
    const tasks: Array<Promise<unknown>> = [
      queryClient.invalidateQueries({ queryKey: ['subscription'] }),
      queryClient.invalidateQueries({ queryKey: ['subscriptions-list'] }),
      queryClient.invalidateQueries({ queryKey: ['balance'] }),
    ];
    if (subscriptionId != null) {
      tasks.push(queryClient.invalidateQueries({ queryKey: ['subscription', subscriptionId] }));
      tasks.push(queryClient.invalidateQueries({ queryKey: ['devices', subscriptionId] }));
      tasks.push(queryClient.invalidateQueries({ queryKey: ['purchase-options', subscriptionId] }));
    }
    if (subscription && trafficRefreshCooldown <= 0) {
      tasks.push(refreshTrafficMutation.mutateAsync().catch(() => undefined));
    }
    refreshUser();
    await Promise.all(tasks);
  };

  const { pullDistance, refreshing } = usePullToRefresh({
    onRefresh: handlePullRefresh,
    disabled: subLoading || showDeviceTopup || showTrafficTopup,
  });

  // ── Собираем вход «мозга экрана» (дефолты безопасны, даже если поле не пришло) ──
  const screenInput: ScreenStateInput = {
    subscription, // структурно совместима с SubscriptionLike (лишние поля игнорируются)
    connectedDevices: devicesData?.total ?? 0,
    panelOk: devicesData?.panel_ok ?? true,
    purchasesRestricted: subscription?.restriction_subscription ?? false,
    canTopupDevice: subscription?.can_topup_devices ?? false,
    canTopupTraffic: subscription?.can_topup_traffic ?? false,
    inGrace: subscription?.in_grace ?? false, // серверный in_grace (Чат 5)
    trafficOverride: trafficData
      ? {
          usedGb: trafficData.traffic_used_gb,
          isUnlimited: trafficData.is_unlimited,
        }
      : null,
    blocked: false, // уровень 0 рисует глобальный BlockingOverlay, не наш экран
  };
  const state = useScreenState(screenInput);

  // Подсказка «подключи устройство» — показываем один раз при T1/P1 (первое открытие с 0 устройств).
  // P7 намеренно исключён: хотя «Подключить» там горит, контекстом управляет скорое продление.
  useEffect(() => {
    if (subLoading || devicesLoading || !subscription || subscriptionId == null) return;
    if (deviceHintTriggered.current) return;
    if (
      !isDeviceHintEligible({
        hasSubscription: true,
        hasSubscriptionId: true,
        devicesLoaded: devicesData != null,
        deviceZoneKind: state.deviceZone.kind,
        screenCode: state.code,
        hasBeenSeen: getDeviceHintSeen(subscriptionId),
        successModalOpen,
      })
    ) {
      return;
    }

    const timer = window.setTimeout(() => {
      if (!connectButtonRef.current) return;
      deviceHintTriggered.current = true;
      setShowDeviceHint(true);
    }, 500);
    return () => window.clearTimeout(timer);
  }, [
    subLoading,
    devicesLoading,
    subscription,
    subscriptionId,
    devicesData,
    state.deviceZone.kind,
    state.code,
    successModalOpen,
  ]);

  // Окно успеха всегда выше coachmark: прячем подсказку временно, не считая это прохождением.
  useEffect(() => {
    if (!successModalOpen || !showDeviceHint) return;
    deviceHintTriggered.current = false;
    setShowDeviceHint(false);
  }, [showDeviceHint, successModalOpen]);

  // Закрытие подсказки — осознанный выбор пользователя (×, Escape или другое действие).
  // Храним его так же, как успешный переход к подключению, чтобы не навязывать подсказку снова.
  const dismissDeviceHint = useCallback(() => {
    if (subscriptionId != null) setDeviceHintSeen(subscriptionId);
    setShowDeviceHint(false);
  }, [subscriptionId]);

  // Баланс/опции покупки — нужны шторкам, чтобы блокировать «Купить» при нуле баланса
  // (§19 п.4). Грузим заранее (когда тариф вообще допускает докупку), чтобы к моменту
  // открытия шторки данные были готовы и не было гонки «тап быстрее загрузки».
  const { data: purchaseOptions } = useQuery({
    queryKey: ['purchase-options', subscriptionId],
    queryFn: () => subscriptionApi.getPurchaseOptions(subscriptionId),
    staleTime: 0,
    enabled:
      !isMultiTariff && subscriptionId != null && (state.canTopupDevice || state.canTopupTraffic),
  });

  const meta: HomeMeta = {
    tariffName: subscription?.tariff_name ?? null,
    endDate: subscription?.end_date ?? null,
    daysLeft: subscription?.days_left ?? 0,
    hoursLeft: subscription?.hours_left ?? 0,
    isTrial: subscription?.is_trial ?? false,
    graceDays: graceDays(subscription?.grace_until ?? null, subscription?.end_date ?? null),
  };

  // ── Действия верха (3a — безопасные переходы; шторки докупки — 3b) ──
  const actions: HomeActions = {
    onConnect: () => {
      if (showDeviceHint) dismissDeviceHint();
      navigate(`/connection?sub=${subscriptionId ?? ''}`);
    },
    onSell: () =>
      navigate(
        deviceFirstRecovery
          ? `/subscription/purchase?checkout=${encodeURIComponent(deviceFirstRecovery.id)}`
          : state.sellZone.kind === 'renew' && subscriptionId != null
            ? `/subscriptions/${subscriptionId}/renew`
            : '/subscription/purchase',
      ),
    // Докупка устройств/гигабайтов — инлайн-шторки (lazy), открываются прямо на экране.
    onAddDevice: () => setShowDeviceTopup(true),
    onTopupTraffic: () => setShowTrafficTopup(true),
    onCheckPayment: () => {
      refetchBootstrap();
      if (subscriptionId != null) {
        queryClient.invalidateQueries({ queryKey: ['subscription', subscriptionId] });
      }
    },
    onSupport: () => navigate('/support'),
  };

  const hasNoSubscription = isMultiTariff
    ? multiSubData !== undefined && (multiSubData.subscriptions?.length ?? 0) === 0
    : bootstrapResponse?.has_subscription === false && !subLoading;

  const hasActivePaid = (multiSubData?.subscriptions ?? []).some(
    (s) => !s.is_trial && (s.status === 'active' || s.status === 'limited'),
  );

  // Открытый заказ без денег в полёте (витринный черновик, неоплаченный счёт) НЕ
  // подавляет блок «нет подписки»: триал — осознанный бесплатный выбор, его CTA идёт
  // через /trial, где сервер явно разрешит живой счёт. При provisioning/operator_review
  // (деньги или выдача уже в полёте) блок гасим — иначе рядом с «проверяем оплату»
  // показывался бы CTA в тупиковый экран.
  // Витринный черновик прячем, пока показан триал-оффер (и пока он грузится — иначе
  // карточка мелькает и исчезает); счёт/operator/provisioning видимы всегда.
  const moneyInFlightRecovery = isMoneyInFlightRecovery(recoveryVariant);
  const showTrialBlock = hasNoSubscription && !trialLoading && !moneyInFlightRecovery;
  const showTrialOffer = showTrialBlock && (trialInfo?.is_available ?? false);
  const showRecoveryCard =
    deviceFirstRecovery != null &&
    recoveryVariant != null &&
    !shouldHideRecoveryCard(recoveryVariant, showTrialOffer || (hasNoSubscription && trialLoading));

  return (
    <div className="space-y-6">
      {/* Pull-to-refresh: индикатор сверху — стрелка-кольцо доворачивается по мере оттягивания,
          крутится во время обновления. Жест и логику обновления даёт usePullToRefresh. */}
      {(pullDistance > 0 || refreshing) && (
        <div
          className="pointer-events-none flex items-center justify-center"
          style={{
            height: refreshing ? 32 : pullDistance,
            transition: refreshing ? 'height 0.2s ease' : undefined,
          }}
        >
          <div
            className={`h-6 w-6 rounded-full border-2 border-dark-50/15 border-t-accent-400 ${
              refreshing ? 'animate-spin' : ''
            }`}
            style={
              refreshing
                ? undefined
                : {
                    transform: `rotate(${pullDistance * 4}deg)`,
                    opacity: Math.min(1, pullDistance / 70),
                  }
            }
          />
        </div>
      )}

      {/* Приветствие — БЕЗ бейджа сегмента (§16; promo-group убран) */}
      <div>
        <h1 className="text-2xl font-bold text-dark-50 sm:text-3xl">
          {t('dashboard.welcome', { name: displayName(user) })}
        </h1>
        <p className="mt-1 text-dark-400">{t('dashboard.yourSubscription')}</p>
      </div>

      {showRecoveryCard && deviceFirstRecovery && recoveryVariant && (
        <button
          type="button"
          onClick={() =>
            navigate(
              `/subscription/purchase?checkout=${encodeURIComponent(deviceFirstRecovery.id)}`,
            )
          }
          className="w-full rounded-2xl border border-accent-400/35 bg-accent-500/10 p-4 text-left"
        >
          <div className="text-sm font-semibold text-accent-200">
            {recoveryVariant === 'operator'
              ? t('deviceFirst.paymentMismatchTitle')
              : recoveryVariant === 'processing'
                ? t('deviceFirst.processing')
                : t('deviceFirst.unfinishedOrder', 'Незавершённый заказ')}
          </div>
          <div className="mt-1 text-sm text-dark-300">
            {recoveryVariant === 'operator'
              ? t('deviceFirst.paymentMismatchText')
              : recoveryVariant === 'processing'
                ? t('deviceFirst.processingText')
                : t('deviceFirst.awaitingPaymentSummary', {
                    devices: `${deviceFirstRecovery.selected_device_limit} ${t('common.units.devices', 'устр.')}`,
                    period: `${deviceFirstRecovery.period_days} ${t('common.units.days')}`,
                    amount: `${formatAmount(deviceFirstRecovery.tariff_total_kopeks / 100)} ${currencySymbol}`,
                    action:
                      recoveryVariant === 'draft'
                        ? t('deviceFirst.draftContinue', 'продолжить оформление')
                        : t('deviceFirst.continuePayment', 'продолжить оплату'),
                  })}
          </div>
        </button>
      )}

      {/* Multi-tariff: список подписок (управление через /subscriptions) — паритет со старым экраном */}
      {isMultiTariff && multiSubData?.subscriptions && multiSubData.subscriptions.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center justify-between px-1">
            <span className="text-sm font-medium opacity-60">
              {t('dashboard.subscriptions', 'Подписки')}
            </span>
            <Link to="/subscriptions" className="text-xs text-accent-400 hover:underline">
              {t('dashboard.manageAll', 'Управление')} →
            </Link>
          </div>
          {multiSubData.subscriptions.slice(0, 3).map((sub) => (
            <SubscriptionListCard
              key={sub.id}
              subscription={sub}
              onClick={() => navigate(`/subscriptions/${sub.id}`)}
            />
          ))}
          <Link
            to="/subscription/purchase"
            className={`flex w-full items-center justify-center gap-2 rounded-2xl p-3.5 text-sm transition-colors ${
              hasActivePaid
                ? 'bg-accent-500/15 font-medium text-accent-400 hover:bg-accent-500/25'
                : 'bg-accent-500 font-semibold text-white hover:bg-accent-600'
            }`}
          >
            <span className="text-base">+</span>{' '}
            {hasActivePaid
              ? t('subscriptions.buyAnother', 'Купить ещё тариф')
              : t('subscriptions.browsePlans', 'Посмотреть тарифы и купить подписку')}
          </Link>
        </div>
      )}

      {/* Single-tariff: НОВЫЙ верх — баннеры → зона действия → карточка статуса */}
      {!isMultiTariff && (
        <>
          {subLoading ? (
            <HomeSkeleton />
          ) : subError ? (
            <HomeError onRetry={() => refetchBootstrap()} />
          ) : subscription ? (
            <>
              <div className="space-y-3">
                {state.panelDown && !state.overlay && !state.accessEnded && <PanelDownNotice />}
                <OverlayBanner
                  state={state}
                  actions={actions}
                  disabledReasonHint={subscription.disabled_reason_hint ?? null}
                  graceUntil={formatUntil(subscription.grace_until ?? null)}
                  graceDays={meta.graceDays}
                />
                <HeroZone
                  state={state}
                  actions={actions}
                  graceDays={meta.graceDays}
                  connectButtonRef={connectButtonRef}
                  connectHintVisible={showDeviceHint}
                />
                {showDeviceHint && subscriptionId != null && (
                  <DeviceHintOverlay
                    targetRef={connectButtonRef}
                    onDismiss={dismissDeviceHint}
                    onTargetUnavailable={() => {
                      setShowDeviceHint(false);
                      deviceHintTriggered.current = false;
                    }}
                  />
                )}
                {/* При перекрывающем состоянии (платёж обрабатывается / временно отключён)
                    карточку «Осталось N дн.» прячем — она путала (активна? тикают ли дни?).
                    Баннер несёт смысл. Для grace/истёкшей overlay=null → карточка остаётся. */}
                {!state.overlay && <StatusCard state={state} meta={meta} />}

                {/* Шторки докупки рисуем рядом с триггером (hero-кнопка / пилюля баннера —
                    оба сверху), чтобы открытая панель была видна без прокрутки. Lazy-чанк. */}
                {(showDeviceTopup || showTrafficTopup) && (
                  <Suspense fallback={null}>
                    <HomeTopupSheets
                      subscription={subscription}
                      subscriptionId={subscriptionId}
                      isDark={isDark}
                      purchaseOptions={purchaseOptions}
                      showDeviceTopup={showDeviceTopup}
                      showTrafficTopup={showTrafficTopup}
                      devicesToAdd={devicesToAdd}
                      onDevicesToAddChange={setDevicesToAdd}
                      selectedTrafficPackage={selectedTrafficPackage}
                      onSelectedTrafficPackageChange={setSelectedTrafficPackage}
                      onCloseDevice={() => setShowDeviceTopup(false)}
                      onCloseTraffic={() => setShowTrafficTopup(false)}
                    />
                  </Suspense>
                )}
              </div>

              {/* НИЗ экрана (ниже сгиба, §16): ссылка для подключения + «Мои устройства».
                  Прячем при перекрывающем состоянии (платёж/отключён) и когда VPN мёртв
                  (accessEnded T5/P8). В grace VPN жив → низ виден. */}
              {!state.overlay && !state.accessEnded && (
                <div className="space-y-4">
                  <ConnectionLinkCard
                    subscriptionId={subscriptionId}
                    subscriptionUrl={subscription.subscription_url}
                    visible={state.linkVisible}
                  />
                  <DevicesPanel
                    subscriptionId={subscriptionId}
                    devices={devicesData?.devices ?? []}
                    total={devicesData?.total ?? 0}
                    deviceLimit={devicesData?.device_limit ?? subscription.device_limit}
                    isLoading={devicesLoading}
                  />
                </div>
              )}

              {/* Вход в управление подпиской (single-tariff) — единственная точка к деталям
                  (автоплатёж, перевыпуск, удаление, история, суточная пауза): /subscriptions/:id.
                  Раньше туда вела отдельная вкладка «Подписка»; после объединения её роль здесь.
                  Виден всегда при наличии подписки, кроме перекрывающих состояний (платёж/отключён)
                  — в т.ч. для истёкшей (там доступны продление/история/удаление). */}
              {!state.overlay && subscriptionId != null && (
                <button
                  type="button"
                  onClick={() => navigate(`/subscriptions/${subscriptionId}`)}
                  className="flex w-full items-center justify-between rounded-2xl border border-dark-50/[0.08] bg-dark-50/[0.03] p-3.5 text-left transition-colors hover:bg-dark-50/[0.06]"
                >
                  <span className="text-sm font-medium text-dark-50/70">
                    {t('home.manageSubscription', 'Управление подпиской')}
                  </span>
                  <span className="text-dark-50/40">→</span>
                </button>
              )}
            </>
          ) : null}
        </>
      )}

      {/* Нет подписки: триал (если доступен) + явная кнопка покупки — паритет.
          Открытый заказ без денег в полёте этот блок не гасит: живой счёт сервер
          разрешает на /trial явным выбором, а витринный черновик спрятан выше,
          пока виден триал-оффер. При provisioning/operator_review блок выключен
          в moneyInFlightRecovery — там уже идёт выдача или ручной разбор. */}
      {showTrialBlock && (
        <div className="space-y-3">
          {trialInfo?.is_available && (
            <TrialOfferCard
              trialInfo={trialInfo}
              balanceKopeks={balanceData?.balance_kopeks || 0}
              balanceRubles={balanceData?.balance_rubles || 0}
            />
          )}
          <Link
            to="/subscription/purchase"
            className="flex w-full items-center justify-center gap-2 rounded-2xl bg-accent-500 p-3.5 text-sm font-semibold text-white transition-colors hover:bg-accent-600"
          >
            <span className="text-base">+</span>{' '}
            {t('subscriptions.browsePlans', 'Посмотреть тарифы и купить подписку')}
          </Link>
        </div>
      )}
    </div>
  );
}
