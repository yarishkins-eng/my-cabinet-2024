import type { PersonalDiscount } from '../api/promo';

export function personalDiscount(
  net: number | null | undefined,
  amount: number | undefined,
  offer?: PersonalDiscount | null,
) {
  if (
    !Number.isSafeInteger(net) ||
    !Number.isSafeInteger(amount) ||
    (net ?? 0) <= 0 ||
    (amount ?? 0) <= 0
  )
    return null;
  const before = net! + amount!;
  if (!Number.isSafeInteger(before)) return null;
  const pct = offer?.discount_percent;
  let percent: number | null = null;
  if (Number.isInteger(pct) && pct! > 0 && pct! < 100 && Number.isSafeInteger(before * pct!)) {
    let quoted = before - Math.floor((before * pct!) / 100);
    if (before >= 100 && quoted > 0) quoted = Math.max(100, Math.floor(quoted / 100) * 100);
    if (quoted === net) percent = pct!;
  }
  return { before, amount: amount!, percent };
}

export const formatCheckoutMoney = (kopeks: number) =>
  `${kopeks < 0 ? '−' : ''}${(Math.abs(kopeks) / 100).toLocaleString('ru-RU', { minimumFractionDigits: kopeks % 100 ? 2 : 0, maximumFractionDigits: 2 })} ₽`;
