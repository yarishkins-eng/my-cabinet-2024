import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import axios from 'axios';
import { AutoMessageParams, AutoMessagePatch, autoMessagesApi } from '../api/autoMessages';
import { useDestructiveConfirm } from '../platform/hooks/useNativeDialog';
import { usePlatform } from '../platform/hooks/usePlatform';
import { BackIcon } from '@/components/icons';

type Field = keyof AutoMessageParams;

const FIELD_LABELS: Record<Field, string> = {
  warn_hours: 'admin.autoMessages.detail.warnHours',
  discount_percent: 'admin.autoMessages.detail.percent',
  valid_hours: 'admin.autoMessages.detail.hours',
  trigger_days: 'admin.autoMessages.detail.days',
  not_connected_after_hours: 'admin.autoMessages.detail.notConnectedHours',
};

const FIELD_HINTS: Record<Field, string> = {
  warn_hours: 'admin.autoMessages.detail.warnHoursHint',
  discount_percent: 'admin.autoMessages.detail.percentHint',
  valid_hours: 'admin.autoMessages.detail.hoursHint',
  trigger_days: 'admin.autoMessages.detail.daysHint',
  not_connected_after_hours: 'admin.autoMessages.detail.notConnectedHoursHint',
};

/** Готовые значения вместо шага. Шаг 12 не давал попасть ни в сутки, ни в двое суток. */
const FIELD_CHOICES: Partial<Record<Field, number[]>> = {
  warn_hours: [2, 3, 4, 6, 12, 24, 48],
  valid_hours: [6, 12, 24, 48, 72, 168],
  discount_percent: [5, 10, 15, 20, 25, 30, 40, 50],
  not_connected_after_hours: [1, 2, 3, 4, 6, 12, 24],
};

/** Запасные границы. Настоящие приходят с сервера в `limits`. */
const FALLBACK_RANGE: Record<Field, [number, number]> = {
  warn_hours: [2, 48],
  discount_percent: [1, 50],
  valid_hours: [1, 168],
  trigger_days: [1, 30],
  not_connected_after_hours: [1, 24],
};

function unitFor(field: Field): string {
  if (field === 'discount_percent') return '%';
  if (field === 'trigger_days') return 'дн';
  return 'ч';
}

/** Мишень 44 px и подпись для озвучки. */
function Toggle({
  on,
  disabled,
  label,
  onClick,
}: {
  on: boolean;
  disabled?: boolean;
  label: string;
  onClick: () => void;
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

function Choices({
  value,
  choices,
  min,
  max,
  unit,
  onChange,
}: {
  value: number;
  choices: number[];
  min: number;
  max: number;
  unit: string;
  onChange: (next: number) => void;
}) {
  const allowed = choices.filter((choice) => choice >= min && choice <= max);
  const list = allowed.includes(value) ? allowed : [...allowed, value].sort((a, b) => a - b);
  return (
    <div className="flex flex-wrap gap-1.5">
      {list.map((choice) => (
        <button
          key={choice}
          type="button"
          onClick={() => onChange(choice)}
          className={`min-h-[36px] rounded-lg border px-3 text-sm tabular-nums transition-colors ${
            choice === value
              ? 'border-accent-500 bg-accent-500/15 text-accent-300'
              : 'border-dark-700 text-dark-300 hover:border-dark-600'
          }`}
        >
          {choice} {unit}
        </button>
      ))}
    </div>
  );
}

function Stepper({
  value,
  unit,
  min,
  max,
  onChange,
}: {
  value: number;
  unit: string;
  min: number;
  max: number;
  onChange: (next: number) => void;
}) {
  return (
    <div className="flex flex-none items-center overflow-hidden rounded-lg border border-dark-700">
      <button
        type="button"
        aria-label="−"
        disabled={value <= min}
        onClick={() => onChange(Math.max(min, value - 1))}
        className="h-11 w-11 bg-dark-700 text-dark-100 disabled:text-dark-600"
      >
        −
      </button>
      <div className="w-20 bg-dark-900 text-center text-sm tabular-nums leading-[44px] text-dark-100">
        {value} {unit}
      </div>
      <button
        type="button"
        aria-label="+"
        disabled={value >= max}
        onClick={() => onChange(Math.min(max, value + 1))}
        className="h-11 w-11 bg-dark-700 text-dark-100 disabled:text-dark-600"
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
  const confirmOff = useDestructiveConfirm();
  const { id } = useParams<{ id: string }>();

  const [draft, setDraft] = useState<AutoMessageParams | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['admin-auto-message', id],
    queryFn: () => autoMessagesApi.get(id as string),
    enabled: Boolean(id),
  });

  // Сверяемся по ЗНАЧЕНИЯМ, а не по объекту: после щелчка тумблером карточка
  // перезапрашивается, приходит новый объект с теми же числами — и черновик,
  // в котором уже выбрано «3 ч», молча возвращался к серверным «2 ч».
  const paramsSignature = data?.params ? JSON.stringify(data.params) : null;
  useEffect(() => {
    if (paramsSignature) setDraft(JSON.parse(paramsSignature) as AutoMessageParams);
  }, [paramsSignature]);

  const serverParams = data?.params ?? null;
  const changedFields: Field[] =
    serverParams && draft
      ? (Object.keys(draft) as Field[]).filter((field) => draft[field] !== serverParams[field])
      : [];

  const showError = (mutationError: unknown) => {
    const detail = axios.isAxiosError(mutationError)
      ? (mutationError.response?.data as { detail?: unknown } | undefined)?.detail
      : undefined;
    setError(typeof detail === 'string' ? detail : t('admin.autoMessages.save.failed'));
    setSaved(false);
  };

  const saveMutation = useMutation({
    mutationFn: (payload: AutoMessagePatch) => autoMessagesApi.patch(id as string, payload),
    onSuccess: () => {
      setError(null);
      setSaved(true);
      queryClient.invalidateQueries({ queryKey: ['admin-auto-message', id] });
      queryClient.invalidateQueries({ queryKey: ['admin-auto-messages'] });
    },
    onError: (mutationError) => {
      showError(mutationError);
      if (data?.params) setDraft({ ...data.params });
    },
  });

  const toggleMutation = useMutation({
    mutationFn: (enabled: boolean) => autoMessagesApi.patch(id as string, { enabled }),
    onSuccess: () => {
      setError(null);
      // Иначе плашка «Сохранено» от правки числа остаётся висеть и читается
      // как подтверждение выключения, которым она не является.
      setSaved(false);
      queryClient.invalidateQueries({ queryKey: ['admin-auto-message', id] });
      queryClient.invalidateQueries({ queryKey: ['admin-auto-messages'] });
    },
    onError: showError,
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

  // Пока идёт любая из двух правок, вторая недоступна: иначе ответы приходят вразнобой
  // и плашка «Сохранено» всплывает уже после выключения сообщения.
  const busy = saveMutation.isPending || toggleMutation.isPending;
  const manageable = data.control === 'toggle';
  const quiet = data.state === 'quiet';

  const handleToggle = async () => {
    if (data.enabled) {
      // 🔴 Диалог — последнее, что он прочитает. Умолчать здесь о паре значит
      // дать выключить «Подписка истекла» человеку, который этого не хотел.
      const question = data.shares_switch_with
        ? t('admin.autoMessages.confirmOffPair', {
            title: data.title,
            other: data.shares_switch_with,
          })
        : t('admin.autoMessages.confirmOff', { title: data.title });
      // Нативный диалог Telegram отказывается показывать текст длиннее 256 символов —
      // и тогда тумблер просто перестаёт работать, без ошибки и без окна. Обрезаем сами.
      const asked = question.length > 240 ? `${question.slice(0, 239)}…` : question;
      const ok = await confirmOff(asked, t('admin.autoMessages.confirmOffAction'));
      if (!ok) return;
    }
    toggleMutation.mutate(!data.enabled);
  };

  return (
    <div className="animate-fade-in">
      <div className="mb-4 flex items-center gap-3">
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
        </div>
      </div>

      {/* Переключатель — в шапке, до превью кнопок. Внутри блока настроек на телефоне
          он оказался бы за первым экраном, и выключить сообщение было бы нечем. */}
      <div className="mb-4 rounded-xl border border-dark-700 bg-dark-800 p-4">
        <div className="flex items-center gap-3">
          {manageable ? (
            <Toggle
              on={Boolean(data.enabled)}
              disabled={busy}
              label={data.title}
              onClick={handleToggle}
            />
          ) : null}
          <div className="min-w-0">
            {/* 🔴 Сначала — отправляется ли сообщение на самом деле. Тумблер «вкл» при
                молчащем сообщении читается как «клиенты это получают», а они не получают:
                список на той же записи честно писал «не отправляется», и два экрана
                одного раздела говорили противоположное. */}
            <div className="text-sm font-semibold text-dark-100">
              {quiet
                ? t('admin.autoMessages.detail.notSending')
                : manageable
                  ? data.enabled
                    ? t('admin.autoMessages.detail.switchOn')
                    : t('admin.autoMessages.detail.switchOff')
                  : t('admin.autoMessages.locked.hint')}
            </div>
            {quiet && data.quiet_reason && (
              <div className="mt-0.5 text-xs text-dark-400">{data.quiet_reason}</div>
            )}
            {/* Показываем положение своего тумблера ТОЛЬКО когда молчание вызвано не им.
                Иначе рядом вставали «Сейчас не отправляется» и «Сообщение включено» —
                то же противоречие, что и раньше, просто переехавшее на строку ниже.
                А когда выключил он сам, третья строка об этом же — лишнее повторение. */}
            {quiet && manageable && data.enabled && (
              <div className="mt-0.5 text-xs text-dark-500">
                {t('admin.autoMessages.detail.ownSwitchOn')}
              </div>
            )}
            {quiet && !manageable && (
              <div className="mt-0.5 text-xs text-dark-500">
                {t('admin.autoMessages.locked.hint')}
              </div>
            )}
            {!quiet && data.note && <div className="mt-0.5 text-xs text-dark-400">{data.note}</div>}
          </div>
        </div>

        {data.shares_switch_with && (
          <p className="mt-3 rounded-lg border border-dark-700 bg-dark-900 px-3 py-2 text-xs text-dark-300">
            {t('admin.autoMessages.detail.sharesSwitch', { other: data.shares_switch_with })}
          </p>
        )}
        {data.warning && (
          // Янтарный, не красный: красным на этом экране помечены отказы, и красить им
          // разрешённое осознанное действие — значит научить пролистывать красное.
          // `whitespace-pre-line`: длинное предупреждение читается абзацами, а не одним
          // комом. Без него переносы из текста сервера схлопываются в пробелы.
          <p className="mt-3 whitespace-pre-line rounded-lg border border-warning-500/40 bg-warning-500/10 px-3 py-2 text-xs text-warning-300">
            {data.warning}
          </p>
        )}
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
          {draft && Object.keys(draft).length > 0 && (
            <div className="rounded-xl border border-dark-700 bg-dark-800 p-4">
              <div className="mb-3 text-[11px] uppercase tracking-wider text-dark-500">
                {t('admin.autoMessages.detail.when')}
              </div>
              {(Object.keys(draft) as Field[]).map((field) => {
                const [min, max] =
                  (data.limits?.[field] as [number, number]) ?? FALLBACK_RANGE[field];
                const choices = FIELD_CHOICES[field];
                return (
                  <div
                    key={field}
                    className="border-t border-dark-700 py-3 first:border-t-0 first:pt-0"
                  >
                    <div className="text-sm text-dark-100">{t(FIELD_LABELS[field])}</div>
                    <div className="mb-2 text-xs text-dark-500">{t(FIELD_HINTS[field])}</div>
                    {choices ? (
                      <Choices
                        value={draft[field] as number}
                        choices={choices}
                        min={min}
                        max={max}
                        unit={unitFor(field)}
                        onChange={(next) => {
                          setSaved(false);
                          setDraft({ ...draft, [field]: next });
                        }}
                      />
                    ) : (
                      <Stepper
                        value={draft[field] as number}
                        unit={unitFor(field)}
                        min={min}
                        max={max}
                        onChange={(next) => {
                          setSaved(false);
                          setDraft({ ...draft, [field]: next });
                        }}
                      />
                    )}
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
                          from: serverParams?.[field],
                          to: draft[field],
                        }),
                      )
                      .join(' · ')}
                  </div>
                  <div className="flex flex-none gap-2">
                    <button
                      type="button"
                      onClick={() => setDraft({ ...(serverParams as AutoMessageParams) })}
                      className="min-h-[44px] rounded-lg border border-dark-600 px-4 text-sm text-dark-300"
                    >
                      {t('admin.autoMessages.save.cancel')}
                    </button>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        saveMutation.mutate(
                          Object.fromEntries(
                            changedFields.map((field) => [field, draft[field]]),
                          ) as AutoMessagePatch,
                        )
                      }
                      className="min-h-[44px] rounded-lg bg-accent-500 px-4 text-sm font-semibold text-white disabled:opacity-60"
                    >
                      {t('admin.autoMessages.save.action')}
                    </button>
                  </div>
                </div>
              )}
              <p className="mt-3 text-xs text-dark-500">
                {/* Про сгоревший процент говорим ТОЛЬКО сообщениям со скидкой: у писем
                    без неё эта строка читалась как будто письмо раздаёт скидки. */}
                {t(
                  draft && 'discount_percent' in draft
                    ? 'admin.autoMessages.detail.futureOnlyDiscount'
                    : 'admin.autoMessages.detail.futureOnly',
                )}
              </p>
            </div>
          )}

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
                      {data.claim_tracked && (
                        <th className="pb-2 text-left">
                          {t('admin.autoMessages.history.claimed')}
                        </th>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {data.history.map((row, index) => (
                      <tr key={`${row.user_ref}-${index}`} className="border-b border-dark-700/60">
                        <td className="py-2 pr-3 text-xs tabular-nums text-dark-400">
                          {row.sent_at ? new Date(row.sent_at).toLocaleString('ru-RU') : '—'}
                        </td>
                        <td className="py-2 pr-3 text-dark-200">{row.user_ref}</td>
                        {data.claim_tracked && (
                          <td className="py-2">
                            {row.claimed ? (
                              <span className="text-success-400">
                                {t('admin.autoMessages.history.yes')}
                              </span>
                            ) : (
                              <span className="text-dark-500">
                                {t('admin.autoMessages.history.no')}
                              </span>
                            )}
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {data.sent_count !== null && (
              <p className="mt-3 text-xs text-dark-500">{data.history_note}</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
