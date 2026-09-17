/**
 * Shared button styling for connection blocks. The config-driven blocks
 * (BlockButtons) and the Happ TV quick-connect both render through this so the
 * latter adapts to exactly the same visual language as the styles coming from
 * the subscription-page config — no divergent one-off button styles.
 */
export function blockButtonClass(variant: 'light' | 'subtle'): string {
  // `variant: 'light'` — это стиль кнопки (контурная), не тема: кабинет всегда тёмный.
  if (variant === 'light') {
    return 'rounded-xl border border-accent-500/40 px-4 py-2 text-sm font-medium text-accent-400 transition-all hover:bg-accent-500/10';
  }
  return 'rounded-xl px-3 py-1.5 text-sm font-medium text-dark-300 transition-all hover:bg-dark-700/50';
}
