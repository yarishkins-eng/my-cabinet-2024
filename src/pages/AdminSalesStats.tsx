import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { keepPreviousData, useIsFetching, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router';

import type { SalesPeopleKind, SalesPeriodName, SalesPeriodParams } from '../api/adminSalesStats';
import { salesStatsApi } from '../api/adminSalesStats';
import { AdminBackButton } from '../components/admin/AdminBackButton';
import { RefreshIcon } from '../components/icons';
import { PaymentHealthTab, PeriodSelector } from '../components/sales-stats';
import {
  AdsCard,
  MoneyBlock,
  NowStrip,
  TrialBlock,
} from '../components/sales-stats/SalesOverviewSections';
import {
  LOADING,
  formatMskRange,
  formatMskTime,
  useLocaleTag,
} from '../components/sales-stats/salesFormat';
import { SALES_STATS } from '../constants/salesStats';
import { usePermissionStore } from '../store/permissions';

const PERIODS: SalesPeriodName[] = [
  'yesterday',
  'this_month',
  'last_month',
  '7d',
  '30d',
  '90d',
  'all',
  'custom',
];

/** Период и открытый список живут в адресе: «Назад» из карточки клиента возвращает туда же (ревью L3-9).
 * Замена, а не новая запись истории — иначе «Назад» Телеграма листал бы периоды (W2-12). */
function useSalesState() {
  const [searchParams, setSearchParams] = useSearchParams();
  const raw = searchParams.get('period') as SalesPeriodName | null;
  const period: SalesPeriodName = raw && PERIODS.includes(raw) ? raw : 'this_month';
  const params: SalesPeriodParams =
    period === 'custom'
      ? {
          period,
          start_date: searchParams.get('from') || undefined,
          end_date: searchParams.get('to') || undefined,
        }
      : { period };
  const open = searchParams.get('open');
  const openKind: SalesPeopleKind | null =
    open === 'not_renewed' || open === 'ending_soon' ? open : null;

  const update = (next: { params?: SalesPeriodParams; openKind?: SalesPeopleKind | null }) => {
    const nextParams = next.params ?? params;
    const nextOpen = next.openKind === undefined ? openKind : next.openKind;
    const query = new URLSearchParams({ period: nextParams.period });
    if (nextParams.period === 'custom') {
      if (nextParams.start_date) query.set('from', nextParams.start_date);
      if (nextParams.end_date) query.set('to', nextParams.end_date);
    }
    if (nextOpen) query.set('open', nextOpen);
    setSearchParams(query, { replace: true });
  };
  return { params, openKind, update };
}

export default function AdminSalesStats() {
  const { t } = useTranslation();
  const locale = useLocaleTag();
  const queryClient = useQueryClient();
  const canSeePeople = usePermissionStore((state) => state.hasAllPermissions('users:read'));
  const canSeeAds = usePermissionStore((state) => state.hasAllPermissions('campaigns:stats'));
  const canOpenCampaigns = usePermissionStore((state) => state.hasAllPermissions('campaigns:read'));
  const { params, openKind, update } = useSalesState();
  const isValid = params.period !== 'custom' || Boolean(params.start_date && params.end_date);
  const queryParams = useMemo(() => params, [params.period, params.start_date, params.end_date]); // eslint-disable-line react-hooks/exhaustive-deps

  const overviewQuery = useQuery({
    queryKey: ['sales-stats', 'overview', queryParams],
    queryFn: () => salesStatsApi.getOverview(queryParams),
    staleTime: SALES_STATS.STALE_TIME,
    enabled: isValid,
    placeholderData: keepPreviousData,
  });
  const adsQuery = useQuery({
    queryKey: ['sales-stats', 'ads'],
    queryFn: () => salesStatsApi.getAds(),
    staleTime: SALES_STATS.STALE_TIME,
    enabled: canSeeAds,
  });
  const refreshing = useIsFetching({ queryKey: ['sales-stats'] }) > 0;

  // при ошибке — прочерки, а не нули; при смене периода старые числа приглушены, пока грузятся новые (L3-10)
  const overview = overviewQuery.isError ? undefined : overviewQuery.data;
  // «Свой» без дат: чисел периода нет вовсе — ни старых, ни нулей; «Сейчас» от периода не зависит (ревью C4-1)
  const periodOverview = isValid ? overview : undefined;
  const loading = overviewQuery.isLoading;
  const stale = overviewQuery.isPlaceholderData && overviewQuery.isFetching;
  const toggle = (kind: SalesPeopleKind) => update({ openKind: openKind === kind ? null : kind });

  // подпись окна — только у чисел ЭТОГО периода: у подставленных старых она сказала бы неправду про кнопку
  const windowLabel = !overview
    ? null
    : overviewQuery.isPlaceholderData
      ? LOADING
      : params.period === 'all'
        ? t('admin.salesStats.overview.windowAll', {
            time: formatMskTime(overview.generated_at, locale),
          })
        : t('admin.salesStats.overview.window', {
            range: formatMskRange(
              overview.window.start,
              overview.window.end,
              locale,
              overview.generated_at,
            ),
            time: formatMskTime(overview.generated_at, locale),
          });

  return (
    <div className="animate-fade-in space-y-5 overflow-hidden">
      <div className="flex items-center gap-3">
        <AdminBackButton />
        <div className="min-w-0 flex-1">
          <h1 className="text-xl font-bold text-dark-100 sm:text-2xl">
            {t('admin.salesStats.title')}
          </h1>
          <p className="text-sm text-dark-400">{t('admin.salesStats.subtitle')}</p>
        </div>
        {/* обновляет всё на экране — и открытый список, и «Оплаты» (ревью C1-5, C4-7) */}
        <button
          type="button"
          onClick={() => queryClient.invalidateQueries({ queryKey: ['sales-stats'] })}
          disabled={refreshing}
          aria-label={t('admin.salesStats.overview.refresh')}
          className="flex min-h-[44px] min-w-[44px] items-center justify-center rounded-lg bg-dark-800/50 text-dark-300 disabled:opacity-60"
        >
          <RefreshIcon className={`h-5 w-5 ${refreshing ? 'animate-spin' : ''}`} />
        </button>
      </div>

      <NowStrip
        overview={overview}
        loading={loading}
        canSeePeople={canSeePeople}
        openKind={openKind}
        onToggle={toggle}
      />

      <PeriodSelector value={params} onChange={(next) => update({ params: next })} />

      {!isValid ? (
        <p className="text-sm text-warning-400">{t('admin.salesStats.overview.pickDates')}</p>
      ) : (
        windowLabel && <p className="text-xs text-dark-400">{windowLabel}</p>
      )}
      {overviewQuery.isError && (
        <div className="flex items-center justify-between gap-2 rounded-xl bg-error-500/10 px-4 py-1 text-sm text-error-400">
          {t('admin.salesStats.loadError')}
          <button
            type="button"
            onClick={() => overviewQuery.refetch()}
            className="min-h-[44px] shrink-0 px-3 text-accent-400"
          >
            {t('admin.salesStats.overview.retry')}
          </button>
        </div>
      )}

      <div className={stale ? 'space-y-5 opacity-60' : 'space-y-5'}>
        <MoneyBlock
          overview={periodOverview}
          loading={loading}
          canSeePeople={canSeePeople}
          openKind={openKind}
          onToggle={toggle}
          params={queryParams}
        />
        <TrialBlock overview={periodOverview} loading={loading} />
      </div>

      {canSeeAds && (
        <AdsCard
          ads={adsQuery.data}
          isError={adsQuery.isError}
          canOpenCampaigns={canOpenCampaigns}
        />
      )}

      {isValid && (
        <section className="space-y-2">
          <h2 className="text-sm font-medium text-dark-400">
            {t('admin.salesStats.overview.paymentsTitle')}
          </h2>
          {/* блок раньше жил на отдельной вкладке; на главном экране красные 66 % читаются как поломка кассы (R-3) */}
          <p className="text-xs text-dark-400">{t('admin.salesStats.overview.paymentsHint')}</p>
          <PaymentHealthTab params={queryParams} />
        </section>
      )}
    </div>
  );
}
