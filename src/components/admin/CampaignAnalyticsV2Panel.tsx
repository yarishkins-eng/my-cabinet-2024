import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import {
  Bar,
  BarChart,
  Cell,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { CampaignAnalyticsV2 } from '../../api/campaigns';
import { PARTNER_STATS } from '../../constants/partner';
import { useChartColors } from '../../hooks/useChartColors';
import { useCurrency } from '../../hooks/useCurrency';

interface Props {
  analytics: CampaignAnalyticsV2;
}

function MetricCard({
  label,
  value,
  detail,
  valueClassName = 'text-dark-100',
}: {
  label: string;
  value: string;
  detail?: string;
  valueClassName?: string;
}) {
  return (
    <div className="rounded-xl border border-dark-700 bg-dark-800 p-4">
      <div className="text-xs font-medium text-dark-400">{label}</div>
      <div className={`mt-2 text-xl font-bold sm:text-2xl ${valueClassName}`}>{value}</div>
      {detail && <div className="mt-1 text-xs leading-relaxed text-dark-400">{detail}</div>}
    </div>
  );
}

export function CampaignAnalyticsServiceInfo({ analytics }: Props) {
  const { t, i18n } = useTranslation();
  const formatDate = (value: string | null) =>
    value
      ? new Date(value).toLocaleString(i18n.language, {
          day: '2-digit',
          month: '2-digit',
          year: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
          timeZone: analytics.timezone,
        })
      : '—';

  return (
    <section className="rounded-xl border border-dark-700 bg-dark-800 p-4">
      <h2 className="font-semibold text-dark-100">{t('admin.campaigns.statsV2.serviceInfo')}</h2>
      <dl className="mt-3 grid grid-cols-1 gap-3 text-sm sm:grid-cols-3">
        <div>
          <dt className="text-dark-400">{t('admin.campaigns.statsV2.lastLead')}</dt>
          <dd className="mt-1 text-dark-200">{formatDate(analytics.last_lead_at)}</dd>
        </div>
        <div>
          <dt className="text-dark-400">{t('admin.campaigns.statsV2.lastTrial')}</dt>
          <dd className="mt-1 text-dark-200">{formatDate(analytics.last_trial_at)}</dd>
        </div>
        <div>
          <dt className="text-dark-400">{t('admin.campaigns.statsV2.lastPurchase')}</dt>
          <dd className="mt-1 text-dark-200">{formatDate(analytics.last_paid_subscription_at)}</dd>
        </div>
      </dl>
    </section>
  );
}

export function CampaignAnalyticsV2Panel({ analytics }: Props) {
  const { t, i18n } = useTranslation();
  const { formatWithCurrency } = useCurrency();
  const colors = useChartColors();
  const percent = (value: number | null) =>
    value === null
      ? '—'
      : `${new Intl.NumberFormat(i18n.language, { maximumFractionDigits: 1 }).format(value)}%`;
  const money = (kopeks: number | null) =>
    kopeks === null ? '—' : formatWithCurrency(kopeks / PARTNER_STATS.KOPEKS_DIVISOR);
  const dailyData = useMemo(
    () =>
      analytics.daily_cohorts.map((item) => ({
        ...item,
        label: new Date(`${item.date}T00:00:00`).toLocaleDateString(i18n.language, {
          day: 'numeric',
          month: 'short',
        }),
      })),
    [analytics.daily_cohorts, i18n.language],
  );
  const paybackData = useMemo(
    () =>
      analytics.cumulative_receipts.map((item) => ({
        ...item,
        label: new Date(`${item.date}T00:00:00`).toLocaleDateString(i18n.language, {
          day: 'numeric',
          month: 'short',
        }),
        receipts: item.confirmed_receipts_kopeks / PARTNER_STATS.KOPEKS_DIVISOR,
        spend:
          item.ad_spend_kopeks === null
            ? null
            : item.ad_spend_kopeks / PARTNER_STATS.KOPEKS_DIVISOR,
      })),
    [analytics.cumulative_receipts, i18n.language],
  );
  const gap = analytics.receipts_minus_ad_spend_kopeks;
  const cohortSummaryId = `campaign-${analytics.campaign_id}-cohort-chart-summary`;
  const receiptsSummaryId = `campaign-${analytics.campaign_id}-receipts-chart-summary`;

  return (
    <div className="space-y-6">
      <section aria-labelledby="campaign-funnel-title">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 id="campaign-funnel-title" className="font-semibold text-dark-100">
              {t('admin.campaigns.statsV2.customerPath')}
            </h2>
            <p className="mt-1 text-xs text-dark-400">
              {t('admin.campaigns.statsV2.allTimeFirstTouch')}
            </p>
          </div>
          <span className="rounded-full bg-dark-700 px-3 py-1 text-xs text-dark-300">
            {t('admin.campaigns.statsV2.moscowTime')}
          </span>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <MetricCard
            label={t('admin.campaigns.statsV2.leads')}
            value={String(analytics.leads)}
            detail={t('admin.campaigns.statsV2.firstTouchLeads')}
          />
          <MetricCard
            label={t('admin.campaigns.statsV2.trials')}
            value={String(analytics.historical_trial_users_count)}
            detail={t('admin.campaigns.statsV2.ofLeads', {
              count: analytics.historical_trial_users_count,
              total: analytics.leads,
              rate: percent(analytics.lead_to_trial_rate),
            })}
            valueClassName="text-success-400"
          />
          <MetricCard
            label={t('admin.campaigns.statsV2.paidSubscriptions')}
            value={String(analytics.paid_subscription_users_count)}
            detail={t('admin.campaigns.statsV2.paidSplit', {
              count: analytics.paid_subscription_users_count,
              total: analytics.leads,
              rate: percent(analytics.lead_to_paid_subscription_rate),
              afterTrial: analytics.paid_after_trial_count,
              trialRate: percent(analytics.trial_to_paid_rate),
              direct: analytics.paid_without_trial_count,
            })}
            valueClassName="text-accent-400"
          />
          <MetricCard
            label={t('admin.campaigns.statsV2.receipts')}
            value={money(analytics.confirmed_receipts_kopeks)}
            detail={t('admin.campaigns.statsV2.receiptsShort')}
            valueClassName="text-warning-400"
          />
        </div>
        <p className="mt-2 text-xs leading-relaxed text-dark-400">
          {t('admin.campaigns.statsV2.receiptsHint')}
        </p>

        {(analytics.immature_leads_count > 0 || analytics.active_trials_count > 0) && (
          <div className="mt-3 rounded-xl border border-warning-500/30 bg-warning-500/10 p-3 text-sm text-warning-200">
            {t('admin.campaigns.statsV2.maturityWarning', {
              leads: analytics.immature_leads_count,
              days: analytics.maturity_horizon_days,
              trials: analytics.active_trials_count,
            })}
          </div>
        )}
        {analytics.data_quality.status === 'partial' && (
          <div className="mt-3 rounded-xl border border-accent-500/30 bg-accent-500/10 p-3 text-xs leading-relaxed text-accent-200">
            {t('admin.campaigns.statsV2.partialDataWarning')}
          </div>
        )}
      </section>

      <section className="rounded-xl border border-dark-700 bg-dark-800 p-4">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="font-semibold text-dark-100">
              {t('admin.campaigns.statsV2.economics')}
            </h2>
            <p className="mt-1 text-xs text-dark-400">
              {t('admin.campaigns.statsV2.grossRoasHint')}
            </p>
          </div>
          {analytics.ad_spend_kopeks !== null && (
            <Link
              to={`/admin/campaigns/${analytics.campaign_id}/edit`}
              className="rounded-lg bg-dark-700 px-3 py-2 text-xs font-medium text-dark-200 hover:bg-dark-600"
            >
              {t('admin.campaigns.statsV2.editSpend')}
            </Link>
          )}
        </div>
        {analytics.ad_spend_kopeks === null ? (
          <div className="rounded-xl border border-dark-700 bg-dark-800 p-4">
            <div className="text-xs font-medium text-dark-400">
              {t('admin.campaigns.statsV2.adSpend')}
            </div>
            <div className="mt-2 text-xl font-bold text-dark-100 sm:text-2xl">
              {t('admin.campaigns.statsV2.notSpecified')}
            </div>
            <Link
              to={`/admin/campaigns/${analytics.campaign_id}/edit`}
              className="mt-3 inline-flex rounded-lg bg-dark-700 px-3 py-2 text-xs font-medium text-dark-200 hover:bg-dark-600"
            >
              {t('admin.campaigns.statsV2.addSpend')}
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <MetricCard
              label={t('admin.campaigns.statsV2.adSpend')}
              value={money(analytics.ad_spend_kopeks)}
            />
            <MetricCard
              label={t('admin.campaigns.statsV2.cpl')}
              value={money(analytics.cost_per_lead_kopeks)}
            />
            <MetricCard
              label={t('admin.campaigns.statsV2.costPerTrial')}
              value={money(analytics.cost_per_trial_kopeks)}
            />
            <MetricCard
              label={t('admin.campaigns.statsV2.cac')}
              value={money(analytics.customer_acquisition_cost_kopeks)}
            />
            <MetricCard
              label={t('admin.campaigns.statsV2.grossRoas')}
              value={percent(analytics.gross_roas_percent)}
            />
            <MetricCard
              label={
                gap !== null && gap >= 0
                  ? t('admin.campaigns.statsV2.aboveSpend')
                  : t('admin.campaigns.statsV2.toPayback')
              }
              value={gap === null ? '—' : money(Math.abs(gap))}
              valueClassName={gap !== null && gap >= 0 ? 'text-success-400' : 'text-warning-400'}
            />
          </div>
        )}
      </section>

      <section className="rounded-xl border border-dark-700 bg-dark-800 p-4">
        <h2 className="font-semibold text-dark-100">{t('admin.campaigns.statsV2.cohortChart')}</h2>
        <p className="mt-1 text-xs text-dark-400">{t('admin.campaigns.statsV2.cohortChartHint')}</p>
        <ul id={cohortSummaryId} className="sr-only">
          {dailyData.map((item) => (
            <li key={`summary-${item.date}`}>
              {item.label}: {t('admin.campaigns.statsV2.leads')}: {item.leads};{' '}
              {t('admin.campaigns.statsV2.trials')}: {item.trial_users};{' '}
              {t('admin.campaigns.statsV2.paidSubscriptions')}: {item.paid_subscription_users}
            </li>
          ))}
        </ul>
        <div
          className="mt-4 h-72 min-w-0"
          role="img"
          aria-label={t('admin.campaigns.statsV2.cohortChartHint')}
          aria-describedby={cohortSummaryId}
        >
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={dailyData} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={colors.grid} />
              <XAxis
                dataKey="label"
                tick={{ fill: colors.tick, fontSize: 10 }}
                interval="preserveStartEnd"
              />
              <YAxis allowDecimals={false} tick={{ fill: colors.tick, fontSize: 10 }} />
              <Tooltip
                contentStyle={{
                  backgroundColor: colors.tooltipBg,
                  border: `1px solid ${colors.tooltipBorder}`,
                  borderRadius: 10,
                  color: colors.label,
                }}
              />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar
                dataKey="leads"
                name={t('admin.campaigns.statsV2.leads')}
                fill={colors.referrals}
                radius={[3, 3, 0, 0]}
              >
                {dailyData.map((entry) => (
                  <Cell key={`lead-${entry.date}`} fillOpacity={entry.mature_7d ? 1 : 0.45} />
                ))}
              </Bar>
              <Bar
                dataKey="trial_users"
                name={t('admin.campaigns.statsV2.trials')}
                fill={colors.earnings}
                radius={[3, 3, 0, 0]}
              >
                {dailyData.map((entry) => (
                  <Cell key={`trial-${entry.date}`} fillOpacity={entry.mature_7d ? 1 : 0.45} />
                ))}
              </Bar>
              <Bar
                dataKey="paid_subscription_users"
                name={t('admin.campaigns.statsV2.paidSubscriptions')}
                fill="#a78bfa"
                radius={[3, 3, 0, 0]}
              >
                {dailyData.map((entry) => (
                  <Cell key={`paid-${entry.date}`} fillOpacity={entry.mature_7d ? 1 : 0.45} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </section>

      <section className="rounded-xl border border-dark-700 bg-dark-800 p-4">
        <h2 className="font-semibold text-dark-100">
          {t('admin.campaigns.statsV2.delayedConversion')}
        </h2>
        <p className="mt-1 text-xs text-dark-400">
          {t('admin.campaigns.statsV2.delayedConversionHint')}
        </p>
        <div className="mt-4 space-y-3">
          {analytics.delay_curve.map((point) => {
            const width = Math.max(0, Math.min(100, point.conversion_rate ?? 0));
            return (
              <div key={point.hours}>
                <div className="mb-1 flex items-center justify-between gap-3 text-xs">
                  <span className="font-medium text-dark-300">
                    {point.hours === 24
                      ? t('admin.campaigns.statsV2.within24Hours')
                      : t('admin.campaigns.statsV2.withinDays', { days: point.hours / 24 })}
                  </span>
                  <span className="text-dark-400">
                    {point.conversion_rate === null
                      ? '—'
                      : `${point.converted_leads} / ${point.eligible_leads} · ${percent(point.conversion_rate)}`}
                  </span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-dark-700">
                  <div
                    className="h-full rounded-full bg-accent-500"
                    style={{ width: `${width}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <section className="rounded-xl border border-dark-700 bg-dark-800 p-4">
        <h2 className="font-semibold text-dark-100">
          {t('admin.campaigns.statsV2.receiptsAndSpend')}
        </h2>
        <p className="mt-1 text-xs text-dark-400">
          {t('admin.campaigns.statsV2.receiptsAndSpendHint')}
        </p>
        <ul id={receiptsSummaryId} className="sr-only">
          {paybackData.map((item) => (
            <li key={`summary-${item.date}`}>
              {item.label}: {t('admin.campaigns.statsV2.receipts')}:{' '}
              {money(item.confirmed_receipts_kopeks)}; {t('admin.campaigns.statsV2.totalAdSpend')}:{' '}
              {item.ad_spend_kopeks === null
                ? t('admin.campaigns.statsV2.notSpecified')
                : money(item.ad_spend_kopeks)}
            </li>
          ))}
        </ul>
        <div
          className="mt-4 h-64 min-w-0"
          role="img"
          aria-label={t('admin.campaigns.statsV2.receiptsAndSpendHint')}
          aria-describedby={receiptsSummaryId}
        >
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={paybackData} margin={{ top: 8, right: 8, left: -10, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke={colors.grid} />
              <XAxis
                dataKey="label"
                tick={{ fill: colors.tick, fontSize: 10 }}
                interval="preserveStartEnd"
              />
              <YAxis tick={{ fill: colors.tick, fontSize: 10 }} />
              <Tooltip
                contentStyle={{
                  backgroundColor: colors.tooltipBg,
                  border: `1px solid ${colors.tooltipBorder}`,
                  borderRadius: 10,
                  color: colors.label,
                }}
                formatter={(value: number | undefined) => formatWithCurrency(value ?? 0)}
              />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Line
                type="monotone"
                dataKey="receipts"
                name={t('admin.campaigns.statsV2.receipts')}
                stroke={colors.earnings}
                strokeWidth={2}
                dot={false}
              />
              {analytics.ad_spend_kopeks !== null && (
                <Line
                  type="monotone"
                  dataKey="spend"
                  name={t('admin.campaigns.statsV2.totalAdSpend')}
                  stroke="#f59e0b"
                  strokeDasharray="5 5"
                  strokeWidth={2}
                  dot={false}
                />
              )}
            </LineChart>
          </ResponsiveContainer>
        </div>
      </section>
    </div>
  );
}
