/**
 * QR 矩阵生成（基于 qrcode-generator，浏览器端可扫描）。
 * 超长 payload 由库自动选择 version；极端长度仍应走服务端生成。
 */

import qrcode from 'qrcode-generator';

type QrModule = boolean;
type QrErrorLevel = 'L' | 'M' | 'Q' | 'H';

function matrixFromQr(text: string, errorLevel: QrErrorLevel): QrModule[][] {
  const qr = qrcode(0, errorLevel);
  qr.addData(text);
  qr.make();
  const count = qr.getModuleCount();
  return Array.from({ length: count }, (_, row) =>
    Array.from({ length: count }, (_, col) => qr.isDark(row, col)),
  );
}

/** 生成可扫描 QR 矩阵；version 由 payload 自动选择。 */
export function encodeQrMatrix(text: string, errorLevel: QrErrorLevel = 'M'): QrModule[][] {
  return matrixFromQr(text, errorLevel);
}

export function qrMatrixToSvg(matrix: QrModule[][], margin = 2): string {
  const size = matrix.length;
  const dim = size + margin * 2;
  let path = '';
  for (let row = 0; row < size; row += 1) {
    for (let col = 0; col < size; col += 1) {
      if (!matrix[row][col]) continue;
      const x = col + margin;
      const y = row + margin;
      path += `M${x},${y}h1v1h-1z`;
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${dim} ${dim}" width="100%" height="100%" preserveAspectRatio="xMidYMid meet"><path fill="currentColor" d="${path}"/></svg>`;
}
