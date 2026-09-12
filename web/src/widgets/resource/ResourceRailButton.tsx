import { WorkbenchRailButton, type WorkbenchRailButtonProps } from '@peri/ui';

/** Shared rectangular action used by the workspace resource rail. */
export function ResourceRailButton(props: WorkbenchRailButtonProps) {
  return <WorkbenchRailButton layout="desktop" indicatorSide="left" {...props} />;
}
