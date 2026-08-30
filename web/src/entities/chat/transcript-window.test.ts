import { describe, expect, it } from 'vitest';
import { TranscriptWindow } from './transcript-window';

describe('TranscriptWindow', () => {
  it('renders a bounded tail window for a two-thousand-entry transcript', () => {
    const transcript = new TranscriptWindow({ estimatedHeight: 80, overscan: 320 });
    transcript.setItems(Array.from({ length: 2_000 }, (_, index) => `entry-${index}`));

    const slice = transcript.slice(159_200, 800);

    expect(slice.ids.at(-1)).toBe('entry-1999');
    expect(slice.ids.length).toBeLessThanOrEqual(20);
    expect(slice.beforeHeight).toBeGreaterThan(150_000);
    expect(slice.afterHeight).toBe(0);
    expect(slice.totalHeight).toBe(160_000);
  });

  it('restores the same visible anchor after an earlier row grows asynchronously', () => {
    const transcript = new TranscriptWindow({ estimatedHeight: 100, overscan: 200 });
    transcript.setItems(Array.from({ length: 200 }, (_, index) => `entry-${index}`));
    const anchor = transcript.captureAnchor(10_025);

    expect(anchor).toEqual({ id: 'entry-100', offset: 25 });
    expect(transcript.measure('entry-50', 220)).toBe(true);

    expect(transcript.restoreAnchor(anchor)).toBe(10_145);
  });

  it('updates only the suffix after a measured tail changes', () => {
    const transcript = new TranscriptWindow({ estimatedHeight: 80, overscan: 160 });
    transcript.setItems(['first', 'tail']);

    expect(transcript.measure('tail', 140)).toBe(true);
    expect(transcript.slice(0, 1_000).totalHeight).toBe(220);
    expect(transcript.captureAnchor(170)).toEqual({ id: 'tail', offset: 90 });
  });

  it('preserves an anchor across remote history prepends', () => {
    const transcript = new TranscriptWindow({ estimatedHeight: 90, overscan: 180 });
    transcript.setItems(Array.from({ length: 100 }, (_, index) => `entry-${index}`));
    const anchor = transcript.captureAnchor(4_520);

    transcript.setItems([
      ...Array.from({ length: 10 }, (_, index) => `history-${index}`),
      ...Array.from({ length: 100 }, (_, index) => `entry-${index}`),
    ]);

    expect(transcript.restoreAnchor(anchor)).toBe(5_420);
    expect(transcript.captureAnchor(5_420)).toEqual(anchor);
  });
});
