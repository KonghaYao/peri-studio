const TARGET_RATE = 16_000;

export function floatToPcm16le(input: Float32Array, inRate: number): Uint8Array<ArrayBuffer> {
  const resampled = inRate === TARGET_RATE ? input : downsample(input, inRate, TARGET_RATE);
  const out = new Uint8Array(resampled.length * 2);
  const view = new DataView(out.buffer);
  for (let i = 0; i < resampled.length; i += 1) {
    const sample = Math.max(-1, Math.min(1, resampled[i] ?? 0));
    view.setInt16(i * 2, Math.round(sample * 0x7fff), true);
  }
  return out;
}

function downsample(input: Float32Array, inRate: number, outRate: number): Float32Array {
  if (inRate % outRate === 0) {
    const factor = inRate / outRate;
    const length = Math.floor(input.length / factor);
    const out = new Float32Array(length);
    for (let i = 0; i < length; i += 1) {
      const start = i * factor;
      let sum = 0;
      for (let j = 0; j < factor; j += 1) sum += input[start + j] ?? 0;
      out[i] = sum / factor;
    }
    return out;
  }
  const ratio = inRate / outRate;
  const length = Math.floor(input.length / ratio);
  const out = new Float32Array(length);
  for (let i = 0; i < length; i += 1) {
    const src = i * ratio;
    const i0 = Math.floor(src);
    const frac = src - i0;
    const a = input[i0] ?? 0;
    const b = input[i0 + 1] ?? a;
    out[i] = a + (b - a) * frac;
  }
  return out;
}

export function joinDictation(baseline: string, incoming: string): string {
  const next = incoming.trim();
  if (!next) return baseline;
  if (!baseline.trim()) return next;
  return /[\s\n]$/.test(baseline) ? `${baseline}${next}` : `${baseline} ${next}`;
}
