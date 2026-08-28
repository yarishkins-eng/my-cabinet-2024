import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { GiftIcon } from '@/components/icons';
import { promoApi, type PromoOffer } from '../../api/promo';
import { usePromoDiscount } from '../../hooks/usePromoDiscount';

// ──────────────────────────────────────────────────────────────────
// PromoDiscountBanner
//
// 🔴 Зачем он вообще. Блок промо-предложений (`PromoOffersSection`) живёт в СТАРОМ
// `Dashboard.tsx`, который с 24.06 не подключён к маршрутам. То есть клиент, работающий
// в кабинете, свою скидку не видит и забрать не может — единственный путь была кнопка
// в телеграм-сообщении, которое легко закрыть. Найдено живым проходом владельца 28.08.
//
// ⛔ Намеренно НЕ переносим старый блок целиком: он тянет за собой «отказаться от скидки»
// (нужно только под промокоды) и «Тестовые сервера», у которых выдача ЗАГЛУШЕНА
// (`app/services/promo_offer_service.py:18-25` всегда возвращает отказ) — была бы мёртвая
// кнопка. Здесь только процентная скидка, и `test_access` отфильтрован явно.
//
// Тексты — все до одного УЖЕ существовали в локали, новых ключей не заведено.
// ──────────────────────────────────────────────────────────────────

// Срок печатаем абсолютным, как это делает бот в сообщении «Скидка действует до 30.08.2026 17:13».
// Относительный отсчёт потребовал бы таймера и перерисовки — цена выше пользы.
function formatDeadline(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function isClaimableDiscount(offer: PromoOffer): boolean {
  // ⛔ Проверки `!offer.is_claimed` здесь НЕТ намеренно, и это не забывчивость: сервер уже
  // складывает её в `is_active` (`app/cabinet/routes/promo.py`: `is_active=offer.is_active
  // and offer.claimed_at is None`). Дубль внешнего забора — это вид защиты, а не защита:
  // мутация «убрать его» переживает любой набор, потому что он ни на что не влияет.
  // Урок 26.08 (мина AR), проверено мутацией здесь же.
  return (
    offer.is_active && offer.effect_type !== 'test_access' && (offer.discount_percent ?? 0) > 0
  );
}

export default function PromoDiscountBanner() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const { data: offers = [] } = useQuery({
    queryKey: ['promo-offers'],
    queryFn: promoApi.getOffers,
    staleTime: 30000,
  });
  const { activeDiscount } = usePromoDiscount();

  const claimMutation = useMutation({
    mutationFn: promoApi.claimOffer,
    onSuccess: () => {
      // 🔴 Гасим ВСЁ, что кормится скидкой: сама скидка, список предложений и цены обеих
      // касс. Иначе человек забирает скидку и продолжает видеть прежнюю цену — ровно та
      // беда, которую этап СК-1 чинил с другого конца.
      for (const key of [
        'active-discount',
        'promo-offers',
        'device-first-options',
        'purchase-options',
      ]) {
        queryClient.invalidateQueries({ queryKey: [key] });
      }
      setErrorMessage(null);
    },
    onError: (error: unknown) => {
      const axiosErr = error as { response?: { data?: { detail?: string } } };
      const detail = axiosErr.response?.data?.detail;
      setErrorMessage(typeof detail === 'string' ? detail : t('promo.offers.activationFailed'));
    },
  });

  const claimable = offers.filter(isClaimableDiscount);
  // Если предложений вдруг несколько — показываем то, что сгорит раньше всех.
  const offer = claimable.reduce<PromoOffer | null>(
    (soonest, current) =>
      soonest && new Date(soonest.expires_at) <= new Date(current.expires_at) ? soonest : current,
    null,
  );

  const hasActive = !!activeDiscount?.is_active && (activeDiscount.discount_percent ?? 0) > 0;

  if (!offer && !hasActive) return null;

  // Непринятое предложение важнее уже активной скидки: там есть срок и действие.
  if (offer) {
    const deadline = formatDeadline(offer.expires_at);
    return (
      <div className="rounded-2xl border border-accent-400/25 bg-accent-500/10 p-3.5">
        <div className="flex gap-3">
          <span className="mt-0.5 flex-shrink-0 text-accent-300">
            <GiftIcon />
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold leading-snug text-dark-50">
              {t('promo.offers.discountPercent', { percent: offer.discount_percent })}
            </div>
            <div className="mt-1 text-[13px] leading-snug text-dark-50/55">
              {t('promo.offers.activateDiscountHint')}
              {deadline ? ` · ${t('promo.offers.expires', { time: deadline })}` : ''}
            </div>
            {errorMessage && (
              <div className="mt-1 text-[13px] leading-snug text-error-300">{errorMessage}</div>
            )}
            <div className="mt-2.5">
              <button
                type="button"
                disabled={claimMutation.isPending}
                onClick={() => claimMutation.mutate(offer.id)}
                className="rounded-xl bg-accent-500 px-3.5 py-2 text-[13px] font-semibold text-white transition-colors active:scale-[0.98] disabled:opacity-60"
              >
                {t('promo.offers.activate')}
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const activeDeadline = formatDeadline(activeDiscount?.expires_at ?? null);
  return (
    <div className="rounded-2xl border border-success-500/30 bg-success-500/10 p-3.5">
      <div className="flex gap-3">
        <span className="mt-0.5 flex-shrink-0 text-success-400">
          <GiftIcon />
        </span>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold leading-snug text-dark-50">
            {t('promo.offers.discountActiveTitle', { percent: activeDiscount?.discount_percent })}
          </div>
          <div className="mt-1 text-[13px] leading-snug text-dark-50/55">
            {t('promo.discountDescription')}
            {activeDeadline ? ` · ${t('promo.offers.expires', { time: activeDeadline })}` : ''}
          </div>
        </div>
      </div>
    </div>
  );
}
