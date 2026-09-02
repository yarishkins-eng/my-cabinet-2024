import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNotify } from '../../../platform/hooks/useNotify';
import { useCurrency } from '../../../hooks/useCurrency';
import { adminUsersApi, type UserDetailResponse } from '../../../api/adminUsers';
import { promocodesApi } from '../../../api/promocodes';
import { promoOffersApi } from '../../../api/promoOffers';
import { getApiErrorMessage } from '../../../utils/api-error';
import { createNumberInputHandler, toNumber } from '../../../utils/inputHelpers';
import { PlusIcon, MinusIcon } from '@/components/icons';

// ──────────────────────────────────────────────────────────────────
// Balance tab — current balance, add/subtract form, active promo
// offer summary, send-offer form, recent transactions list. State
// (form inputs + inline-confirm arm) is local; the parent only
// owns the user query and is told when to refresh.
// ──────────────────────────────────────────────────────────────────

export interface BalanceTabProps {
  user: UserDetailResponse;
  userId: number;
  hasPermission: (perm: string) => boolean;
  onUserRefresh: () => Promise<void> | void;
  formatDate: (date: string | null) => string;
}

export function BalanceTab({
  user,
  userId,
  hasPermission,
  onUserRefresh,
  formatDate,
}: BalanceTabProps) {
  const { t } = useTranslation();
  const notify = useNotify();
  const { formatWithCurrency } = useCurrency();

  const [balanceAmount, setBalanceAmount] = useState<number | ''>('');
  const [balanceDescription, setBalanceDescription] = useState('');
  const [offerDiscountPercent, setOfferDiscountPercent] = useState<number | ''>('');
  const [offerValidHours, setOfferValidHours] = useState<number | ''>(24);

  const [actionLoading, setActionLoading] = useState(false);
  const [offerSending, setOfferSending] = useState(false);

  // Inline two-click confirm — local so other tabs aren't dimmed.
  const [confirmingAction, setConfirmingAction] = useState<string | null>(null);
  const handleInlineConfirm = (actionKey: string, executeFn: () => Promise<void>) => {
    if (confirmingAction === actionKey) {
      setConfirmingAction(null);
      executeFn();
    } else {
      setConfirmingAction(actionKey);
      setTimeout(() => {
        setConfirmingAction((current) => (current === actionKey ? null : current));
      }, 3000);
    }
  };

  // ─── Mutations ──────────────────────────────────────────────────

  const handleUpdateBalance = async (isAdd: boolean) => {
    // Ноль сервер отбивает 400: он проходил валидацию, писал проводку на 0 ₽ и слал
    // клиенту «списано 0 ₽ — если это ошибка, напишите в поддержку». Не доводим до отказа.
    if (balanceAmount === '' || toNumber(balanceAmount) === 0) return;
    setActionLoading(true);
    try {
      // Math.round, а не усечение: 1.1 * 100 в JS даёт 110.00000000000001, и Pydantic
      // отбивал такую сумму 422-й. Раньше отказ уходил только в консоль, теперь его
      // увидел бы админ — но чинить надо не показ отказа, а сам отказ.
      const amount = Math.round(Math.abs(toNumber(balanceAmount) * 100));
      const result = await adminUsersApi.updateBalance(userId, {
        amount_kopeks: isAdd ? amount : -amount,
        description:
          balanceDescription ||
          (isAdd
            ? t('admin.users.detail.balance.addByAdmin')
            : t('admin.users.detail.balance.subtractByAdmin')),
      });
      // Экран обязан сказать, дошло ли до клиента сообщение о деньгах: сам факт
      // начисления виден по цифре, а доставка — нет. До этапа УБ-1 здесь не было
      // ни тоста успеха, ни тоста ошибки — админ не узнавал даже про отказ сервера.
      if (result.notified === false) {
        notify.warning(
          t('admin.users.detail.balance.notDelivered'),
          t('admin.users.detail.balance.saved'),
        );
      } else if (result.notified) {
        notify.success(
          t('admin.users.detail.balance.delivered'),
          t('admin.users.detail.balance.saved'),
        );
      } else {
        // Поле не пришло — бот старее кабинета. Утверждать «не доставлено» нельзя:
        // мы этого не знаем. Говорим только то, что знаем точно.
        notify.success(t('admin.users.detail.balance.saved'));
      }
      setBalanceAmount('');
      setBalanceDescription('');
    } catch (error) {
      console.error('Failed to update balance:', error);
      // Причину отказа берём из ответа сервера готовым разборщиком: он умеет и строку,
      // и список ошибок валидации. Без неё «Не удалось выполнить действие» скрывает
      // «Insufficient balance. Current: X, requested: Y» — админ не поймёт, что промахнулся.
      notify.error(
        getApiErrorMessage(error, t('admin.users.userActions.error')),
        t('common.error'),
      );
    } finally {
      // 🔴 Обновление карточки — в finally. В try оно не выполнялось при отказе, и админ
      // видел «ошибка» и СТАРЫЙ баланс на деньгах, которые уже начислены: маршрут ждёт
      // Телеграм до 20 с при клиентском таймауте 30 с. Следующим шагом он начислил бы
      // второй раз. Нашла линза соответствия замыслу.
      await onUserRefresh();
      setActionLoading(false);
    }
  };

  const handleDeactivateOffer = async () => {
    setActionLoading(true);
    try {
      await promocodesApi.deactivateDiscount(userId);
      notify.success(t('admin.users.detail.offerDeactivated'), t('common.success'));
      await onUserRefresh();
    } catch {
      notify.error(t('admin.users.userActions.error'), t('common.error'));
    } finally {
      setActionLoading(false);
    }
  };

  const handleSendOffer = async () => {
    if (offerDiscountPercent === '' || offerValidHours === '') return;
    setOfferSending(true);
    try {
      await promoOffersApi.broadcastOffer({
        user_id: userId,
        notification_type: 'admin_personal',
        discount_percent: toNumber(offerDiscountPercent),
        valid_hours: toNumber(offerValidHours, 24),
        effect_type: 'percent_discount',
        send_notification: true,
      });
      notify.success(t('admin.users.detail.offerSent'), t('common.success'));
      setOfferDiscountPercent('');
      setOfferValidHours(24);
      await onUserRefresh();
    } catch {
      notify.error(t('admin.users.detail.offerSendError'), t('common.error'));
    } finally {
      setOfferSending(false);
    }
  };

  // ─── Render ─────────────────────────────────────────────────────

  return (
    <div className="space-y-4">
      {/* Current balance */}
      <div className="rounded-xl border border-accent-500/30 bg-gradient-to-r from-accent-500/20 to-accent-700/20 p-4">
        <div className="mb-1 text-sm text-dark-400">{t('admin.users.detail.balance.current')}</div>
        <div className="text-3xl font-bold text-dark-100">
          {formatWithCurrency(user.balance_rubles)}
        </div>
      </div>

      {/* Add/subtract form */}
      {hasPermission('users:balance') && (
        <div className="space-y-3 rounded-xl bg-dark-800/50 p-4">
          <input
            type="number"
            value={balanceAmount}
            onChange={createNumberInputHandler(setBalanceAmount)}
            placeholder={t('admin.users.detail.balance.amountPlaceholder')}
            className="input"
          />
          <input
            type="text"
            value={balanceDescription}
            onChange={(e) => setBalanceDescription(e.target.value)}
            placeholder={t('admin.users.detail.balance.descriptionPlaceholder')}
            className="input"
            maxLength={500}
          />
          {/* 🔴 РЕК-6А. Поле называлось «Описание (опционально)» и читалось как пометка для себя,
              а 500 символов из него уходят прямо в историю операций КЛИЕНТА
              (`admin_users.py` → `Transaction.description` → `Balance.tsx`). Ни строчки об этом
              на экране не было. Дверь шире метки кампании: там 32 символа латиницей. */}
          <p className="-mt-1 text-xs text-warning-400">
            {t('admin.users.detail.balance.descriptionHint')}
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => handleUpdateBalance(true)}
              disabled={actionLoading || balanceAmount === '' || toNumber(balanceAmount) === 0}
              className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-success-500 py-2 text-white transition-colors hover:bg-success-600 disabled:opacity-50"
            >
              <PlusIcon className="h-4 w-4" /> {t('admin.users.detail.balance.add')}
            </button>
            <button
              onClick={() => handleUpdateBalance(false)}
              disabled={actionLoading || balanceAmount === '' || toNumber(balanceAmount) === 0}
              className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-error-500 py-2 text-white transition-colors hover:bg-error-600 disabled:opacity-50"
            >
              <MinusIcon className="h-4 w-4" /> {t('admin.users.detail.balance.subtract')}
            </button>
          </div>
        </div>
      )}

      {/* Active promo offer */}
      {user.promo_offer_discount_percent > 0 && (
        <div className="rounded-xl border border-accent-500/20 bg-accent-500/5 p-4">
          <div className="mb-3 flex items-center justify-between">
            <span className="text-sm font-medium text-accent-400">
              {t('admin.users.detail.activePromoOffer')}
            </span>
            <button
              onClick={() => handleInlineConfirm('deactivateOffer', handleDeactivateOffer)}
              disabled={actionLoading}
              className={`rounded-lg px-3 py-1 text-xs font-medium transition-all disabled:opacity-50 ${
                confirmingAction === 'deactivateOffer'
                  ? 'bg-error-500 text-white'
                  : 'bg-error-500/15 text-error-400 hover:bg-error-500/25'
              }`}
            >
              {confirmingAction === 'deactivateOffer'
                ? t('admin.users.detail.actions.areYouSure')
                : t('admin.users.detail.deactivateOffer')}
            </button>
          </div>
          <div className="grid grid-cols-3 gap-3 text-center">
            <div>
              <div className="text-lg font-bold text-dark-100">
                {user.promo_offer_discount_percent}%
              </div>
              <div className="text-xs text-dark-500">{t('admin.users.detail.discount')}</div>
            </div>
            <div>
              <div className="text-sm font-medium text-dark-100">
                {user.promo_offer_discount_source || '-'}
              </div>
              <div className="text-xs text-dark-500">{t('admin.users.detail.source')}</div>
            </div>
            <div>
              <div className="text-sm font-medium text-dark-100">
                {user.promo_offer_discount_expires_at
                  ? formatDate(user.promo_offer_discount_expires_at)
                  : '-'}
              </div>
              <div className="text-xs text-dark-500">{t('admin.users.detail.expiresAt')}</div>
            </div>
          </div>
        </div>
      )}

      {/* Send promo offer */}
      {hasPermission('users:send_offer') && (
        <div className="rounded-xl bg-dark-800/50 p-4">
          <div className="mb-3 text-sm font-medium text-dark-200">
            {t('admin.users.detail.sendOffer')}
          </div>
          <div className="space-y-3">
            <input
              type="number"
              value={offerDiscountPercent}
              onChange={createNumberInputHandler(setOfferDiscountPercent, 1)}
              placeholder={t('admin.users.detail.discountPercent')}
              className="input"
              min={1}
              max={100}
            />
            <input
              type="number"
              value={offerValidHours}
              onChange={createNumberInputHandler(setOfferValidHours, 1)}
              placeholder={t('admin.users.detail.validHours')}
              className="input"
              min={1}
              max={8760}
            />
            <button
              onClick={handleSendOffer}
              disabled={offerSending || offerDiscountPercent === '' || offerValidHours === ''}
              className="btn-primary w-full disabled:opacity-50"
            >
              {offerSending ? t('common.loading') : t('admin.users.detail.sendOffer')}
            </button>
          </div>
        </div>
      )}

      {/* Recent transactions */}
      {user.recent_transactions.length > 0 && (
        <div className="rounded-xl bg-dark-800/50 p-4">
          <div className="mb-3 font-medium text-dark-200">
            {t('admin.users.detail.balance.recentTransactions')}
          </div>
          <div className="max-h-48 space-y-2 overflow-y-auto">
            {user.recent_transactions.map((tx) => (
              <div
                key={tx.id}
                className="flex items-center justify-between border-b border-dark-700 py-2 last:border-0"
              >
                <div>
                  <div className="text-sm text-dark-200">{tx.description || tx.type}</div>
                  {/* 🔴 Этап ДВ-3, мина ID. Номер заказа читался прямо из английской подписи,
                      пока она была машинной. Перевели — и связать деньги с заказом глазами
                      стало нечем. Возвращаем отдельной строкой: тут владелец, а не клиент. */}
                  <div className="text-xs text-dark-500">
                    {formatDate(tx.created_at)}
                    {tx.external_id ? ` · ${tx.external_id}` : ''}
                  </div>
                </div>
                <div className={tx.amount_kopeks >= 0 ? 'text-success-400' : 'text-error-400'}>
                  {tx.amount_kopeks >= 0 ? '+' : ''}
                  {formatWithCurrency(tx.amount_rubles)}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
