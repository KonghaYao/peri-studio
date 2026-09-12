import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Avatar, AvatarFallback, AvatarGroup } from './Avatar';
import { Badge } from './Badge';
import { Descriptions } from './descriptions';
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

  it('renders QR code with accessible label', () => {
    render(() => <QRCode value="peri-studio" />);
    expect(screen.getByRole('img', { name: /QR code for peri-studio/ })).toBeInTheDocument();
  });

  it('renders badge count with overflow', () => {
    render(() => (
      <Badge count={120} overflowCount={99}>
        <span>Inbox</span>
      </Badge>
    ));
    expect(screen.getByText('99+')).toBeInTheDocument();
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
