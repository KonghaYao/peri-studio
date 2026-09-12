import { createMemo, onCleanup, onMount, splitProps, type Component, type ComponentProps } from 'solid-js';
import { cn } from '../../lib/cn';

export type WatermarkProps = ComponentProps<'div'> & {
  content?: string | string[];
  image?: string;
  gap?: [number, number];
  offset?: [number, number];
  rotate?: number;
  fontSize?: number;
  zIndex?: number;
  /** 防篡改：监听 DOM 变更并恢复水印层。 */
  antiTamper?: boolean;
};

function buildWatermarkSvg(options: {
  content: string[];
  gap: [number, number];
  offset: [number, number];
  rotate: number;
  fontSize: number;
  image?: string;
}) {
  const [gapX, gapY] = options.gap;
  const [offsetX, offsetY] = options.offset;
  const width = gapX;
  const height = gapY;
  const text = options.content.join(' ');
  const imageMarkup = options.image
    ? `<image href="${options.image}" x="${offsetX}" y="${offsetY}" height="${options.fontSize}" opacity="0.15" />`
    : `<text x="50%" y="50%" fill="rgba(0,0,0,0.12)" font-size="${options.fontSize}" font-family="system-ui,sans-serif" text-anchor="middle" dominant-baseline="middle" transform="rotate(${options.rotate} ${width / 2} ${height / 2})">${text}</text>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">${imageMarkup}</svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

/** 文本/图片水印覆盖层，对齐 Ant Design Watermark。 */
export const Watermark: Component<WatermarkProps> = (props) => {
  const [local, rest] = splitProps(props, [
    'class',
    'children',
    'content',
    'image',
    'gap',
    'offset',
    'rotate',
    'fontSize',
    'zIndex',
    'antiTamper',
  ]);

  let host: HTMLDivElement | undefined;
  let overlay: HTMLDivElement | undefined;

  const lines = createMemo(() => {
    const value = local.content ?? 'Peri Studio';
    return Array.isArray(value) ? value : [value];
  });

  const background = createMemo(() =>
    buildWatermarkSvg({
      content: lines(),
      gap: local.gap ?? [180, 120],
      offset: local.offset ?? [0, 0],
      rotate: local.rotate ?? -22,
      fontSize: local.fontSize ?? 14,
      image: local.image,
    }),
  );

  const restoreOverlay = () => {
    if (!host || !overlay || host.contains(overlay)) return;
    host.appendChild(overlay);
  };

  onMount(() => {
    if (!local.antiTamper || !host) return;
    const observer = new MutationObserver(() => restoreOverlay());
    observer.observe(host, { childList: true });
    onCleanup(() => observer.disconnect());
  });

  return (
    <div ref={host} data-slot="watermark" class={cn('relative overflow-hidden', local.class)} {...rest}>
      {local.children}
      <div
        ref={overlay}
        aria-hidden="true"
        class="pointer-events-none absolute inset-0 bg-repeat"
        style={{
          'z-index': String(local.zIndex ?? 10),
          'background-image': background(),
        }}
      />
    </div>
  );
};
