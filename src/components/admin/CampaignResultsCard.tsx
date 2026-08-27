import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import type { TopCampaignsResponse } from '../../api/admin';
import { ChevronRightIcon, MegaphoneIcon } from '../icons';

interface CampaignResultsCardProps {
  data: TopCampaignsResponse;
  currencySymbol: string;
  formatAmount: (rubles: number, decimals?: number) => string;
  canOpenDetails: boolean;
}

const localeMap: Record<string, string> = {
  ru: 'ru-RU',
  en: 'en-US',
  zh: 'zh-CN',
  fa: 'fa-IR',
};

export function CampaignResultsCard({
  data,
  currencySymbol,
  formatAmount,
  canOpenDetails,
}: CampaignResultsCardProps) {
  const { t, i18n } = useTranslation();
  const locale = localeMap[i18n.language] || 'en-US';
  const percent = (value: number) =>
    new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(value);
  const paid = (count: number) => t('adminDashboard.topCampaigns.paid', { count });
  const totalLeads = data.total_leads ?? data.total_registrations ?? 0;
  const legacyPayingLeads = data.campaigns.reduce(
    (total, campaign) => total + (campaign.conversions ?? 0),
    0,
  );
  const totalPayingLeads = data.total_paying_leads ?? legacyPayingLeads;
  const totalConversion =
    data.payment_conversion_rate ??
    (totalLeads > 0 ? Math.round((totalPayingLeads / totalLeads) * 1000) / 10 : 0);
  const totalReceipts = data.confirmed_receipts_kopeks ?? data.total_revenue_kopeks ?? 0;
  const visibleCampaigns = data.campaigns.slice(0, 5);
  const hasReceiptContract =
    Number.isFinite(data.total_leads) &&
    Number.isFinite(data.total_paying_leads) &&
    Number.isFinite(data.payment_conversion_rate) &&
    Number.isFinite(data.confirmed_receipts_kopeks) &&
    visibleCampaigns.every(
      (campaign) =>
        Number.isFinite(campaign.leads) &&
        Number.isFinite(campaign.paying_leads) &&
        Number.isFinite(campaign.payment_conversion_rate) &&
        Number.isFinite(campaign.confirmed_receipts_kopeks) &&
        Number.isFinite(campaign.avg_confirmed_receipts_per_lead_kopeks),
    );
  const receiptsPerLead = totalLeads > 0 ? totalReceipts / totalLeads : 0;
  const receiptsPerPayingLead = totalPayingLeads > 0 ? totalReceipts / totalPayingLeads : 0;
  const isRtl = i18n.dir() === 'rtl';
  const receiptShare = (campaignReceipts: number) => {
    if (
      !Number.isFinite(campaignReceipts) ||
      !Number.isFinite(totalReceipts) ||
      totalReceipts <= 0
    ) {
      return 0;
    }
    return Math.min(100, Math.max(0, (campaignReceipts / totalReceipts) * 100));
  };
  const shareLabel = (share: number) =>
    share > 0 && share < 0.1
      ? t('adminDashboard.topCampaigns.shareTiny', { percent: percent(0.1) })
      : t('adminDashboard.topCampaigns.share', { percent: percent(share) });

  return (
    <div className="flex h-full flex-col rounded-xl border border-dark-700 bg-dark-800/30 p-4 light:border-champagne-300/50 light:bg-champagne-100/40 sm:p-5">
      <div className="mb-4 flex items-center gap-2 sm:gap-3">
        <div className="rounded-lg bg-warning-500/20 p-2 text-warning-400 sm:p-2.5">
          <MegaphoneIcon />
        </div>
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-dark-100 light:text-champagne-900 sm:text-lg">
            {t('adminDashboard.topCampaigns.title')}
          </h2>
          <p className="text-xs text-dark-300 light:text-champagne-800 sm:text-sm">
            {t('adminDashboard.topCampaigns.campaigns', { count: data.total_campaigns })} ·{' '}
            {t('adminDashboard.topCampaigns.leads', { count: totalLeads })} ·{' '}
            {paid(totalPayingLeads)} · {percent(totalConversion)}%
            {data.total_campaigns > visibleCampaigns.length && (
              <>
                {' '}
                ·{' '}
                {t('adminDashboard.topCampaigns.shownTop', {
                  count: visibleCampaigns.length,
                  total: data.total_campaigns,
                })}
              </>
            )}
          </p>
        </div>
      </div>

      <ul className="space-y-2">
        {visibleCampaigns.map((campaign) => {
          // The legacy fallbacks are only a rollout/rollback guard. Backend is deployed first.
          const campaignReceipts =
            campaign.confirmed_receipts_kopeks ?? campaign.total_revenue_kopeks ?? 0;
          const share = receiptShare(campaignReceipts);
          const content = (
            <>
              <div className="flex flex-wrap items-start gap-x-2 gap-y-1">
                <div className="min-w-0 flex-[1_1_9rem] text-start">
                  <div className="truncate text-xs font-medium text-dark-100 light:text-champagne-900 sm:text-sm">
                    {campaign.name}
                  </div>
                  <div
                    dir="ltr"
                    className="truncate text-[10px] text-dark-300 [unicode-bidi:isolate] light:text-champagne-800 sm:text-xs"
                  >
                    ?start={campaign.start_parameter}
                  </div>
                </div>
                <div className="ms-auto flex min-w-0 max-w-full items-start gap-1 text-end">
                  <div className="min-w-0">
                    <div className="truncate text-xs font-semibold text-warning-400 light:text-warning-800 sm:text-sm">
                      {formatAmount(campaignReceipts / 100)} {currencySymbol}
                    </div>
                    <div className="truncate text-[10px] text-dark-300 light:text-champagne-800 sm:text-xs">
                      {paid(campaign.paying_leads ?? campaign.conversions ?? 0)} ·{' '}
                      {percent(campaign.payment_conversion_rate ?? campaign.conversion_rate ?? 0)}%
                    </div>
                  </div>
                  {canOpenDetails && (
                    <span aria-hidden="true">
                      <ChevronRightIcon
                        className={`mt-0.5 h-4 w-4 shrink-0 text-dark-300 light:text-champagne-800 ${isRtl ? 'rotate-180' : ''}`}
                      />
                    </span>
                  )}
                </div>
              </div>
              {hasReceiptContract && (
                <div className="mt-2">
                  <div className="mb-1 text-start text-[10px] leading-snug text-dark-300 light:text-champagne-800 sm:text-xs">
                    {shareLabel(share)}
                  </div>
                  <div
                    className="h-1 overflow-hidden rounded-full bg-dark-700/70 light:bg-champagne-300/70"
                    aria-hidden="true"
                  >
                    <div
                      className="h-full rounded-full bg-warning-500 light:bg-warning-700"
                      style={{ width: `${share}%` }}
                    />
                  </div>
                </div>
              )}
            </>
          );

          return (
            <li key={campaign.id}>
              {canOpenDetails ? (
                <Link
                  to={`/admin/campaigns/${campaign.id}/stats`}
                  className="group block min-h-11 rounded-lg bg-dark-900/50 p-2 transition-colors hover:bg-dark-800/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-400 light:bg-champagne-200/50 light:hover:bg-champagne-200/80 light:focus-visible:ring-accent-600 sm:p-3"
                >
                  <span className="sr-only">
                    {t('adminDashboard.topCampaigns.openStats', { name: campaign.name })}
                  </span>
                  {content}
                </Link>
              ) : (
                <div className="min-h-11 rounded-lg bg-dark-900/50 p-2 light:bg-champagne-200/50 sm:p-3">
                  {content}
                </div>
              )}
            </li>
          );
        })}
      </ul>

      <div className="mt-auto pt-4">
        {hasReceiptContract && (
          <dl
            aria-label={t('adminDashboard.topCampaigns.averagesLabel')}
            className="mb-4 grid grid-cols-1 gap-2 sm:grid-cols-2"
          >
            <div className="rounded-lg bg-dark-900/50 p-2 light:bg-champagne-200/50">
              <dt className="text-[10px] text-dark-300 light:text-champagne-800 sm:text-xs">
                {t('adminDashboard.topCampaigns.perLead')}
              </dt>
              <dd className="mt-0.5 text-xs font-semibold text-dark-100 light:text-champagne-900 sm:text-sm">
                {formatAmount(receiptsPerLead / 100)} {currencySymbol}
              </dd>
            </div>
            <div className="rounded-lg bg-dark-900/50 p-2 light:bg-champagne-200/50">
              <dt className="text-[10px] text-dark-300 light:text-champagne-800 sm:text-xs">
                {t('adminDashboard.topCampaigns.perPayingLead')}
              </dt>
              <dd className="mt-0.5 text-xs font-semibold text-dark-100 light:text-champagne-900 sm:text-sm">
                {formatAmount(receiptsPerPayingLead / 100)} {currencySymbol}
              </dd>
            </div>
          </dl>
        )}
        <div className="border-t border-dark-700 pt-4 light:border-champagne-300/60">
          <div className="flex items-start justify-between gap-3">
            <span className="text-xs text-dark-300 light:text-champagne-800 sm:text-sm">
              {t('adminDashboard.topCampaigns.total')}
            </span>
            <span className="shrink-0 text-sm font-bold text-warning-400 light:text-warning-800 sm:text-base">
              {formatAmount(totalReceipts / 100)} {currencySymbol}
            </span>
          </div>
          <p className="mt-2 text-[10px] leading-relaxed text-dark-300 light:text-champagne-800 sm:text-xs">
            {t('adminDashboard.topCampaigns.hint')}
          </p>
        </div>
      </div>
    </div>
  );
}
