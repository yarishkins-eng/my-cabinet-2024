import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import type { RefObject } from 'react';

interface DeviceHintOverlayProps {
  targetRef: RefObject<HTMLButtonElement | null>;
  onTargetUnavailable: () => void;
}

/**
 * Coachmark без второй CTA: пользователь нажимает настоящую кнопку Hero.
 * Четыре прозрачных барьера блокируют остальной экран, оставляя над ней «окно».
 */
export default function DeviceHintOverlay({
  targetRef,
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
      return;
    }
    setTargetRect(target.getBoundingClientRect());
  }, [onTargetUnavailable, targetRef]);

  // Кнопка уже отрисована до эффекта; скроллим только если она вне видимой области.
  useEffect(() => {
    const target = targetRef.current;
    if (!target) {
      onTargetUnavailable();
      return;
    }
    const rect = target.getBoundingClientRect();
    if (rect.top < 0 || rect.bottom > window.innerHeight) {
      target.scrollIntoView({ block: 'center' });
    }
    const frame = window.requestAnimationFrame(() => {
      updateTarget();
      target.focus({ preventScroll: true });
      setIsVisible(true);
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

  const blockers = targetRect
    ? [
        { top: 0, left: 0, width: '100%', height: Math.max(0, targetRect.top - pad) },
        {
          top: Math.min(window.innerHeight, targetRect.bottom + pad),
          left: 0,
          width: '100%',
          bottom: 0,
        },
        {
          top: Math.max(0, targetRect.top - pad),
          left: 0,
          width: Math.max(0, targetRect.left - pad),
          height: targetRect.height + pad * 2,
        },
        {
          top: Math.max(0, targetRect.top - pad),
          left: Math.min(window.innerWidth, targetRect.right + pad),
          right: 0,
          height: targetRect.height + pad * 2,
        },
      ]
    : [];

  return createPortal(
    <div className="onboarding-overlay" style={{ opacity: isVisible ? 1 : 0 }}>
      <div className="onboarding-spotlight" style={{ ...spotlightStyle, pointerEvents: 'none' }} />

      {/* Текст объясняет действие; отдельной CTA здесь намеренно нет. */}
      <div
        ref={tooltipSizeRef}
        className={`onboarding-tooltip tooltip-${placement}`}
        style={getTooltipStyle()}
        role="status"
        aria-live="polite"
        onPointerDown={(event) => event.preventDefault()}
        onClick={(event) => event.preventDefault()}
      >
        <h3 id="device-hint-title" className="mb-2 text-lg font-semibold text-dark-50">
          {t('home.deviceHint.title')}
        </h3>
        <p id="device-hint-desc" className="mb-0 text-sm text-dark-400">
          {t('home.deviceHint.description')}
        </p>
      </div>

      {/* Блокируем остальные элементы, но оставляем «дыру» над настоящей кнопкой Hero. */}
      {isVisible &&
        blockers.map((style, index) => (
          <div
            key={index}
            aria-hidden="true"
            className="absolute"
            style={{ ...style, pointerEvents: 'auto' }}
            onPointerDown={(event) => event.preventDefault()}
            onClick={(event) => event.preventDefault()}
          />
        ))}
    </div>,
    document.body,
  );
}
