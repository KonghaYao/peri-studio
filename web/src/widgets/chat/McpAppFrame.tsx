import { createEffect, createSignal, onCleanup, onMount, Show } from 'solid-js';
import { Maximize2, Minimize2 } from 'lucide-solid';
import { Dialog, DialogContent, DialogHeader, DialogTitle, IconButton } from '@peri/ui';
import { bindMcpAppHost } from '@/features/mcp/mcp-app-host';
import { liveMcpApp, liveMcpAppHeight } from '@/features/mcp/mcp-apps';

const FULLSCREEN_DIALOG_CLASS =
  'fixed inset-0 top-0 left-0 z-61 flex h-full w-full max-h-none max-w-none translate-x-0 translate-y-0 flex-col overflow-hidden rounded-none border-0 p-0 shadow-none motion-reduce:animate-none';

export function McpAppFrame(props: { toolCallId: string }) {
  let sandboxRef: HTMLIFrameElement | undefined;
  let inlineHostRef: HTMLDivElement | undefined;
  let fullscreenHostRef: HTMLDivElement | undefined;
  const [fullscreen, setFullscreen] = createSignal(false);

  const syncIframeHost = () => {
    const iframe = sandboxRef;
    if (!iframe) return;
    const host = fullscreen() ? fullscreenHostRef : inlineHostRef;
    if (host && iframe.parentElement !== host) host.appendChild(iframe);
    iframe.className = fullscreen() ? 'min-h-0 w-full flex-1 border-0' : 'w-full border-0';
    iframe.style.height = fullscreen() ? '100%' : `${liveMcpAppHeight(props.toolCallId)}px`;
  };

  // iframe 生命周期跟组件挂载走，不跟 liveApps / Yjs 更新走。
  // 对话投影每帧都会换 session 对象；绑在 html 信号上会反复 abort → 重连。
  onMount(() => {
    const iframe = document.createElement('iframe');
    iframe.title = 'MCP App sandbox';
    iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin');
    sandboxRef = iframe;
    inlineHostRef?.appendChild(iframe);
    syncIframeHost();

    const toolCallId = props.toolCallId;
    const abort = new AbortController();
    const started = bindMcpAppHost(iframe, () => liveMcpApp(toolCallId), abort.signal).catch(() => null);
    onCleanup(() => {
      abort.abort();
      void started.then((handle) => handle?.close()).catch(() => undefined);
      iframe.removeAttribute('src');
      iframe.remove();
    });
  });

  createEffect(() => {
    fullscreen();
    liveMcpAppHeight(props.toolCallId);
    syncIframeHost();
  });

  const inlineHeight = () => liveMcpAppHeight(props.toolCallId);

  return (
    <Dialog open={fullscreen()} onOpenChange={setFullscreen}>
      <div
        class="w-full max-w-(--tool-activity-max)"
        style={fullscreen() ? { height: `${inlineHeight()}px` } : undefined}
      >
        <div
          ref={(element) => {
            inlineHostRef = element;
            syncIframeHost();
          }}
          class="relative w-full overflow-hidden rounded-9 border border-divider bg-surface"
          classList={{ hidden: fullscreen() }}
        >
          <Show when={!fullscreen()}>
            <div class="absolute top-8 right-8 z-2">
              <IconButton
                type="button"
                size="compact"
                variant="ghost"
                label="Open fullscreen"
                class="border border-divider bg-surface/92 text-text-muted shadow-subtle hover:text-text-primary"
                onClick={() => setFullscreen(true)}
              >
                <Maximize2 size={15} strokeWidth={1.8} />
              </IconButton>
            </div>
          </Show>
        </div>
        <Show when={fullscreen()}>
          <DialogContent class={FULLSCREEN_DIALOG_CLASS}>
            <DialogHeader class="flex h-44 shrink-0 items-center justify-end gap-6 border-b border-divider px-10 py-0">
              <DialogTitle class="mr-auto text-12 font-650 text-text-secondary">MCP App</DialogTitle>
              <IconButton
                type="button"
                size="compact"
                variant="ghost"
                label="Exit fullscreen"
                class="border-0 bg-transparent text-text-muted hover:text-text-primary"
                onClick={() => setFullscreen(false)}
              >
                <Minimize2 size={16} strokeWidth={1.8} />
              </IconButton>
            </DialogHeader>
            <div
              ref={(element) => {
                fullscreenHostRef = element;
                syncIframeHost();
              }}
              class="flex min-h-0 flex-1 flex-col bg-surface"
            />
          </DialogContent>
        </Show>
      </div>
    </Dialog>
  );
}
