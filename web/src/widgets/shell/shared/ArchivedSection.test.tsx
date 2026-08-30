// ArchivedSection 行为测试：归档折叠区块契约。
// ProjectSidebar 内 archived-projects / archived-sessions 双胞胎的
// 展开交互与计数断言自此统一在此验证。

import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ArchivedSection } from './ArchivedSection';

afterEach(cleanup);

describe('ArchivedSection', () => {
  it('renders a toggle with label, count and chevron, collapsing the list initially', () => {
    render(() => <ArchivedSection
      toggleClass="archived-sessions__toggle"
      label="Archived sessions"
      count={3}
      open={false}
      onOpenChange={vi.fn()}
      listId="archived-sessions-p1"
      listClass="archived-session-list"
    >
      <div class="archived-session-row">Row content</div>
    </ArchivedSection>);

    const toggle = screen.getByRole('button', { name: /Archived sessions/ });
    expect(toggle).toHaveClass('archived-sessions__toggle');
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(toggle).not.toHaveAttribute('aria-controls');
    expect(toggle.querySelector('small')).toHaveTextContent('3');
    expect(toggle.querySelector('svg')).not.toBeNull();
    expect(screen.queryByText('Row content')).not.toBeInTheDocument();
  });

  it('expands on toggle and exposes the list container', () => {
    const onOpenChange = vi.fn();
    render(() => <ArchivedSection
      toggleClass="archived-projects__toggle"
      label="Archived"
      count={1}
      open
      onOpenChange={onOpenChange}
      listId="archived-project-list"
      listClass="archived-project-list"
    >
      <div class="archived-project-row">Project row</div>
    </ArchivedSection>);

    const toggle = screen.getByRole('button', { name: /Archived/ });
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(toggle).toHaveAttribute('aria-controls', 'archived-project-list');
    const list = screen.getByText('Project row').closest('#archived-project-list');
    expect(list).toHaveClass('archived-project-list');

    fireEvent.click(toggle);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
