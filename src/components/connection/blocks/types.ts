import type { ReactNode } from 'react';
import type { RemnawaveBlockClient, RemnawaveButtonClient, LocalizedText } from '@/types';
import type { ConnectionFlow } from './useConnectionProgress';

/**
 * A block to render. Beyond the panel's data (title/description/buttons), it may
 * carry `customNode` — extra interactive content (e.g. the Happ TV connect
 * widget) that every renderer drops into the block body, so it inherits the
 * active style (cards/timeline/accordion/minimal) instead of clashing with it.
 */
export type RenderBlock = RemnawaveBlockClient & { customNode?: ReactNode };

export interface BlockRendererProps {
  connectionFlow?: ConnectionFlow;
  blocks: RenderBlock[];
  isMobile: boolean;
  getLocalizedText: (text: LocalizedText | undefined) => string;
  getSvgHtml: (key: string | undefined) => string;
  renderBlockButtons: (
    buttons: RemnawaveButtonClient[] | undefined,
    variant: 'light' | 'subtle',
    step?: { primary: boolean; action: (type: string) => void },
  ) => React.ReactNode;
}
