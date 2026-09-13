import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Avatar, AvatarFallback, AvatarGroup } from './Avatar';
import { Badge } from './Badge';
import { Descriptions, layoutDescriptionItems } from './descriptions/Descriptions';
import { List as DisplayList, ListLoadMore } from './list';
import { PaginationControls } from './Pagination';
import { QRCode } from './qr-code';
import { Segmented } from './segmented';
import { Statistic, StatisticCountdown } from './statistic';
import { Tag } from './tag';
import { Timeline } from './timeline';
import { TypographyText } from './typography/Text';

afterEach(() => cleanup());

describe('Display components', () => {
  it('renders descriptions with bordered layout', () => {
    render(() => (
      <Descriptions
        bordered
        title="User Info"
        items={[
          { label: 'Name', children: 'Peri Studio' },
          { label: 'Role', children: 'Admin' },
        ]}
      />
    ));
    expect(screen.getByText('User Info')).toBeInTheDocument();
    expect(screen.getByText('Peri Studio')).toBeInTheDocument();
  });

  it('lays out multi-column descriptions as separate label and value cells', () => {
    const { placements, rowCount } = layoutDescriptionItems(
      [
        { label: 'Instance', children: 'local-connect' },
        { label: 'Protocol', children: 'ACP 1.2' },
        { label: 'Sessions', children: '12 active', span: 2 },
      ],
      2,
    );
    expect(rowCount).toBe(2);
    expect(placements).toHaveLength(3);
    expect(placements[0]).toMatchObject({ row: 0, colStart: 0, span: 1, isRowEnd: false });
    expect(placements[1]).toMatchObject({ row: 0, colStart: 1, span: 1, isRowEnd: true });
    expect(placements[2]).toMatchObject({ row: 1, colStart: 0, span: 2, isRowEnd: true });

    const { container } = render(() => (
      <Descriptions
        bordered
        column={2}
        items={[
          { label: 'Instance', children: 'local-connect' },
          { label: 'Protocol', children: 'ACP 1.2' },
          { label: 'Sessions', children: '12 active', span: 2 },
        ]}
      />
    ));
    const labels = container.querySelectorAll('[data-slot="descriptions-label"]');
    const contents = container.querySelectorAll('[data-slot="descriptions-content"]');
    expect(labels).toHaveLength(3);
    expect(contents).toHaveLength(3);
    expect(labels[0]).toHaveStyle({ 'grid-column': '1' });
    expect(contents[0]).toHaveStyle({ 'grid-column': '2 / span 1' });
    expect(labels[1]).toHaveStyle({ 'grid-column': '3' });
    expect(contents[1]).toHaveStyle({ 'grid-column': '4 / span 1' });
    expect(labels[2]).toHaveStyle({ 'grid-column': '1' });
    expect(contents[2]).toHaveStyle({ 'grid-column': '2 / span 3' });
  });

  it('renders segmented control and fires onChange', () => {
    const onChange = vi.fn();
    render(() => (
      <Segmented
        options={[
          { label: 'Daily', value: 'daily' },
          { label: 'Weekly', value: 'weekly' },
        ]}
        value="daily"
        onChange={onChange}
      />
    ));
    fireEvent.click(screen.getByRole('radio', { name: 'Weekly' }));
    expect(onChange).toHaveBeenCalledWith('weekly');
  });

  it('renders statistic and countdown', () => {
    render(() => (
      <>
        <Statistic title="Active users" value={1280} suffix="users" />
        <StatisticCountdown title="Launch" value={Date.now() + 60_000} format="mm:ss" />
      </>
    ));
    expect(screen.getByText('1,280')).toBeInTheDocument();
    expect(screen.getByText('users')).toBeInTheDocument();
  });

  it('supports closable and checkable tags', () => {
    const onChange = vi.fn();
    render(() => (
      <>
        <Tag closable onClose={(event: Event) => event.preventDefault()}>Closable</Tag>
        <Tag checked={false} onChange={onChange}>Checkable</Tag>
      </>
    ));
    fireEvent.click(screen.getByRole('checkbox', { name: /Checkable/ }));
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it('renders timeline items', () => {
    render(() => (
      <Timeline
        items={[
          { label: '09:00', children: 'Create project' },
          { label: '10:00', children: 'Run agent' },
        ]}
      />
    ));
    expect(screen.getByText('Create project')).toBeInTheDocument();
  });

  it('renders list with load more', () => {
    render(() => (
      <DisplayList
        header="Sessions"
        dataSource={[{ meta: { title: 'Alpha', description: 'Updated today' } }]}
        loadMore={<ListLoadMore>Load more</ListLoadMore>}
      />
    ));
    expect(screen.getByText('Sessions')).toBeInTheDocument();
    expect(screen.getByText('Alpha')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Load more' })).toBeInTheDocument();
  });

  it('renders QR code with accessible label and svg payload', () => {
    render(() => <QRCode value="https://peri.studio/docs" />);
    const qr = screen.getByRole('img', { name: /QR code for https:\/\/peri\.studio\/docs/ });
    expect(qr).toBeInTheDocument();
    expect(qr.querySelector('svg')).toBeTruthy();
    expect(qr.querySelector('path[fill="currentColor"]')).toBeTruthy();
  });

  it('renders badge count with overflow', () => {
    render(() => (
      <Badge count={120} overflowCount={99}>
        <span>Inbox</span>
      </Badge>
    ));
    expect(screen.getByText('99+')).toBeInTheDocument();
  });

  it('anchors badge count to the top-right of its child', () => {
    const { container } = render(() => (
      <Badge count={5} dot>
        <button type="button">Inbox</button>
      </Badge>
    ));
    const count = container.querySelector('[data-slot="badge-count"]');
    expect(count).toHaveStyle({
      position: 'absolute',
      top: '0px',
      right: '0px',
    });
  });

  it('renders avatar group overflow', () => {
    render(() => (
      <AvatarGroup max={2}>
        <Avatar><AvatarFallback>A</AvatarFallback></Avatar>
        <Avatar><AvatarFallback>B</AvatarFallback></Avatar>
        <Avatar><AvatarFallback>C</AvatarFallback></Avatar>
      </AvatarGroup>
    ));
    expect(screen.getByText('+1')).toBeInTheDocument();
  });

  it('renders pagination controls with total', () => {
    const onChange = vi.fn();
    render(() => (
      <PaginationControls current={2} pageSize={10} total={45} showTotal onChange={onChange} />
    ));
    expect(screen.getByText('Total 45 items')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('link', { name: 'Go to next page' }));
    expect(onChange).toHaveBeenCalled();
  });

  it('supports typography copy action', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    render(() => <TypographyText copyable>Session id</TypographyText>);
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    expect(writeText).toHaveBeenCalledWith('Session id');
  });
});
