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
      label="Archived sessions"
      count={3}
      open={false}
      onOpenChange={vi.fn()}
      listId="archived-sessions-p1"
    >
      <div>Row content</div>
    </ArchivedSection>);

    const toggle = screen.getByTestId('archived-section-toggle');
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(toggle).not.toHaveAttribute('aria-controls');
    expect(toggle.querySelector('small')).toHaveTextContent('3');
    expect(toggle.querySelector('svg')).not.toBeNull();
    expect(screen.queryByText('Row content')).not.toBeInTheDocument();
  });

  it('expands on toggle and exposes the list container', () => {
    const onOpenChange = vi.fn();
    render(() => <ArchivedSection
      label="Archived"
      count={1}
      open
      onOpenChange={onOpenChange}
      listId="archived-project-list"
    >
      <div>Project row</div>
    </ArchivedSection>);

    const toggle = screen.getByTestId('archived-section-toggle');
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(toggle).toHaveAttribute('aria-controls', 'archived-project-list');
    expect(screen.getByTestId('archived-section-list')).toContainElement(screen.getByText('Project row'));

    fireEvent.click(toggle);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
