import { Show, splitProps, type Component, type JSX } from 'solid-js';
import { cn } from '../../lib/cn';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../Tabs';

export type IoTabKey = 'preview' | 'input' | 'output' | 'metadata';

export type IoTabsShellProps = {
  /** 为 true 时展示 Preview 标签并由 slot 注入内容。 */
  showPreviewTab?: boolean;
  defaultTab?: IoTabKey;
  class?: string;
  onTabChange?: (tab: IoTabKey) => void;
  renderPreview?: () => JSX.Element;
  renderInput: () => JSX.Element;
  renderOutput: () => JSX.Element;
  renderMetadata: () => JSX.Element;
  'data-testid'?: string;
};

function resolveDefaultTab(showPreview: boolean, preferred?: IoTabKey): IoTabKey {
  if (preferred) return preferred;
  return showPreview ? 'preview' : 'input';
}

/** T3 · Observation IO 标签壳：Preview / Input / Output / Metadata，内容由 slot 注入。 */
export const IoTabsShell: Component<IoTabsShellProps> = (props) => {
  const [local, rest] = splitProps(props, [
    'showPreviewTab',
    'defaultTab',
    'class',
    'onTabChange',
    'renderPreview',
    'renderInput',
    'renderOutput',
    'renderMetadata',
  ]);

  const showPreview = () => local.showPreviewTab ?? false;
  const initialTab = () => resolveDefaultTab(showPreview(), local.defaultTab);

  const handleChange = (value: string) => {
    const tab = value as IoTabKey;
    local.onTabChange?.(tab);
  };

  return (
    <div
      {...rest}
      data-testid={rest['data-testid'] ?? 'io-tabs-shell'}
      class={cn('ui-io-tabs-shell flex min-h-0 flex-col', local.class)}
    >
      <Tabs defaultValue={initialTab()} onChange={handleChange}>
        <TabsList aria-label="IO sections">
          <Show when={showPreview()}>
            <TabsTrigger value="preview">Preview</TabsTrigger>
          </Show>
          <TabsTrigger value="input">Input</TabsTrigger>
          <TabsTrigger value="output">Output</TabsTrigger>
          <TabsTrigger value="metadata">Metadata</TabsTrigger>
        </TabsList>

        <Show when={showPreview()}>
          <TabsContent value="preview" class="min-h-0">
            {local.renderPreview?.()}
          </TabsContent>
        </Show>
        <TabsContent value="input" class="min-h-0">
          {local.renderInput()}
        </TabsContent>
        <TabsContent value="output" class="min-h-0">
          {local.renderOutput()}
        </TabsContent>
        <TabsContent value="metadata" class="min-h-0">
          {local.renderMetadata()}
        </TabsContent>
      </Tabs>
    </div>
  );
};
