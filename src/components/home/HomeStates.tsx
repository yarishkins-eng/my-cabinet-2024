import { useTranslation } from 'react-i18next';
import { InfoIcon } from '@/components/icons';

/**
 * «Скучные» состояния оболочки экрана (§19 п.13) — не из `useScreenState`, а уровень
 * страницы: загрузка (skeleton всего верха), ошибка сети, «панель не ответила».
 */

/** Скелет верха на время загрузки подписки. */
export function HomeSkeleton() {
  return (
    <div className="space-y-6" aria-hidden="true">
      <div>
        <div className="skeleton h-7 w-44 rounded-lg" />
        <div className="skeleton mt-2 h-4 w-28 rounded" />
      </div>
      <div className="space-y-2.5">
        <div className="skeleton h-[60px] w-full rounded-2xl" />
        <div className="skeleton h-[60px] w-full rounded-2xl" />
      </div>
      <div className="skeleton h-28 w-full rounded-2xl" />
    </div>
  );
}

/** Понятный экран сетевой ошибки с кнопкой повтора. */
export function HomeError({ onRetry }: { onRetry?: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="border-dark-50/12 rounded-2xl border bg-dark-50/[0.03] p-6 text-center">
      <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-error-500/10 text-error-400">
        <InfoIcon className="h-6 w-6" />
      </div>
      <div className="text-base font-semibold text-dark-50">{t('home.state.errorTitle')}</div>
      <div className="mt-1 text-[13px] text-dark-50/55">{t('home.state.errorText')}</div>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="mt-4 rounded-xl bg-accent-500 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-accent-600"
        >
          {t('home.state.retry')}
        </button>
      )}
    </div>
  );
}

/**
 * Мягкое уведомление «панель не ответила» (`panel_ok=false`). Само решение «не зажигать
 * ложное Подключить» уже принято в `useScreenState`; здесь — спокойный статус, что VPN жив.
 */
export function PanelDownNotice() {
  const { t } = useTranslation();
  return (
    <div className="flex gap-3 rounded-2xl border border-warning-400/25 bg-warning-500/[0.08] p-3.5">
      <span className="mt-0.5 flex-shrink-0 text-warning-300">
        <InfoIcon className="h-5 w-5" />
      </span>
      <div>
        <div className="text-sm font-semibold text-warning-200">{t('home.state.panelTitle')}</div>
        <div className="mt-1 text-[13px] text-dark-50/55">{t('home.state.panelText')}</div>
      </div>
    </div>
  );
}
