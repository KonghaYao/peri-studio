/**
 * 轻量 QR 矩阵生成（byte 模式，MIT 风格实现，仅供展示组件使用）。
 * 不支持超长 payload；复杂场景应走服务端生成。
 */

type QrModule = boolean;

function createMatrix(size: number): QrModule[][] {
  return Array.from({ length: size }, () => Array.from({ length: size }, () => false));
}

function setFinder(matrix: QrModule[][], row: number, col: number) {
  for (let r = 0; r < 7; r += 1) {
    for (let c = 0; c < 7; c += 1) {
      const edge = r === 0 || r === 6 || c === 0 || c === 6;
      const core = r >= 2 && r <= 4 && c >= 2 && c <= 4;
      matrix[row + r][col + c] = edge || core;
    }
  }
}

function setTiming(matrix: QrModule[][]) {
  const size = matrix.length;
  for (let i = 8; i < size - 8; i += 1) {
    matrix[6][i] = i % 2 === 0;
    matrix[i][6] = i % 2 === 0;
  }
}

function reserveFormat(matrix: QrModule[][]) {
  const size = matrix.length;
  for (let i = 0; i < 9; i += 1) {
    matrix[8][i] = false;
    matrix[i][8] = false;
  }
  for (let i = size - 8; i < size; i += 1) {
    matrix[8][i] = false;
    matrix[i][8] = false;
  }
}

function placeData(matrix: QrModule[][], bits: number[]) {
  const size = matrix.length;
  let bitIndex = 0;
  let upward = true;
  for (let col = size - 1; col > 0; col -= 2) {
    if (col === 6) col -= 1;
    for (let row = 0; row < size; row += 1) {
      const r = upward ? size - 1 - row : row;
      for (let c = 0; c < 2; c += 1) {
        const x = col - c;
        if (matrix[r][x] !== undefined && !isReserved(matrix, r, x)) {
          matrix[r][x] = bits[bitIndex] === 1;
          bitIndex += 1;
        }
      }
    }
    upward = !upward;
  }
}

function isReserved(matrix: QrModule[][], row: number, col: number) {
  const size = matrix.length;
  const inFinder =
    (row < 9 && col < 9) ||
    (row < 9 && col >= size - 8) ||
    (row >= size - 8 && col < 9);
  const timing = row === 6 || col === 6;
  const format = row === 8 || col === 8;
  return inFinder || timing || format;
}

function encodeBits(text: string, capacity: number): number[] {
  const bytes = Array.from(new TextEncoder().encode(text));
  const bits: number[] = [];
  const push = (value: number, width: number) => {
    for (let i = width - 1; i >= 0; i -= 1) bits.push((value >> i) & 1);
  };
  push(4, 4);
  push(bytes.length, 8);
  for (const byte of bytes) push(byte, 8);
  push(0, Math.min(4, capacity - bits.length));
  while (bits.length % 8 !== 0) bits.push(0);
  const pad = [0xec, 0x11];
  let padIndex = 0;
  while (bits.length < capacity) {
    push(pad[padIndex % 2], 8);
    padIndex += 1;
  }
  return bits.slice(0, capacity);
}

/** 生成 version-1（21×21）QR 矩阵；文本过长时截断。 */
export function encodeQrMatrix(text: string): QrModule[][] {
  const size = 21;
  const matrix = createMatrix(size);
  setFinder(matrix, 0, 0);
  setFinder(matrix, 0, size - 7);
  setFinder(matrix, size - 7, 0);
  setTiming(matrix);
  reserveFormat(matrix);
  const capacity = 128;
  const payload = text.length > 14 ? text.slice(0, 14) : text;
  placeData(matrix, encodeBits(payload, capacity));
  return matrix;
}

export function qrMatrixToSvg(matrix: QrModule[][], moduleSize = 4, margin = 2): string {
  const size = matrix.length;
  const dim = (size + margin * 2) * moduleSize;
  let path = '';
  for (let row = 0; row < size; row += 1) {
    for (let col = 0; col < size; col += 1) {
      if (!matrix[row][col]) continue;
      const x = (col + margin) * moduleSize;
      const y = (row + margin) * moduleSize;
      path += `M${x},${y}h${moduleSize}v${moduleSize}h-${moduleSize}z`;
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${dim} ${dim}" width="${dim}" height="${dim}"><path fill="currentColor" d="${path}"/></svg>`;
}
