import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { statsApi, type NodeStatus } from '../api/admin';
import { CampaignResultsCard } from '../components/admin/CampaignResultsCard';
import { DashboardMoney } from '../components/admin/DashboardMoney';
import { DashboardReferrals } from '../components/admin/DashboardReferrals';
import { useMoney } from '../components/sales-stats/salesFormat';
import { formatUptime } from '../utils/format';

const CABINET_VERSION = __APP_VERSION__;
import { useCurrency } from '../hooks/useCurrency';
import { usePlatform } from '../platform/hooks/usePlatform';
import { usePermissionStore } from '../store/permissions';

import {
  BackIcon,
  BanknotesIcon,
  ChevronDownIcon,
  ExclamationIcon,
  PowerIcon,
  RefreshIcon,
  RestartIcon,
  ServerIcon,
  UsersIcon,
  UsersOnlineIcon,
} from '@/components/icons';

interface StatCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  icon: React.ReactNode;
  color: 'accent' | 'success' | 'warning' | 'error' | 'info';
  trend?: {
    value: number;
    label: string;
  };
}

function StatCard({ title, value, subtitle, icon, color, trend }: StatCardProps) {
  const colorClasses = {
    accent: 'bg-accent-500/20 text-accent-400',
    success: 'bg-success-500/20 text-success-400',
    warning: 'bg-warning-500/20 text-warning-400',
    error: 'bg-error-500/20 text-error-400',
    info: 'bg-info-500/20 text-info-400',
  };

  return (
    <div className="rounded-xl border border-dark-700 bg-dark-800/50 p-5 transition-colors hover:border-dark-600">
      <div className="mb-3 flex items-start justify-between">
        <div className={`rounded-lg p-2.5 ${colorClasses[color]}`}>{icon}</div>
        {trend && (
          <div
            className={`rounded-full px-2 py-1 text-xs ${trend.value >= 0 ? 'bg-success-500/20 text-success-400' : 'bg-error-500/20 text-error-400'}`}
          >
            {trend.value >= 0 ? '+' : ''}
            {trend.value}% {trend.label}
          </div>
        )}
      </div>
      <div className="mb-1 text-2xl font-bold text-dark-100">{value}</div>
      <div className="text-sm text-dark-400">{title}</div>
      {subtitle && <div className="mt-1 text-xs text-dark-500">{subtitle}</div>}
    </div>
  );
}

interface NodeCardProps {
  node: NodeStatus;
  onRestart: (uuid: string) => void;
  onToggle: (uuid: string) => void;
  isLoading: boolean;
}

function NodeCard({ node, onRestart, onToggle, isLoading }: NodeCardProps) {
  const { t } = useTranslation();

  const getStatusColor = () => {
    if (node.is_disabled) return 'bg-dark-600 text-dark-400';
    if (node.is_connected) return 'bg-success-500/20 text-success-400';
    return 'bg-error-500/20 text-error-400';
  };

  const getStatusText = () => {
    if (node.is_disabled) return t('adminDashboard.nodes.disabled');
    if (node.is_connected) return t('adminDashboard.nodes.online');
    return t('adminDashboard.nodes.offline');
  };

  const formatTraffic = (bytes?: number) => {
    if (!bytes) return '-';
    const gb = bytes / (1024 * 1024 * 1024);
    if (gb >= 1000) return `${(gb / 1000).toFixed(1)} TB`;
    return `${gb.toFixed(1)} GB`;
  };

  const hasError = node.last_status_message && !node.is_connected;

  return (
    <div
      className={`rounded-xl border bg-dark-800/50 ${node.is_disabled ? 'border-dark-700' : node.is_connected ? 'border-success-500/30' : 'border-error-500/30'} p-4 transition-colors hover:border-dark-600`}
    >
      <div className="mb-3 flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div
            className={`h-3 w-3 rounded-full ${node.is_disabled ? 'bg-dark-500' : node.is_connected ? 'animate-pulse bg-success-500' : 'bg-error-500'}`}
          />
          <div>
            <div className="font-medium text-dark-100">{node.name}</div>
            <div className="text-xs text-dark-500">{node.address}</div>
          </div>
        </div>
        <span className={`rounded-full px-2 py-1 text-xs ${getStatusColor()}`}>
          {getStatusText()}
        </span>
      </div>

      {/* Xray Version & Uptime */}
      {(node.versions?.xray || node.xray_uptime > 0) && (
        <div className="mb-3 flex items-center gap-3 text-xs">
          {node.versions?.xray && (
            <span className="rounded bg-dark-700/50 px-2 py-1 text-dark-300">
              Xray {node.versions.xray}
            </span>
          )}
          {node.xray_uptime > 0 && (
            <span className="text-dark-500">Uptime: {formatUptime(node.xray_uptime)}</span>
          )}
        </div>
      )}

      {/* Error Message */}
      {hasError && (
        <div className="mb-3 rounded-lg border border-error-500/20 bg-error-500/10 p-2">
          <div className="flex items-start gap-2">
            <ExclamationIcon className="h-4 w-4" />
            <span className="break-all text-xs text-error-400">{node.last_status_message}</span>
          </div>
        </div>
      )}

      <div className="mb-3 grid grid-cols-2 gap-3">
        <div className="rounded-lg bg-dark-900/50 p-2.5">
          <div className="mb-0.5 text-xs text-dark-500">
            {t('adminDashboard.nodes.usersOnline')}
          </div>
          <div className="text-lg font-semibold text-dark-100">{node.users_online}</div>
        </div>
        <div className="rounded-lg bg-dark-900/50 p-2.5">
          <div className="mb-0.5 text-xs text-dark-500">{t('adminDashboard.nodes.traffic')}</div>
          <div className="text-lg font-semibold text-dark-100">
            {formatTraffic(node.traffic_used_bytes)}
          </div>
        </div>
      </div>

      <div className="flex gap-2">
        <button
          onClick={() => onToggle(node.uuid)}
          disabled={isLoading}
          className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
            node.is_disabled
              ? 'bg-success-500/20 text-success-400 hover:bg-success-500/30'
              : 'bg-warning-500/20 text-warning-400 hover:bg-warning-500/30'
          } disabled:opacity-50`}
        >
          <PowerIcon className="h-4 w-4" />
          {node.is_disabled ? t('adminDashboard.nodes.enable') : t('adminDashboard.nodes.disable')}
        </button>
        <button
          onClick={() => onRestart(node.uuid)}
          disabled={isLoading || node.is_disabled}
          className="flex items-center justify-center gap-1.5 rounded-lg bg-accent-500/20 px-3 py-2 text-sm font-medium text-accent-400 transition-colors hover:bg-accent-500/30 disabled:opacity-50"
        >
          <RestartIcon className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

export default function AdminDashboard() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { formatAmount, currencySymbol } = useCurrency();
  const money = useMoney();
  const { capabilities } = usePlatform();
  const canOpenCampaignDetails = usePermissionStore((state) =>
    state.hasAllPermissions('campaigns:read', 'campaigns:stats'),
  );
  const canOpenSalesStats = usePermissionStore((state) =>
    state.hasAllPermissions('sales_stats:read'),
  );

  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [showAllNodes, setShowAllNodes] = useState(false);
  const [referrersTab, setReferrersTab] = useState<'earnings' | 'invited'>('earnings');

  // Data fetching via React Query: caching, dedupe, and auto-refetch every 30s
  // (replaces the manual setInterval + useState + console.error pattern).
  const statsQuery = useQuery({
    queryKey: ['admin-dashboard-stats'] as const,
    queryFn: () => statsApi.getDashboardStats(),
    refetchInterval: 30_000,
  });
  const stats = statsQuery.data ?? null;
  const loading = statsQuery.isLoading;
  const error = statsQuery.isError ? t('adminDashboard.loadError') : null;

  const extendedQuery = useQuery({
    queryKey: ['admin-dashboard-extended'] as const,
    queryFn: async () => {
      const [topReferrers, topCampaigns, recentPayments, sysInfo] = await Promise.all([
        statsApi.getTopReferrers(10),
        statsApi.getTopCampaigns(10),
        statsApi.getRecentPayments(20),
        statsApi.getSystemInfo(),
      ]);
      return { topReferrers, topCampaigns, recentPayments, sysInfo };
    },
    refetchInterval: 30_000,
  });
  // СП-1б: деньги на «Статистике» — отдельным запросом, раз в минуту (суммы меняются редко, экран опрашивает каждые 30 с)
  const moneyQuery = useQuery({
    queryKey: ['admin-dashboard-money'] as const,
    queryFn: () => statsApi.getDashboardMoney(),
    refetchInterval: 60_000,
  });
  // РЕФ-2: приглашения — СВОИМ запросом, а не в общем Promise.all: до выкладки бота ручки нет (404), и сбой в общей
  // пачке снял бы с экрана ещё три блока; числа меняются редко — раз в 5 минут и по кнопке «Обновить»
  const referralsQuery = useQuery({
    queryKey: ['admin-dashboard-referrals'] as const,
    queryFn: () => statsApi.getDashboardReferrals(),
    refetchInterval: 300_000,
  });
  const referrers = extendedQuery.data?.topReferrers ?? null;
  const campaigns = extendedQuery.data?.topCampaigns ?? null;
  const payments = extendedQuery.data?.recentPayments ?? null;
  // ПЛ-1: метка «первая / повторная» и строка «за что · реклама»; со старым ботом полей нет — прежние тип и способ
  type PaymentRow = NonNullable<typeof payments>['payments'][number];
  const paymentBadge = (payment: PaymentRow) => {
    if (payment.is_first == null) {
      const legacyClass =
        payment.type === 'deposit'
          ? 'bg-success-500/20 text-success-400'
          : 'bg-accent-500/20 text-accent-400';
      return { label: payment.type_display, className: legacyClass };
    }
    return payment.is_first
      ? {
          label: t('adminDashboard.recentPayments.first'),
          className: 'bg-accent-500/20 text-accent-400',
        }
      : {
          label: t('adminDashboard.recentPayments.repeat'),
          className: 'bg-success-500/20 text-success-400',
        };
  };
  const paymentContext = (payment: PaymentRow) => {
    if (payment.is_first == null) return payment.payment_method || '-';
    const parts = [payment.purpose || t('adminDashboard.recentPayments.onBalance')];
    if (payment.campaign_name) {
      parts.push(t('adminDashboard.recentPayments.campaign', { name: payment.campaign_name }));
    }
    return parts.join(' · ');
  };
  const systemInfo = extendedQuery.data?.sysInfo ?? null;

  const handleRestartNode = async (uuid: string) => {
    try {
      setActionLoading(uuid);
      await statsApi.restartNode(uuid);
      // Refresh stats after action
      setTimeout(() => statsQuery.refetch(), 2000);
    } catch (err) {
      console.error('Failed to restart node:', err);
    } finally {
      setActionLoading(null);
    }
  };

  const handleToggleNode = async (uuid: string) => {
    try {
      setActionLoading(uuid);
      await statsApi.toggleNode(uuid);
      await statsQuery.refetch();
    } catch (err) {
      console.error('Failed to toggle node:', err);
    } finally {
      setActionLoading(null);
    }
  };

  if (loading && !stats) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-accent-500 border-t-transparent" />
      </div>
    );
  }

  if (error && !stats) {
    return (
      <div className="flex h-64 flex-col items-center justify-center gap-4">
        <div className="text-error-400">{error}</div>
        <button onClick={() => statsQuery.refetch()} className="btn-primary">
          {t('common.loading')}
        </button>
      </div>
    );
  }

  return (
    <div className="animate-fade-in space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          {/* Show back button only on web, not in Telegram Mini App */}
          {!capabilities.hasBackButton && (
            <button
              onClick={() => navigate('/admin')}
              className="flex h-10 w-10 items-center justify-center rounded-xl border border-dark-700 bg-dark-800 transition-colors hover:border-dark-600"
            >
              <BackIcon />
            </button>
          )}
          <div>
            <h1 className="text-2xl font-bold text-dark-100">{t('adminDashboard.title')}</h1>
            <p className="text-dark-400">{t('adminDashboard.subtitle')}</p>
          </div>
        </div>
        <button
          onClick={() => {
            statsQuery.refetch();
            moneyQuery.refetch();
            referralsQuery.refetch();
            extendedQuery.refetch();
          }}
          disabled={loading}
          className="flex items-center gap-2 rounded-lg bg-dark-800 px-4 py-2 text-dark-300 transition-colors hover:bg-dark-700 hover:text-dark-100 disabled:opacity-50"
        >
          <RefreshIcon className="h-5 w-5" />
          {t('adminDashboard.refresh')}
        </button>
      </div>

      {/* СП-1б: деньги вернулись по решению владельца 27.09 — те же, что на экране продаж и в утреннем письме */}
      <DashboardMoney
        money={moneyQuery.data}
        loading={moneyQuery.isLoading}
        isError={moneyQuery.isError}
        people={stats?.subscriptions}
      />
      {canOpenSalesStats && (
        <button
          type="button"
          onClick={() => navigate('/admin/sales-stats')}
          className="flex min-h-[44px] w-full items-center justify-between gap-2 rounded-xl border border-dark-700 bg-dark-800/30 px-4 py-2 text-left text-sm font-medium text-accent-400 transition-colors hover:bg-dark-800/50"
        >
          {t('adminDashboard.salesLink')}
          <span aria-hidden="true">→</span>
        </button>
      )}

      {/* РЕФ-2: рефералка по месяцам — решения владельца 29.09 (под «Деньгами», после кнопки на продажи) */}
      <DashboardReferrals
        data={referralsQuery.data}
        loading={referralsQuery.isLoading}
        isError={referralsQuery.isError}
      />

      {/* Онлайн */}
      <StatCard
        title={t('adminDashboard.stats.usersOnline')}
        value={stats?.nodes.total_users_online || 0}
        icon={<UsersOnlineIcon />}
        color="success"
      />

      {/* Nodes Section */}
      <div className="rounded-xl border border-dark-700 bg-dark-800/30 p-5">
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-accent-500/20 p-2.5 text-accent-400">
              <ServerIcon />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-dark-100">
                {t('adminDashboard.nodes.title')}
              </h2>
              <p className="text-sm text-dark-400">
                {stats?.nodes.online || 0} {t('adminDashboard.nodes.online').toLowerCase()} /{' '}
                {stats?.nodes.total || 0} {t('adminDashboard.stats.total').toLowerCase()}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="flex items-center gap-1.5 text-xs text-dark-400">
              <span className="h-2 w-2 rounded-full bg-success-500"></span>
              {stats?.nodes.online || 0}
            </span>
            <span className="flex items-center gap-1.5 text-xs text-dark-400">
              <span className="h-2 w-2 rounded-full bg-error-500"></span>
              {stats?.nodes.offline || 0}
            </span>
            <span className="flex items-center gap-1.5 text-xs text-dark-400">
              <span className="h-2 w-2 rounded-full bg-dark-500"></span>
              {stats?.nodes.disabled || 0}
            </span>
          </div>
        </div>

        {stats?.nodes.nodes && stats.nodes.nodes.length > 0 ? (
          <>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
              {(showAllNodes ? stats.nodes.nodes : stats.nodes.nodes.slice(0, 3)).map((node) => (
                <NodeCard
                  key={node.uuid}
                  node={node}
                  onRestart={handleRestartNode}
                  onToggle={handleToggleNode}
                  isLoading={actionLoading === node.uuid}
                />
              ))}
            </div>
            {stats.nodes.nodes.length > 3 && (
              <button
                onClick={() => setShowAllNodes(!showAllNodes)}
                className="mt-4 flex w-full items-center justify-center gap-2 rounded-lg bg-dark-700/50 px-4 py-3 text-dark-300 transition-colors hover:bg-dark-700 hover:text-dark-100"
              >
                <span
                  className={`transform transition-transform ${showAllNodes ? 'rotate-180' : ''}`}
                >
                  <ChevronDownIcon />
                </span>
                {showAllNodes
                  ? t('adminDashboard.nodes.hide', { count: stats.nodes.nodes.length - 3 })
                  : t('adminDashboard.nodes.showMore', { count: stats.nodes.nodes.length - 3 })}
              </button>
            )}
          </>
        ) : (
          <div className="py-8 text-center text-dark-500">{t('adminDashboard.nodes.noNodes')}</div>
        )}
      </div>

      {/* СП-1 (решение владельца 27.09.2026): доход, график, подписки и тарифы с этого экрана сняты — они
          считались по старым правилам (с Team). Деньги и покупатели — на экране «Статистика продаж». */}

      {/* Extended Stats Grid */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Top Referrers */}
        {referrers && (referrers.by_earnings.length > 0 || referrers.by_invited.length > 0) && (
          <div className="rounded-xl border border-dark-700 bg-dark-800/30 p-4 sm:p-5">
            <div className="mb-4 flex items-center justify-between">
              <div className="flex items-center gap-2 sm:gap-3">
                <div className="rounded-lg bg-accent-500/20 p-2 text-accent-400 sm:p-2.5">
                  <UsersIcon />
                </div>
                <div>
                  <h2 className="text-base font-semibold text-dark-100 sm:text-lg">
                    {t('adminDashboard.topReferrers.title')}
                  </h2>
                  <p className="text-xs text-dark-400 sm:text-sm">
                    {referrers.total_referrers}{' '}
                    {t('adminDashboard.topReferrers.stats', { count: referrers.total_referrals })}
                  </p>
                </div>
              </div>
            </div>

            {/* Tabs */}
            <div className="mb-4 flex gap-2">
              <button
                onClick={() => setReferrersTab('earnings')}
                className={`rounded-lg px-2 py-1.5 text-xs font-medium transition-colors sm:px-3 sm:text-sm ${
                  referrersTab === 'earnings'
                    ? 'bg-accent-500/20 text-accent-400'
                    : 'bg-dark-700/50 text-dark-400 hover:text-dark-200'
                }`}
              >
                {t('adminDashboard.topReferrers.byEarnings')}
              </button>
              <button
                onClick={() => setReferrersTab('invited')}
                className={`rounded-lg px-2 py-1.5 text-xs font-medium transition-colors sm:px-3 sm:text-sm ${
                  referrersTab === 'invited'
                    ? 'bg-accent-500/20 text-accent-400'
                    : 'bg-dark-700/50 text-dark-400 hover:text-dark-200'
                }`}
              >
                {t('adminDashboard.topReferrers.byInvited')}
              </button>
            </div>

            <div className="space-y-2">
              {(referrersTab === 'earnings' ? referrers.by_earnings : referrers.by_invited)
                .slice(0, 5)
                .map((ref, idx) => (
                  <div
                    key={ref.user_id}
                    className="flex items-center justify-between gap-2 rounded-lg bg-dark-900/50 p-2 transition-colors hover:bg-dark-800/50 sm:p-3"
                  >
                    <div className="flex min-w-0 flex-1 items-center gap-2 sm:gap-3">
                      <span className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-dark-700 text-[10px] font-bold text-dark-300 sm:h-6 sm:w-6 sm:text-xs">
                        {idx + 1}
                      </span>
                      <div className="min-w-0">
                        <div className="truncate text-xs font-medium text-dark-100 sm:text-sm">
                          {ref.display_name}
                        </div>
                        {ref.username && (
                          <div className="truncate text-[10px] text-dark-500 sm:text-xs">
                            @{ref.username}
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="flex-shrink-0 text-right">
                      {referrersTab === 'earnings' ? (
                        <>
                          <div className="text-xs font-semibold text-success-400 sm:text-sm">
                            {money(ref.earnings_total_kopeks)}
                          </div>
                          <div className="text-xs text-dark-400">
                            {ref.invited_count} {t('adminDashboard.topReferrers.invites')}
                          </div>
                          {/* «заплатили N» — своей строкой: в одной строке с «N пригл.» столбец чисел отнимал у
                              имени 70–90 px на телефоне 360 px (ревью C4-1) */}
                          {typeof ref.paid_count === 'number' && (
                            <div className="text-xs text-dark-400">
                              {t('adminDashboard.topReferrers.paid', { count: ref.paid_count })}
                            </div>
                          )}
                        </>
                      ) : (
                        <>
                          <div className="text-xs font-semibold text-accent-400 sm:text-sm">
                            {ref.invited_count} {t('adminDashboard.topReferrers.people')}
                          </div>
                          {typeof ref.paid_count === 'number' && (
                            <div className="text-xs text-dark-400">
                              {t('adminDashboard.topReferrers.paid', { count: ref.paid_count })}
                            </div>
                          )}
                          <div className="text-xs text-dark-400">
                            {money(ref.earnings_total_kopeks)}
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                ))}
            </div>

            {/* Period Stats — РЕФ-2.5б: начислено ВСЕМ пригласившим по суткам Москвы, тем же счётчиком, что плитка
                блока «Приглашения»; старый бот итогов не шлёт — тогда «—», а не сумма десяти строк вкладки (D-3) */}
            <div className="mt-4 border-t border-dark-700 pt-4">
              <div className="mb-2 text-xs text-dark-400">
                {t('adminDashboard.topReferrers.periodCaption')}
              </div>
              <div className="grid grid-cols-3 gap-2 sm:gap-3">
                {(
                  [
                    ['today', referrers.period_totals?.today_kopeks],
                    ['week', referrers.period_totals?.week_kopeks],
                    ['month', referrers.period_totals?.month_kopeks],
                  ] as const
                ).map(([key, kopeks]) => (
                  <div key={key} className="text-center">
                    <div className="mb-1 text-xs text-dark-400">
                      {t(`adminDashboard.period.${key}`)}
                    </div>
                    <div className="text-xs font-semibold text-dark-200 sm:text-base">
                      {money(kopeks)}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Top Campaigns */}
        {campaigns && campaigns.campaigns.length > 0 && (
          <CampaignResultsCard
            data={campaigns}
            currencySymbol={currencySymbol}
            formatAmount={formatAmount}
            canOpenDetails={canOpenCampaignDetails}
          />
        )}
      </div>

      {/* Recent Payments */}
      {payments && payments.payments.length > 0 && (
        <div className="rounded-xl border border-dark-700 bg-dark-800/30 p-4 sm:p-5">
          <div className="mb-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="rounded-lg bg-success-500/20 p-2 text-success-400 sm:p-2.5">
                <BanknotesIcon />
              </div>
              <div>
                {/* суммы «Сегодня / Неделя» сняты: третье определение денег, сутки по UTC (ревью C2-3) */}
                <h2 className="text-base font-semibold text-dark-100 sm:text-lg">
                  {t('adminDashboard.recentPayments.title')}
                </h2>
              </div>
            </div>
          </div>

          {/* Desktop Table */}
          <div className="hidden overflow-x-auto md:block">
            <table className="w-full">
              <thead>
                <tr className="border-b border-dark-700">
                  <th className="px-2 py-3 text-left text-xs font-medium text-dark-500">
                    {t('adminDashboard.table.user')}
                  </th>
                  <th className="px-2 py-3 text-left text-xs font-medium text-dark-500">
                    {t('adminDashboard.table.type')}
                  </th>
                  <th className="px-2 py-3 text-right text-xs font-medium text-dark-500">
                    {t('adminDashboard.table.amount')}
                  </th>
                  <th className="px-2 py-3 text-left text-xs font-medium text-dark-500">
                    {payments.payments[0]?.is_first == null
                      ? t('adminDashboard.table.method')
                      : t('adminDashboard.recentPayments.purpose')}
                  </th>
                  <th className="px-2 py-3 text-right text-xs font-medium text-dark-500">
                    {t('adminDashboard.table.date')}
                  </th>
                </tr>
              </thead>
              <tbody>
                {payments.payments.slice(0, 10).map((payment) => (
                  <tr
                    key={payment.id}
                    className="border-b border-dark-700/50 transition-colors hover:bg-dark-800/50"
                  >
                    <td className="px-2 py-3">
                      <button
                        onClick={() => navigate(`/admin/users/${payment.user_id}`)}
                        className="text-left transition-colors hover:opacity-80"
                      >
                        <div className="text-sm font-medium text-dark-100 underline decoration-dark-600 underline-offset-2 hover:decoration-dark-400">
                          {payment.display_name}
                        </div>
                        {payment.username && (
                          <div className="text-xs text-dark-500">@{payment.username}</div>
                        )}
                      </button>
                    </td>
                    <td className="px-2 py-3">
                      <span
                        className={`whitespace-nowrap rounded-full px-2 py-1 text-xs ${paymentBadge(payment).className}`}
                      >
                        {paymentBadge(payment).label}
                      </span>
                    </td>
                    <td className="px-2 py-3 text-right">
                      <span className="font-semibold text-dark-100">
                        {formatAmount(payment.amount_rubles)} {currencySymbol}
                      </span>
                    </td>
                    <td className="px-2 py-3">
                      <span className="text-xs text-dark-400">{paymentContext(payment)}</span>
                    </td>
                    <td className="px-2 py-3 text-right">
                      <span className="text-xs text-dark-400">
                        {new Date(payment.created_at).toLocaleString('ru-RU', {
                          day: '2-digit',
                          month: '2-digit',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile Cards */}
          <div className="space-y-2 md:hidden">
            {payments.payments.slice(0, 10).map((payment) => (
              <div key={payment.id} className="rounded-lg bg-dark-900/50 p-3">
                {/* ПЛ-1: имя одно в первой строке — метка и сумма не съедают его на узком экране */}
                <div className="flex items-center justify-between gap-2">
                  <button
                    onClick={() => navigate(`/admin/users/${payment.user_id}`)}
                    className="min-w-0 truncate text-left text-sm font-medium text-dark-100 underline decoration-dark-600 underline-offset-2 transition-colors hover:decoration-dark-400"
                  >
                    {payment.display_name}
                  </button>
                  <span className="shrink-0 whitespace-nowrap text-sm font-semibold tabular-nums text-dark-100">
                    {formatAmount(payment.amount_rubles)} {currencySymbol}
                  </span>
                </div>
                <div className="mt-1.5 flex items-center justify-between gap-2 text-xs text-dark-400">
                  <span
                    className={`whitespace-nowrap rounded-full px-2 py-0.5 ${paymentBadge(payment).className}`}
                  >
                    {paymentBadge(payment).label}
                  </span>
                  <span className="shrink-0 whitespace-nowrap tabular-nums">
                    {new Date(payment.created_at).toLocaleString('ru-RU', {
                      day: '2-digit',
                      month: '2-digit',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </span>
                </div>
                <div className="mt-1.5 break-words text-xs text-dark-400">
                  {paymentContext(payment)}
                </div>
              </div>
            ))}
          </div>
          {payments.hidden_last_30d && (
            <p className="mt-3 border-t border-dark-700/50 pt-3 text-xs text-dark-400">
              {t('adminDashboard.recentPayments.hidden', {
                bonuses: payments.hidden_last_30d.registration_bonuses,
                balance: payments.hidden_last_30d.balance_purchases,
                manual: payments.hidden_last_30d.manual_credits,
              })}
            </p>
          )}
        </div>
      )}

      {/* System Info — без «Пользователей: 753» и «Активных подписок: 140»: старые числа с Team, стендами и
          удалёнными спорили с «Платят / На пробном» (решение владельца «убрать старые числа», ревью C4-3) */}
      {systemInfo && (
        <div className="rounded-xl border border-dark-700 bg-dark-800 p-4">
          <h3 className="mb-3 text-sm font-semibold text-dark-300">
            {t('adminDashboard.systemInfo.title')}
          </h3>
          <div className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
            <div>
              <span className="text-dark-500">{t('adminDashboard.systemInfo.cabinet')}: </span>
              <span className="font-medium text-dark-200">v{CABINET_VERSION}</span>
            </div>
            <div>
              <span className="text-dark-500">{t('adminDashboard.systemInfo.bot')}: </span>
              <span className="font-medium text-dark-200">v{systemInfo.bot_version}</span>
            </div>
            <div>
              <span className="text-dark-500">{t('adminDashboard.systemInfo.python')}: </span>
              <span className="font-medium text-dark-200">{systemInfo.python_version}</span>
            </div>
            <div>
              <span className="text-dark-500">{t('adminDashboard.systemInfo.uptime')}: </span>
              <span className="font-medium text-dark-200">
                {(() => {
                  const s = systemInfo.uptime_seconds;
                  const d = Math.floor(s / 86400);
                  const h = Math.floor((s % 86400) / 3600);
                  const m = Math.floor((s % 3600) / 60);
                  return [d > 0 && `${d}d`, h > 0 && `${h}h`, `${m}m`].filter(Boolean).join(' ');
                })()}
              </span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
