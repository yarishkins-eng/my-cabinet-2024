import { useTranslation } from 'react-i18next';
import type { TopCampaignsResponse } from '../../api/admin';
import { MegaphoneIcon } from '../icons';

interface CampaignResultsCardProps {
  data: TopCampaignsResponse;
  currencySymbol: string;
  formatAmount: (rubles: number, decimals?: number) => string;
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

  return (
    <div className="rounded-xl border border-dark-700 bg-dark-800/30 p-4 sm:p-5">
      <div className="mb-4 flex items-center gap-2 sm:gap-3">
        <div className="rounded-lg bg-warning-500/20 p-2 text-warning-400 sm:p-2.5">
          <MegaphoneIcon />
        </div>
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-dark-100 sm:text-lg">
            {t('adminDashboard.topCampaigns.title')}
          </h2>
          <p className="text-xs text-dark-400 sm:text-sm">
            {t('adminDashboard.topCampaigns.campaigns', { count: data.total_campaigns })} ·{' '}
            {t('adminDashboard.topCampaigns.leads', { count: totalLeads })} ·{' '}
            {paid(totalPayingLeads)} · {percent(totalConversion)}%
          </p>
        </div>
      </div>

      <div className="space-y-2">
        {data.campaigns.slice(0, 5).map((campaign) => (
          // The legacy fallbacks are only a rollout/rollback guard. Backend is deployed first.
          <div
            key={campaign.id}
            className="flex items-start justify-between gap-3 rounded-lg bg-dark-900/50 p-2 transition-colors hover:bg-dark-800/50 sm:p-3"
          >
            <div className="min-w-0 flex-1">
              <div className="truncate text-xs font-medium text-dark-100 sm:text-sm">
                {campaign.name}
              </div>
              <div className="truncate text-[10px] text-dark-500 sm:text-xs">
                ?start={campaign.start_parameter}
              </div>
            </div>
            <div className="shrink-0 text-right">
              <div className="text-xs font-semibold text-warning-400 sm:text-sm">
                {formatAmount(
                  (campaign.confirmed_receipts_kopeks ?? campaign.total_revenue_kopeks ?? 0) / 100,
                )}{' '}
                {currencySymbol}
              </div>
              <div className="text-[10px] text-dark-500 sm:text-xs">
                {paid(campaign.paying_leads ?? campaign.conversions ?? 0)} ·{' '}
                {percent(campaign.payment_conversion_rate ?? campaign.conversion_rate ?? 0)}%
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-4 border-t border-dark-700 pt-4">
        <div className="flex items-start justify-between gap-3">
          <span className="text-xs text-dark-400 sm:text-sm">
            {t('adminDashboard.topCampaigns.total')}
          </span>
          <span className="shrink-0 text-sm font-bold text-warning-400 sm:text-base">
            {formatAmount(totalReceipts / 100)} {currencySymbol}
          </span>
        </div>
        <p className="mt-2 text-[10px] leading-relaxed text-dark-500 sm:text-xs">
          {t('adminDashboard.topCampaigns.hint')}
        </p>
      </div>
    </div>
  );
}
