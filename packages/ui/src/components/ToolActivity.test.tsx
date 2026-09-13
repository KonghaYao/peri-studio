import { cleanup, render, screen } from '@solidjs/testing-library';
import { FileText } from 'lucide-solid';
import { afterEach, describe, expect, it } from 'vitest';
import { ToolActivityGroup, ToolActivityRow } from './ToolActivity';

afterEach(() => cleanup());

describe('ToolActivity', () => {
  it('renders status and expandable evidence', async () => {
    render(() => (
      <ToolActivityGroup>
        <ToolActivityRow
          icon={FileText}
          title="Opened file"
          input="path.ts"
          output="ok"
          status="done"
          duration="12ms"
        />
      </ToolActivityGroup>
    ));

    expect(screen.getByText('Opened file')).toBeInTheDocument();
    expect(screen.getByText('12ms')).toBeInTheDocument();
    expect(screen.queryByText('path.ts')).not.toBeInTheDocument();

    screen.getByLabelText('Expand tool details').click();
    expect(screen.getByText('path.ts')).toBeInTheDocument();
    expect(screen.getByText('ok')).toBeInTheDocument();
  });

  it('uses a white icon tile when idle and selected background while running', () => {
    const { unmount: unmountDone } = render(() => (
      <ToolActivityGroup>
        <ToolActivityRow title="Opened file" status="done" />
      </ToolActivityGroup>
    ));
    const doneIcon = document.querySelector('[data-slot="tool-activity-row"] span[aria-hidden="true"]');
    expect(doneIcon).toHaveClass('bg-surface');
    expect(doneIcon).not.toHaveClass('bg-sidebar-selected');
    unmountDone();

    render(() => (
      <ToolActivityGroup>
        <ToolActivityRow title="Running $ bun run test" status="running" />
      </ToolActivityGroup>
    ));
    const runningIcon = document.querySelector('[data-slot="tool-activity-row"] span[aria-hidden="true"]');
    expect(runningIcon).toHaveClass('bg-sidebar-selected');
    expect(runningIcon).not.toHaveClass('bg-surface');
  });

  it('renders a file preview as icon plus basename without the directory', () => {
    let opened = 0;
    render(() => (
      <ToolActivityGroup>
        <ToolActivityRow
          title=""
          status="done"
          filePreview={{
            prefix: 'Edited ',
            pathLabel: 'project-sidebar-model.ts',
            path: 'web/src/widgets/sidebar/project-sidebar-model.ts',
            onOpen: () => { opened += 1; },
          }}
        />
      </ToolActivityGroup>
    ));

    expect(screen.getByText('Edited')).toBeInTheDocument();
    const link = screen.getByTestId('tool-activity-file-link');
    expect(link).toHaveTextContent('project-sidebar-model.ts');
    expect(link).not.toHaveTextContent('web/src/widgets/sidebar');
    expect(link).not.toHaveClass('text-link');
    expect(link).toHaveAccessibleName('Edited project-sidebar-model.ts');
    expect(link.querySelector('[data-file-icon]')).toBeTruthy();
    link.click();
    expect(opened).toBe(1);
  });

  it('applies shimmer to the title while running', () => {
    render(() => (
      <ToolActivityGroup>
        <ToolActivityRow title="Running $ bun run test" status="running" />
      </ToolActivityGroup>
    ));

    const shimmer = screen.getByText('Running $ bun run test');
    expect(shimmer).toHaveClass('ui-ai-shimmer');
  });
});
