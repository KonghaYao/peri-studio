import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, describe, expect, it } from 'vitest';
import { resetResourceProject, setResourceDiffPreview } from '../lib/resource-store';
import { ResourceDiffEditor } from './ResourceDiffEditor';

afterEach(() => { cleanup(); resetResourceProject(); });

describe('VS Code-style Git diff editor', () => {
  it('renders aligned old and new lines with comparison context', () => {
    setResourceDiffPreview({
      requestId: 'request-1', repoId: 'repo-1', groupId: 'working_tree', changeId: 'change-1',
      path: 'src/main.ts', status: 'modified', loading: false,
      text: '--- a/src/main.ts\n+++ b/src/main.ts\n@@ -1,2 +1,2 @@\n keep\n-before\n+after\n',
    });

    render(() => <ResourceDiffEditor />);

    expect(screen.getByLabelText('Git diff preview')).toBeInTheDocument();
    expect(screen.getByText('Index ↔ Working Tree')).toBeInTheDocument();
    expect(screen.getByRole('table', { name: 'Changes in src/main.ts' })).toBeInTheDocument();
    expect(screen.getByText('before')).toBeInTheDocument();
    expect(screen.getByText('after')).toBeInTheDocument();
    expect(screen.getByText('before').parentElement).toHaveClass('bg-danger-soft');
    expect(screen.getByText('after').parentElement).toHaveClass('bg-success-soft');
  });

  it('explains binary changes and closes with Escape', () => {
    setResourceDiffPreview({
      requestId: 'request-2', repoId: 'repo-1', groupId: 'index', changeId: 'change-2',
      path: 'logo.png', status: 'modified', loading: false,
      text: 'diff --git a/logo.png b/logo.png\nBinary files a/logo.png and b/logo.png differ\n',
    });

    render(() => <ResourceDiffEditor />);
    expect(screen.getByText('Binary file')).toBeInTheDocument();
    expect(screen.getByText('HEAD ↔ Index')).toBeInTheDocument();

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByText('logo.png')).not.toBeInTheDocument();
  });

  it('offers a repository refresh for a stale change identity', () => {
    setResourceDiffPreview({
      requestId: 'request-3', repoId: 'repo-1', groupId: 'working_tree', changeId: 'stale-change',
      path: 'src/main.ts', status: 'modified', loading: false,
      error: 'repository state changed', errorCode: 'VERSION_CONFLICT', retryable: false,
    });

    render(() => <ResourceDiffEditor />);
    expect(screen.getByRole('alert')).toHaveTextContent('repository state changed');
    expect(screen.getByRole('button', { name: 'Refresh Source Control' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
  });
});
