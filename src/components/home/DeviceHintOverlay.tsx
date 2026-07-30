import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import type { RefObject } from 'react';
import { CloseIcon } from '@/components/icons';

interface DeviceHintOverlayProps {
  targetRef: RefObject<HTMLButtonElement | null>;
  onDismiss: () => void;
  onTargetUnavailable: () => void;
}

/**
 * Ненавязчивая подсказка для первого подключения: подчёркивает настоящую Hero-кнопку,
 * но не блокирует остальной экран и не отнимает у пользователя текущий фокус.
 */
export default function DeviceHintOverlay({
  targetRef,
  onDismiss,
  onTargetUnavailable,
}: DeviceHintOverlayProps) {
  const { t } = useTranslation();
  const [targetRect, setTargetRect] = useState<DOMRect | null>(null);
  const [isVisible, setIsVisible] = useState(false);
  const [placement, setPlacement] = useState<'top' | 'bottom'>('bottom');
  const tooltipSizeRef = useRef<HTMLDivElement>(null);
  const pad = 8;

  const updateTarget = useCallback(() => {
    const target = targetRef.current;
    if (!target || !target.isConnected || target.getClientRects().length === 0) {
      setIsVisible(false);
      onTargetUnavailable();
      return false;
    }

    const rect = target.getBoundingClientRect();
    const isFullyVisible =
      rect.top >= 0 &&
      rect.left >= 0 &&
      rect.bottom <= window.innerHeight &&
      rect.right <= window.innerWidth;
    if (!isFullyVisible) {
      setIsVisible(false);
      onTargetUnavailable();
      return false;
    }

    setTargetRect(rect);
    return true;
  }, [onTargetUnavailable, targetRef]);

  // Не скроллим и не переводим фокус: подсказка не должна перехватывать действие пользователя.
  useEffect(() => {
    const target = targetRef.current;
    if (!target) {
      onTargetUnavailable();
      return;
    }
    const frame = window.requestAnimationFrame(() => {
      if (updateTarget()) setIsVisible(true);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [onTargetUnavailable, targetRef, updateTarget]);

  useEffect(() => {
    window.addEventListener('resize', updateTarget);
    window.addEventListener('scroll', updateTarget, true);
    window.visualViewport?.addEventListener('resize', updateTarget);
    return () => {
      window.removeEventListener('resize', updateTarget);
      window.removeEventListener('scroll', updateTarget, true);
      window.visualViewport?.removeEventListener('resize', updateTarget);
    };
  }, [updateTarget]);

  // Capture click lets the first tap reach a real control underneath the hint
  // (for example, “Copy link”). Pointerdown is deliberately not used: a scroll
  // gesture must not permanently dismiss the hint.
  useEffect(() => {
    if (!isVisible) return;

    const handleDocumentClick = (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (tooltipSizeRef.current?.contains(target)) return;
      if (targetRef.current?.contains(target)) return;
      onDismiss();
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      onDismiss();
    };

    document.addEventListener('click', handleDocumentClick, true);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('click', handleDocumentClick, true);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isVisible, onDismiss, targetRef]);

  const spotlightStyle: React.CSSProperties = targetRect
    ? {
        top: targetRect.top - pad,
        left: targetRect.left - pad,
        width: targetRect.width + pad * 2,
        height: targetRect.height + pad * 2,
        opacity: isVisible ? 1 : 0,
      }
    : { opacity: 0 };

  useEffect(() => {
    if (!targetRect) return;
    const tooltipH = tooltipSizeRef.current?.offsetHeight ?? 180;
    const below = targetRect.bottom + pad + 14;
    setPlacement(below + tooltipH <= window.innerHeight - 16 ? 'bottom' : 'top');
  }, [targetRect]);

  const getTooltipStyle = (): React.CSSProperties => {
    if (!targetRect) return { opacity: 0 };

    const tooltipW = Math.min(320, window.innerWidth - 32);
    const tooltipH = tooltipSizeRef.current?.offsetHeight ?? 180;
    const left = Math.max(
      16,
      Math.min(
        targetRect.left + targetRect.width / 2 - tooltipW / 2,
        window.innerWidth - tooltipW - 16,
      ),
    );
    const placeBelow = placement === 'bottom';
    const below = targetRect.bottom + pad + 14;

    return {
      top: placeBelow ? below : Math.max(16, targetRect.top - pad - 14 - tooltipH),
      left,
      width: tooltipW,
      opacity: isVisible ? 1 : 0,
      transform: isVisible ? 'scale(1)' : 'scale(0.95)',
      animationDelay: '0.1s',
      animationFillMode: 'both',
      pointerEvents: isVisible ? 'auto' : 'none',
    };
  };

  return createPortal(
    <div className="onboarding-overlay" style={{ opacity: isVisible ? 1 : 0 }}>
      <div className="onboarding-spotlight" style={{ ...spotlightStyle, pointerEvents: 'none' }} />

      {/* Подсказка дополняет настоящую CTA, но не заменяет и не блокирует её. */}
      <div
        ref={tooltipSizeRef}
        className={`onboarding-tooltip tooltip-${placement}`}
        style={getTooltipStyle()}
        aria-live="polite"
      >
        <button
          type="button"
          onClick={onDismiss}
          aria-label={t('common.close')}
          className="absolute right-2 top-2 flex h-11 w-11 items-center justify-center rounded-xl text-dark-400 transition-colors hover:bg-dark-50/10 hover:text-dark-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-400 focus-visible:ring-offset-2 focus-visible:ring-offset-dark-900"
        >
          <CloseIcon />
        </button>
        <h3 id="device-hint-title" className="mb-2 pr-10 text-lg font-semibold text-dark-50">
          {t('home.deviceHint.title')}
        </h3>
        <p id="device-hint-desc" className="mb-0 text-sm text-dark-300">
          {t('home.deviceHint.description')}
        </p>
      </div>
    </div>,
    document.body,
  );
}
