import { lazy, Suspense, useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
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
import { useScreenState, type ScreenStateInput } from '../hooks/useScreenState';
import { useTheme } from '../hooks/useTheme';
import HeroZone from '../components/home/HeroZone';
import StatusCard from '../components/home/StatusCard';
import { formatUntil, graceDays } from '../utils/format';
import OverlayBanner from '../components/home/OverlayBanner';
import { HomeSkeleton, HomeError, PanelDownNotice } from '../components/home/HomeStates';
import ConnectionLinkCard from '../components/home/ConnectionLinkCard';
import DevicesPanel from '../components/home/DevicesPanel';
import type { HomeMeta, HomeActions } from '../components/home/types';

// Шторки докупки — отдельный lazy-чанк: код шторок (+ их зависимости) НЕ попадает в
// eager-бандл «/» (§19 п.4). Грузится только при первом открытии шторки.
const HomeTopupSheets = lazy(() => import('../components/home/HomeTopupSheets'));

/**
 * Объединённый экран кабинета — ВЕРХ (Чат 3a). Под фиче-флагом `VITE_UNIFIED_HOME`;
 * по умолчанию выключен (в проде живёт старый `Dashboard`).
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
  const [trialError, setTrialError] = useState<string | null>(null);

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

  const activateTrialMutation = useMutation({
    mutationFn: () => subscriptionApi.activateTrial(),
    onSuccess: () => {
      setTrialError(null);
      queryClient.invalidateQueries({ queryKey: ['subscription'] });
      queryClient.invalidateQueries({ queryKey: ['subscriptions-list'] });
      queryClient.invalidateQueries({ queryKey: ['trial-info'] });
      queryClient.invalidateQueries({ queryKey: ['balance'] });
      queryClient.invalidateQueries({ queryKey: ['purchase-options'] });
      refreshUser();
    },
    onError: (error: { response?: { data?: { detail?: string } } }) => {
      setTrialError(error.response?.data?.detail || t('common.error'));
    },
  });

  // Свежий трафик — общий хук (тот же, что у детальной; без дубля).
  const { trafficData } = useTrafficRefresh({
    subscriptionId,
    enabled: !!subscription,
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
    onConnect: () => navigate(`/connection?sub=${subscriptionId ?? ''}`),
    onSell: () =>
      navigate(
        state.sellZone.kind === 'renew' && subscriptionId != null
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

  return (
    <div className="space-y-6">
      {/* Приветствие — БЕЗ бейджа сегмента (§16; promo-group убран) */}
      <div>
        <h1 className="text-2xl font-bold text-dark-50 sm:text-3xl">
          {t('dashboard.welcome', { name: displayName(user) })}
        </h1>
        <p className="mt-1 text-dark-400">{t('dashboard.yourSubscription')}</p>
      </div>

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
                <HeroZone state={state} actions={actions} graceDays={meta.graceDays} />
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

      {/* Нет подписки: триал (если доступен) + явная кнопка покупки — паритет */}
      {hasNoSubscription && !trialLoading && (
        <div className="space-y-3">
          {trialInfo?.is_available && (
            <TrialOfferCard
              trialInfo={trialInfo}
              balanceKopeks={balanceData?.balance_kopeks || 0}
              balanceRubles={balanceData?.balance_rubles || 0}
              activateTrialMutation={activateTrialMutation}
              trialError={trialError}
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
