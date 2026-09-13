import { createSignal, Show } from 'solid-js';
import { showCatalogSection } from '@/catalog/catalog-section';
import {
  Alert,
  AlertDescription,
  AlertTitle,
  Button,
  dialog,
  Dialog,
  DialogContent,
  DialogPanel,
  DialogTitle,
  DialogTrigger,
  EditableTabs,
  EnhancedDataTable,
  LinkButton,
  type DataTableSortState,
  MessageHost,
  message,
  NotificationHost,
  notification,
  Popconfirm,
  ProgressCircle,
  Result,
  SliderWithMarks,
  Toaster,
  Upload,
  Watermark,
  showToast,
  showToastPromise,
} from '@peri/ui';
import { Plus } from 'lucide-solid';
import { CatalogDemo, DemoRow } from '@/pages/shared/DemoSection';

export function ComponentCatalogFeedback(props: { sections?: string[] }) {
  const [tabs, setTabs] = createSignal([
    { key: 'a', label: 'Tab A', closable: true },
    { key: 'b', label: 'Tab B', closable: true },
  ]);

  const [dialogOpen, setDialogOpen] = createSignal(false);
  const [tablePage, setTablePage] = createSignal(1);
  const [tableSort, setTableSort] = createSignal<DataTableSortState>(null);

  const serverRows = Array.from({ length: 48 }, (_, index) => ({
    name: `User ${index + 1}`,
    role: index % 3 === 0 ? 'Owner' : 'Editor',
  }));

  const pagedData = () => {
    const sorted = [...serverRows];
    const sort = tableSort();
    if (sort) {
      sorted.sort((left, right) => {
        const value = sort.columnId === 'name'
          ? left.name.localeCompare(right.name)
          : left.role.localeCompare(right.role);
        return sort.direction === 'asc' ? value : -value;
      });
    }
    const start = (tablePage() - 1) * 5;
    return sorted.slice(start, start + 5);
  };

  return (
    <>
      <MessageHost />
      <NotificationHost placement="top-right" />
      <Toaster placement="bottom-right" />

      <Show when={showCatalogSection(props.sections, 'message')}>
        <CatalogDemo id="message" title="Message" description="顶部轻量消息栈，区别于 Toast。">
          <DemoRow>
            <Button variant="default" size="sm" onClick={() => message.info('Sync started')}>Info</Button>
            <Button variant="primary" size="sm" onClick={() => message.success('Command delivered')}>Success</Button>
            <Button variant="danger" size="sm" onClick={() => message.error('Delivery failed')}>Error</Button>
          </DemoRow>
        </CatalogDemo>
      </Show>

      <Show when={showCatalogSection(props.sections, 'notification')}>
        <CatalogDemo id="notification" title="Notification" description="角落通知面板，支持 title + description。">
          <Button
            variant="default"
            size="sm"
            onClick={() => notification.success({
              message: 'Runtime ready',
              description: 'Instance connected and catalog synced.',
            })}
          >
            Show notification
          </Button>
        </CatalogDemo>
      </Show>

      <Show when={showCatalogSection(props.sections, 'popconfirm')}>
        <CatalogDemo id="popconfirm" title="Popconfirm" description="触发器上的确认气泡。">
          <Popconfirm title="Delete session?" description="This cannot be undone." variant="danger" size="sm" okType="danger" onConfirm={() => { message.success('Deleted'); }}>
            Delete
          </Popconfirm>
        </CatalogDemo>
      </Show>

      <Show when={showCatalogSection(props.sections, 'result')}>
        <CatalogDemo id="result" title="Result" description="成功/错误/404 等结果页。">
          <Result status="success" title="Submission complete" subTitle="The agent will continue in the background." />
        </CatalogDemo>
      </Show>

      <Show when={showCatalogSection(props.sections, 'watermark')}>
        <CatalogDemo id="watermark" title="Watermark" description="文本/图片水印覆盖。">
          <Watermark content={['Peri Studio', 'Preview']} class="rounded-8 border border-border-subtle p-24">
            <p class="text-13 text-content-secondary">Protected preview surface</p>
          </Watermark>
        </CatalogDemo>
      </Show>

      <Show when={showCatalogSection(props.sections, 'upload')}>
        <CatalogDemo id="upload" title="Upload" description="拖拽上传、进度与失败重试。">
          <Upload drag multiple />
        </CatalogDemo>
      </Show>

      <Show when={showCatalogSection(props.sections, 'alert-types')}>
        <CatalogDemo id="alert-types" title="Alert types" description="info / success / warning / error + banner + closable。">
          <div class="flex flex-col gap-8">
            <Alert type="info" closable><AlertTitle>Info</AlertTitle><AlertDescription>Runtime is reconnecting.</AlertDescription></Alert>
            <Alert type="success" banner><AlertTitle>Success banner</AlertTitle></Alert>
            <Alert type="warning"><AlertTitle>Context almost full</AlertTitle><AlertDescription>182k/200k tokens used in this turn.</AlertDescription></Alert>
            <Alert type="error"><AlertTitle>Runtime interrupted</AlertTitle><AlertDescription>The ACP process exited before confirming the last action.</AlertDescription></Alert>
          </div>
        </CatalogDemo>
      </Show>

      <Show when={showCatalogSection(props.sections, 'button-variants')}>
        <CatalogDemo id="button-variants" title="Button variants" description="dashed / text / link / block / shape / icon slots。">
          <DemoRow>
            <Button variant="dashed">Dashed</Button>
            <Button variant="text">Text</Button>
            <LinkButton href="#/components" variant="link">Link</LinkButton>
            <Button variant="primary" shape="circle" leadingIcon={<Plus size={16} />} />
          </DemoRow>
          <Button variant="primary" block>Block button</Button>
        </CatalogDemo>
      </Show>

      <Show when={showCatalogSection(props.sections, 'progress-circle')}>
        <CatalogDemo id="progress-circle" title="Progress circle" description="circle / dashboard + format。">
          <ProgressCircle percent={72} type="dashboard" format={(value) => `${value}%`} />
        </CatalogDemo>
      </Show>

      <Show when={showCatalogSection(props.sections, 'slider-marks')}>
        <CatalogDemo id="slider-marks" title="Slider marks" description="刻度、垂直与 tooltip format。">
          <SliderWithMarks
            defaultValue={[30]}
            marks={[{ value: 0, label: '0' }, { value: 50, label: '50' }, { value: 100, label: '100' }]}
            formatTooltip={(value) => `${value}%`}
          />
        </CatalogDemo>
      </Show>

      <Show when={showCatalogSection(props.sections, 'editable-tabs')}>
        <CatalogDemo id="editable-tabs" title="Editable tabs" description="可增删标签页 + destroyInactiveTabPane。">
          <EditableTabs
            items={tabs()}
            destroyInactiveTabPane
            onEdit={(key, action) => {
              if (action === 'add') {
                const next = String(tabs().length + 1);
                setTabs([...tabs(), { key: next, label: `Tab ${next}`, closable: true }]);
              } else {
                setTabs(tabs().filter((item) => item.key !== key));
              }
            }}
          >
            {(item) => <p class="text-13 text-content-secondary">Content for {item.label}</p>}
          </EditableTabs>
        </CatalogDemo>
      </Show>

      <Show when={showCatalogSection(props.sections, 'enhanced-table')}>
        <CatalogDemo id="enhanced-table" title="Enhanced DataTable" description="服务端排序/分页、固定头列、行选择与可展开行。">
          <EnhancedDataTable
            data={pagedData()}
            bordered
            striped
            fixedHeader
            fixedColumnStart={1}
            serverSort
            sort={tableSort()}
            onSortChange={setTableSort}
            pagination={{
              current: tablePage(),
              pageSize: 5,
              total: serverRows.length,
              onChange: (page) => setTablePage(page),
            }}
            rowSelection={{}}
            expandable={{ expandedRowRender: (row) => <div class="p-8 text-12 text-content-secondary">Details for {row.name}</div> }}
            columns={[
              { id: 'name', header: 'Name', accessor: (row) => row.name, sortable: true },
              { id: 'role', header: 'Role', accessor: (row) => row.role, sortable: true },
            ]}
          />
        </CatalogDemo>
      </Show>

      <Show when={showCatalogSection(props.sections, 'dialog-methods')}>
        <CatalogDemo id="dialog-methods" title="Dialog methods" description="info / success / warning / error / confirm + footer null。">
          <DemoRow>
            <Button size="sm" onClick={() => dialog.info({ title: 'Info', content: 'Runtime is healthy.' })}>Info</Button>
            <Button size="sm" onClick={() => dialog.confirm({ title: 'Confirm', content: 'Proceed with delivery?' })}>Confirm</Button>
            <Dialog open={dialogOpen()} onOpenChange={setDialogOpen}>
              <DialogTrigger as={Button} size="sm" variant="default">Footer null</DialogTrigger>
              <DialogContent>
                <DialogPanel
                  header={<DialogTitle class="px-20 pt-20">Read-only notice</DialogTitle>}
                  footer={null}
                >
                  <p class="text-13 text-content-secondary">This dialog intentionally omits the footer region.</p>
                </DialogPanel>
              </DialogContent>
            </Dialog>
          </DemoRow>
        </CatalogDemo>
      </Show>

      <Show when={showCatalogSection(props.sections, 'toast-enhanced')}>
        <CatalogDemo id="toast-enhanced" title="Toast enhanced" description="placement / action / promise。">
          <DemoRow>
            <Button
              size="sm"
              onClick={() => showToast('Saved', { action: <Button variant="ghost" size="sm">Undo</Button> })}
            >
              Action toast
            </Button>
            <Button
              size="sm"
              onClick={() => showToastPromise(
                new Promise((resolve) => setTimeout(resolve, 800)),
                { loading: 'Saving…', success: 'Saved', error: 'Failed' },
              )}
            >
              Promise toast
            </Button>
          </DemoRow>
        </CatalogDemo>
      </Show>
    </>
  );
}
