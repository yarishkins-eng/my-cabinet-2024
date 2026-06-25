import { useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import { useHaptic } from '@/platform';
import { CloseIcon } from '@/components/icons';
import InsufficientBalancePrompt from '../InsufficientBalancePrompt';

interface InsufficientBalanceModalProps {
  /** Сумма нехватки в копейках. null = окно закрыто. Открываем только при значении > 0. */
  missingKopeks: number | null;
  onClose: () => void;
  /** Сохранить контекст перед уходом на пополнение (например, корзину). */
  onBeforeTopUp?: () => Promise<void>;
}

/**
 * Окно «Недостаточно средств» — поверх экрана (createPortal на document.body, z-100),
 * тот же визуальный язык, что и SuccessNotificationModal. Решает UX-баг: раньше сообщение
 * о нехватке рисовалось ВНИЗУ длинной формы покупки, за нижним меню, и его было видно
 * только промотав вниз. Теперь оно всплывает по центру с затемнением — заметно сразу.
 * Внутри — готовый InsufficientBalancePrompt (кошелёк, «Не хватает X», «Пополнить баланс»).
 */
export default function InsufficientBalanceModal({
  missingKopeks,
  onClose,
  onBeforeTopUp,
}: InsufficientBalanceModalProps) {
  const { t } = useTranslation();
  const haptic = useHaptic();
  const isOpen = missingKopeks !== null;
  const modalRef = useFocusTrap<HTMLDivElement>(isOpen, { lockScroll: false });

  const handleClose = useCallback(() => onClose(), [onClose]);

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        handleClose();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [isOpen, handleClose]);

  useEffect(() => {
    if (isOpen) haptic.notification('warning');
  }, [isOpen, haptic]);

  useEffect(() => {
    if (!isOpen) return;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = '';
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const content = (
    <div className="fixed inset-0 z-[100] flex items-center justify-center">
      <div className="absolute inset-0 bg-dark-950/80 backdrop-blur-sm" onClick={handleClose} />
      <div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-label={t('balance.insufficientFunds')}
        tabIndex={-1}
        className="relative mx-4 w-full max-w-sm rounded-3xl border border-dark-700/50 bg-dark-900 p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <button
          onClick={handleClose}
          aria-label={t('common.close', 'Закрыть')}
          className="absolute right-3 top-3 z-10 rounded-xl p-2 text-dark-400 transition-colors hover:bg-dark-800 hover:text-dark-200"
        >
          <CloseIcon />
        </button>

        <InsufficientBalancePrompt
          missingAmountKopeks={missingKopeks ?? 0}
          onBeforeTopUp={onBeforeTopUp}
        />

        <button
          onClick={handleClose}
          className="mt-3 w-full rounded-xl bg-dark-800 py-3 font-semibold text-dark-300 transition-colors hover:bg-dark-700 hover:text-dark-100"
        >
          {t('common.close', 'Закрыть')}
        </button>
      </div>
    </div>
  );

  return typeof document !== 'undefined' ? createPortal(content, document.body) : content;
}
