import { useTranslation } from 'react-i18next';
import { ClockIcon, InfoIcon, GiftIcon, WalletIcon } from '@/components/icons';
import type { ScreenState } from '../../hooks/useScreenState';
import type { HomeActions } from './types';

type Tone = 'info' | 'neutral' | 'danger' | 'warning';

const TONE: Record<Tone, { box: string; icon: string; title: string }> = {
  info: {
    box: 'border-accent-400/25 bg-accent-500/10',
    icon: 'text-accent-300',
    title: 'text-dark-50',
  },
  neutral: {
    box: 'border-dark-50/12 bg-dark-50/[0.04]',
    icon: 'text-dark-50/50',
    title: 'text-dark-50',
  },
  danger: {
    box: 'border-error-500/30 bg-error-500/[0.1]',
    icon: 'text-error-400',
    title: 'text-error-300',
  },
  warning: {
    box: 'border-warning-400/30 bg-warning-500/[0.1]',
    icon: 'text-warning-300',
    title: 'text-warning-200',
  },
};

function Banner({
  tone,
  icon,
  title,
  text,
  children,
}: {
  tone: Tone;
  icon: React.ReactNode;
  title: string;
  text?: string;
  children?: React.ReactNode;
}) {
  const c = TONE[tone];
  return (
    <div className={`rounded-2xl border p-3.5 ${c.box}`}>
      <div className="flex gap-3">
        <span className={`mt-0.5 flex-shrink-0 ${c.icon}`}>{icon}</span>
        <div className="min-w-0 flex-1">
          <div className={`text-sm font-semibold leading-snug ${c.title}`}>{title}</div>
          {text && <div className="mt-1 text-[13px] leading-snug text-dark-50/55">{text}</div>}
          {children && <div className="mt-2.5">{children}</div>}
        </div>
      </div>
    </div>
  );
}

/** Маленькая кнопка-пилюля внутри баннера. */
function PillButton({
  onClick,
  children,
  tone = 'neutral',
}: {
  onClick?: () => void;
  children: React.ReactNode;
  tone?: 'accent' | 'neutral' | 'warning';
}) {
  const cls = {
    accent: 'bg-accent-500 text-white hover:bg-accent-600',
    neutral: 'border border-dark-50/15 text-dark-50/80 hover:bg-dark-50/[0.06]',
    warning: 'border border-warning-400/40 text-warning-100 hover:bg-warning-500/15',
  }[tone];
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-xl px-3.5 py-2 text-[13px] font-semibold transition-colors active:scale-[0.98] ${cls}`}
    >
      {children}
    </button>
  );
}

/**
 * Перекрывающие баннеры и статус-строки верха (§16). Рисуем по `ScreenState`:
 *  — `overlay='payment_pending'` → «Платёж обрабатывается» + «Проверить оплату» (без продающих кнопок);
 *  — `overlay='disabled'` → нейтральный текст + Поддержка; подсказка 'channel' → «вернись в канал»;
 *  — `accessEnded` (T5/P8) → красный баннер «Подписка закончилась» (плашка ИСТЕКЛА — в карточке);
 *  — `code='grace'` → жёлтый баннер-подарок «VPN ещё работает 2 дня»;
 *  — `trafficExhausted` (P9/T4, подписка жива) → строка «трафик кончился» (тише, не красным).
 */
export default function OverlayBanner({
  state,
  actions = {},
  disabledReasonHint,
  graceUntil,
  graceDays = 2,
}: {
  state: ScreenState;
  actions?: HomeActions;
  disabledReasonHint?: string | null;
  graceUntil?: string | null;
  graceDays?: number;
}) {
  const { t } = useTranslation();

  // ── Уровень 1: платёж обрабатывается ──
  if (state.overlay === 'payment_pending') {
    return (
      <Banner
        tone="info"
        icon={<ClockIcon className="h-5 w-5" />}
        title={t('home.banner.pendingTitle')}
        text={t('home.banner.pendingText')}
      >
        <PillButton tone="accent" onClick={actions.onCheckPayment}>
          {t('home.banner.checkPayment')}
        </PillButton>
      </Banner>
    );
  }

  // ── Уровень 1: временно отключён (причина 'channel' best-effort) ──
  if (state.overlay === 'disabled') {
    const isChannel = disabledReasonHint === 'channel';
    return (
      <Banner
        tone="neutral"
        icon={<InfoIcon className="h-5 w-5" />}
        title={isChannel ? t('home.banner.disabledChannelTitle') : t('home.banner.disabledTitle')}
        text={isChannel ? t('home.banner.disabledChannelText') : t('home.banner.disabledText')}
      >
        <PillButton tone="neutral" onClick={actions.onSupport}>
          {t('home.banner.support')}
        </PillButton>
      </Banner>
    );
  }

  // ── Уровень 2: бонус 2 дня (grace) — VPN ещё работает ──
  if (state.code === 'grace') {
    return (
      <Banner
        tone="warning"
        icon={<GiftIcon className="h-5 w-5" />}
        title={t('home.banner.graceTitle')}
        text={
          graceUntil
            ? `${t('home.banner.graceText', { days: t('subscription.days', { count: graceDays }) })} ${t('home.banner.graceUntil', { date: graceUntil })}`
            : t('home.banner.graceText', { days: t('subscription.days', { count: graceDays }) })
        }
      />
    );
  }

  // ── Уровень 2: доступ закончился (VPN мёртв) ──
  if (state.accessEnded) {
    return (
      <Banner
        tone="danger"
        icon={<InfoIcon className="h-5 w-5" />}
        title={t('home.banner.expiredTitle')}
        // Глагол под стать кнопке: триал → «Оформите», платная → «Продлите».
        text={state.isTrial ? t('home.banner.expiredTextTrial') : t('home.banner.expiredText')}
      />
    );
  }

  // ── Уровень 2 (флаг): трафик кончился, подписка жива ──
  if (state.trafficExhausted) {
    if (state.isTrial) {
      // T4 — пробный трафик кончился (главное действие — «Оформить», горит в HeroZone).
      return (
        <Banner
          tone="warning"
          icon={<WalletIcon className="h-5 w-5" />}
          title={t('home.banner.trialTrafficTitle')}
          text={t('home.banner.trialTrafficText')}
        />
      );
    }
    // P9 — бесплатное ожидание главным, докупка трафика второстепенной (только если включена).
    return (
      <Banner
        tone="warning"
        icon={<WalletIcon className="h-5 w-5" />}
        title={t('home.banner.trafficResetTitle')}
        text={t('home.banner.trafficResetText')}
      >
        {state.canTopupTraffic && (
          <div>
            <PillButton tone="warning" onClick={actions.onTopupTraffic}>
              {t('home.banner.buyTraffic')}
            </PillButton>
            <div className="mt-1.5 text-[11px] text-dark-50/35">
              {t('home.banner.buyTrafficHint')}
            </div>
          </div>
        )}
      </Banner>
    );
  }

  // ── Покупки запрещены админ-ограничением (§4 ур.1 п.3) ──
  // Сами продающие кнопки уже спрятаны в useScreenState; здесь объясняем ПОЧЕМУ,
  // чтобы экран не выглядел «просто без кнопок». Показываем только в активном
  // состоянии (для pending/disabled/истекла уже есть свой баннер выше).
  if (state.purchasesRestricted) {
    return (
      <Banner
        tone="neutral"
        icon={<InfoIcon className="h-5 w-5" />}
        title={t('home.banner.restrictedTitle')}
        text={t('home.banner.restrictedText')}
      >
        <PillButton tone="neutral" onClick={actions.onSupport}>
          {t('home.banner.support')}
        </PillButton>
      </Banner>
    );
  }

  return null;
}
