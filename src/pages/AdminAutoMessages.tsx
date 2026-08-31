import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AutoMessageItem, GROUP_ORDER, GROUP_TITLES, autoMessagesApi } from '../api/autoMessages';
import { useDestructiveConfirm } from '../platform/hooks/useNativeDialog';
import { usePlatform } from '../platform/hooks/usePlatform';
import { BackIcon } from '@/components/icons';

/** Замок вместо переключателя: у сообщения нет настроек в боте, и врать об этом нельзя. */
function LockIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden="true"
    >
      <rect x="5" y="11" width="14" height="10" rx="2" />
      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
    </svg>
  );
}

function Toggle({
  on,
  disabled,
  onClick,
}: {
  on: boolean;
  disabled?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      disabled={disabled}
      onClick={onClick}
      className={`relative h-6 w-11 flex-none rounded-full transition-colors disabled:opacity-50 ${
        on ? 'bg-accent-500/40' : 'bg-dark-600'
      }`}
    >
      <span
        className={`absolute top-1 h-4 w-4 rounded-full transition-all ${
          on ? 'left-6 bg-accent-400' : 'left-1 bg-dark-400'
        }`}
      />
    </button>
  );
}

function MessageRow({
  item,
  onToggle,
  onOpen,
  busy,
}: {
  item: AutoMessageItem;
  onToggle: (item: AutoMessageItem) => void;
  onOpen: (item: AutoMessageItem) => void;
  busy: boolean;
}) {
  const { t } = useTranslation();
  const quiet = item.state === 'quiet';

  return (
    <div
      className={`flex items-center gap-3 rounded-xl border border-dark-700 bg-dark-800 p-3 ${
        quiet ? 'opacity-60' : ''
      }`}
    >
      <div className="flex w-11 flex-none justify-center">
        {item.control === 'toggle' ? (
          <Toggle on={Boolean(item.enabled)} disabled={busy} onClick={() => onToggle(item)} />
        ) : (
          <span className="text-dark-500" title={t('admin.autoMessages.control.locked')}>
            <LockIcon />
          </span>
        )}
      </div>

      <button type="button" onClick={() => onOpen(item)} className="min-w-0 flex-1 text-left">
        <div className="truncate text-sm font-semibold text-dark-100">{item.title}</div>
        <div className="mt-0.5 text-xs text-dark-400">{item.when}</div>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          <span
            className={`rounded px-2 py-0.5 text-[11px] ${
              quiet ? 'bg-dark-700 text-dark-400' : 'bg-success-500/15 text-success-400'
            }`}
          >
            {quiet ? t('admin.autoMessages.state.quiet') : t('admin.autoMessages.state.live')}
          </span>
          {(item.quiet_reason || item.note) && (
            <span className="rounded bg-dark-700 px-2 py-0.5 text-[11px] text-dark-400">
              {item.quiet_reason ?? item.note}
            </span>
          )}
          <span className="rounded bg-dark-700 px-2 py-0.5 text-[11px] text-dark-400">
            {item.control === 'toggle'
              ? t('admin.autoMessages.control.edit')
              : item.control === 'server'
                ? t('admin.autoMessages.control.server')
                : t('admin.autoMessages.control.locked')}
          </span>
        </div>
      </button>

      <div className="flex flex-none gap-4 text-right">
        <div>
          <div className="text-sm tabular-nums text-dark-200">
            {item.sent_count === null ? '—' : item.sent_count}
          </div>
          <div className="text-[10px] uppercase tracking-wide text-dark-500">
            {t('admin.autoMessages.tiles.sent')}
          </div>
        </div>
        <div>
          <div
            className={`text-sm tabular-nums ${
              item.claim_tracked ? 'text-success-400' : 'text-dark-500'
            }`}
          >
            {item.claim_tracked ? item.claimed_count : '—'}
          </div>
          <div className="text-[10px] uppercase tracking-wide text-dark-500">
            {t('admin.autoMessages.tiles.claimed')}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function AdminAutoMessages() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { capabilities } = usePlatform();
  const confirmOff = useDestructiveConfirm();
  const [error, setError] = useState<string | null>(null);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['admin-auto-messages'],
    queryFn: autoMessagesApi.list,
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      autoMessagesApi.patch(id, { enabled }),
    onSuccess: () => {
      setError(null);
      queryClient.invalidateQueries({ queryKey: ['admin-auto-messages'] });
    },
    onError: () => setError(t('admin.autoMessages.save.failed')),
  });

  const handleToggle = async (item: AutoMessageItem) => {
    if (item.enabled) {
      const ok = await confirmOff(
        t('admin.autoMessages.confirmOff', { title: item.title }),
        t('admin.autoMessages.confirmOffAction'),
      );
      if (!ok) return;
    }
    toggleMutation.mutate({ id: item.id, enabled: !item.enabled });
  };

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
  const busy = toggleMutation.isPending;

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
          </div>
        </div>

        {/* Только справка. Этот выключатель живёт в настройках бота: он пишет общий
            ключ конфигурации и вдобавок глушит уведомления клиентам об ответах
            поддержки — такой радиус раздел про автосообщения обещать не может. */}
        <div className="max-w-sm rounded-xl border border-dark-700 bg-dark-800 p-3">
          <div className="text-sm font-semibold text-dark-100">
            {summary.global_enabled
              ? t('admin.autoMessages.master.on')
              : t('admin.autoMessages.master.off')}
          </div>
          <div className="mt-0.5 text-xs text-dark-400">
            {t('admin.autoMessages.master.hint', { count: summary.global_affects })}
          </div>
          <div className="mt-1 text-xs text-dark-500">{t('admin.autoMessages.master.where')}</div>
        </div>
      </div>

      {error && (
        <div className="mb-4 rounded-xl border border-error-500/40 bg-error-500/10 p-3 text-sm text-error-300">
          {error}
        </div>
      )}

      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
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

      <p className="mb-6 text-xs text-dark-500">{t('admin.autoMessages.tiles.caveat')}</p>

      {items.length === 0 ? (
        <div className="rounded-xl border border-dark-700 bg-dark-800 p-6 text-center text-sm text-dark-400">
          {t('admin.autoMessages.empty')}
        </div>
      ) : (
        GROUP_ORDER.map((group) => {
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
                    busy={busy}
                    onToggle={handleToggle}
                    onOpen={(target) => navigate(`/admin/auto-messages/${target.id}`)}
                  />
                ))}
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}
