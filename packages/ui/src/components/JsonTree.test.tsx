import { cleanup, fireEvent, render, screen, within } from '@solidjs/testing-library';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { JsonTree } from './JsonTree';
import { buildLargeJsonFixture } from './json-tree-model';

afterEach(() => cleanup());

describe('JsonTree', () => {
  it('renders empty state for null', () => {
    render(() => <JsonTree data={null} />);
    expect(screen.getByText('(empty)')).toBeInTheDocument();
  });

  it('renders empty state for undefined', () => {
    render(() => <JsonTree data={undefined} />);
    expect(screen.getByText('(empty)')).toBeInTheDocument();
  });

  it('renders primitive values', () => {
    render(() => <JsonTree data="hello" />);
    expect(screen.getByText('hello')).toBeInTheDocument();
  });

  it('truncates long string previews', () => {
    const long = 'x'.repeat(60);
    render(() => <JsonTree data={{ note: long }} defaultCollapsedDepth={1} />);
    expect(screen.getByText(`"${'x'.repeat(48)}…"`)).toBeInTheDocument();
  });

  it('renders nested object fields when expanded by default depth', () => {
    render(() => (
      <JsonTree
        data={{ name: 'trace', nested: { count: 2 } }}
        defaultCollapsedDepth={2}
      />
    ));
    expect(screen.getByText('name')).toBeInTheDocument();
    expect(screen.getByText('"trace"')).toBeInTheDocument();
    expect(screen.getByText('count')).toBeInTheDocument();
  });

  it('collapses deep nodes until expanded', () => {
    render(() => (
      <JsonTree
        data={{ nested: { secret: 'hidden' } }}
        defaultCollapsedDepth={0}
      />
    ));
    expect(screen.getByText('Object(1)')).toBeInTheDocument();
    expect(screen.queryByText('nested')).not.toBeInTheDocument();
    expect(screen.queryByText('secret')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Expand' }));
    expect(screen.getByText('nested')).toBeInTheDocument();
    expect(screen.queryByText('"hidden"')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Expand' }));
    expect(screen.getByText('"hidden"')).toBeInTheDocument();
  });

  it('renders array indices', () => {
    render(() => (
      <JsonTree
        data={[{ role: 'user' }]}
        defaultCollapsedDepth={2}
      />
    ));
    expect(screen.getByText('0')).toBeInTheDocument();
    expect(screen.getByText('role')).toBeInTheDocument();
  });

  it('colors boolean values with accent token class', () => {
    render(() => (
      <JsonTree
        data={{ enabled: true }}
        defaultCollapsedDepth={2}
      />
    ));
    const row = screen.getByText('true');
    expect(row.className).toContain('text-accent-solid');
  });

  describe('copy', () => {
    const writeText = vi.fn();

    beforeEach(() => {
      writeText.mockReset();
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: { writeText },
      });
    });

    it('copies leaf JSON value on row copy click', async () => {
      writeText.mockResolvedValue(undefined);
      render(() => (
        <JsonTree
          data={{ note: 'trace' }}
          defaultCollapsedDepth={2}
        />
      ));
      const row = screen.getByText('note').closest('[data-json-path]');
      expect(row).not.toBeNull();
      const copyButton = within(row as HTMLElement).getByRole('button', { name: 'Copy' });
      fireEvent.click(copyButton);
      expect(writeText).toHaveBeenCalledWith('"trace"');
      expect(await within(row as HTMLElement).findByRole('button', { name: 'Copied' })).toBeInTheDocument();
    });

    it('copies JSON path for expandable rows', async () => {
      writeText.mockResolvedValue(undefined);
      render(() => (
        <JsonTree
          data={{ nested: { secret: 'hidden' } }}
          defaultCollapsedDepth={0}
        />
      ));
      const row = screen.getByText('Object(1)').closest('[data-json-path]');
      expect(row).not.toBeNull();
      const copyButton = within(row as HTMLElement).getByRole('button', { name: 'Copy path' });
      fireEvent.click(copyButton);
      expect(writeText).toHaveBeenCalledWith('root');
    });

    it('reports copy failure without throwing', async () => {
      writeText.mockRejectedValue(new Error('denied'));
      render(() => (
        <JsonTree
          data={{ note: 'trace' }}
          defaultCollapsedDepth={2}
        />
      ));
      const row = screen.getByText('note').closest('[data-json-path]');
      const copyButton = within(row as HTMLElement).getByRole('button', { name: 'Copy' });
      fireEvent.click(copyButton);
      expect(await within(row as HTMLElement).findByRole('button', { name: 'Copy failed' })).toBeInTheDocument();
    });
  });

  describe('virtualization', () => {
    it('uses flat mode for small expanded trees', () => {
      const { container } = render(() => (
        <JsonTree
          data={{ a: 1, b: 2 }}
          defaultCollapsedDepth={2}
          virtualizeAfter={10}
        />
      ));
      expect(container.querySelector('[data-json-tree-mode="flat"]')).toBeInTheDocument();
      expect(container.querySelector('[data-json-tree-mode="virtual"]')).not.toBeInTheDocument();
    });

    it('uses virtual mode when expanded rows exceed threshold', () => {
      const data = buildLargeJsonFixture(8);
      const { container } = render(() => (
        <JsonTree
          data={data}
          defaultCollapsedDepth={Number.MAX_SAFE_INTEGER}
          virtualizeAfter={5}
        />
      ));
      expect(container.querySelector('[data-json-tree-mode="virtual"]')).toBeInTheDocument();
      expect(container.querySelector('[data-json-tree-mode="flat"]')).not.toBeInTheDocument();
    });
  });
});
