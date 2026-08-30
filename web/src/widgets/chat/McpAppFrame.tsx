import { createEffect, createSignal, onCleanup, onMount, Show } from 'solid-js';
import { Maximize2, Minimize2 } from 'lucide-solid';
import { IconButton } from '../../components/ui';
import { bindMcpAppHost } from '../../panel/lib/mcp-app-host';
import { liveMcpApp, liveMcpAppHeight } from '../../panel/lib/mcp-apps';

export function McpAppFrame(props: { toolCallId: string }) {
  let sandboxRef: HTMLIFrameElement | undefined;
  const [fullscreen, setFullscreen] = createSignal(false);

  // iframe 生命周期跟组件挂载走，不跟 liveApps / Yjs 更新走。
  // 对话投影每帧都会换 session 对象；绑在 html 信号上会反复 abort → 重连。
  onMount(() => {
    const iframe = sandboxRef;
    const toolCallId = props.toolCallId;
    if (!iframe) return;
    const abort = new AbortController();
    const started = bindMcpAppHost(iframe, () => liveMcpApp(toolCallId), abort.signal).catch(() => null);
    onCleanup(() => {
      abort.abort();
      void started.then((handle) => handle?.close()).catch(() => undefined);
      iframe.removeAttribute('src');
    });
  });

  createEffect(() => {
    if (!fullscreen()) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      setFullscreen(false);
    };
    window.addEventListener('keydown', onKey);
    onCleanup(() => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKey);
    });
  });

  const inlineHeight = () => liveMcpAppHeight(props.toolCallId);
  const iframeHeight = () => fullscreen() ? '100%' : `${inlineHeight()}px`;

  return (
    <div class="mcp-app-slot w-full max-w-(--tool-activity-max)" style={fullscreen() ? { height: `${inlineHeight()}px` } : undefined}>
      <div
        class={fullscreen()
          ? 'mcp-app-frame mcp-app-frame--fullscreen fixed inset-0 z-[80] flex flex-col bg-surface'
          : 'mcp-app-frame relative w-full overflow-hidden rounded-9 border border-divider bg-surface'}
        role={fullscreen() ? 'dialog' : undefined}
        aria-modal={fullscreen() ? true : undefined}
        aria-label="MCP App"
      >
        <Show when={fullscreen()}>
          <header class="flex h-44 shrink-0 items-center justify-end gap-6 border-b border-divider px-10">
            <span class="mr-auto text-12 font-650 text-text-secondary">MCP App</span>
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
          </header>
        </Show>
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
        <iframe
          ref={sandboxRef}
          title="MCP App sandbox"
          class={fullscreen() ? 'min-h-0 w-full flex-1 border-0' : 'w-full border-0'}
          style={{ height: iframeHeight() }}
          sandbox="allow-scripts allow-same-origin"
        />
      </div>
    </div>
  );
}
