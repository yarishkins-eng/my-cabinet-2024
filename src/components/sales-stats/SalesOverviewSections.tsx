import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';

import type {
  SalesAds,
  SalesOverview,
  SalesPeopleKind,
  SalesPeriodParams,
} from '../../api/adminSalesStats';
import { salesStatsApi } from '../../api/adminSalesStats';
import { SALES_STATS } from '../../constants/salesStats';
import { ChevronDownIcon, ChevronRightIcon } from '../icons';
import {
  DASH,
  LOADING,
  formatChange,
  formatMskDateTime,
  formatMskRange,
  formatPercent,
  percentChange,
  useLocaleTag,
  useMoney,
} from './salesFormat';

function Tile({
  label,
  value,
  hint,
  onClick,
  open,
}: {
  label: string;
  value: string;
  hint?: string;
  onClick?: () => void;
  open?: boolean;
}) {
  const body = (
    <>
      <div className="text-xs text-dark-400 sm:text-sm">{label}</div>
      <div className="mt-1 flex items-center gap-2 text-xl font-semibold text-dark-100">
        {value}
        {onClick && (
          <ChevronDownIcon
            className={`h-4 w-4 text-dark-400 transition-transform ${open ? 'rotate-180' : ''}`}
          />
        )}
      </div>
      {hint && <div className="mt-1 text-xs text-dark-400">{hint}</div>}
    </>
  );
  if (!onClick) return <div className="rounded-xl bg-dark-800/30 p-3">{body}</div>;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={open}
      className="min-h-[44px] w-full rounded-xl bg-dark-800/30 p-3 text-left transition-colors hover:bg-dark-800/50 active:bg-dark-800/60"
    >
      {body}
    </button>
  );
}

/** «Кончится» считается от «сейчас»: без периода в ключе и в запросе — смена кнопки периода его не перезапрашивает,
 * а «Свой» без дат не роняет (ревью C1-1, C5-6, C6-4). «Не продлили» — за выбранный период. */
export function PeopleList({
  kind,
  params,
}: {
  kind: SalesPeopleKind;
  params?: SalesPeriodParams;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const money = useMoney();
  const locale = useLocaleTag();
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['sales-stats', 'people', kind, params ?? null],
    queryFn: () => salesStatsApi.getPeople(kind, params),
    staleTime: SALES_STATS.STALE_TIME,
  });

  if (isLoading) {
    return <div className="h-16 animate-pulse rounded-xl bg-dark-800/30" />;
  }
  if (isError || !data) {
    return (
      <div className="flex items-center justify-between rounded-xl bg-dark-800/30 p-3 text-sm text-error-400">
        {t('admin.salesStats.overview.peopleError')}
        <button
          type="button"
          onClick={() => refetch()}
          className="min-h-[44px] px-3 text-accent-400"
        >
          {t('admin.salesStats.overview.retry')}
        </button>
      </div>
    );
  }
  if (data.items.length === 0) {
    return (
      <div className="rounded-xl bg-dark-800/30 p-3 text-sm text-dark-400">
        {t('admin.salesStats.overview.peopleEmpty')}
      </div>
    );
  }
  return (
    <ul className="divide-y divide-dark-700/50 overflow-hidden rounded-xl bg-dark-800/30">
      {data.items.map((person) => {
        // имя без единой буквы или цифры (на боевом у клиента имя «.») — не имя: показываем ник, ID или «Без имени»
        const name = person.name && /[\p{L}\p{N}]/u.test(person.name) ? person.name : null;
        const idLabel = person.telegram_id !== null ? `ID ${person.telegram_id}` : null;
        const title =
          name ||
          (person.username ? `@${person.username}` : null) ||
          idLabel ||
          t('admin.salesStats.overview.noName');
        const when = t(
          kind === 'not_renewed'
            ? 'admin.salesStats.overview.ended'
            : 'admin.salesStats.overview.ends',
          {
            date: formatMskDateTime(person.end_date, locale),
          },
        );
        const details = [
          when,
          person.tariff_name,
          t(
            person.autopay_enabled
              ? 'admin.salesStats.overview.autopayOn'
              : 'admin.salesStats.overview.autopayOff',
          ),
          t('admin.salesStats.overview.balance', { amount: money(person.balance_kopeks) }),
        ].filter(Boolean);
        return (
          <li key={person.user_id}>
            <button
              type="button"
              onClick={() => navigate(`/admin/users/${person.user_id}`)}
              className="flex min-h-[44px] w-full items-center gap-2 p-3 text-left transition-colors hover:bg-dark-800/50 active:bg-dark-800/60"
            >
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium text-dark-100">
                  {title}
                  {name && person.username && (
                    <span className="ml-1 text-dark-400">@{person.username}</span>
                  )}
                </div>
                <div className="mt-0.5 text-xs text-dark-400">{details.join(' · ')}</div>
                {idLabel && title !== idLabel && (
                  <div className="text-xs text-dark-400">{idLabel}</div>
                )}
              </div>
              {/* строка ведёт в карточку клиента — видно по стрелке, а не только по наведению (ревью C4-12) */}
              <ChevronRightIcon className="h-4 w-4 shrink-0 text-dark-400" />
            </button>
          </li>
        );
      })}
    </ul>
  );
}

export function NowStrip({
  overview,
  loading,
  canSeePeople,
  openKind,
  onToggle,
}: {
  overview: SalesOverview | undefined;
  loading: boolean;
  canSeePeople: boolean;
  openKind: SalesPeopleKind | null;
  onToggle: (kind: SalesPeopleKind) => void;
}) {
  const { t } = useTranslation();
  const value = (n: number | undefined) =>
    n === undefined ? (loading ? LOADING : DASH) : String(n);
  return (
    <section className="space-y-2">
      <h2 className="text-sm font-medium text-dark-400">
        {t('admin.salesStats.overview.nowTitle')}
      </h2>
      <div className="grid grid-cols-2 gap-2">
        <Tile
          label={t('admin.salesStats.overview.paying')}
          value={value(overview?.now.paying)}
          hint={t('admin.salesStats.overview.payingHint')}
        />
        <Tile
          label={t('admin.salesStats.overview.onTrial')}
          value={value(overview?.now.on_trial)}
          hint={t('admin.salesStats.overview.onTrialHint')}
        />
      </div>
      <Tile
        label={t('admin.salesStats.overview.endingSoon')}
        value={value(overview?.now.ending_soon)}
        // список «Кончится» от периода не зависит — сворачивается и без чисел периода (после «Назад» в «Свой»; K-6)
        onClick={canSeePeople ? () => onToggle('ending_soon') : undefined}
        open={openKind === 'ending_soon'}
      />
      {canSeePeople && openKind === 'ending_soon' && <PeopleList kind="ending_soon" />}
    </section>
  );
}

export function MoneyBlock({
  overview,
  loading,
  canSeePeople,
  openKind,
  onToggle,
  params,
}: {
  overview: SalesOverview | undefined;
  loading: boolean;
  canSeePeople: boolean;
  openKind: SalesPeopleKind | null;
  onToggle: (kind: SalesPeopleKind) => void;
  params: SalesPeriodParams;
}) {
  const { t } = useTranslation();
  const money = useMoney();
  const locale = useLocaleTag();
  const blank = loading ? LOADING : DASH;
  const m = overview?.money;
  const p = overview?.purchases;
  const w = overview?.window;
  const hasPrevious = Boolean(w?.previous_start && w?.previous_end);
  const until = (time: string) => t('admin.salesStats.overview.until', { time });
  const previousRange =
    overview && hasPrevious
      ? formatMskRange(w!.previous_start!, w!.previous_end!, locale, overview.generated_at, until)
      : '';
  const change =
    m && w
      ? percentChange(
          m.received_kopeks,
          m.previous_received_kopeks,
          m.previous_comparable,
          new Date(w.end).getTime() - new Date(w.start).getTime(),
        )
      : null;
  return (
    <section className="space-y-2">
      <h2 className="text-sm font-medium text-dark-400">
        {t('admin.salesStats.overview.moneyTitle')}
      </h2>
      <div className="rounded-xl bg-dark-800/30 p-3">
        <div className="text-xs text-dark-400 sm:text-sm">
          {t('admin.salesStats.overview.received')}
        </div>
        <div className="mt-1 text-2xl font-semibold text-success-400">
          {m ? money(m.received_kopeks) : blank}
        </div>
        {m && (
          <div className="mt-1 text-xs text-dark-400">
            {t('admin.salesStats.overview.receivedSplit', {
              deposits: m.deposits_count,
              receipts: m.receipts_count,
            })}
          </div>
        )}
        {m && hasPrevious && m.previous_received_kopeks !== null && (
          <div className="mt-1 text-xs text-dark-400">
            {t('admin.salesStats.overview.previous', {
              range: previousRange,
              amount: money(m.previous_received_kopeks),
            })}
            {change !== null && (
              <span
                className={`ml-1 ${
                  change > 0 ? 'text-success-400' : change < 0 ? 'text-error-400' : 'text-dark-400'
                }`}
              >
                {formatChange(change, locale)}
              </span>
            )}
          </div>
        )}
      </div>
      <div className="rounded-xl bg-dark-800/30 p-3">
        <div className="text-lg font-semibold text-dark-100">
          {p
            ? t('admin.salesStats.overview.bought', {
                count: p.count,
                amount: money(p.amount_kopeks),
              })
            : blank}
        </div>
        {p && (
          <div className="mt-1 text-xs text-dark-400">
            {t('admin.salesStats.overview.boughtSplit', {
              first: p.first_count,
              afterTrial: p.first_after_trial,
              direct: p.first_direct,
              renewals: p.renewal_count,
            })}
          </div>
        )}
        {p && hasPrevious && p.previous_first_count !== null && (
          <div className="mt-1 text-xs text-dark-400">
            {t('admin.salesStats.overview.previousFirst', {
              range: previousRange,
              count: p.previous_first_count,
            })}
          </div>
        )}
        {p && (
          <div className="mt-2 text-sm text-dark-200">
            {t('admin.salesStats.overview.addons', {
              count: p.addon_count,
              amount: money(p.addon_amount_kopeks),
            })}
          </div>
        )}
        {p && (
          <div className="mt-2 text-xs text-dark-400">
            {t('admin.salesStats.overview.boughtHint')}
          </div>
        )}
      </div>
      <Tile
        label={t('admin.salesStats.overview.notRenewed')}
        value={p ? String(p.not_renewed) : blank}
        onClick={canSeePeople && overview ? () => onToggle('not_renewed') : undefined}
        open={openKind === 'not_renewed'}
      />
      {canSeePeople && overview && openKind === 'not_renewed' && (
        <PeopleList kind="not_renewed" params={params} />
      )}
    </section>
  );
}

export function TrialBlock({
  overview,
  loading,
}: {
  overview: SalesOverview | undefined;
  loading: boolean;
}) {
  const { t } = useTranslation();
  const locale = useLocaleTag();
  const blank = loading ? LOADING : DASH;
  const trial = overview?.trial;
  const percent = (part: number, whole: number) =>
    whole > 0 ? formatPercent(Math.round((part / whole) * 100), locale) : null;
  const tookShare = trial ? percent(trial.took_trial, trial.came) : null;
  // процент только от 30 закончившихся: на малых числах он скачет и путает (ревью L5)
  const conversionShare =
    trial && trial.trial_finished >= 30
      ? percent(trial.bought_after_trial, trial.trial_finished)
      : null;
  return (
    <section className="space-y-2">
      <h2 className="text-sm font-medium text-dark-400">
        {t('admin.salesStats.overview.trialTitle')}
      </h2>
      <div className="grid grid-cols-2 gap-2">
        <Tile
          label={t('admin.salesStats.overview.came')}
          value={trial ? String(trial.came) : blank}
        />
        <Tile
          label={t('admin.salesStats.overview.tookTrial')}
          value={trial ? `${trial.took_trial}${tookShare ? ` · ${tookShare}` : ''}` : blank}
        />
      </div>
      <div className="rounded-xl bg-dark-800/30 p-3">
        <div className="text-xs text-dark-400 sm:text-sm">
          {t('admin.salesStats.overview.conversion')}
        </div>
        <div className="mt-1 text-sm text-dark-100">
          {!trial
            ? blank
            : trial.took_trial === 0
              ? t('admin.salesStats.overview.noTrials')
              : trial.trial_finished === 0
                ? t('admin.salesStats.overview.trialsRunning')
                : `${t('admin.salesStats.overview.conversionValue', {
                    bought: trial.bought_after_trial,
                    finished: trial.trial_finished,
                  })}${conversionShare ? ` · ${conversionShare}` : ''}`}
        </div>
      </div>
    </section>
  );
}

export function AdsCard({
  ads,
  isError,
  canOpenCampaigns,
}: {
  ads: SalesAds | undefined;
  isError: boolean;
  canOpenCampaigns: boolean;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const money = useMoney();
  const mature = ads?.campaigns.filter((campaign) => !campaign.fresh) ?? [];
  const fresh = ads?.campaigns.filter((campaign) => campaign.fresh) ?? [];
  const row = (campaign: SalesAds['campaigns'][number]) => (
    <li key={campaign.campaign_id} className="py-1.5 text-xs text-dark-300">
      <span className="text-dark-100">{campaign.name}</span>
      {' — '}
      {[
        t('admin.salesStats.overview.adsSpend', { amount: money(campaign.ad_spend_kopeks) }),
        t('admin.salesStats.overview.adsBuyers', { count: campaign.buyers }),
        campaign.cost_per_buyer_kopeks !== null && !campaign.fresh
          ? t('admin.salesStats.overview.adsCostPerBuyer', {
              amount: money(campaign.cost_per_buyer_kopeks),
            })
          : null,
      ]
        .filter(Boolean)
        .join(' · ')}
    </li>
  );
  return (
    <section className="space-y-2">
      <h2 className="text-sm font-medium text-dark-400">
        {t('admin.salesStats.overview.adsTitle')}
      </h2>
      <div className="rounded-xl bg-dark-800/30 p-3">
        {isError ? (
          <div className="text-sm text-error-400">{t('admin.salesStats.loadError')}</div>
        ) : !ads ? (
          <div className="h-12 animate-pulse rounded-lg bg-dark-800/50" />
        ) : (
          <>
            <div className="text-xs text-dark-400">
              {t('admin.salesStats.overview.adsCoverage', {
                withSpend: ads.campaigns_with_spend,
                total: ads.campaigns_total,
              })}
            </div>
            {ads.campaigns_with_spend === 0 ? (
              // без расхода ни у одной кампании — подсказка, что заполнить, а не строка нулей (ревью C4-19)
              <div className="mt-2 text-sm text-dark-300">
                {t('admin.salesStats.overview.adsNoSpend')}
              </div>
            ) : (
              <>
                <div className="mt-2 text-sm font-medium text-dark-100">
                  {t('admin.salesStats.overview.adsMature')}
                </div>
                <div className="mt-1 text-sm text-dark-200">
                  {[
                    t('admin.salesStats.overview.adsSpend', {
                      amount: money(ads.mature_spend_kopeks),
                    }),
                    t('admin.salesStats.overview.adsBuyers', { count: ads.mature_buyers }),
                    ads.mature_cost_per_buyer_kopeks !== null
                      ? t('admin.salesStats.overview.adsCostPerBuyer', {
                          amount: money(ads.mature_cost_per_buyer_kopeks),
                        })
                      : null,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </div>
                <div className="mt-1 text-xs text-dark-400">
                  {t('admin.salesStats.overview.adsReceipts', {
                    amount: money(ads.mature_receipts_kopeks),
                  })}
                </div>
                <ul className="mt-1">{mature.map(row)}</ul>
                {fresh.length > 0 && (
                  <>
                    <div className="mt-3 text-sm font-medium text-dark-100">
                      {t('admin.salesStats.overview.adsFresh')}
                    </div>
                    <ul className="mt-1">{fresh.map(row)}</ul>
                  </>
                )}
              </>
            )}
            {/* экран кампаний пускает по campaigns:read — без него кнопка вела бы в отказ (ревью C5-5) */}
            {canOpenCampaigns && (
              <button
                type="button"
                onClick={() => navigate('/admin/campaigns')}
                className="mt-2 min-h-[44px] text-sm font-medium text-accent-400"
              >
                {t('admin.salesStats.overview.adsOpen')} →
              </button>
            )}
          </>
        )}
      </div>
    </section>
  );
}
