import { FolderOpen, Inbox } from 'lucide-solid';
import { createSignal, Show } from 'solid-js';
import { showCatalogSection } from '@/catalog/catalog-section';
import {
  Avatar,
  AvatarFallback,
  AvatarGroup,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Descriptions,
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyState,
  EmptyTitle,
  Status,
  Image,
  ImagePreviewGroup,
  DisplayList,
  ListLoadMore,
  PaginationControls,
  QRCode,
  Segmented,
  LoadingState,
  Shimmer,
  Skeleton,
  SkeletonAvatar,
  SkeletonButton,
  SkeletonInput,
  SkeletonParagraph,
  Statistic,
  StatisticCountdown,
  Tag,
  Timeline,
  Tour,
  TypographyParagraph,
  TypographyText,
  TypographyTitle,
  useTour,
} from '@peri/ui';
import { List as ListIcon, Mail } from 'lucide-solid';
import { CatalogDemo, DemoRow } from '@/pages/shared/DemoSection';

export function ComponentCatalogExtrasDisplay(props: { sections?: string[] }) {
  const [segment, setSegment] = createSignal('list');
  const [page, setPage] = createSignal(1);
  const [simplePage, setSimplePage] = createSignal(3);
  const tour = useTour([
    { target: '[data-tour="sidebar"]', title: 'Sidebar', description: 'Browse projects and sessions.' },
    { target: '[data-tour="composer"]', title: 'Composer', description: 'Send prompts to the agent.' },
  ]);

  return (
    <>
      <Show when={showCatalogSection(props.sections, 'descriptions')}>
        <CatalogDemo id="descriptions" title="Descriptions" description="Key-value lists with bordered layout.">
          <Descriptions
            bordered
            column={2}
            title="Runtime"
            extra="Updated 2m ago"
            items={[
              { label: 'Instance', children: 'local-connect' },
              { label: 'Protocol', children: 'ACP 1.2' },
              { label: 'Sessions', children: '12 active', span: 2 },
            ]}
          />
        </CatalogDemo>
      </Show>

      <Show when={showCatalogSection(props.sections, 'image')}>
        <CatalogDemo id="image" title="Image" description="Preview, zoom, and multi-image gallery.">
          <DemoRow>
            <Image
              src="https://picsum.photos/seed/peri/320/180"
              alt="Workspace"
              class="max-w-240"
              preview
            />
          </DemoRow>
          <ImagePreviewGroup
            images={[
              'https://picsum.photos/seed/a/160/120',
              'https://picsum.photos/seed/b/160/120',
              'https://picsum.photos/seed/c/160/120',
            ]}
          />
        </CatalogDemo>
      </Show>

      <Show when={showCatalogSection(props.sections, 'list')}>
        <CatalogDemo id="list" title="List" description="Header, footer, load more, and meta rows.">
          <DisplayList
            bordered
            header="Recent sessions"
            footer="3 pinned"
            dataSource={[
              {
                meta: {
                  avatar: <Avatar size="sm"><AvatarFallback>PS</AvatarFallback></Avatar>,
                  title: 'Refactor sidebar',
                  description: 'Updated 5 minutes ago',
                },
                actions: [<Button size="sm" variant="ghost">Open</Button>],
              },
              {
                meta: {
                  avatar: <Avatar size="sm"><AvatarFallback>AI</AvatarFallback></Avatar>,
                  title: 'Browser tests',
                  description: 'Updated yesterday',
                },
              },
            ]}
            loadMore={<ListLoadMore onClick={() => undefined} />}
          />
        </CatalogDemo>
      </Show>

      <Show when={showCatalogSection(props.sections, 'qr-code')}>
        <CatalogDemo
          id="qr-code"
          title="QRCode"
          description="Scannable codes for docs links and remote instance pairing URLs."
        >
          <DemoRow label="Open docs">
            <div class="flex flex-col items-start gap-8">
              <QRCode value="https://peri.studio/docs" size={160} bordered />
              <TypographyText class="font-mono text-11 text-content-secondary">
                https://peri.studio/docs
              </TypographyText>
            </div>
          </DemoRow>
          <DemoRow label="Pair device">
            <div class="flex flex-col items-start gap-8">
              <QRCode
                value="https://studio.example.com:8456/pair?code=7K3M9P2Q"
                size={160}
                bordered
                errorLevel="M"
              />
              <TypographyText class="font-mono text-11 text-content-secondary">
                https://studio.example.com:8456/pair?code=7K3M9P2Q
              </TypographyText>
            </div>
          </DemoRow>
        </CatalogDemo>
      </Show>

      <Show when={showCatalogSection(props.sections, 'segmented')}>
        <CatalogDemo id="segmented" title="Segmented" description="Mutually exclusive view switcher (distinct from ButtonGroup).">
          <Segmented
            block
            value={segment()}
            onChange={setSegment}
            options={[
              { label: 'List', value: 'list', icon: <ListIcon size={14} /> },
              { label: 'Inbox', value: 'inbox', icon: <Mail size={14} /> },
            ]}
          />
        </CatalogDemo>
      </Show>

      <Show when={showCatalogSection(props.sections, 'statistic')}>
        <CatalogDemo id="statistic" title="Statistic" description="Metrics with prefix/suffix and countdown.">
          <DemoRow>
            <Statistic title="Tokens used" value={182_400} suffix="/ 200k" />
            <StatisticCountdown title="Maintenance" value={Date.now() + 90_000} />
          </DemoRow>
        </CatalogDemo>
      </Show>

      <Show when={showCatalogSection(props.sections, 'tag')}>
        <CatalogDemo id="tag" title="Tag" description="Preset colors, closable, and checkable tags.">
          <DemoRow>
            <Tag color="success">Success</Tag>
            <Tag color="warning" closable>Warning</Tag>
            <Tag checked onChange={() => undefined}>Checked</Tag>
          </DemoRow>
        </CatalogDemo>
      </Show>

      <Show when={showCatalogSection(props.sections, 'timeline')}>
        <CatalogDemo id="timeline" title="Timeline" description="Activity feed with pending state.">
          <Timeline
            pending
            items={[
              { label: '2026-09-12 10:00', children: 'Session created', color: 'success' },
              { label: '2026-09-12 10:05', children: 'Agent connected', color: 'info' },
            ]}
          />
        </CatalogDemo>
      </Show>

      <Show when={showCatalogSection(props.sections, 'tour')}>
        <CatalogDemo id="tour" title="Tour" description="Guided overlay with step navigation.">
          <DemoRow>
            <span data-tour="sidebar" class="rounded-6 border border-border-subtle px-12 py-8">Sidebar target</span>
            <span data-tour="composer" class="rounded-6 border border-border-subtle px-12 py-8">Composer target</span>
            <Button size="sm" onClick={() => tour.start()}>Start tour</Button>
          </DemoRow>
          <Tour
            open={tour.open()}
            current={tour.current()}
            steps={tour.steps}
            onChange={tour.setCurrent}
            onClose={tour.close}
          />
        </CatalogDemo>
      </Show>

      <Show when={showCatalogSection(props.sections, 'badge')}>
        <CatalogDemo id="badge" title="Badge & Status" description="Tone pills、角标计数与 live status（2026-08 定稿）。">
          <DemoRow label="Tone pills">
            <Badge tone="success">Done</Badge>
            <Badge tone="warning">Running</Badge>
            <Badge tone="danger">Failed</Badge>
            <Badge tone="info">Nova 4.1</Badge>
            <Badge tone="neutral">Queued</Badge>
          </DemoRow>
          <DemoRow label="Count & dot">
            <Badge count={5}><Button size="sm" variant="default">Inbox</Button></Badge>
            <Badge count={120} overflowCount={99}><Button size="sm" variant="default">Overflow</Button></Badge>
            <Badge dot><Button size="sm" variant="default">Activity</Button></Badge>
          </DemoRow>
          <DemoRow label="Status">
            <Status tone="success" live>Connected</Status>
            <Status tone="warning">Reconciling</Status>
            <Status tone="neutral">Idle</Status>
            <Badge status="processing" text="Syncing" />
            <Badge status="success" text="Online" />
            <Badge status="error" text="Offline" />
          </DemoRow>
        </CatalogDemo>
      </Show>

      <Show when={showCatalogSection(props.sections, 'avatar-display')}>
        <CatalogDemo id="avatar-display" title="Avatar" description="Shape, size presets, and group stacking.">
          <DemoRow>
            <Avatar size="lg" shape="square"><AvatarFallback>PS</AvatarFallback></Avatar>
            <AvatarGroup max={3} gap={-12}>
              <Avatar><AvatarFallback>A</AvatarFallback></Avatar>
              <Avatar><AvatarFallback>B</AvatarFallback></Avatar>
              <Avatar><AvatarFallback>C</AvatarFallback></Avatar>
              <Avatar><AvatarFallback>D</AvatarFallback></Avatar>
            </AvatarGroup>
          </DemoRow>
        </CatalogDemo>
      </Show>

      <Show when={showCatalogSection(props.sections, 'card-display')}>
        <CatalogDemo id="card-display" title="Card" description="基础容器与 hoverable / cover / tabs / loading 变体。">
          <Card class="max-w-md">
            <CardHeader>
              <CardTitle>Session configuration</CardTitle>
              <CardDescription>Runtime settings apply to the next prompt delivery.</CardDescription>
            </CardHeader>
            <CardContent>
              <p class="text-13 text-content-secondary">Model routing stays on the server.</p>
            </CardContent>
          </Card>
          <Card
            size="sm"
            hoverable
            cover={<div class="h-120 bg-surface-sunken" />}
            tabList={[
              { key: 'overview', tab: 'Overview', content: <p class="text-13">Project summary and runtime health.</p> },
              { key: 'settings', tab: 'Settings', content: <p class="text-13">Instance and token configuration.</p> },
            ]}
          />
          <Card loading class="mt-12 max-w-360" />
        </CatalogDemo>
      </Show>

      <Show when={showCatalogSection(props.sections, 'empty')}>
        <CatalogDemo id="empty" title="Empty & EmptyState" description="Empty 复合原语、preset 插图与 EmptyState 便捷封装（唯一 demo 入口）。">
          <DemoRow label="EmptyState · page">
            <EmptyState
              class="flex-1"
              icon={<Inbox size={28} strokeWidth={1.5} />}
              title="No conversations yet"
              description="Start a project session to create your first conversation."
              action={<Button variant="primary" size="sm">New session</Button>}
            />
          </DemoRow>
          <DemoRow label="EmptyState · inline">
            <EmptyState
              variant="inline"
              preset="noData"
              title="No files in this folder"
              description="Upload assets or create a new file to get started."
            />
          </DemoRow>
          <DemoRow label="Empty compound">
            <Empty class="max-w-md">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <FolderOpen class="size-24" />
                </EmptyMedia>
                <EmptyTitle>No projects yet</EmptyTitle>
                <EmptyDescription>You have not created any projects yet.</EmptyDescription>
              </EmptyHeader>
              <EmptyContent>
                <Button variant="primary" size="sm">New project</Button>
              </EmptyContent>
            </Empty>
          </DemoRow>
          <DemoRow label="Empty preset">
            <Empty preset="noResult" class="max-w-md">
              <EmptyHeader>
                <EmptyTitle>No results</EmptyTitle>
                <EmptyDescription>Try a different query or clear filters.</EmptyDescription>
              </EmptyHeader>
              <EmptyContent>
                <Button size="sm" variant="primary">Clear filters</Button>
              </EmptyContent>
            </Empty>
          </DemoRow>
        </CatalogDemo>
      </Show>

      <Show when={showCatalogSection(props.sections, 'skeleton-display')}>
        <CatalogDemo id="skeleton-display" title="Skeleton" description="Active shimmer and structural presets.">
          <div class="flex max-w-360 flex-col gap-12">
            <div class="flex items-center gap-12">
              <SkeletonAvatar />
              <div class="flex-1">
                <Skeleton class="mb-8 h-12 w-120" />
                <SkeletonParagraph rows={2} />
              </div>
            </div>
            <SkeletonInput />
            <SkeletonButton />
          </div>
          <DemoRow label="LoadingState & Shimmer">
            <LoadingState label="Loading projection" />
            <Shimmer class="h-32 w-200 rounded-8" />
          </DemoRow>
        </CatalogDemo>
      </Show>

      <Show when={showCatalogSection(props.sections, 'typography-display')}>
        <CatalogDemo id="typography-display" title="Typography" description="Ellipsis, copyable, and editable text.">
          <TypographyTitle level={3} copyable>Project session title</TypographyTitle>
          <TypographyParagraph ellipsis={{ rows: 2 }}>
            Long description that truncates after two lines in compact layouts while preserving copy and edit affordances.
          </TypographyParagraph>
          <TypographyText editable={{ onChange: () => undefined }}>Editable label</TypographyText>
        </CatalogDemo>
      </Show>

      <Show when={showCatalogSection(props.sections, 'pagination-display')}>
        <CatalogDemo id="pagination-display" title="Pagination" description="Simple mode, size changer, quick jumper, and total.">
          <PaginationControls
            current={page()}
            pageSize={10}
            total={128}
            showTotal
            showSizeChanger
            showQuickJumper
            onChange={(next) => setPage(next)}
          />
          <PaginationControls
            simple
            current={simplePage()}
            pageSize={10}
            total={128}
            onChange={(next) => setSimplePage(next)}
          />
        </CatalogDemo>
      </Show>
    </>
  );
}
