import { splitProps, type Component } from 'solid-js';
import { cn } from '../../lib/cn';
import { JsonTree } from '../JsonTree';

export type IoViewerJsonViewProps = {
  data: unknown;
  /** 初始展开深度；IoViewer 默认全展开。 */
  defaultCollapsedDepth?: number;
  class?: string;
  'data-testid'?: string;
};

/** IoViewer JSON 模式：空值、primitive 与对象树，行为对齐 peri-fuse JsonViewer。 */
export const IoViewerJsonView: Component<IoViewerJsonViewProps> = (props) => {
  const [local, rest] = splitProps(props, ['data', 'defaultCollapsedDepth', 'class']);

  const empty = () => local.data === null || local.data === undefined;
  const primitive = () => {
    const value = local.data;
    return value !== null && value !== undefined && typeof value !== 'object';
  };

  return (
    <div
      {...rest}
      data-testid={rest['data-testid'] ?? 'io-viewer-json'}
      class={cn('ui-io-viewer-json min-w-0', local.class)}
    >
      {empty() ? (
        <div class="rounded-4 border border-border-subtle bg-surface-sunken p-12 text-11 text-content-muted">
          (empty)
        </div>
      ) : primitive() ? (
        <pre class="ui-io-viewer-json-primitive ui-scrollbar max-h-(--container-io-viewer-primitive-max) overflow-auto whitespace-pre-wrap rounded-4 border border-border-subtle bg-surface-sunken p-12 font-mono text-11 wrap-anywhere">
          {String(local.data)}
        </pre>
      ) : (
        <JsonTree
          data={local.data}
          defaultCollapsedDepth={local.defaultCollapsedDepth ?? Number.MAX_SAFE_INTEGER}
          class="max-h-none border-0 bg-transparent p-0"
        />
      )}
    </div>
  );
};
