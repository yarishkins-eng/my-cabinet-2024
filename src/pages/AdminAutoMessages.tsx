import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { AutoMessageItem, GROUP_ORDER, GROUP_TITLES, autoMessagesApi } from '../api/autoMessages';
import { usePlatform } from '../platform/hooks/usePlatform';
import { BackIcon } from '@/components/icons';

/** Текущие значения прямо в строке: иначе нужное сообщение ищется перебором карточек. */
function paramsSummary(item: AutoMessageItem): string | null {
  if (!item.params) return null;
  const parts: string[] = [];
  if (item.params.warn_hours !== undefined) parts.push(`за ${item.params.warn_hours} ч`);
  if (item.params.discount_percent !== undefined)
    parts.push(`скидка ${item.params.discount_percent} %`);
  if (item.params.trigger_days !== undefined) parts.push(`через ${item.params.trigger_days} дн.`);
  if (item.params.valid_hours !== undefined) parts.push(`действует ${item.params.valid_hours} ч`);
  return parts.length ? parts.join(' · ') : null;
}

/**
 * Числа — текстом в потоке, а не столбиками справа.
 *
 * 🔴 У двенадцати сообщений из двадцати числа нет вообще. Фиксированное место под
 * счётчик оставляло бы дыру, а прочерк с подписью «не считаем» владелец прочитал
 * как загадку: что именно не считаем и почему. Нет числа — нет и строки.
 */
function countsSummary(item: AutoMessageItem, t: (key: string) => string): string | null {
  const parts: string[] = [];
  if (item.sent_count !== null)
    parts.push(`${t('admin.autoMessages.tiles.sent')} ${item.sent_count}`);
  if (item.claim_tracked)
    parts.push(`${t('admin.autoMessages.tiles.claimed')} ${item.claimed_count}`);
  return parts.length ? parts.join(' · ') : null;
}

function MessageRow({ item, onOpen }: { item: AutoMessageItem; onOpen: () => void }) {
  const { t } = useTranslation();
  const off = item.enabled === false;
  const quiet = item.state === 'quiet';
  const params = paramsSummary(item);
  const counts = countsSummary(item, t);

  return (
    // Переключателя в строке нет совсем — по прямому решению владельца: его легко
    // задеть рукой при прокрутке, а пользуются им редко. Он живёт в карточке.
    <button
      type="button"
      onClick={onOpen}
      className={`flex w-full items-center gap-3 rounded-xl border border-dark-700 bg-dark-800 p-3 text-left transition-colors hover:border-dark-600 ${
        quiet ? 'opacity-60' : ''
      }`}
    >
      <div className="min-w-0 flex-1">
        <div className={`text-sm font-semibold ${quiet ? 'text-dark-400' : 'text-dark-100'}`}>
          {item.title}
        </div>
        <div className="mt-0.5 text-xs text-dark-400">{item.when}</div>
        {params && <div className="mt-0.5 text-xs text-accent-400">{params}</div>}
        {counts && <div className="mt-0.5 text-xs text-dark-500">{counts}</div>}
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {off && (
            <span className="rounded bg-dark-700 px-2 py-0.5 text-[11px] text-dark-300">
              {t('admin.autoMessages.state.off')}
            </span>
          )}
          {!off && quiet && (
            <span className="rounded bg-dark-700 px-2 py-0.5 text-[11px] text-dark-400">
              {t('admin.autoMessages.state.quiet')}
              {item.quiet_reason ? `: ${item.quiet_reason}` : ''}
            </span>
          )}
          {!off && !quiet && item.note && (
            <span className="rounded bg-dark-700 px-2 py-0.5 text-[11px] text-dark-400">
              {item.note}
            </span>
          )}
          {item.control !== 'toggle' && (
            <span className="rounded bg-dark-700 px-2 py-0.5 text-[11px] text-dark-400">
              {t('admin.autoMessages.control.server')}
            </span>
          )}
        </div>
      </div>
      <span className="flex-none text-dark-500" aria-hidden="true">
        ›
      </span>
    </button>
  );
}

export default function AdminAutoMessages() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { capabilities } = usePlatform();

  const { data, isLoading, isError } = useQuery({
    queryKey: ['admin-auto-messages'],
    queryFn: autoMessagesApi.list,
  });

  if (isLoading) {
    return (
      <div className="animate-fade-in space-y-3">
        {[0, 1, 2, 3, 4].map((row) => (
          <div
            key={row}
            className="h-16 animate-pulse rounded-xl border border-dark-700 bg-dark-800"
          />
        ))}
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="animate-fade-in rounded-xl border border-error-500/40 bg-error-500/10 p-4 text-sm text-error-300">
        {t('admin.autoMessages.error')}
      </div>
    );
  }

  const { summary, items } = data;
  const lastCycle = summary.last_cycle_at
    ? new Date(summary.last_cycle_at).toLocaleString('ru-RU')
    : null;

  return (
    <div className="animate-fade-in">
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-center gap-3">
          {!capabilities.hasBackButton && (
            <button
              onClick={() => navigate('/admin')}
              className="flex h-10 w-10 items-center justify-center rounded-xl border border-dark-700 bg-dark-800 transition-colors hover:border-dark-600"
            >
              <BackIcon />
            </button>
          )}
          <div>
            <h1 className="text-xl font-semibold text-dark-100">{t('admin.autoMessages.title')}</h1>
            <p className="text-sm text-dark-400">{t('admin.autoMessages.subtitle')}</p>
            {lastCycle && (
              <p className="mt-0.5 text-xs text-dark-500">
                {t('admin.autoMessages.lastCheck')} {lastCycle}
              </p>
            )}
          </div>
        </div>

        {/* Справка, а не орган управления. */}
        <div className="max-w-sm rounded-xl border border-dashed border-dark-700 p-3">
          <div className="text-xs text-dark-300">
            {summary.global_enabled
              ? t('admin.autoMessages.master.on')
              : t('admin.autoMessages.master.off')}{' '}
            · {t('admin.autoMessages.master.hint', { count: summary.global_affects })}
          </div>
          <div className="mt-1 text-xs text-dark-500">{t('admin.autoMessages.master.where')}</div>
        </div>
      </div>

      <div className="mb-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-xl border border-dark-700 bg-dark-800 p-4">
          <div className="text-2xl font-bold tabular-nums text-dark-100">{summary.sent_total}</div>
          <div className="text-xs text-dark-400">{t('admin.autoMessages.tiles.sentHint')}</div>
        </div>
        <div className="rounded-xl border border-dark-700 bg-dark-800 p-4">
          <div className="text-2xl font-bold tabular-nums text-accent-400">
            {summary.claimed_total}
          </div>
          <div className="text-xs text-dark-400">{t('admin.autoMessages.tiles.claimed')}</div>
        </div>
        <div className="rounded-xl border border-dark-700 bg-dark-800 p-4">
          <div className="text-2xl font-bold tabular-nums text-dark-100">
            {summary.live_count}
            <span className="text-base text-dark-400"> / {summary.total_count}</span>
          </div>
          <div className="text-xs text-dark-400">{t('admin.autoMessages.tiles.live')}</div>
        </div>
        <div className="rounded-xl border border-dark-700 bg-dark-800 p-4">
          <div className="text-2xl font-bold tabular-nums text-dark-100">
            {summary.configurable_count}
          </div>
          <div className="text-xs text-dark-400">{t('admin.autoMessages.tiles.editable')}</div>
        </div>
      </div>

      <p className="mb-1 text-xs text-dark-500">{t('admin.autoMessages.tiles.caveat')}</p>
      <p className="mb-6 text-xs text-dark-500">{t('admin.autoMessages.scope')}</p>

      {GROUP_ORDER.map((group) => {
        const groupItems = items.filter((item) => item.group === group);
        if (groupItems.length === 0) return null;
        return (
          <div key={group} className="mb-6">
            <div className="mb-2 flex items-center gap-2">
              <h2 className="text-sm font-semibold text-dark-200">{t(GROUP_TITLES[group])}</h2>
              <span className="text-xs tabular-nums text-dark-500">{groupItems.length}</span>
            </div>
            <div className="space-y-2">
              {groupItems.map((item) => (
                <MessageRow
                  key={item.id}
                  item={item}
                  onOpen={() => navigate(`/admin/auto-messages/${item.id}`)}
                />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
