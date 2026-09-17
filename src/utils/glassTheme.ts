/**
 * Glass morphism color tokens for the glassmorphic card components.
 * The cabinet is dark-only, so this is a fixed set; the function is kept
 * (no arguments) because callers and a test mock import it by name.
 */
export function getGlassColors() {
  return {
    // Card container
    cardBg: 'linear-gradient(145deg, rgba(255,255,255,0.05) 0%, rgba(255,255,255,0.02) 100%)',
    cardBorder: 'rgba(255,255,255,0.07)',

    // Inner sections (cards within cards)
    innerBg: 'rgba(255,255,255,0.03)',
    innerBorder: 'rgba(255,255,255,0.04)',

    // Hover states
    hoverBg: 'rgba(255,255,255,0.05)',

    // Text
    text: '#fff',
    textSecondary: 'rgba(255,255,255,0.4)',
    textMuted: 'rgba(255,255,255,0.3)',
    textFaint: 'rgba(255,255,255,0.25)',
    textGhost: 'rgba(255,255,255,0.08)',

    // Progress bar track
    trackBg: 'rgba(255,255,255,0.06)',
    trackBorder: 'rgba(255,255,255,0.04)',

    // Code blocks
    codeBg: 'rgba(255,255,255,0.03)',
    codeBorder: 'rgba(255,255,255,0.04)',
  };
}
