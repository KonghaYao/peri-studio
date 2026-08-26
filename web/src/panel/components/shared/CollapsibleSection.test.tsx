// CollapsibleSection 行为测试：details 折叠契约（结构 + 原生展开交互）。
// 折叠行为在此验证；各 feature 测试只保留内容级断言。

import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, describe, expect, it } from 'vitest';
import { CollapsibleSection } from './CollapsibleSection';

afterEach(cleanup);

describe('CollapsibleSection', () => {
  it('renders the details skeleton with mark, copy, meta and chevron', () => {
    render(() => <CollapsibleSection
      detailsClass="agent-activity"
      label="Peri activity"
      mark={<span class="agent-activity__pulse" aria-hidden="true" />}
      copy={<span class="agent-activity__summary-copy"><strong>Peri activity</strong><span>Code review · in progress</span></span>}
      meta={<span class="agent-activity__count">2</span>}
      chevronClass="agent-activity__chevron"
    >
      <ol><li>Content</li></ol>
    </CollapsibleSection>);

    const details = screen.getByRole('group', { name: 'Peri activity' });
    expect(details).not.toHaveAttribute('open');
    expect(details.querySelector('.agent-activity__summary-copy')).toHaveTextContent('Peri activity');
    expect(details.querySelector('.agent-activity__count')).toHaveTextContent('2');
    expect(details.querySelector('.agent-activity__chevron')).toHaveTextContent('›');
    // 折叠态由 details 原生机制实现：jsdom 不隐藏 children（无 layout），
    // 折叠语义通过 open 属性断言；展开后的可见性由下一个用例覆盖。
    expect(details.querySelector('ol')).not.toBeNull();
  });

  it('expands and collapses on summary click like a native disclosure', () => {
    render(() => <CollapsibleSection
      detailsClass="agent-plan"
      label="Agent execution plan"
      copy={<span class="agent-plan__summary-copy"><strong>Execution plan</strong><span>View task progress</span></span>}
      meta={<span class="agent-plan__progress">1/3</span>}
      chevronClass="agent-plan__chevron"
    >
      <ol><li>Visible content</li></ol>
    </CollapsibleSection>);

    const details = screen.getByRole('group', { name: 'Agent execution plan' });
    fireEvent.click(details.querySelector('summary')!);
    expect(details).toHaveAttribute('open');
    expect(screen.getByText('Visible content')).toBeInTheDocument();
    fireEvent.click(details.querySelector('summary')!);
    expect(details).not.toHaveAttribute('open');
  });

  it('honours an initial open state and an extra summary class', () => {
    render(() => <CollapsibleSection
      detailsClass="tool-card tool-card--error"
      summaryClass="tool-card__summary"
      open
      mark={<span class="tool-card__mark" aria-hidden="true" />}
      copy={<span class="tool-card__identity"><strong>shell</strong><code>call-1</code></span>}
      meta={<span class="tool-card__status">Failed</span>}
      chevronClass="tool-card__chevron"
    >
      <div class="tool-card__body">Body</div>
    </CollapsibleSection>);

    const details = screen.getByRole('group', { name: undefined });
    expect(details).toHaveAttribute('open');
    expect(details.querySelector('summary')).toHaveClass('tool-card__summary');
    expect(screen.getByText('Body')).toBeInTheDocument();
  });
});
