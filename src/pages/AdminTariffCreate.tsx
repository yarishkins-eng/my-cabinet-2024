import { useState, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import {
  tariffsApi,
  TariffDetail,
  TariffCreateRequest,
  TariffUpdateRequest,
  PeriodPrice,
  AccessPointInfo,
  AccessPointPlanPreview,
} from '../api/tariffs';
import { AdminBackButton } from '../components/admin';
import { createNumberInputHandler, toNumber } from '../utils/inputHelpers';
import {
  CalendarIcon,
  CheckIcon,
  InfinityIcon,
  PlusIcon,
  RefreshIcon,
  SunIcon,
  TrashIcon,
} from '@/components/icons';

type TariffType = 'period' | 'daily' | null;

export default function AdminTariffCreate() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const queryClient = useQueryClient();
  const isEdit = !!id;

  // Step: null = type selection, 'period' or 'daily' = form
  const [tariffType, setTariffType] = useState<TariffType>(null);
  const isDaily = tariffType === 'daily';

  // Form state - matches bot fields
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [isActive, setIsActive] = useState(true);
  const [trafficLimitGb, setTrafficLimitGb] = useState<number | ''>(100);
  const [deviceLimit, setDeviceLimit] = useState<number | ''>(1);
  const [devicePriceKopeks, setDevicePriceKopeks] = useState<number | ''>(0);
  const [maxDeviceLimit, setMaxDeviceLimit] = useState<number | ''>(0);
  const [devicePurchaseOptions, setDevicePurchaseOptions] = useState<number[] | null>(null);
  const [devicePurchaseOptionsText, setDevicePurchaseOptionsText] = useState('');
  const [tierLevel, setTierLevel] = useState<number | ''>(1);
  const [periodPrices, setPeriodPrices] = useState<PeriodPrice[]>([]);
  const [selectedAccessPointIds, setSelectedAccessPointIds] = useState<string[]>([]);
  const [initialAccessPointIds, setInitialAccessPointIds] = useState<string[]>([]);
  const [accessPointPolicyRevision, setAccessPointPolicyRevision] = useState(0);
  const [accessPointPolicyEditable, setAccessPointPolicyEditable] = useState(!isEdit);
  const [accessPointPolicyReadOnlyReason, setAccessPointPolicyReadOnlyReason] = useState<
    string | null
  >(null);
  const [accessPointPolicyReason, setAccessPointPolicyReason] = useState(
    'Cabinet access-point policy update',
  );
  const [preservedLegacyAccessPoints, setPreservedLegacyAccessPoints] = useState<
    { id: string; title: string; flag?: string | null }[]
  >([]);
  const [accessPointPlan, setAccessPointPlan] = useState<AccessPointPlanPreview | null>(null);
  const [selectedPromoGroups, setSelectedPromoGroups] = useState<number[]>([]);
  const [dailyPriceKopeks, setDailyPriceKopeks] = useState<number | ''>(0);

  // Traffic topup
  const [trafficTopupEnabled, setTrafficTopupEnabled] = useState(false);
  const [maxTopupTrafficGb, setMaxTopupTrafficGb] = useState<number | ''>(0);
  const [trafficTopupPackages, setTrafficTopupPackages] = useState<Record<string, number>>({});

  // New traffic package for adding
  const [newPackageGb, setNewPackageGb] = useState<number | ''>(10);
  const [newPackagePrice, setNewPackagePrice] = useState<number | ''>(100);

  // Track editing state for traffic package prices
  const [editingPackagePrices, setEditingPackagePrices] = useState<Record<string, string>>({});

  // Traffic reset mode
  const [trafficResetMode, setTrafficResetMode] = useState<string | null>(null);

  // Gift visibility
  const [showInGift, setShowInGift] = useState(true);

  // New period for adding
  const [newPeriodDays, setNewPeriodDays] = useState<number | ''>(30);
  const [newPeriodPrice, setNewPeriodPrice] = useState<number | ''>(300);

  // Track editing state for period prices
  const [editingPeriodPrices, setEditingPeriodPrices] = useState<Record<number, string>>({});

  const [activeTab, setActiveTab] = useState<'basic' | 'periods' | 'servers' | 'extra'>('basic');

  const {
    data: accessPoints = [],
    isLoading: isLoadingAccessPoints,
    isError: isAccessPointsError,
  } = useQuery({
    queryKey: ['admin-access-point-catalog'],
    queryFn: () => tariffsApi.getAccessPointCatalog(),
  });

  // Fetch promo groups
  const { data: promoGroups = [] } = useQuery({
    queryKey: ['admin-tariffs-promo-groups'],
    queryFn: () => tariffsApi.getAvailablePromoGroups(),
  });

  // Fetch tariff for editing
  const { isLoading: isLoadingTariff } = useQuery({
    queryKey: ['admin-tariff', id],
    queryFn: () => tariffsApi.getTariff(Number(id)),
    enabled: isEdit,
    staleTime: 0,
    gcTime: 0,
    refetchOnMount: true,
    refetchOnWindowFocus: false,
    select: useCallback((data: TariffDetail) => {
      setTariffType(data.is_daily ? 'daily' : 'period');
      setName(data.name);
      setDescription(data.description || '');
      setIsActive(data.is_active ?? true);
      setTrafficLimitGb(data.traffic_limit_gb ?? 100);
      setDeviceLimit(data.device_limit || 1);
      setDevicePriceKopeks(data.device_price_kopeks || 0);
      setMaxDeviceLimit(data.max_device_limit || 0);
      setDevicePurchaseOptions(data.device_purchase_options);
      setDevicePurchaseOptionsText((data.device_purchase_options || []).join(', '));
      setTierLevel(data.tier_level || 1);
      setPeriodPrices(data.period_prices?.length ? data.period_prices : []);
      setSelectedPromoGroups(
        data.promo_groups?.filter((pg) => pg.is_selected).map((pg) => pg.id) || [],
      );
      setDailyPriceKopeks(data.daily_price_kopeks || 0);
      setTrafficTopupEnabled(data.traffic_topup_enabled || false);
      setMaxTopupTrafficGb(data.max_topup_traffic_gb || 0);
      setTrafficTopupPackages(data.traffic_topup_packages || {});
      setTrafficResetMode(data.traffic_reset_mode || null);
      setShowInGift(data.show_in_gift ?? true);
      return data;
    }, []),
  });

  const { refetch: refetchAccessPointPolicy } = useQuery({
    queryKey: ['admin-tariff-access-point-policy', id],
    queryFn: () => tariffsApi.getTariffAccessPointPolicy(Number(id)),
    enabled: isEdit,
    select: useCallback(
      (data: {
        editable: boolean;
        reason?: string;
        policy_revision: number;
        access_points: AccessPointInfo[];
        preserved_legacy_access_points?: { id: string; title: string; flag?: string | null }[];
      }) => {
        const selected = data.access_points
          .filter((point) => point.selected)
          .map((point) => point.id);
        setSelectedAccessPointIds(selected);
        setInitialAccessPointIds(selected);
        setAccessPointPolicyRevision(data.policy_revision);
        setAccessPointPolicyEditable(data.editable);
        setAccessPointPolicyReadOnlyReason(data.reason || null);
        setPreservedLegacyAccessPoints(data.preserved_legacy_access_points || []);
        return data;
      },
      [],
    ),
  });

  // Create mutation
  const createMutation = useMutation({
    mutationFn: async (data: TariffCreateRequest) => {
      // The backend forbids an AP policy for daily billing. Keep the second
      // client-side fence here as well: even a stale/deep-linked daily form
      // must fail before it creates an inactive no-locations draft.
      if (data.is_daily) {
        throw new Error('Access-point tariffs cannot use daily billing');
      }
      const tariff = await tariffsApi.createTariff(data);
      await tariffsApi.replaceTariffAccessPointPolicy(
        tariff.id,
        selectedAccessPointIds,
        0,
        accessPointPolicyReason,
      );
      if (isActive) await tariffsApi.updateTariff(tariff.id, { is_active: true });
      return tariff;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-tariffs'] });
      navigate('/admin/tariffs');
    },
  });

  // Update mutation
  const updateMutation = useMutation({
    mutationFn: async ({ id: tariffId, data }: { id: number; data: TariffUpdateRequest }) => {
      if (accessPointPolicyEditable && accessPointPolicyChanged) {
        await tariffsApi.replaceTariffAccessPointPolicy(
          tariffId,
          selectedAccessPointIds,
          accessPointPolicyRevision,
          accessPointPolicyReason,
        );
      }
      // A draft that is being activated first receives its audited policy;
      // the server-side activation gate then validates that exact policy.
      // Reversing this order would reject the safe one-screen transition.
      return tariffsApi.updateTariff(tariffId, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-tariffs'] });
      navigate('/admin/tariffs');
    },
  });

  const prepareAccessPointPlanMutation = useMutation({
    mutationFn: () => tariffsApi.prepareTariffAccessPointPlan(Number(id), accessPointPolicyReason),
    onSuccess: (plan) => setAccessPointPlan(plan),
  });

  const confirmAccessPointPlanMutation = useMutation({
    mutationFn: () => {
      if (!accessPointPlan) throw new Error('Access-point plan is not prepared');
      return tariffsApi.confirmTariffAccessPointPlan(
        Number(id),
        accessPointPlan.plan_id,
        accessPointPlan.plan_hash,
        accessPointPolicyReason,
      );
    },
    onSuccess: (confirmation) => {
      setAccessPointPlan((current) =>
        current ? { ...current, state: confirmation.state } : current,
      );
    },
  });

  const handleSubmit = () => {
    const data: TariffCreateRequest | TariffUpdateRequest = {
      name,
      description: description || undefined,
      // Policy is persisted by a second audited endpoint.  A fresh tariff is
      // therefore created inactive so a dropped follow-up cannot widen a
      // legacy empty-squad tariff to every server.
      is_active: isEdit ? isActive : false,
      show_in_gift: showInGift,
      traffic_limit_gb: toNumber(trafficLimitGb, 100),
      device_limit: toNumber(deviceLimit, 1),
      device_price_kopeks:
        toNumber(devicePriceKopeks) >= 0 ? toNumber(devicePriceKopeks) : undefined,
      max_device_limit: toNumber(maxDeviceLimit) > 0 ? toNumber(maxDeviceLimit) : undefined,
      device_purchase_options: isDaily ? null : devicePurchaseOptions,
      tier_level: toNumber(tierLevel, 1),
      period_prices: isDaily ? [] : periodPrices.filter((p) => p.price_kopeks >= 0),
      promo_group_ids: selectedPromoGroups.length > 0 ? selectedPromoGroups : undefined,
      traffic_topup_enabled: trafficTopupEnabled,
      traffic_topup_packages: trafficTopupPackages,
      max_topup_traffic_gb: toNumber(maxTopupTrafficGb),
      is_daily: isDaily,
      daily_price_kopeks: isDaily ? toNumber(dailyPriceKopeks) : 0,
      traffic_reset_mode: trafficResetMode,
    };

    if (isEdit) {
      updateMutation.mutate({ id: Number(id), data });
    } else {
      createMutation.mutate(data as TariffCreateRequest);
    }
  };

  const toggleAccessPoint = (accessPointId: string) => {
    setSelectedAccessPointIds((prev) =>
      prev.includes(accessPointId)
        ? prev.filter((id) => id !== accessPointId)
        : [...prev, accessPointId],
    );
  };

  const togglePromoGroup = (groupId: number) => {
    setSelectedPromoGroups((prev) =>
      prev.includes(groupId) ? prev.filter((id) => id !== groupId) : [...prev, groupId],
    );
  };

  const addPeriod = () => {
    const days = toNumber(newPeriodDays, 0);
    const price = toNumber(newPeriodPrice, 0);
    if (days > 0 && price > 0) {
      const exists = periodPrices.some((p) => p.days === days);
      if (!exists) {
        setPeriodPrices((prev) =>
          [...prev, { days, price_kopeks: price * 100 }].sort((a, b) => a.days - b.days),
        );
        setNewPeriodDays(30);
        setNewPeriodPrice(300);
      }
    }
  };

  const removePeriod = (days: number) => {
    setPeriodPrices((prev) => prev.filter((p) => p.days !== days));
  };

  const updatePeriodPrice = (days: number, priceRubles: number) => {
    setPeriodPrices((prev) =>
      prev.map((p) => (p.days === days ? { ...p, price_kopeks: priceRubles * 100 } : p)),
    );
  };

  const isLoading = createMutation.isPending || updateMutation.isPending;
  const isAccessPointCatalogReady = !isLoadingAccessPoints && !isAccessPointsError;
  const accessPointPolicyChanged =
    [...selectedAccessPointIds].sort().join('|') !== [...initialAccessPointIds].sort().join('|');
  const requiresAccessPointSelection = !isDaily && (!isEdit || accessPointPolicyEditable);
  const hasValidAccessPointSelection =
    !requiresAccessPointSelection || selectedAccessPointIds.length > 0;
  const hasValidAccessPointPolicyReason =
    !accessPointPolicyChanged || accessPointPolicyReason.trim().length >= 3;
  const saveError = createMutation.error || updateMutation.error;
  const saveErrorStatus = (saveError as { response?: { status?: number } } | null)?.response
    ?.status;
  const accessPointPlanError =
    prepareAccessPointPlanMutation.error || confirmAccessPointPlanMutation.error;

  const reloadAccessPointPolicy = () => {
    void queryClient.invalidateQueries({ queryKey: ['admin-access-point-catalog'] });
    if (isEdit) void refetchAccessPointPolicy();
  };

  // Validation like bot: name 2-50 chars, device_limit >= 1, tier_level 1-10
  const isNameValid = name.length >= 2 && name.length <= 50;
  const isDeviceLimitValid = deviceLimit !== '' && toNumber(deviceLimit) >= 1;
  const isTierLevelValid =
    tierLevel !== '' && toNumber(tierLevel) >= 1 && toNumber(tierLevel) <= 10;
  const hasTrafficPackages = !trafficTopupEnabled || Object.keys(trafficTopupPackages).length > 0;
  const deviceOptionsTokensValid =
    devicePurchaseOptions === null || /^\s*\d+\s*(,\s*\d+\s*)*$/.test(devicePurchaseOptionsText);
  const deviceOptionsValid =
    devicePurchaseOptions === null ||
    (deviceOptionsTokensValid &&
      devicePurchaseOptions.length > 0 &&
      devicePurchaseOptions.includes(toNumber(deviceLimit, 1)) &&
      devicePurchaseOptions.every(
        (value, index) =>
          value > 0 &&
          (index === 0 || value > devicePurchaseOptions[index - 1]) &&
          (toNumber(maxDeviceLimit) === 0 || value <= toNumber(maxDeviceLimit)),
      ) &&
      (!devicePurchaseOptions.some((value) => value > toNumber(deviceLimit, 1)) ||
        toNumber(devicePriceKopeks) > 0));
  const isValidPeriod =
    isNameValid &&
    isDeviceLimitValid &&
    isTierLevelValid &&
    periodPrices.length > 0 &&
    hasTrafficPackages;
  const isValidPeriodWithDevices = isValidPeriod && deviceOptionsValid;
  const isValidDaily =
    isNameValid &&
    isDeviceLimitValid &&
    isTierLevelValid &&
    toNumber(dailyPriceKopeks) > 0 &&
    hasTrafficPackages;
  const isValid =
    tariffType === 'period'
      ? isValidPeriodWithDevices
      : tariffType === 'daily'
        ? isValidDaily
        : false;

  // Collect validation errors for display
  const validationErrors: string[] = [];
  if (!isNameValid) {
    if (name.length === 0) {
      validationErrors.push('nameRequired');
    } else if (name.length < 2 || name.length > 50) {
      validationErrors.push('nameLength');
    }
  }
  if (!isDeviceLimitValid) validationErrors.push('deviceLimitRequired');
  if (!isTierLevelValid) validationErrors.push('tierLevelInvalid');
  if (tariffType === 'period' && periodPrices.length === 0) {
    validationErrors.push('periodsRequired');
  }
  if (tariffType === 'daily' && toNumber(dailyPriceKopeks) === 0) {
    validationErrors.push('dailyPriceRequired');
  }
  if (trafficTopupEnabled && Object.keys(trafficTopupPackages).length === 0) {
    validationErrors.push('trafficPackagesRequired');
  }
  if (!deviceOptionsValid) validationErrors.push('devicePurchaseOptionsInvalid');

  // Loading state
  if (isEdit && isLoadingTariff) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-accent-500 border-t-transparent" />
      </div>
    );
  }

  // Type selection step (only for creation)
  if (!isEdit && tariffType === null) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-3">
          <AdminBackButton to="/admin/tariffs" />
          <div>
            <h1 className="text-xl font-bold text-dark-100">{t('admin.tariffs.selectType')}</h1>
            <p className="text-sm text-dark-400">{t('admin.tariffs.selectTypeDesc')}</p>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <button
            onClick={() => setTariffType('period')}
            className="card group p-6 text-left transition-colors hover:border-accent-500/50"
          >
            <div className="flex items-center gap-4">
              <div className="rounded-lg bg-accent-500/20 p-3 text-accent-400 group-hover:bg-accent-500/30">
                <CalendarIcon className="h-6 w-6" />
              </div>
              <div>
                <h3 className="font-medium text-dark-100">{t('admin.tariffs.periodTariff')}</h3>
                <p className="mt-1 text-sm text-dark-400">{t('admin.tariffs.periodTariffDesc')}</p>
              </div>
            </div>
          </button>
          <button
            type="button"
            disabled
            aria-disabled="true"
            className="card cursor-not-allowed p-6 text-left opacity-60"
          >
            <div className="flex items-center gap-4">
              <div className="rounded-lg bg-warning-500/20 p-3 text-warning-400">
                <SunIcon className="h-6 w-6" />
              </div>
              <div>
                <h3 className="font-medium text-dark-100">{t('admin.tariffs.dailyTariff')}</h3>
                <p className="mt-1 text-sm text-dark-400">{t('admin.tariffs.dailyTariffDesc')}</p>
                <p className="mt-2 text-xs text-warning-300" role="status">
                  {t('admin.tariffs.accessPoints.dailyUnsupported')}
                </p>
              </div>
            </div>
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <AdminBackButton to="/admin/tariffs" />
        <div className="flex items-center gap-3">
          <div
            className={`rounded-lg p-2 ${
              isDaily ? 'bg-warning-500/20 text-warning-400' : 'bg-accent-500/20 text-accent-400'
            }`}
          >
            {isDaily ? <SunIcon className="h-6 w-6" /> : <CalendarIcon className="h-6 w-6" />}
          </div>
          <div>
            <h1 className="text-xl font-bold text-dark-100">
              {isEdit
                ? t('admin.tariffs.editTitle')
                : isDaily
                  ? t('admin.tariffs.newDailyTitle')
                  : t('admin.tariffs.newPeriodTitle')}
            </h1>
            <p className="text-sm text-dark-400">
              {isDaily ? t('admin.tariffs.dailyDeduction') : t('admin.tariffs.periodPayment')}
            </p>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div
        className="scrollbar-hide -mx-4 flex gap-2 overflow-x-auto px-4 py-1"
        style={{ WebkitOverflowScrolling: 'touch' }}
      >
        {(isDaily
          ? (['basic', 'extra'] as const)
          : (['basic', 'periods', 'servers', 'extra'] as const)
        ).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`shrink-0 whitespace-nowrap rounded-xl px-4 py-2.5 text-sm font-medium transition-all ${
              activeTab === tab
                ? isDaily
                  ? 'bg-warning-500/15 text-warning-400 ring-1 ring-warning-500/30'
                  : 'bg-accent-500/15 text-accent-400 ring-1 ring-accent-500/30'
                : 'bg-dark-800/50 text-dark-400 hover:bg-dark-700'
            }`}
          >
            {tab === 'basic' && t('admin.tariffs.tabBasic')}
            {tab === 'periods' && t('admin.tariffs.tabPeriods')}
            {tab === 'servers' && t('admin.tariffs.tabAccessPoints')}
            {tab === 'extra' && t('admin.tariffs.tabExtra')}
          </button>
        ))}
      </div>

      {/* Content */}
      {activeTab === 'basic' && (
        <div className="card space-y-4">
          {/* Name */}
          <div>
            <label htmlFor="tariff-name" className="mb-2 block text-sm font-medium text-dark-300">
              {t('admin.tariffs.nameLabel')}
              <span className="text-error-400">*</span>
            </label>
            <input
              id="tariff-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={`input ${!isNameValid && name.length > 0 ? 'border-error-500/50' : ''}`}
              placeholder={
                isDaily ? t('admin.tariffs.nameExampleDaily') : t('admin.tariffs.nameExamplePeriod')
              }
              maxLength={50}
            />
            <p className="mt-1 text-xs text-dark-500">{t('admin.tariffs.nameHint')}</p>
            {name.length > 0 && (name.length < 2 || name.length > 50) && (
              <p className="mt-1 text-xs text-error-400">
                {t('admin.tariffs.validation.nameLength')}
              </p>
            )}
          </div>

          {/* Description */}
          <div>
            <label
              htmlFor="tariff-description"
              className="mb-2 block text-sm font-medium text-dark-300"
            >
              {t('admin.tariffs.descriptionLabel')}
            </label>
            <textarea
              id="tariff-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="input min-h-[80px] resize-none"
              placeholder={t('admin.tariffs.descriptionPlaceholder')}
            />
          </div>

          {/* Daily Price (only for daily tariff) */}
          {isDaily && (
            <div className="rounded-lg border border-warning-500/30 bg-warning-500/10 p-4">
              <label
                htmlFor="tariff-daily-price"
                className="mb-2 block text-sm font-medium text-warning-400"
              >
                {t('admin.tariffs.dailyPriceLabel')}
                <span className="text-error-400">*</span>
              </label>
              <div className="flex items-center gap-2">
                <input
                  id="tariff-daily-price"
                  type="number"
                  value={dailyPriceKopeks === '' ? '' : dailyPriceKopeks / 100}
                  onChange={(e) => {
                    const val = e.target.value;
                    if (val === '') {
                      setDailyPriceKopeks('');
                    } else {
                      const num = Math.max(0, parseFloat(val) || 0) * 100;
                      setDailyPriceKopeks(num);
                    }
                  }}
                  className={`input w-32 ${dailyPriceKopeks === '' || dailyPriceKopeks === 0 ? 'border-error-500/50' : ''}`}
                  min={0}
                  step={0.1}
                  placeholder="50"
                />
                <span className="text-dark-400">{t('admin.tariffs.currencyPerDay')}</span>
              </div>
              <p className="mt-2 text-xs text-dark-500">{t('admin.tariffs.dailyDeductionDesc')}</p>
            </div>
          )}

          {/* Traffic Limit */}
          <div>
            <label
              htmlFor="tariff-traffic-limit"
              className="mb-2 block text-sm font-medium text-dark-300"
            >
              {t('admin.tariffs.trafficLimitLabel')}
            </label>
            <div className="flex items-center gap-2">
              <input
                id="tariff-traffic-limit"
                type="number"
                value={trafficLimitGb}
                onChange={createNumberInputHandler(setTrafficLimitGb, 0)}
                className="input w-32"
                min={0}
                placeholder="100"
              />
              <span className="text-dark-400">{t('admin.tariffs.gbUnit')}</span>
              {(trafficLimitGb === 0 || trafficLimitGb === '') && (
                <span className="flex items-center gap-1 text-sm text-success-500">
                  <InfinityIcon className="h-4 w-4" />
                  {t('admin.tariffs.unlimited')}
                </span>
              )}
            </div>
            <p className="mt-1 text-xs text-dark-500">{t('admin.tariffs.trafficLimitHint')}</p>
          </div>

          {/* Device Limit */}
          <div>
            <label
              htmlFor="tariff-device-limit"
              className="mb-2 block text-sm font-medium text-dark-300"
            >
              {t('admin.tariffs.deviceLimitLabel')}
              <span className="text-error-400">*</span>
            </label>
            <input
              id="tariff-device-limit"
              type="number"
              value={deviceLimit}
              onChange={createNumberInputHandler(setDeviceLimit, 1)}
              className={`input w-32 ${!isDeviceLimitValid ? 'border-error-500/50' : ''}`}
              min={1}
              placeholder="1"
            />
          </div>

          {/* Tier Level */}
          <div>
            <label
              htmlFor="tariff-tier-level"
              className="mb-2 block text-sm font-medium text-dark-300"
            >
              {t('admin.tariffs.tierLevelLabel')}
              <span className="text-error-400">*</span>
            </label>
            <input
              id="tariff-tier-level"
              type="number"
              value={tierLevel}
              onChange={createNumberInputHandler(setTierLevel, 1, 10)}
              className={`input w-32 ${!isTierLevelValid ? 'border-error-500/50' : ''}`}
              min={1}
              max={10}
              placeholder="1"
            />
            <p className="mt-1 text-xs text-dark-500">{t('admin.tariffs.tierLevelHint')}</p>
          </div>
        </div>
      )}

      {activeTab === 'periods' && !isDaily && (
        <div className="card space-y-4">
          <p className="text-sm text-dark-400">{t('admin.tariffs.periodsTabHint')}</p>

          {/* Add new period */}
          <div className="rounded-lg border border-dashed border-dark-600 bg-dark-800/50 p-4">
            <h4 className="mb-3 text-sm font-medium text-dark-300">
              {t('admin.tariffs.addPeriodTitle')}
            </h4>
            <div className="flex flex-wrap items-end gap-3">
              <div>
                <label className="mb-1 block text-xs text-dark-500">
                  {t('admin.tariffs.daysLabel')}
                </label>
                <input
                  type="number"
                  value={newPeriodDays}
                  onChange={createNumberInputHandler(setNewPeriodDays, 1)}
                  className="input w-24"
                  placeholder="30"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-dark-500">
                  {t('admin.tariffs.priceLabel')}
                </label>
                <input
                  type="number"
                  value={newPeriodPrice}
                  onChange={createNumberInputHandler(setNewPeriodPrice, 1)}
                  className="input w-28"
                  placeholder="300"
                />
              </div>
              <button
                onClick={addPeriod}
                disabled={periodPrices.some((p) => p.days === toNumber(newPeriodDays, 0))}
                className="btn-primary flex items-center gap-2"
              >
                <PlusIcon />
                {t('admin.tariffs.addButton')}
              </button>
            </div>
          </div>

          {/* Period list */}
          {periodPrices.length === 0 ? (
            <div className="py-8 text-center text-dark-500">{t('admin.tariffs.noPeriodsHint')}</div>
          ) : (
            <div className="space-y-2">
              {periodPrices.map((period) => (
                <div
                  key={period.days}
                  className="flex items-center gap-3 rounded-lg bg-dark-800 p-3"
                >
                  <div className="w-20 font-medium text-dark-300">
                    {period.days} {t('admin.tariffs.daysShort')}
                  </div>
                  <input
                    type="number"
                    value={
                      editingPeriodPrices[period.days] !== undefined
                        ? editingPeriodPrices[period.days]
                        : period.price_kopeks / 100
                    }
                    onChange={(e) => {
                      const val = e.target.value;
                      setEditingPeriodPrices((prev) => ({ ...prev, [period.days]: val }));
                      if (val !== '') {
                        const num = parseFloat(val);
                        if (!isNaN(num)) {
                          updatePeriodPrice(period.days, Math.max(0, num));
                        }
                      }
                    }}
                    onBlur={(e) => {
                      const val = e.target.value;
                      if (val === '') {
                        updatePeriodPrice(period.days, 0);
                      }
                      setEditingPeriodPrices((prev) => {
                        const copy = { ...prev };
                        delete copy[period.days];
                        return copy;
                      });
                    }}
                    className="input w-28"
                    step={1}
                    placeholder="0"
                  />
                  <span className="text-dark-400">₽</span>
                  <div className="flex-1" />
                  <button
                    onClick={() => removePeriod(period.days)}
                    className="rounded-lg p-2 text-dark-400 transition-colors hover:bg-error-500/20 hover:text-error-400"
                  >
                    <TrashIcon className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {activeTab === 'servers' && (
        <div className="space-y-4">
          <div className="card space-y-4">
            <div>
              <h4 className="text-sm font-medium text-dark-200">
                {t('admin.tariffs.accessPoints.title')}
              </h4>
              <p className="text-sm text-dark-400">{t('admin.tariffs.accessPoints.hint')}</p>
            </div>
            {!accessPointPolicyEditable && isEdit ? (
              <div className="space-y-2 rounded-lg border border-warning-500/30 bg-warning-500/10 p-3">
                <p className="text-sm text-warning-300" role="status">
                  {accessPointPolicyReadOnlyReason ===
                  'location_managed_tariff_uses_public_locations'
                    ? t('admin.tariffs.accessPoints.locationManagedReadOnly')
                    : t('admin.tariffs.accessPoints.legacyReadOnly')}
                </p>
                {preservedLegacyAccessPoints.length > 0 && (
                  <div>
                    <p className="text-xs font-medium text-dark-200">
                      {t('admin.tariffs.accessPoints.preservedLegacyTitle')}
                    </p>
                    <ul className="mt-1 flex flex-wrap gap-2 text-xs text-dark-300">
                      {preservedLegacyAccessPoints.map((accessPoint) => (
                        <li key={accessPoint.id} className="rounded bg-dark-800 px-2 py-1">
                          {accessPoint.flag ? `${accessPoint.flag} ` : ''}
                          {accessPoint.title}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            ) : null}
            {isLoadingAccessPoints ? (
              <p className="py-4 text-center text-dark-400" role="status">
                {t('admin.tariffs.accessPoints.loading')}
              </p>
            ) : isAccessPointsError ? (
              <p className="py-4 text-center text-error-400" role="alert">
                {t('admin.tariffs.accessPoints.loadError')}
              </p>
            ) : accessPoints.length === 0 ? (
              <p className="py-4 text-center text-dark-500" role="status">
                {t('admin.tariffs.accessPoints.empty')}
              </p>
            ) : (
              <div
                className="space-y-2"
                role="group"
                aria-label={t('admin.tariffs.accessPoints.ariaLabel')}
              >
                {accessPoints.map((accessPoint) => {
                  const isSelected = selectedAccessPointIds.includes(accessPoint.id);
                  const disabled =
                    isDaily ||
                    !accessPointPolicyEditable ||
                    !accessPoint.tariff_assignable ||
                    accessPoint.state !== 'verified';
                  return (
                    <label
                      key={accessPoint.id}
                      className={`flex w-full items-center gap-3 rounded-lg p-3 transition-colors ${
                        disabled
                          ? 'cursor-not-allowed bg-dark-800/50 text-dark-500'
                          : 'cursor-pointer bg-dark-800 text-dark-300 focus-within:ring-2 focus-within:ring-accent-500 hover:bg-dark-700'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={isSelected}
                        disabled={disabled}
                        onChange={() => toggleAccessPoint(accessPoint.id)}
                        className="h-4 w-4 accent-accent-500"
                      />
                      <span className="flex-1 text-sm font-medium">{accessPoint.title}</span>
                      <span className="text-xs text-dark-500">{accessPoint.state}</span>
                    </label>
                  );
                })}
              </div>
            )}
            <label className="block text-sm text-dark-300">
              {t('admin.tariffs.accessPoints.reason')}
              <input
                value={accessPointPolicyReason}
                onChange={(event) => setAccessPointPolicyReason(event.target.value)}
                minLength={3}
                className="input mt-1 w-full"
                aria-describedby="access-point-policy-note"
              />
            </label>
            <p id="access-point-policy-note" className="text-xs text-dark-500">
              {t('admin.tariffs.accessPoints.note')}
            </p>
            <div className="flex items-center justify-between gap-3 text-sm text-dark-300">
              <span>
                {t('admin.tariffs.accessPoints.selected', { count: selectedAccessPointIds.length })}
              </span>
            </div>
            {isEdit && (
              <div className="space-y-3 border-t border-dark-700 pt-3">
                <p className="text-xs text-dark-500" role="status">
                  {t('admin.tariffs.accessPoints.executionUnavailable')}
                </p>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="btn-secondary"
                    disabled={
                      accessPointPolicyReason.trim().length < 3 ||
                      prepareAccessPointPlanMutation.isPending
                    }
                    onClick={() => prepareAccessPointPlanMutation.mutate()}
                  >
                    {prepareAccessPointPlanMutation.isPending
                      ? t('admin.tariffs.accessPoints.preparingPlan')
                      : t('admin.tariffs.accessPoints.preparePlan')}
                  </button>
                  {accessPointPlan?.state === 'previewed' && (
                    <button
                      type="button"
                      className="btn-secondary"
                      disabled={
                        accessPointPolicyReason.trim().length < 3 ||
                        confirmAccessPointPlanMutation.isPending
                      }
                      onClick={() => confirmAccessPointPlanMutation.mutate()}
                    >
                      {confirmAccessPointPlanMutation.isPending
                        ? t('admin.tariffs.accessPoints.confirmingPlan')
                        : t('admin.tariffs.accessPoints.confirmPlan')}
                    </button>
                  )}
                </div>
                {accessPointPlanError && (
                  <p className="text-sm text-error-300" role="alert">
                    {t('admin.tariffs.accessPoints.planError')}
                  </p>
                )}
                {accessPointPlan && (
                  <div
                    className="space-y-2 rounded-lg border border-dark-700 bg-dark-800/60 p-3"
                    role="status"
                  >
                    <p className="text-sm font-medium text-dark-100">
                      {accessPointPlan.state === 'confirmed_execution_disabled'
                        ? t('admin.tariffs.accessPoints.planConfirmed')
                        : t('admin.tariffs.accessPoints.planPrepared')}
                    </p>
                    <p className="text-xs text-dark-400">
                      {t('admin.tariffs.accessPoints.planScope', {
                        subscriptions: accessPointPlan.affected_subscription_count,
                        identities: accessPointPlan.affected_identity_count,
                        excluded:
                          accessPointPlan.excluded_subscription_count +
                          accessPointPlan.missing_active_term_subscription_count,
                      })}
                    </p>
                    {accessPointPlan.preserved_legacy_access_points.length > 0 && (
                      <p className="text-xs text-dark-300">
                        {t('admin.tariffs.accessPoints.planPreservedLegacy')}:{' '}
                        {accessPointPlan.preserved_legacy_access_points
                          .map((point) => point.title)
                          .join(', ')}
                      </p>
                    )}
                    {accessPointPlan.target_access_points.length > 0 && (
                      <p className="text-xs text-dark-300">
                        {t('admin.tariffs.accessPoints.planTarget')}:{' '}
                        {accessPointPlan.target_access_points
                          .map((point) => point.title)
                          .join(', ')}
                      </p>
                    )}
                    {accessPointPlan.added_access_points.length > 0 && (
                      <p className="text-xs text-success-300">
                        {t('admin.tariffs.accessPoints.planAdded')}:{' '}
                        {accessPointPlan.added_access_points.map((point) => point.title).join(', ')}
                      </p>
                    )}
                    {accessPointPlan.removed_access_points.length > 0 && (
                      <p className="text-xs text-warning-300">
                        {t('admin.tariffs.accessPoints.planRemoved')}:{' '}
                        {accessPointPlan.removed_access_points
                          .map((point) => point.title)
                          .join(', ')}
                      </p>
                    )}
                    {accessPointPlan.requires_dedicated_equivalence_preparation && (
                      <p className="text-xs text-warning-300">
                        {t('admin.tariffs.accessPoints.planLegacyBlocked')}
                      </p>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {activeTab === 'extra' && (
        <div className="space-y-4">
          {/* Device addon */}
          <div className="card space-y-3">
            <h4 className="text-sm font-medium text-dark-200">
              {t('admin.tariffs.extraDeviceTitle')}
            </h4>
            <div className="flex items-center gap-3">
              <span className="w-48 text-sm text-dark-400">
                {t('admin.tariffs.devicePriceLabel')}
              </span>
              <input
                type="number"
                value={devicePriceKopeks === '' ? '' : devicePriceKopeks / 100}
                onChange={(e) => {
                  const val = e.target.value;
                  if (val === '') {
                    setDevicePriceKopeks('');
                  } else {
                    setDevicePriceKopeks(Math.max(0, parseFloat(val) || 0) * 100);
                  }
                }}
                className="input w-24"
                min={0}
                step={1}
                placeholder="0"
              />
              <span className="text-dark-400">₽</span>
            </div>
            <p className="text-xs text-dark-500">{t('admin.tariffs.devicePriceHint')}</p>
            <div className="flex items-center gap-3">
              <span className="w-48 text-sm text-dark-400">
                {t('admin.tariffs.maxDeviceLabel')}
              </span>
              <input
                type="number"
                value={maxDeviceLimit}
                onChange={createNumberInputHandler(setMaxDeviceLimit, 0)}
                className="input w-24"
                min={0}
                placeholder="0"
              />
            </div>
            <p className="text-xs text-dark-500">{t('admin.tariffs.noLimitHint')}</p>
            {!isDaily && (
              <div className="mt-4 border-t border-dark-700 pt-4">
                <div className="mb-2 flex items-center justify-between gap-4">
                  <label
                    htmlFor="device-purchase-options"
                    className="text-sm font-medium text-dark-200"
                  >
                    {t('admin.tariffs.devicePurchaseOptions')}
                  </label>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={devicePurchaseOptions !== null}
                    aria-label={t('admin.tariffs.devicePurchaseOptions')}
                    onClick={() => {
                      if (devicePurchaseOptions === null) {
                        const base = toNumber(deviceLimit, 1);
                        setDevicePurchaseOptions([base]);
                        setDevicePurchaseOptionsText(String(base));
                      } else {
                        setDevicePurchaseOptions(null);
                        setDevicePurchaseOptionsText('');
                      }
                    }}
                    className={`relative h-6 w-11 rounded-full transition-colors ${
                      devicePurchaseOptions !== null ? 'bg-accent-500' : 'bg-dark-600'
                    }`}
                  >
                    <span
                      className={`absolute top-1 h-4 w-4 rounded-full bg-white transition-transform ${
                        devicePurchaseOptions !== null ? 'left-6' : 'left-1'
                      }`}
                    />
                  </button>
                </div>
                {devicePurchaseOptions !== null && (
                  <>
                    <input
                      id="device-purchase-options"
                      type="text"
                      value={devicePurchaseOptionsText}
                      onChange={(event) => {
                        const text = event.target.value;
                        setDevicePurchaseOptionsText(text);
                        if (/^\s*\d+\s*(,\s*\d+\s*)*$/.test(text)) {
                          setDevicePurchaseOptions(
                            text.split(',').map((part) => Number(part.trim())),
                          );
                        }
                      }}
                      className={`input ${!deviceOptionsValid ? 'border-error-500/50' : ''}`}
                      placeholder="1, 3, 5"
                    />
                    <p className="mt-2 text-xs text-dark-500">
                      {t('admin.tariffs.devicePurchaseOptionsHint')}
                    </p>
                    {!deviceOptionsTokensValid && (
                      <p role="alert" className="mt-2 text-xs text-error-400">
                        {t('admin.tariffs.devicePurchaseOptionsInvalid')}
                      </p>
                    )}
                  </>
                )}
              </div>
            )}
          </div>

          {/* Traffic topup */}
          <div className="card space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-medium text-dark-200">
                {t('admin.tariffs.extraTrafficTitle')}
              </h4>
              <button
                type="button"
                onClick={() => setTrafficTopupEnabled(!trafficTopupEnabled)}
                role="switch"
                aria-checked={trafficTopupEnabled}
                aria-label={t('admin.tariffs.extraTrafficTitle')}
                className={`relative h-6 w-11 rounded-full transition-colors ${
                  trafficTopupEnabled ? 'bg-accent-500' : 'bg-dark-600'
                }`}
              >
                <span
                  className={`absolute top-1 h-4 w-4 rounded-full bg-white transition-transform ${
                    trafficTopupEnabled ? 'left-6' : 'left-1'
                  }`}
                />
              </button>
            </div>
            {trafficTopupEnabled && (
              <>
                <div className="flex items-center gap-3">
                  <span className="w-32 text-sm text-dark-400">
                    {t('admin.tariffs.trafficMaxLimitLabel')}
                  </span>
                  <input
                    type="number"
                    value={maxTopupTrafficGb}
                    onChange={createNumberInputHandler(setMaxTopupTrafficGb, 0)}
                    className="input w-24"
                    min={0}
                    placeholder="0"
                  />
                  <span className="text-dark-400">{t('admin.tariffs.gbUnit')}</span>
                </div>
                {/* Add new package */}
                <div className="rounded-lg border border-dashed border-dark-600 bg-dark-800/50 p-3">
                  <h5 className="mb-2 text-xs font-medium text-dark-400">
                    {t('admin.tariffs.addPackageTitle')}
                  </h5>
                  <div className="flex flex-wrap items-end gap-2">
                    <div>
                      <label className="mb-1 block text-xs text-dark-500">
                        {t('admin.tariffs.gbUnit')}
                      </label>
                      <input
                        type="number"
                        value={newPackageGb}
                        onChange={createNumberInputHandler(setNewPackageGb, 1)}
                        className="input w-20"
                        placeholder="10"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs text-dark-500">
                        {t('admin.tariffs.priceLabel')}
                      </label>
                      <input
                        type="number"
                        value={newPackagePrice}
                        onChange={createNumberInputHandler(setNewPackagePrice, 1)}
                        className="input w-24"
                        placeholder="100"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        const gb = toNumber(newPackageGb, 0);
                        const price = toNumber(newPackagePrice, 0);
                        if (gb > 0 && price >= 0 && !trafficTopupPackages[String(gb)]) {
                          setTrafficTopupPackages((prev) => ({
                            ...prev,
                            [String(gb)]: price * 100,
                          }));
                          setNewPackageGb(10);
                          setNewPackagePrice(100);
                        }
                      }}
                      disabled={
                        newPackageGb === '' ||
                        newPackagePrice === '' ||
                        !!trafficTopupPackages[String(newPackageGb)]
                      }
                      className="btn-primary flex items-center gap-1 px-3 py-2 text-sm"
                    >
                      <PlusIcon />
                      {t('admin.tariffs.addButton')}
                    </button>
                  </div>
                </div>

                {/* Package list */}
                <div>
                  <span className="text-sm text-dark-400">
                    {t('admin.tariffs.trafficPackagesLabel')}
                  </span>
                  {Object.keys(trafficTopupPackages).length === 0 ? (
                    <div className="mt-2 py-4 text-center text-sm text-dark-500">
                      {t('admin.tariffs.noPackagesHint')}
                    </div>
                  ) : (
                    <div className="mt-2 space-y-2">
                      {Object.entries(trafficTopupPackages)
                        .sort(([a], [b]) => Number(a) - Number(b))
                        .map(([gb, priceKopeks]) => (
                          <div
                            key={gb}
                            className="flex items-center gap-2 rounded-lg bg-dark-800 p-2"
                          >
                            <span className="w-16 text-sm font-medium text-dark-300">
                              {gb} {t('admin.tariffs.gbPackageUnit')}
                            </span>
                            <input
                              type="number"
                              value={
                                editingPackagePrices[gb] !== undefined
                                  ? editingPackagePrices[gb]
                                  : priceKopeks / 100
                              }
                              onChange={(e) => {
                                const val = e.target.value;
                                setEditingPackagePrices((prev) => ({ ...prev, [gb]: val }));
                                if (val !== '') {
                                  const num = parseFloat(val);
                                  if (!isNaN(num)) {
                                    setTrafficTopupPackages((prev) => ({
                                      ...prev,
                                      [gb]: Math.max(0, num) * 100,
                                    }));
                                  }
                                }
                              }}
                              onBlur={(e) => {
                                const val = e.target.value;
                                if (val === '') {
                                  setTrafficTopupPackages((prev) => ({
                                    ...prev,
                                    [gb]: 0,
                                  }));
                                }
                                setEditingPackagePrices((prev) => {
                                  const copy = { ...prev };
                                  delete copy[gb];
                                  return copy;
                                });
                              }}
                              className="input w-24"
                              step={1}
                              placeholder="0"
                            />
                            <span className="text-xs text-dark-400">₽</span>
                            <div className="flex-1" />
                            <button
                              type="button"
                              onClick={() => {
                                setTrafficTopupPackages((prev) => {
                                  const copy = { ...prev };
                                  delete copy[gb];
                                  return copy;
                                });
                              }}
                              className="rounded-lg p-2 text-dark-400 transition-colors hover:bg-error-500/20 hover:text-error-400"
                            >
                              <TrashIcon className="h-4 w-4" />
                            </button>
                          </div>
                        ))}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>

          {/* Traffic reset mode */}
          <div className="card space-y-3">
            <h4 className="text-sm font-medium text-dark-200">
              {t('admin.tariffs.trafficResetModeTitle')}
            </h4>
            <p className="text-xs text-dark-500">{t('admin.tariffs.trafficResetModeDesc')}</p>
            <div className="grid grid-cols-2 gap-2">
              {[
                { value: null, labelKey: 'admin.tariffs.resetModeGlobal', emoji: '🌐' },
                { value: 'DAY', labelKey: 'admin.tariffs.resetModeDaily', emoji: '📅' },
                { value: 'WEEK', labelKey: 'admin.tariffs.resetModeWeekly', emoji: '📆' },
                { value: 'MONTH', labelKey: 'admin.tariffs.resetModeMonthly', emoji: '🗓️' },
                {
                  value: 'MONTH_ROLLING',
                  labelKey: 'admin.tariffs.resetModeMonthRolling',
                  emoji: '🔄',
                },
                { value: 'NO_RESET', labelKey: 'admin.tariffs.resetModeNever', emoji: '🚫' },
              ].map((option) => (
                <button
                  key={option.value || 'global'}
                  type="button"
                  onClick={() => setTrafficResetMode(option.value)}
                  className={`rounded-lg p-3 text-left text-sm transition-colors ${
                    trafficResetMode === option.value
                      ? isDaily
                        ? 'bg-warning-500/20 text-warning-300 ring-1 ring-warning-500/30'
                        : 'bg-accent-500/20 text-accent-300 ring-1 ring-accent-500/30'
                      : 'bg-dark-800 text-dark-300 hover:bg-dark-700'
                  }`}
                >
                  {option.emoji} {t(option.labelKey)}
                </button>
              ))}
            </div>
          </div>

          {/* Promo Groups */}
          <div className="card space-y-4">
            <h4 className="text-sm font-medium text-dark-200">
              {t('admin.tariffs.promoGroupsTitle')}
            </h4>
            <p className="text-sm text-dark-400">{t('admin.tariffs.promoGroupsHint')}</p>
            {promoGroups.length === 0 ? (
              <p className="py-4 text-center text-dark-500">{t('admin.tariffs.noPromoGroups')}</p>
            ) : (
              <div className="space-y-2">
                {promoGroups.map((group) => {
                  const isSelected = selectedPromoGroups.includes(group.id);
                  return (
                    <button
                      key={group.id}
                      type="button"
                      onClick={() => togglePromoGroup(group.id)}
                      className={`flex w-full items-center gap-3 rounded-lg p-3 text-left transition-colors ${
                        isSelected
                          ? isDaily
                            ? 'bg-warning-500/20 text-warning-300'
                            : 'bg-accent-500/20 text-accent-300'
                          : 'bg-dark-800 text-dark-300 hover:bg-dark-700'
                      }`}
                    >
                      <div
                        className={`flex h-5 w-5 items-center justify-center rounded ${
                          isSelected
                            ? isDaily
                              ? 'bg-warning-500 text-white'
                              : 'bg-accent-500 text-white'
                            : 'bg-dark-600'
                        }`}
                      >
                        {isSelected && <CheckIcon />}
                      </div>
                      <span className="min-w-0 flex-1 truncate text-sm font-medium">
                        {group.name}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Tariff status */}
          <div className="card space-y-3">
            <h4 className="text-sm font-medium text-dark-200">{t('admin.tariffs.statusTitle')}</h4>
            {/* Active toggle */}
            <div className="flex items-center justify-between rounded-lg bg-dark-800 p-3">
              <div>
                <span className="text-sm font-medium text-dark-200">
                  {t('admin.tariffs.isActiveLabel')}
                </span>
                <p className="text-xs text-dark-500">{t('admin.tariffs.isActiveHint')}</p>
              </div>
              <button
                type="button"
                onClick={() => setIsActive(!isActive)}
                role="switch"
                aria-checked={isActive}
                aria-label={t('admin.tariffs.isActiveLabel')}
                className={`relative h-6 w-11 rounded-full transition-colors ${
                  isActive ? 'bg-success-500' : 'bg-dark-600'
                }`}
              >
                <span
                  className={`absolute top-1 h-4 w-4 rounded-full bg-white transition-transform ${
                    isActive ? 'left-6' : 'left-1'
                  }`}
                />
              </button>
            </div>
            {/* Show in gift toggle */}
            <div className="flex items-center justify-between rounded-lg bg-dark-800 p-3">
              <div>
                <span className="text-sm font-medium text-dark-200">
                  {t('admin.tariffs.showInGiftLabel')}
                </span>
                <p className="text-xs text-dark-500">{t('admin.tariffs.showInGiftHint')}</p>
              </div>
              <button
                type="button"
                onClick={() => setShowInGift(!showInGift)}
                role="switch"
                aria-checked={showInGift}
                aria-label={t('admin.tariffs.showInGiftLabel')}
                className={`relative h-6 w-11 rounded-full transition-colors ${
                  showInGift ? 'bg-accent-500' : 'bg-dark-600'
                }`}
              >
                <span
                  className={`absolute top-1 h-4 w-4 rounded-full bg-white transition-transform ${
                    showInGift ? 'left-6' : 'left-1'
                  }`}
                />
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Footer */}
      <div className="card space-y-3">
        {!isAccessPointCatalogReady && (
          <p className="text-sm text-error-400" role={isAccessPointsError ? 'alert' : 'status'}>
            {isLoadingAccessPoints
              ? t('admin.tariffs.accessPoints.catalogLoadingSaveBlocked')
              : t('admin.tariffs.accessPoints.catalogErrorSaveBlocked')}
          </p>
        )}
        {saveError && (
          <div className="rounded-lg border border-error-500/30 bg-error-500/10 p-3" role="alert">
            <p className="text-sm text-error-300">
              {saveErrorStatus === 409
                ? t('admin.tariffs.accessPoints.stalePolicyError')
                : t('admin.tariffs.accessPoints.saveError')}
            </p>
            {saveErrorStatus === 409 && (
              <button
                type="button"
                className="btn-secondary mt-2"
                onClick={reloadAccessPointPolicy}
              >
                {t('admin.tariffs.accessPoints.reloadPolicy')}
              </button>
            )}
          </div>
        )}
        {validationErrors.length > 0 && (
          <div className="rounded-lg border border-error-500/30 bg-error-500/10 p-3">
            <p className="mb-1 text-sm font-medium text-error-400">
              {t('admin.tariffs.cannotSave')}
            </p>
            <ul className="list-inside list-disc space-y-1 text-xs text-error-300">
              {validationErrors.map((error) => (
                <li key={error}>{t(`admin.tariffs.validation.${error}`)}</li>
              ))}
            </ul>
          </div>
        )}
        <div className="flex justify-end">
          <button
            onClick={handleSubmit}
            disabled={
              !isValid ||
              isLoading ||
              !isAccessPointCatalogReady ||
              !hasValidAccessPointSelection ||
              !hasValidAccessPointPolicyReason
            }
            className="btn-primary flex items-center gap-2"
          >
            {isLoading && <RefreshIcon spinning />}
            {isLoading ? t('admin.tariffs.savingButton') : t('admin.tariffs.saveButton')}
          </button>
        </div>
      </div>
    </div>
  );
}
