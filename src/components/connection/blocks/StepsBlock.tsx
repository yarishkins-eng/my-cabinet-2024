import type { BlockRendererProps } from './types';

/**
 * Numbered installation flow: every step is shown at once as a vertical 1·2·3
 * list with a big number bullet and a connecting line — so even a first-time
 * user reads it as "do step 1, then 2, then 3" instead of separate cards or
 * collapsed accordions. Mirrors TimelineBlock, but the bullet is the step
 * number rather than the block icon (sequence, not category).
 */
export function StepsBlock({
  blocks,
  isMobile,
  isLight,
  getLocalizedText,
  renderBlockButtons,
}: BlockRendererProps) {
  const visibleBlocks = blocks.filter(
    (b) =>
      getLocalizedText(b.title) ||
      getLocalizedText(b.description) ||
      b.buttons?.length ||
      b.customNode,
  );

  if (!visibleBlocks.length) return null;

  const size = isMobile ? 36 : 44;

  return (
    <div className="space-y-0">
      {visibleBlocks.map((block, index) => {
        const isLast = index === visibleBlocks.length - 1;

        return (
          <div key={index} className="flex gap-3 sm:gap-4">
            {/* Left column: number bullet + line segment */}
            <div className="flex flex-col items-center">
              <div
                className={`flex shrink-0 items-center justify-center rounded-full bg-accent-500 font-semibold text-white ${
                  isMobile ? 'text-base' : 'text-lg'
                }`}
                style={{ width: size, height: size }}
              >
                {index + 1}
              </div>
              {!isLast && (
                <div className={`w-0.5 flex-1 ${isLight ? 'bg-dark-700/40' : 'bg-dark-700'}`} />
              )}
            </div>
            {/* Right column: content */}
            <div className={`min-w-0 flex-1 ${isLast ? '' : 'pb-6'}`}>
              <h3 className="font-semibold text-dark-100">{getLocalizedText(block.title)}</h3>
              <p className="mt-1 whitespace-pre-line text-sm leading-relaxed text-dark-400">
                {getLocalizedText(block.description)}
              </p>
              {renderBlockButtons(block.buttons, 'light')}
              {block.customNode}
            </div>
          </div>
        );
      })}
    </div>
  );
}
