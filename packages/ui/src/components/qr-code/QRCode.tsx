import { createMemo, splitProps, type Component, type ComponentProps } from 'solid-js';
import { cn } from '../../lib/cn';
import { encodeQrMatrix, qrMatrixToSvg } from '../../lib/qr-encode';

export type QRCodeProps = ComponentProps<'div'> & {
  value: string;
  size?: number;
  color?: string;
  bgColor?: string;
  bordered?: boolean;
  errorLevel?: 'L' | 'M' | 'Q' | 'H';
};

/** QR 码展示（本地编码，适合邀请链接与配对 URL）。 */
export const QRCode: Component<QRCodeProps> = (props) => {
  const [local, rest] = splitProps(props, [
    'class',
    'value',
    'size',
    'color',
    'bgColor',
    'bordered',
    'errorLevel',
  ]);
  const size = () => local.size ?? 160;
  const svg = createMemo(() => {
    const matrix = encodeQrMatrix(local.value, local.errorLevel ?? 'M');
    return qrMatrixToSvg(matrix);
  });

  return (
    <div
      data-slot="qr-code"
      role="img"
      aria-label={`QR code for ${local.value}`}
      class={cn(
        'inline-flex box-border items-center justify-center rounded-8 bg-surface p-12 text-content-primary',
        local.bordered ? 'border border-border-subtle' : '',
        local.class,
      )}
      style={{
        width: `${size()}px`,
        height: `${size()}px`,
        color: local.color ?? 'currentColor',
        'background-color': local.bgColor ?? undefined,
      }}
      {...rest}
    >
      <div class="h-full w-full" innerHTML={svg()} />
    </div>
  );
};
