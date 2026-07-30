import { cn } from '@/lib/utils';
import { safeBoolean } from './types';
import { useAnimationPause } from '@/hooks/useAnimationLoop';
import { useTheme } from '@/hooks/useTheme';

interface Props {
  settings: Record<string, unknown>;
}

const isMobile = typeof window !== 'undefined' && window.innerWidth < 768;

export default function AuroraBackground({ settings }: Props) {
  const showRadialGradient = safeBoolean(settings.showRadialGradient, true);
  const paused = useAnimationPause();
  const { isDark } = useTheme();
  const backgroundImage = isDark
    ? 'repeating-linear-gradient(100deg, #000 0%, #000 7%, transparent 10%, transparent 12%, #000 16%), repeating-linear-gradient(100deg, #3b82f6 10%, #a5b4fc 15%, #93c5fd 20%, #ddd6fe 25%, #60a5fa 30%)'
    : 'repeating-linear-gradient(100deg, rgba(255,255,255,0.42) 0%, rgba(255,255,255,0.42) 7%, transparent 10%, transparent 12%, rgba(255,255,255,0.42) 16%), repeating-linear-gradient(100deg, rgba(191,219,254,0.48) 10%, rgba(224,231,255,0.48) 15%, rgba(254,243,199,0.44) 20%, rgba(253,230,138,0.42) 25%, rgba(191,219,254,0.48) 30%)';

  return (
    <div className="absolute inset-0 overflow-hidden">
      <div
        className={cn(
          'pointer-events-none absolute -inset-[10px] opacity-50',
          !isMobile && 'animate-aurora',
          showRadialGradient &&
            '[mask-image:radial-gradient(ellipse_at_100%_0%,black_10%,transparent_70%)]',
        )}
        style={{
          backgroundImage,
          backgroundSize: isMobile ? '100%, 100%' : '300%, 200%',
          animationPlayState: paused ? 'paused' : 'running',
        }}
      />
    </div>
  );
}
