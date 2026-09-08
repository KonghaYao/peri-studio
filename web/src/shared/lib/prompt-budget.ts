const encoder = new TextEncoder();

/** 与 Rust `str::len` 对齐，按 UTF-8 字节而不是 UTF-16 code unit 计数。 */
export function promptByteLength(value: string): number {
  return encoder.encode(value).byteLength;
}

export function promptFitsBudget(value: string, maxBytes: number): boolean {
  return Number.isSafeInteger(maxBytes) && maxBytes > 0 && promptByteLength(value) <= maxBytes;
}
