import { useTranslation } from 'react-i18next';
import type { TrafficInfo } from '../../utils/screenState';

/** Гигабайты человеку: целое — без хвоста, дробное — 1 знак. */
function fmtGb(n: number): string {
  if (!Number.isFinite(n)) return '0';
  return Number.isInteger(n) ? String(n) : n.toFixed(1);
}

/**
 * Трафик ДРОБЬЮ (§16): `42 / ∞` · `42 / 100 ГБ`. Полоску заменяет дробь.
 *
 * Цвет (§19 п.10 + решение владельца v1.9 п.2):
 *  — `exhausted` (трафик кончился, ждём сброса, подписка ЖИВА) → ТИШЕ, янтарь, НЕ красным
 *    (это спокойное «восстановится при сбросе», а не тревога «продли»);
 *  — `nearLimit` (≥90%, ещё не кончился) → красным — предупреждение «вот-вот кончится»;
 *  — иначе → обычным приглушённым.
 * Красный у трафика — ТОЛЬКО «у предела», и никогда для «кончился» (порядок проверок важен:
 * при исчерпании процент ≥100, т.е. nearLimit тоже true — поэтому `exhausted` проверяем первым).
 */
export default function TrafficFraction({
  traffic,
  className = '',
}: {
  traffic: TrafficInfo;
  className?: string;
}) {
  const { t } = useTranslation();

  const used = fmtGb(traffic.usedGb);
  const text = traffic.unlimited
    ? `${used} / ∞`
    : t('dashboard.trafficUsage', { used, limit: fmtGb(traffic.limitGb) });

  const color = traffic.exhausted
    ? 'text-warning-300'
    : traffic.nearLimit
      ? 'text-error-400'
      : 'text-dark-50/90';

  return <span className={`font-semibold tabular-nums ${color} ${className}`}>{text}</span>;
}
