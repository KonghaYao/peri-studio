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
});
