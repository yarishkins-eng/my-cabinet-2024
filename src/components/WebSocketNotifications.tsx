/**
 * Global WebSocket notifications handler.
 * Listens to all WebSocket events and shows appropriate toasts or modals.
 */

import { useCallback } from 'react';
import { useNavigate } from 'react-router';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { useWebSocket, WSMessage } from '../hooks/useWebSocket';
import { useToast } from './Toast';
import { useAuthStore } from '../store/auth';
import { useCurrency } from '../hooks/useCurrency';
import { useSuccessNotification } from '../store/successNotification';

export default function WebSocketNotifications() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const refreshUser = useAuthStore((state) => state.refreshUser);
  const { formatAmount, currencySymbol } = useCurrency();
  const showSuccessModal = useSuccessNotification((state) => state.show);

  const handleMessage = useCallback(
    (message: WSMessage) => {
      const { type } = message;

      // Skip ticket events - they are handled by TicketNotificationBell
      if (type.startsWith('ticket.')) {
        return;
      }

      // Balance events
      if (type === 'balance.topup') {
        // Show prominent success modal for balance top-up
        showSuccessModal({
          type: 'balance_topup',
          amountKopeks: message.amount_kopeks,
          newBalanceKopeks: message.new_balance_kopeks,
        });
        // Refresh data
        queryClient.invalidateQueries({ queryKey: ['balance'] });
        queryClient.invalidateQueries({ queryKey: ['purchase-options'] });
        queryClient.invalidateQueries({ queryKey: ['transactions'] });
        // 🔴 РЕК-3, находка скептика — воспроизведена прогоном. Этого ключа в списке не было
        // НИ РАЗУ, а он и есть баланс, который печатает касса. Канал живой и обычный: человек
        // стоит на подтверждении, копирует платёжную ссылку, платит из браузера и возвращается
        // «назад» — мимо экрана результата пополнения, где стоит вся защита этапа. Касса при
        // этом держит ДОоплатное «Не хватает N ₽» и залитую кнопку «Доплатить N ₽» бессрочно:
        // сама она не обновляется (`refetchOnWindowFocus` выключен глобально в `main.tsx`), а
        // читатель у ключа во всём приложении ровно один — экран покупки.
        // ⚠️ Здесь ПОМЕТКА, а не снос: человек может СМОТРЕТЬ на кассу прямо сейчас, и снос
        // кэша у живого наблюдателя обнулил бы ему экран. `refetchType: 'all'` — ради второго
        // случая, когда кассы на экране нет: без него неактивный запрос сохранит прежнее число
        // и отдаст его первым кадром следующего захода.
        // ⚠️ ЧЕСТНО, СКОЛЬКО МЕСТ ПРОВЕРЕНО: этот же набор из трёх ключей гасится в ПЯТИ
        // ветках файла (`balance.topup`, `balance.change`, `subscription.devices_purchased`,
        // `subscription.traffic_purchased`, `payment.received`). Правится ОДНА — та, где вред
        // доказан прогоном. В остальных четырёх деньги либо уходят (касса покажет больше, чем
        // есть, и сервер честно откажет), либо канал не измерен. Дом остатка — план, не «заодно».
        queryClient.invalidateQueries({
          queryKey: ['device-first-options'],
          refetchType: 'all',
        });
        refreshUser();
        return;
      }

      if (type === 'balance.change') {
        const amount = message.amount_rubles ?? (message.amount_kopeks ?? 0) / 100;
        const isPositive = amount >= 0;
        showToast({
          type: isPositive ? 'success' : 'info',
          title: t('wsNotifications.balance.changeTitle', 'Balance updated'),
          message:
            message.description ||
            t(
              'wsNotifications.balance.changeMessage',
              'Your balance has changed by {{amount}} {{currency}}',
              {
                amount: (isPositive ? '+' : '') + formatAmount(amount),
                currency: currencySymbol,
              },
            ),
          icon: <span className="text-lg">{isPositive ? '💵' : '💸'}</span>,
          onClick: () => navigate('/balance'),
          duration: 5000,
        });
        queryClient.invalidateQueries({ queryKey: ['balance'] });
        queryClient.invalidateQueries({ queryKey: ['purchase-options'] });
        queryClient.invalidateQueries({ queryKey: ['transactions'] });
        refreshUser();
        return;
      }

      // Subscription events
      if (type === 'subscription.activated') {
        // Show prominent success modal for subscription activation
        showSuccessModal({
          type: 'subscription_activated',
          expiresAt: message.expires_at,
          tariffName: message.tariff_name,
        });
        queryClient.invalidateQueries({
          predicate: (query) =>
            Array.isArray(query.queryKey) && query.queryKey[0] === 'subscription',
        });
        // Оффер триала на Главной гейтится запросом ['trial-info']. После активации
        // подписки его надо инвалидировать, иначе оффер «Попробовать бесплатно» залипает.
        queryClient.invalidateQueries({ queryKey: ['trial-info'] });
        queryClient.invalidateQueries({ queryKey: ['subscriptions-list'] });
        queryClient.invalidateQueries({ queryKey: ['balance'] });
        queryClient.invalidateQueries({ queryKey: ['purchase-options'] });
        refreshUser();
        return;
      }

      if (type === 'subscription.renewed') {
        // Show prominent success modal for subscription renewal
        showSuccessModal({
          type: 'subscription_renewed',
          amountKopeks: message.amount_kopeks,
          expiresAt: message.new_expires_at,
        });
        queryClient.invalidateQueries({
          predicate: (query) =>
            Array.isArray(query.queryKey) && query.queryKey[0] === 'subscription',
        });
        queryClient.invalidateQueries({ queryKey: ['subscriptions-list'] });
        queryClient.invalidateQueries({ queryKey: ['balance'] });
        queryClient.invalidateQueries({ queryKey: ['purchase-options'] });
        refreshUser();
        return;
      }

      if (type === 'subscription.expiring') {
        showToast({
          type: 'warning',
          title: t('wsNotifications.subscription.expiringTitle', 'Subscription expiring soon'),
          message: t(
            'wsNotifications.subscription.expiringMessage',
            'Your subscription expires in {{days}} days',
            {
              days: message.days_left ?? 0,
            },
          ),
          icon: <span className="text-lg">⏰</span>,
          onClick: () => navigate('/'),
          duration: 10000,
        });
        return;
      }

      if (type === 'subscription.expired') {
        showToast({
          type: 'error',
          title: t('wsNotifications.subscription.expiredTitle', 'Subscription expired'),
          message: t(
            'wsNotifications.subscription.expiredMessage',
            'Your subscription has expired. Renew to continue using the service.',
          ),
          icon: <span className="text-lg">😢</span>,
          onClick: () => navigate('/'),
          duration: 10000,
        });
        queryClient.invalidateQueries({
          predicate: (query) =>
            Array.isArray(query.queryKey) && query.queryKey[0] === 'subscription',
        });
        queryClient.invalidateQueries({ queryKey: ['subscriptions-list'] });
        refreshUser();
        return;
      }

      if (type === 'subscription.grace_started') {
        // «Бонус 2 дня» (grace): подписка закончилась, но VPN продлён. Про бонус
        // пользователю уже пришло Telegram-сообщение → здесь БЕЗ тоста, просто
        // перечитываем подписку, чтобы открытый кабинет сразу показал жёлтый
        // «Бонус N дней» вместо устаревшего состояния (а не пугающее «истекла»).
        queryClient.invalidateQueries({
          predicate: (query) =>
            Array.isArray(query.queryKey) && query.queryKey[0] === 'subscription',
        });
        queryClient.invalidateQueries({ queryKey: ['subscriptions-list'] });
        refreshUser();
        return;
      }

      if (type === 'subscription.daily_debit') {
        const amount = message.amount_rubles ?? (message.amount_kopeks ?? 0) / 100;
        showToast({
          type: 'info',
          title: t('wsNotifications.subscription.dailyDebitTitle', 'Daily charge'),
          message: t(
            'wsNotifications.subscription.dailyDebitMessage',
            'Daily subscription fee: {{amount}} {{currency}}',
            {
              amount: formatAmount(amount),
              currency: currencySymbol,
            },
          ),
          icon: <span className="text-lg">📅</span>,
          duration: 5000,
        });
        queryClient.invalidateQueries({ queryKey: ['balance'] });
        queryClient.invalidateQueries({ queryKey: ['purchase-options'] });
        refreshUser();
        return;
      }

      if (type === 'subscription.traffic_reset') {
        showToast({
          type: 'info',
          title: t('wsNotifications.subscription.trafficResetTitle', 'Traffic reset'),
          message: t(
            'wsNotifications.subscription.trafficResetMessage',
            'Your traffic limit has been reset',
          ),
          icon: <span className="text-lg">🔄</span>,
          duration: 5000,
        });
        queryClient.invalidateQueries({
          predicate: (query) =>
            Array.isArray(query.queryKey) && query.queryKey[0] === 'subscription',
        });
        queryClient.invalidateQueries({ queryKey: ['subscriptions-list'] });
        return;
      }

      if (type === 'subscription.devices_purchased') {
        // Show prominent success modal for device purchase
        showSuccessModal({
          type: 'devices_purchased',
          amountKopeks: message.amount_kopeks,
          devicesAdded: message.devices_added,
          newDeviceLimit: message.new_device_limit,
        });
        queryClient.invalidateQueries({
          predicate: (query) =>
            Array.isArray(query.queryKey) && query.queryKey[0] === 'subscription',
        });
        // Счётчик устройств на Главной/детали живёт под ключом ['devices', id]. id в этом
        // WS-событии может не прийти → инвалидируем по предикату (любой ['devices', *]),
        // иначе после докупки устройств счётчик завис бы на старом значении.
        queryClient.invalidateQueries({
          predicate: (query) => Array.isArray(query.queryKey) && query.queryKey[0] === 'devices',
        });
        queryClient.invalidateQueries({ queryKey: ['subscriptions-list'] });
        queryClient.invalidateQueries({ queryKey: ['balance'] });
        queryClient.invalidateQueries({ queryKey: ['purchase-options'] });
        queryClient.invalidateQueries({ queryKey: ['transactions'] });
        refreshUser();
        return;
      }

      if (type === 'subscription.traffic_purchased') {
        // Show prominent success modal for traffic purchase
        showSuccessModal({
          type: 'traffic_purchased',
          amountKopeks: message.amount_kopeks,
          trafficGbAdded: message.traffic_gb_added,
          newTrafficLimitGb: message.new_traffic_limit_gb,
        });
        queryClient.invalidateQueries({
          predicate: (query) =>
            Array.isArray(query.queryKey) && query.queryKey[0] === 'subscription',
        });
        queryClient.invalidateQueries({ queryKey: ['subscriptions-list'] });
        queryClient.invalidateQueries({ queryKey: ['balance'] });
        queryClient.invalidateQueries({ queryKey: ['purchase-options'] });
        queryClient.invalidateQueries({ queryKey: ['transactions'] });
        refreshUser();
        return;
      }

      // Autopay events
      if (type === 'autopay.success') {
        const amount = message.amount_rubles ?? (message.amount_kopeks ?? 0) / 100;
        showToast({
          type: 'success',
          title: t('wsNotifications.autopay.successTitle', 'Auto-renewal successful'),
          message: t(
            'wsNotifications.autopay.successMessage',
            'Your subscription was auto-renewed for {{amount}} {{currency}}',
            {
              amount: formatAmount(amount),
              currency: currencySymbol,
            },
          ),
          icon: <span className="text-lg">🔁</span>,
          onClick: () => navigate('/'),
          duration: 8000,
        });
        queryClient.invalidateQueries({
          predicate: (query) =>
            Array.isArray(query.queryKey) && query.queryKey[0] === 'subscription',
        });
        queryClient.invalidateQueries({ queryKey: ['subscriptions-list'] });
        queryClient.invalidateQueries({ queryKey: ['balance'] });
        queryClient.invalidateQueries({ queryKey: ['purchase-options'] });
        refreshUser();
        return;
      }

      if (type === 'autopay.failed') {
        showToast({
          type: 'error',
          title: t('wsNotifications.autopay.failedTitle', 'Auto-renewal failed'),
          message:
            message.reason ||
            t('wsNotifications.autopay.failedMessage', 'Failed to auto-renew your subscription'),
          icon: <span className="text-lg">❌</span>,
          onClick: () => navigate('/'),
          duration: 10000,
        });
        return;
      }

      if (type === 'autopay.insufficient_funds') {
        const required = message.required_rubles ?? (message.required_kopeks ?? 0) / 100;
        const balance = message.balance_rubles ?? (message.balance_kopeks ?? 0) / 100;
        showToast({
          type: 'warning',
          title: t('wsNotifications.autopay.insufficientTitle', 'Insufficient funds'),
          message: t(
            'wsNotifications.autopay.insufficientMessage',
            'Need {{required}} {{currency}} for renewal, but balance is {{balance}} {{currency}}',
            {
              required: formatAmount(required),
              balance: formatAmount(balance),
              currency: currencySymbol,
            },
          ),
          icon: <span className="text-lg">💳</span>,
          onClick: () => navigate('/balance'),
          duration: 10000,
        });
        return;
      }

      // Account events
      if (type === 'account.banned') {
        showToast({
          type: 'error',
          title: t('wsNotifications.account.bannedTitle', 'Account blocked'),
          message:
            message.reason ||
            t('wsNotifications.account.bannedMessage', 'Your account has been blocked'),
          icon: <span className="text-lg">🚫</span>,
          duration: 15000,
        });
        refreshUser();
        return;
      }

      if (type === 'account.unbanned') {
        showToast({
          type: 'success',
          title: t('wsNotifications.account.unbannedTitle', 'Account unblocked'),
          message: t('wsNotifications.account.unbannedMessage', 'Your account has been unblocked'),
          icon: <span className="text-lg">✅</span>,
          duration: 8000,
        });
        refreshUser();
        return;
      }

      if (type === 'account.warning') {
        showToast({
          type: 'warning',
          title: t('wsNotifications.account.warningTitle', 'Warning'),
          message:
            message.message ||
            t('wsNotifications.account.warningMessage', 'You have received a warning'),
          icon: <span className="text-lg">⚠️</span>,
          duration: 10000,
        });
        return;
      }

      // Referral events
      if (type === 'referral.bonus') {
        const bonus = message.bonus_rubles ?? (message.bonus_kopeks ?? 0) / 100;
        showToast({
          type: 'success',
          title: t('wsNotifications.referral.bonusTitle', 'Referral bonus'),
          message: message.referral_name
            ? t(
                'wsNotifications.referral.bonusWithName',
                'You received {{amount}} {{currency}} bonus from {{name}}!',
                {
                  amount: formatAmount(bonus),
                  currency: currencySymbol,
                  name: message.referral_name,
                },
              )
            : t(
                'wsNotifications.referral.bonusMessage',
                'You received {{amount}} {{currency}} referral bonus!',
                {
                  amount: formatAmount(bonus),
                  currency: currencySymbol,
                },
              ),
          icon: <span className="text-lg">🎁</span>,
          onClick: () => navigate('/referral'),
          duration: 8000,
        });
        queryClient.invalidateQueries({ queryKey: ['balance'] });
        queryClient.invalidateQueries({ queryKey: ['purchase-options'] });
        queryClient.invalidateQueries({ queryKey: ['referral-stats'] });
        refreshUser();
        return;
      }

      if (type === 'referral.registered') {
        showToast({
          type: 'success',
          title: t('wsNotifications.referral.registeredTitle', 'New referral'),
          message: message.referral_name
            ? t(
                'wsNotifications.referral.registeredWithName',
                '{{name}} joined using your referral link!',
                { name: message.referral_name },
              )
            : t(
                'wsNotifications.referral.registeredMessage',
                'Someone joined using your referral link!',
              ),
          icon: <span className="text-lg">👤</span>,
          onClick: () => navigate('/referral'),
          duration: 6000,
        });
        queryClient.invalidateQueries({ queryKey: ['referral-stats'] });
        return;
      }

      // Payment received
      if (type === 'payment.received') {
        const amount = message.amount_rubles ?? (message.amount_kopeks ?? 0) / 100;
        showToast({
          type: 'success',
          title: t('wsNotifications.payment.receivedTitle', 'Payment received'),
          message: t(
            'wsNotifications.payment.receivedMessage',
            'Payment of {{amount}} {{currency}} received',
            {
              amount: formatAmount(amount),
              currency: currencySymbol,
            },
          ),
          icon: <span className="text-lg">💳</span>,
          onClick: () => navigate('/balance'),
          duration: 6000,
        });
        queryClient.invalidateQueries({ queryKey: ['balance'] });
        queryClient.invalidateQueries({ queryKey: ['purchase-options'] });
        queryClient.invalidateQueries({ queryKey: ['transactions'] });
        refreshUser();
        return;
      }
    },
    [
      t,
      showToast,
      showSuccessModal,
      navigate,
      queryClient,
      refreshUser,
      formatAmount,
      currencySymbol,
    ],
  );

  // Connect to WebSocket and handle messages
  useWebSocket({
    onMessage: handleMessage,
  });

  // This component doesn't render anything
  return null;
}
