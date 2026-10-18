import type { BlockRendererProps } from './types';
import { useTranslation } from 'react-i18next';
import { CheckIcon } from '@/components/icons';
import { useConnectionProgress } from './useConnectionProgress';

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
  getLocalizedText,
  renderBlockButtons,
  connectionFlow,
}: BlockRendererProps) {
  const { t } = useTranslation();
  const flow = useConnectionProgress(connectionFlow);
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
        const completed =
          !!connectionFlow &&
          index < flow.active &&
          !(
            index === 0 &&
            connectionFlow.platform === 'ios' &&
            connectionFlow.app === 'Happ' &&
            !flow.received
          );
        const collapsed = completed && flow.expanded !== index;
        const status = index === 1 ? flow.received : index === 2 && flow.active === 3;

        return (
          <div key={index} className="flex gap-3 sm:gap-4">
            {/* Left column: number bullet + line segment */}
            <div className="flex flex-col items-center">
              <div
                className={`flex shrink-0 items-center justify-center rounded-full font-semibold text-white ${completed ? 'bg-success-600' : 'bg-accent-500'} ${connectionFlow && index === flow.active ? 'ring-4 ring-accent-500/30' : ''} ${
                  isMobile ? 'text-base' : 'text-lg'
                }`}
                style={{ width: size, height: size }}
              >
                {completed ? <CheckIcon className="h-5 w-5" /> : index + 1}
              </div>
              {!isLast && <div className="w-0.5 flex-1 bg-dark-700" />}
            </div>
            {/* Right column: content */}
            <div className={`min-w-0 flex-1 ${isLast ? '' : 'pb-6'}`}>
              <h3 className="font-semibold text-dark-100">
                {completed ? (
                  <button
                    aria-expanded={!collapsed}
                    onClick={() => flow.setExpanded(collapsed ? index : null)}
                    className="min-h-11 text-left text-dark-400"
                  >
                    {getLocalizedText(block.title)}
                  </button>
                ) : (
                  getLocalizedText(block.title)
                )}
              </h3>
              {!collapsed && (
                <>
                  <p className="mt-1 whitespace-pre-line text-sm leading-relaxed text-dark-400">
                    {getLocalizedText(block.description)}
                  </p>
                  {renderBlockButtons(
                    block.buttons,
                    'light',
                    connectionFlow
                      ? { primary: index === flow.active, action: flow.action }
                      : undefined,
                  )}
                  {connectionFlow &&
                    index === 0 &&
                    (connectionFlow.platform === 'ios' && connectionFlow.app === 'Happ' ? (
                      <button
                        className="inline-flex min-h-11 w-full items-center justify-center gap-2 text-center text-xs text-accent-400"
                        onClick={connectionFlow.selectIncy}
                      >
                        <span aria-hidden="true">⇄</span>
                        {t('subscription.connection.chooseIncy')}
                      </button>
                    ) : (
                      <button
                        className="inline-flex min-h-11 w-full items-center justify-center gap-2 text-center text-xs text-accent-400"
                        onClick={flow.skip}
                      >
                        {t('subscription.connection.alreadyInstalled', { app: connectionFlow.app })}
                      </button>
                    ))}
                  {block.customNode}
                </>
              )}
              {connectionFlow && status && (
                <p
                  role="status"
                  className="mt-2 rounded-xl border border-success-500/30 bg-success-500/10 p-3 text-sm text-success-400"
                >
                  <CheckIcon className="mr-2 inline h-4 w-4" />
                  {t(`subscription.connection.${index === 2 ? 'vpnWorking' : 'receivedSettings'}`, {
                    app: connectionFlow.app,
                  })}
                </p>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
