import { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';

interface DeviceHintOverlayProps {
  onDismiss: () => void;
  onConnect: () => void;
}

const DATA_ATTR = '[data-device-hint="connect-btn"]';

export default function DeviceHintOverlay({ onDismiss, onConnect }: DeviceHintOverlayProps) {
  const { t } = useTranslation();
  const [targetRect, setTargetRect] = useState<DOMRect | null>(null);
  const [isVisible, setIsVisible] = useState(false);
  const tooltipRef = useRef<HTMLDivElement>(null);

  // Находим кнопку в DOM с повторными попытками (элемент может ещё рендериться)
  useEffect(() => {
    let cancelled = false;
    let attempts = 0;

    const tryFind = () => {
      if (cancelled) return;
      const target = document.querySelector(DATA_ATTR);
      if (target) {
        setTargetRect(target.getBoundingClientRect());
        window.setTimeout(() => {
          if (!cancelled) setIsVisible(true);
        }, 100);
        return;
      }
      attempts += 1;
      if (attempts < 6) window.setTimeout(tryFind, 200);
    };

    window.setTimeout(tryFind, 300);
    return () => {
      cancelled = true;
    };
  }, []);

  // Пересчитываем позицию при ресайзе и скролле
  useEffect(() => {
    const update = () => {
      const target = document.querySelector(DATA_ATTR);
      if (target) setTargetRect(target.getBoundingClientRect());
    };
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, []);

  // Escape закрывает оверлей
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onDismiss();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onDismiss]);

  // Клик по области кнопки = понял + переходим к подключению
  const handleButtonAreaClick = () => {
    onDismiss();
    onConnect();
  };

  const pad = 8;

  const spotlightStyle: React.CSSProperties = targetRect
    ? {
        top: targetRect.top - pad,
        left: targetRect.left - pad,
        width: targetRect.width + pad * 2,
        height: targetRect.height + pad * 2,
        opacity: isVisible ? 1 : 0,
      }
    : { opacity: 0 };

  const getTooltipStyle = (): React.CSSProperties => {
    if (!targetRect) return { opacity: 0 };
    const tooltipW = 320;
    const vw = window.innerWidth;
    const left = Math.max(16, Math.min(targetRect.left, vw - tooltipW - 16));
    const top = targetRect.bottom + pad + 14;
    return {
      top,
      left,
      width: tooltipW,
      opacity: isVisible ? 1 : 0,
      transform: isVisible ? 'scale(1)' : 'scale(0.95)',
      pointerEvents: isVisible ? 'auto' : 'none',
    };
  };

  return createPortal(
    <div className="onboarding-overlay" style={{ opacity: isVisible ? 1 : 0 }}>
      {/* Подсветка кнопки */}
      <div className="onboarding-spotlight" style={spotlightStyle} />

      {/* Тултип ниже кнопки */}
      <div
        ref={tooltipRef}
        className="onboarding-tooltip tooltip-bottom"
        style={getTooltipStyle()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="device-hint-title"
        aria-describedby="device-hint-desc"
      >
        <h3 id="device-hint-title" className="mb-2 text-lg font-semibold text-dark-50">
          {t('home.deviceHint.title')}
        </h3>
        <p id="device-hint-desc" className="mb-5 text-sm text-dark-400">
          {t('home.deviceHint.description')}
        </p>
        <button type="button" onClick={onDismiss} className="btn-primary w-full text-sm">
          {t('home.deviceHint.dismiss')}
        </button>
      </div>

      {/* Прозрачный слой над кнопкой: клик = понял + навигация */}
      {targetRect && isVisible && (
        <div
          aria-hidden="true"
          className="absolute cursor-pointer"
          style={{
            top: targetRect.top,
            left: targetRect.left,
            width: targetRect.width,
            height: targetRect.height,
          }}
          onClick={handleButtonAreaClick}
        />
      )}
    </div>,
    document.body,
  );
}
