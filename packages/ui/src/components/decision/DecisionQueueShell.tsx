import { splitProps, type Component, type JSX } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { cn } from '../../lib/cn';
import { decisionQueueShellClass, decisionQueueSurfaceClass } from './decision-queue-layout';

export {
  decisionQueueShellClass,
  decisionQueueSurfaceClass,
} from './decision-queue-layout';

export type DecisionQueueShellProps = {
  class?: string;
  surfaceClass?: string;
  element?: 'section' | 'aside';
  'aria-label'?: string;
  'data-testid'?: string;
  surfaceTestId?: string;
  children: JSX.Element;
};

/** T3 · Composer 上方决策队列容器：permissions / questions / elicitation 共用叠层壳。 */
export const DecisionQueueShell: Component<DecisionQueueShellProps> = (props) => {
  const [local, rest] = splitProps(props, [
    'class',
    'surfaceClass',
    'element',
    'surfaceTestId',
    'children',
  ]);
  const tag = () => local.element ?? 'section';

  return (
    <Dynamic
      component={tag()}
      data-slot="decision-queue-shell"
      data-testid={rest['data-testid']}
      class={cn(decisionQueueShellClass, local.class)}
      aria-label={rest['aria-label']}
    >
      <div
        data-testid={local.surfaceTestId}
        class={cn(decisionQueueSurfaceClass, local.surfaceClass)}
      >
        {local.children}
      </div>
    </Dynamic>
  );
};
