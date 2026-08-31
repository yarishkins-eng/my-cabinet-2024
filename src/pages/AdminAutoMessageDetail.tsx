import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import axios from 'axios';
import { AutoMessageParams, AutoMessagePatch, autoMessagesApi } from '../api/autoMessages';
import { usePlatform } from '../platform/hooks/usePlatform';
import { BackIcon } from '@/components/icons';

const FIELD_LABELS: Record<keyof AutoMessageParams, string> = {
  discount_percent: 'admin.autoMessages.detail.percent',
  valid_hours: 'admin.autoMessages.detail.hours',
  trigger_days: 'admin.autoMessages.detail.days',
};

const FIELD_HINTS: Record<keyof AutoMessageParams, string> = {
  discount_percent: 'admin.autoMessages.detail.percentHint',
  valid_hours: 'admin.autoMessages.detail.hoursHint',
  trigger_days: 'admin.autoMessages.detail.daysHint',
};

const FIELD_STEP: Record<keyof AutoMessageParams, number> = {
  discount_percent: 5,
  valid_hours: 12,
  trigger_days: 1,
};

/** Запасные границы. Настоящие приходят с сервера в `limits`: пол «через сколько
 *  дней» у разных сообщений разный, и зашитая здесь единица врала бы третьей волне. */
const FALLBACK_RANGE: Record<keyof AutoMessageParams, [number, number]> = {
  discount_percent: [1, 50],
  valid_hours: [1, 168],
  trigger_days: [1, 60],
};

function Stepper({
  value,
  suffix,
  min,
  max,
  step,
  onChange,
}: {
  value: number;
  suffix: string;
  min: number;
  max: number;
  step: number;
  onChange: (next: number) => void;
}) {
  return (
    <div className="flex flex-none items-center overflow-hidden rounded-lg border border-dark-700">
      <button
        type="button"
        aria-label="−"
        disabled={value <= min}
        onClick={() => onChange(Math.max(min, value - step))}
        className="h-9 w-9 bg-dark-700 text-dark-100 disabled:text-dark-600"
      >
        −
      </button>
      <div className="w-20 bg-dark-900 text-center text-sm tabular-nums leading-9 text-dark-100">
        {value} {suffix}
      </div>
      <button
        type="button"
        aria-label="+"
        disabled={value >= max}
        onClick={() => onChange(Math.min(max, value + step))}
        className="h-9 w-9 bg-dark-700 text-dark-100 disabled:text-dark-600"
      >
        +
      </button>
    </div>
  );
}

export default function AdminAutoMessageDetail() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { capabilities } = usePlatform();
  const { id } = useParams<{ id: string }>();

  const [draft, setDraft] = useState<AutoMessageParams | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['admin-auto-message', id],
    queryFn: () => autoMessagesApi.get(id as string),
    enabled: Boolean(id),
  });

  // Черновик заводится от серверных значений и живёт до «Сохранить» или «Отменить».
  // Мгновенное применение — ровно тот недостаток чат-админки, ради которого экран и делается.
  useEffect(() => {
    if (data?.params) setDraft({ ...data.params });
  }, [data?.params]);

  // Без useMemo намеренно: список из трёх полей, а компилятор React не берётся
  // сохранить ручную мемоизацию на nullable-черновике и валит сборку.
  const serverParams = data?.params ?? null;
  const changedFields: (keyof AutoMessageParams)[] =
    serverParams && draft
      ? (Object.keys(draft) as (keyof AutoMessageParams)[]).filter(
          (field) => draft[field] !== serverParams[field],
        )
      : [];

  const saveMutation = useMutation({
    mutationFn: (payload: AutoMessagePatch) => autoMessagesApi.patch(id as string, payload),
    onSuccess: () => {
      setError(null);
      setSaved(true);
      queryClient.invalidateQueries({ queryKey: ['admin-auto-message', id] });
      queryClient.invalidateQueries({ queryKey: ['admin-auto-messages'] });
    },
    onError: (mutationError) => {
      // Сервер объясняет отказ по-русски (потолок скидки, диапазон часов) — показываем
      // именно его причину, а не общее «не удалось».
      const detail = axios.isAxiosError(mutationError)
        ? (mutationError.response?.data as { detail?: unknown } | undefined)?.detail
        : undefined;
      setError(typeof detail === 'string' ? detail : t('admin.autoMessages.save.failed'));
      setSaved(false);
      if (data?.params) setDraft({ ...data.params });
    },
  });

  if (isLoading) {
    return (
      <div className="animate-fade-in space-y-3">
        {[0, 1, 2].map((row) => (
          <div
            key={row}
            className="h-24 animate-pulse rounded-xl border border-dark-700 bg-dark-800"
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

  const editable = data.control === 'toggle' && draft !== null;

  return (
    <div className="animate-fade-in">
      <div className="mb-6 flex items-center gap-3">
        {!capabilities.hasBackButton && (
          <button
            onClick={() => navigate('/admin/auto-messages')}
            className="flex h-10 w-10 items-center justify-center rounded-xl border border-dark-700 bg-dark-800 transition-colors hover:border-dark-600"
          >
            <BackIcon />
          </button>
        )}
        <div className="min-w-0">
          <h1 className="text-xl font-semibold text-dark-100">{data.title}</h1>
          <p className="text-sm text-dark-400">{data.when}</p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            <span
              className={`rounded px-2 py-0.5 text-[11px] ${
                data.state === 'quiet'
                  ? 'bg-dark-700 text-dark-400'
                  : 'bg-success-500/15 text-success-400'
              }`}
            >
              {data.state === 'quiet'
                ? t('admin.autoMessages.state.quiet')
                : t('admin.autoMessages.state.live')}
            </span>
            {(data.quiet_reason || data.note) && (
              <span className="rounded bg-dark-700 px-2 py-0.5 text-[11px] text-dark-400">
                {data.quiet_reason ?? data.note}
              </span>
            )}
          </div>
        </div>
      </div>

      {error && (
        <div className="mb-4 rounded-xl border border-error-500/40 bg-error-500/10 p-3 text-sm text-error-300">
          {error}
        </div>
      )}
      {saved && changedFields.length === 0 && (
        <div className="mb-4 rounded-xl border border-success-500/40 bg-success-500/10 p-3 text-sm text-success-300">
          {t('admin.autoMessages.save.done')}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,340px)_minmax(0,1fr)]">
        <div className="rounded-xl border border-dark-700 bg-dark-800 p-4">
          <div className="mb-3 text-[11px] uppercase tracking-wider text-dark-500">
            {t('admin.autoMessages.detail.preview')}
          </div>
          {data.buttons.length === 0 ? (
            <p className="text-sm text-dark-400">{t('admin.autoMessages.detail.noButtons')}</p>
          ) : (
            <div className="space-y-2">
              {data.buttons.map((button) => (
                <div key={button.label}>
                  <div className="rounded-lg border border-dark-600 bg-dark-700 px-3 py-2 text-center text-sm text-dark-100">
                    {button.label}
                  </div>
                  <div className="mt-1 flex items-start gap-2 px-1 text-[11px] leading-snug text-dark-400">
                    <span
                      className={`flex-none rounded px-1.5 py-0.5 ${
                        button.tracked
                          ? 'bg-success-500/15 text-success-400'
                          : 'bg-dark-700 text-dark-500'
                      }`}
                    >
                      {button.tracked
                        ? t('admin.autoMessages.btn.tracked')
                        : t('admin.autoMessages.btn.untracked')}
                    </span>
                    <span>{button.target}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="space-y-4">
          <div className="rounded-xl border border-dark-700 bg-dark-800 p-4">
            <div className="mb-3 text-[11px] uppercase tracking-wider text-dark-500">
              {t('admin.autoMessages.detail.when')}
            </div>
            {data.control !== 'toggle' ? (
              <p className="text-sm text-dark-400">{t('admin.autoMessages.locked.hint')}</p>
            ) : !editable || Object.keys(draft ?? {}).length === 0 ? (
              <p className="text-sm text-dark-400">{t('admin.autoMessages.detail.switchOnly')}</p>
            ) : (
              <>
                {(Object.keys(draft) as (keyof AutoMessageParams)[]).map((field) => {
                  const [min, max] =
                    (data.limits?.[field] as [number, number]) ?? FALLBACK_RANGE[field];
                  return (
                    <div
                      key={field}
                      className="flex items-center justify-between gap-4 border-t border-dark-700 py-3 first:border-t-0 first:pt-0"
                    >
                      <div>
                        <div className="text-sm text-dark-100">{t(FIELD_LABELS[field])}</div>
                        <div className="text-xs text-dark-500">{t(FIELD_HINTS[field])}</div>
                      </div>
                      <Stepper
                        value={draft[field] as number}
                        suffix={
                          field === 'discount_percent' ? '%' : field === 'valid_hours' ? 'ч' : 'дн'
                        }
                        min={min}
                        max={max}
                        step={FIELD_STEP[field]}
                        onChange={(next) => {
                          setSaved(false);
                          setDraft({ ...draft, [field]: next });
                        }}
                      />
                    </div>
                  );
                })}

                {changedFields.length > 0 && (
                  <div className="mt-4 flex flex-col gap-3 border-t border-dark-700 pt-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="text-xs text-accent-400">
                      {changedFields
                        .map((field) =>
                          t('admin.autoMessages.save.changed', {
                            what: t(FIELD_LABELS[field]),
                            from: data.params?.[field],
                            to: draft[field],
                          }),
                        )
                        .join(' · ')}
                    </div>
                    <div className="flex flex-none gap-2">
                      <button
                        type="button"
                        onClick={() => setDraft({ ...(data.params as AutoMessageParams) })}
                        className="rounded-lg border border-dark-600 px-4 py-2 text-sm text-dark-300"
                      >
                        {t('admin.autoMessages.save.cancel')}
                      </button>
                      <button
                        type="button"
                        disabled={saveMutation.isPending}
                        onClick={() =>
                          saveMutation.mutate(
                            Object.fromEntries(
                              changedFields.map((field) => [field, draft[field]]),
                            ) as AutoMessagePatch,
                          )
                        }
                        className="rounded-lg bg-accent-500 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60"
                      >
                        {t('admin.autoMessages.save.action')}
                      </button>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>

          <div className="rounded-xl border border-dark-700 bg-dark-800 p-4">
            <div className="mb-3 text-[11px] uppercase tracking-wider text-dark-500">
              {t('admin.autoMessages.detail.history')}
            </div>
            {data.sent_count === null ? (
              <p className="text-sm text-dark-400">{t('admin.autoMessages.history.notCounted')}</p>
            ) : data.history.length === 0 ? (
              <p className="text-sm text-dark-400">{t('admin.autoMessages.empty')}</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-dark-700 text-[10px] uppercase tracking-wider text-dark-500">
                      <th className="pb-2 pr-3 text-left">
                        {t('admin.autoMessages.history.when')}
                      </th>
                      <th className="pb-2 pr-3 text-left">{t('admin.autoMessages.history.who')}</th>
                      <th className="pb-2 text-left">{t('admin.autoMessages.history.claimed')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.history.map((row, index) => (
                      <tr key={`${row.user_ref}-${index}`} className="border-b border-dark-700/60">
                        <td className="py-2 pr-3 text-xs tabular-nums text-dark-400">
                          {row.sent_at ? new Date(row.sent_at).toLocaleString('ru-RU') : '—'}
                        </td>
                        <td className="py-2 pr-3 text-dark-200">{row.user_ref}</td>
                        <td className="py-2">
                          {row.claimed === null ? (
                            <span className="text-dark-500">—</span>
                          ) : row.claimed ? (
                            <span className="text-success-400">
                              {t('admin.autoMessages.history.yes')}
                            </span>
                          ) : (
                            <span className="text-dark-500">
                              {t('admin.autoMessages.history.no')}
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {data.sent_count !== null && (
              <p className="mt-3 text-xs text-dark-500">{data.history_note}</p>
            )}
            {data.control === 'toggle' && (
              <p className="mt-3 text-xs text-dark-500">
                {t('admin.autoMessages.detail.futureOnly')}
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
