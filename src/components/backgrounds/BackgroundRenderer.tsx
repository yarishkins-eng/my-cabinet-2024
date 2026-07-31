import { Suspense, useMemo } from 'react';
import { createPortal } from 'react-dom';
import { useQuery } from '@tanstack/react-query';
import { brandingApi } from '@/api/branding';
import type { AnimationConfig, BackgroundType } from '@/components/ui/backgrounds/types';
import { DEFAULT_ANIMATION_CONFIG } from '@/components/ui/backgrounds/types';
import { backgroundComponents, prefetchBackground } from '@/components/ui/backgrounds/registry';
import { validateConfig, getCachedConfig, setCachedConfig } from '@/utils/backgroundConfig';
import { useTheme } from '@/hooks/useTheme';

// Prefetch the background JS chunk immediately based on localStorage cache.
const cachedConfig = getCachedConfig();
if (cachedConfig?.enabled && cachedConfig.type && cachedConfig.type !== 'none') {
  prefetchBackground(cachedConfig.type);
}

function reduceMobileSettings(settings: Record<string, unknown>): Record<string, unknown> {
  const reduced = { ...settings };
  // 75% reduction (divide by 4) instead of 50% — much less GPU work
  if (typeof reduced.particleCount === 'number')
    reduced.particleCount = Math.max(20, Math.floor(reduced.particleCount / 4));
  if (typeof reduced.particleDensity === 'number')
    reduced.particleDensity = Math.max(50, Math.floor(reduced.particleDensity / 4));
  if (typeof reduced.number === 'number')
    reduced.number = Math.max(5, Math.floor(reduced.number / 4));
  if ('interactive' in reduced) reduced.interactive = false;
  if (typeof reduced.lineCount === 'number')
    reduced.lineCount = Math.max(5, Math.floor(reduced.lineCount / 2));
  if (typeof reduced.rippleCount === 'number')
    reduced.rippleCount = Math.max(2, Math.floor(reduced.rippleCount / 2));
  if (typeof reduced.count === 'number') reduced.count = Math.max(3, Math.floor(reduced.count / 2));
  if (typeof reduced.rows === 'number') reduced.rows = Math.max(4, Math.floor(reduced.rows * 0.6));
  if (typeof reduced.cols === 'number') reduced.cols = Math.max(4, Math.floor(reduced.cols * 0.6));
  return reduced;
}

function RenderBackground({
  config,
  includeThemeBackdrop = false,
}: {
  config: AnimationConfig;
  includeThemeBackdrop?: boolean;
}) {
  const { theme, isDark } = useTheme();
  const prefersReducedMotion = useMemo(
    () => window.matchMedia('(prefers-reduced-motion: reduce)').matches,
    [],
  );

  const shouldRenderAnimation = config.enabled && config.type !== 'none' && !prefersReducedMotion;

  if (!shouldRenderAnimation && !includeThemeBackdrop) {
    return null;
  }

  const bgType = shouldRenderAnimation ? (config.type as Exclude<BackgroundType, 'none'>) : null;
  const Component = bgType ? backgroundComponents[bgType] : null;

  if (shouldRenderAnimation && !Component && !includeThemeBackdrop) return null;

  const isMobile = window.innerWidth < 768;
  const settings =
    config.reducedOnMobile && isMobile ? reduceMobileSettings(config.settings) : config.settings;

  // On mobile, cap blur to 4px max — full blur is extremely GPU-heavy
  const effectiveBlur = isMobile ? Math.min(config.blur, 4) : config.blur;

  return createPortal(
    <div
      className="pointer-events-none fixed inset-0"
      data-app-background-theme={theme}
      style={{
        zIndex: -2,
        backgroundColor: includeThemeBackdrop
          ? isDark
            ? 'var(--color-dark-bg)'
            : 'var(--color-light-bg)'
          : undefined,
      }}
    >
      {shouldRenderAnimation && Component && (
        <div
          className="absolute inset-0"
          style={{
            opacity: config.opacity,
            filter: effectiveBlur > 0 ? `blur(${effectiveBlur}px)` : undefined,
            contain: 'strict',
            backfaceVisibility: 'hidden',
          }}
        >
          <Suspense fallback={null}>
            <Component settings={settings} />
          </Suspense>
        </div>
      )}
    </div>,
    document.body,
    // Telegram Desktop/macOS can retain the separately painted body/root canvas
    // together with this negative-z animated surface after the DOM has already
    // switched themes. Route navigation happened to invalidate those pixels.
    // For the application backdrop, replace the portal subtree on every theme
    // change and paint the base colour inside it; static landing backgrounds keep
    // a stable key because they do not own the application backdrop.
    includeThemeBackdrop ? `app-background-${theme}` : 'static-background',
  );
}

export function BackgroundRenderer() {
  const { data: config } = useQuery({
    queryKey: ['animation-config'],
    queryFn: async () => {
      const raw = await brandingApi.getAnimationConfig();
      const result = validateConfig(raw) ?? DEFAULT_ANIMATION_CONFIG;
      setCachedConfig(result);
      return result;
    },
    initialData: getCachedConfig() ?? undefined,
    initialDataUpdatedAt: 0,
    staleTime: 30_000,
  });

  const effectiveConfig = config ?? DEFAULT_ANIMATION_CONFIG;
  return <RenderBackground config={effectiveConfig} includeThemeBackdrop />;
}

export function StaticBackgroundRenderer({ config }: { config: AnimationConfig }) {
  const validated = useMemo(() => validateConfig(config), [config]);
  if (!validated) return null;
  return <RenderBackground config={validated} />;
}
