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

/** QR 码展示（轻量本地编码，适合短文本）。 */
export const QRCode: Component<QRCodeProps> = (props) => {
  const [local, rest] = splitProps(props, ['class', 'value', 'size', 'color', 'bgColor', 'bordered']);
  const size = () => local.size ?? 160;
  const svg = createMemo(() => {
    const matrix = encodeQrMatrix(local.value);
    const moduleSize = Math.max(2, Math.floor(size() / matrix.length));
    return qrMatrixToSvg(matrix, moduleSize, 2);
  });

  return (
    <div
      data-slot="qr-code"
      role="img"
      aria-label={`QR code for ${local.value}`}
      class={cn(
        'inline-flex items-center justify-center rounded-8 bg-surface p-12 text-content-primary',
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
      innerHTML={svg()}
    />
  );
};
