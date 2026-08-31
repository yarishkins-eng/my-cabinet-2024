import { useState } from 'react';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import axios from 'axios';
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

/** Мишень 44 px и подпись для озвучки: экран открывают и с телефона. */
function Toggle({
  on,
  disabled,
  label,
  onClick,
}: {
  on: boolean;
  disabled?: boolean;
  label: string;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="flex h-11 w-11 flex-none items-center justify-center disabled:opacity-50"
    >
      <span
        className={`relative block h-6 w-11 rounded-full transition-colors ${
          on ? 'bg-accent-500/40' : 'bg-dark-600'
        }`}
      >
        <span
          className={`absolute top-1 h-4 w-4 rounded-full transition-all ${
            on ? 'left-6 bg-accent-400' : 'left-1 bg-dark-400'
          }`}
        />
      </span>
    </button>
  );
}

/** Текущие значения прямо в строке: иначе нужное сообщение ищется перебором карточек. */
function paramsSummary(item: AutoMessageItem): string | null {
  if (!item.params) return null;
  const parts: string[] = [];
  if (item.params.discount_percent !== undefined)
    parts.push(`скидка ${item.params.discount_percent} %`);
  if (item.params.trigger_days !== undefined) parts.push(`через ${item.params.trigger_days} дн.`);
  if (item.params.valid_hours !== undefined) parts.push(`действует ${item.params.valid_hours} ч`);
  return parts.length ? parts.join(' · ') : null;
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
  const summary = paramsSummary(item);

  return (
    // Телефон: всё в столбик. Раньше строка была жёстким рядом, и на 375 px середине
    // оставалось около восьмидесяти пикселей — текст и чипсы рвались в вертикальную лапшу.
    <div
      className={`flex flex-col gap-2 rounded-xl border border-dark-700 bg-dark-800 p-3 sm:flex-row sm:items-center sm:gap-3 ${
        quiet ? 'opacity-60' : ''
      }`}
    >
      <div className="flex min-w-0 flex-1 items-start gap-2">
        <div className="flex flex-none justify-center">
          {item.control === 'toggle' ? (
            <Toggle
              on={Boolean(item.enabled)}
              disabled={busy}
              label={item.title}
              onClick={() => onToggle(item)}
            />
          ) : (
            <span
              className="flex h-11 w-11 items-center justify-center text-dark-500"
              aria-hidden="true"
            >
              <LockIcon />
            </span>
          )}
        </div>

        <button
          type="button"
          onClick={() => onOpen(item)}
          className="min-w-0 flex-1 py-1 text-left"
        >
          <div className="text-sm font-semibold text-dark-100">{item.title}</div>
          <div className="mt-0.5 text-xs text-dark-400">{item.when}</div>
          {summary && <div className="mt-0.5 text-xs text-accent-400">{summary}</div>}
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
      </div>

      <div className="flex flex-none gap-4 pl-[52px] sm:pl-0 sm:text-right">
        <div>
          <div className="text-sm tabular-nums text-dark-200">
            {item.sent_count === null ? '—' : item.sent_count}
          </div>
          <div className="text-[10px] uppercase tracking-wide text-dark-500">
            {item.sent_count === null
              ? t('admin.autoMessages.tiles.notCounted')
              : t('admin.autoMessages.tiles.sent')}
          </div>
        </div>
        <div>
          <div
            className={`text-sm tabular-nums ${item.claim_tracked ? 'text-success-400' : 'text-dark-500'}`}
          >
            {item.claim_tracked ? item.claimed_count : '—'}
          </div>
          <div className="text-[10px] uppercase tracking-wide text-dark-500">
            {item.claim_tracked
              ? t('admin.autoMessages.tiles.claimed')
              : t('admin.autoMessages.tiles.notCounted')}
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
    onError: (mutationError) => {
      // Причину отказа сервер объясняет по-русски. Раньше список её глотал и показывал
      // общее «не удалось», хотя карточка того же раздела причину показывала.
      const detail = axios.isAxiosError(mutationError)
        ? (mutationError.response?.data as { detail?: unknown } | undefined)?.detail
        : undefined;
      setError(typeof detail === 'string' ? detail : t('admin.autoMessages.save.failed'));
    },
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
              // Единственный ответ на «а бот вообще работает и увидел ли мою правку».
              <p className="mt-0.5 text-xs text-dark-500">
                {t('admin.autoMessages.lastCheck')} {lastCycle}
              </p>
            )}
          </div>
        </div>

        {/* Справка, а не орган управления: пунктирная рамка и мелкий текст — чтобы блок
            не выглядел настройкой, в которую человек будет тыкать и считать, что зависло. */}
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

      {error && (
        <div className="mb-4 rounded-xl border border-error-500/40 bg-error-500/10 p-3 text-sm text-error-300">
          {error}
        </div>
      )}

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

      <p className="mb-1 text-xs text-dark-500">{t('admin.autoMessages.tiles.dashMeans')}</p>
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
                  busy={busy}
                  onToggle={handleToggle}
                  onOpen={(target) => navigate(`/admin/auto-messages/${target.id}`)}
                />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
