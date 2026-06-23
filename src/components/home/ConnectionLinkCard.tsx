import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { subscriptionApi } from '../../api/subscription';
import { resolveConnectionUrlForUi } from '../../utils/connectionLink';
import { copyToClipboard } from '../../utils/clipboard';
import { CopyIcon, CheckIcon } from '@/components/icons';

/**
 * «Моя ссылка для подключения» — НИЗ объединённого экрана (Чат 3b, §16/§19 п.12).
 *
 * Главное — широкая понятная кнопка «Скопировать ссылку» (вместо прежнего крошечного
 * кода opacity-30 + безымянной иконки). Логика выбора ссылки (happ-crypt и пр.) и copy
 * перенесены из `Subscription.tsx` без изменений — тот же `resolveConnectionUrlForUi`.
 *
 * Видимость:
 *  — `visible` приходит из `ScreenState.linkVisible` (уже учитывает accessEnded/pending/
 *    disabled и `subscription.hide_subscription_link`);
 *  — дополнительно уважаем `connectionLink.hide_link` (отдельный серверный флаг этого эндпоинта);
 *  — пока ссылка не разрешилась (грузится) — не рисуем ничего (она ниже сгиба, мерцания нет).
 *
 * Запрос `['connection-link', subscriptionId]` enabled ТОЛЬКО когда ссылка видима — в
 * скрытых состояниях лишнего обращения к сети нет.
 */
export default function ConnectionLinkCard({
  subscriptionId,
  subscriptionUrl,
  visible,
}: {
  subscriptionId: number | undefined;
  /** Фолбэк-URL из подписки (на случай, если эндпоинт ссылки ещё/уже недоступен). */
  subscriptionUrl: string | null;
  /** ScreenState.linkVisible — ссылка разрешена в текущем состоянии. */
  visible: boolean;
}) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const [showHint, setShowHint] = useState(false);

  const { data: connectionLink, isLoading } = useQuery({
    queryKey: ['connection-link', subscriptionId],
    queryFn: () => subscriptionApi.getConnectionLink(subscriptionId),
    retry: false,
    staleTime: 0,
    enabled: visible && subscriptionId != null,
  });

  const displayedUrl = useMemo(
    () =>
      resolveConnectionUrlForUi({
        mode: connectionLink?.connect_mode,
        happSchemeLink: connectionLink?.happ_scheme_link,
        displayLink: connectionLink?.display_link,
        subscriptionUrl: connectionLink?.subscription_url,
        happCryptLink: connectionLink?.happ_cryptolink,
        happCryptoLink: connectionLink?.happ_crypto_link,
        happLink: connectionLink?.happ_link,
        fallbackUrl: isLoading ? null : subscriptionUrl,
      }),
    [
      connectionLink?.connect_mode,
      connectionLink?.display_link,
      connectionLink?.happ_cryptolink,
      connectionLink?.happ_crypto_link,
      connectionLink?.happ_link,
      connectionLink?.happ_scheme_link,
      connectionLink?.subscription_url,
      isLoading,
      subscriptionUrl,
    ],
  );

  const copy = () => {
    if (!displayedUrl) return;
    void copyToClipboard(displayedUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Скрыта состоянием, спрятана сервером, или ещё не разрешилась — ничего не рисуем.
  if (!visible || connectionLink?.hide_link || !displayedUrl) return null;

  return (
    <section className="space-y-2">
      <div className="flex items-center gap-1.5 px-1">
        <span className="text-sm font-medium text-dark-50/70">{t('home.link.title')}</span>
        <button
          type="button"
          onClick={() => setShowHint((v) => !v)}
          aria-label={t('home.link.help')}
          aria-expanded={showHint}
          className="flex h-4 w-4 items-center justify-center rounded-full bg-dark-50/10 text-[10px] font-bold text-dark-50/50 transition-colors hover:bg-dark-50/20 hover:text-dark-50/70"
        >
          ?
        </button>
      </div>

      {showHint && (
        <p className="px-1 text-[12px] leading-snug text-dark-50/45">{t('home.link.hint')}</p>
      )}

      <button
        type="button"
        onClick={copy}
        className={`flex w-full items-center justify-center gap-2.5 rounded-2xl p-3.5 text-sm font-semibold transition-all active:scale-[0.99] ${
          copied
            ? 'bg-success-500/15 text-success-400'
            : 'border border-accent-400/25 bg-accent-500/15 text-accent-300 hover:bg-accent-500/25'
        }`}
      >
        {copied ? <CheckIcon className="h-4 w-4" /> : <CopyIcon className="h-4 w-4" />}
        {copied ? t('home.link.copied') : t('home.link.copy')}
      </button>

      {/* Сама ссылка — мелким приглушённым (для доверия, что копируется), но не как главный элемент. */}
      <div className="truncate px-1 font-mono text-[10px] text-dark-50/25" title={displayedUrl}>
        {displayedUrl}
      </div>
    </section>
  );
}
