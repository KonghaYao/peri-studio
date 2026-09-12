import { ComposerDropOverlay as ComposerDropOverlayBase } from '@peri/ui';
import type { ComposerDropOverlayProps } from '@peri/ui';

/** Composer drop 覆盖层（生产默认带 test id）。 */
export function ComposerDropOverlay(props: ComposerDropOverlayProps) {
  return <ComposerDropOverlayBase data-testid="composer-drop-overlay" {...props} />;
}
