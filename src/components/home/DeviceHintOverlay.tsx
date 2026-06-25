import { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';
import { useFocusTrap } from '../../hooks/useFocusTrap';

interface DeviceHintOverlayProps {
  onDismiss: () => void;
  onConnect: () => void;
}

const DATA_ATTR = '[data-device-hint="connect-btn"]';

export default function DeviceHintOverlay({ onDismiss, onConnect }: DeviceHintOverlayProps) {
  const { t } = useTranslation();
  const [targetRect, setTargetRect] = useState<DOMRect | null>(null);
  const [isVisible, setIsVisible] = useState(false);
  const tooltipSizeRef = useRef<HTMLDivElement>(null);

  // Focus trap (Tab cycling + Escape). lockScroll: false — как в остальных оверлеях проекта.
  const trapRef = useFocusTrap<HTMLDivElement>(isVisible, {
    onEscape: onDismiss,
    lockScroll: false,
  });

  // Объединяем trapRef + tooltipSizeRef в один callback-ref
  const setTooltipNode = useCallback(
    (node: HTMLDivElement | null) => {
      tooltipSizeRef.current = node;
      trapRef.current = node;
    },
    [trapRef],
  );

  // Находим кнопку в DOM с повторными попытками (элемент может ещё рендериться)
  useEffect(() => {
    let cancelled = false;
    let attempts = 0;
    const timers: number[] = [];

    const tryFind = () => {
      if (cancelled) return;
      const target = document.querySelector(DATA_ATTR);
      if (target) {
        setTargetRect(target.getBoundingClientRect());
        const t2 = window.setTimeout(() => {
          if (!cancelled) setIsVisible(true);
        }, 100);
        timers.push(t2);
        return;
      }
      attempts += 1;
      if (attempts < 6) {
        const t3 = window.setTimeout(tryFind, 200);
        timers.push(t3);
      }
    };

    const t1 = window.setTimeout(tryFind, 300);
    timers.push(t1);

    return () => {
      cancelled = true;
      timers.forEach((id) => window.clearTimeout(id));
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

  // Клик по области кнопки = закрыть подсказку + перейти к подключению
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
    const vh = window.innerHeight;
    const tooltipH = tooltipSizeRef.current?.offsetHeight ?? 180;

    const left = Math.max(16, Math.min(targetRect.left, vw - tooltipW - 16));
    // Клампируем снизу, чтобы тултип не вылетал за экран на коротких телефонах
    const top = Math.min(targetRect.bottom + pad + 14, vh - tooltipH - 16);

    return {
      top,
      left,
      width: tooltipW,
      opacity: isVisible ? 1 : 0,
      transform: isVisible ? 'scale(1)' : 'scale(0.95)',
      // Анимация запускается после того как элемент становится видимым (не во время opacity:0)
      animationDelay: '0.1s',
      animationFillMode: 'both',
      pointerEvents: isVisible ? 'auto' : 'none',
    };
  };

  return createPortal(
    <div className="onboarding-overlay" style={{ opacity: isVisible ? 1 : 0 }}>
      {/* Подсветка кнопки */}
      <div className="onboarding-spotlight" style={spotlightStyle} />

      {/* Тултип ниже кнопки */}
      <div
        ref={setTooltipNode}
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

      {/* FIX: pointer-events-auto — иначе div наследует none от .onboarding-overlay */}
      {targetRect && isVisible && (
        <div
          aria-hidden="true"
          className="absolute cursor-pointer"
          style={{
            top: targetRect.top,
            left: targetRect.left,
            width: targetRect.width,
            height: targetRect.height,
            pointerEvents: 'auto',
          }}
          onClick={handleButtonAreaClick}
        />
      )}
    </div>,
    document.body,
  );
}
