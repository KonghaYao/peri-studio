import { type JSX } from 'solid-js';
import { WorkbenchFloatingPanel, type WorkbenchPanelWidthProfile } from '@peri/ui';

type ResourceFloatingPanelProps = {
  children: JSX.Element;
  class?: string;
  'data-testid'?: string;
  widthProfile?: WorkbenchPanelWidthProfile;
  anchor?: 'left' | 'right';
  leftOffset?: number;
};

/** 桌面端浮动面板壳：委托 `@peri/ui` WorkbenchFloatingPanel。 */
export function ResourceFloatingPanel(props: ResourceFloatingPanelProps) {
  return <WorkbenchFloatingPanel {...props} />;
}
