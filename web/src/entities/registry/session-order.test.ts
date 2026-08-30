import { describe, expect, it } from 'vitest';
import { stabilizeProjectSessionOrder } from './session-order';
import type { ProjectSessionInfo } from './registry-view';

const session = (
  id: string,
  projectId: string,
  stamps: { lastOpenedAt?: string | null; updatedAt?: string | null } = {},
): ProjectSessionInfo => ({
  id,
  projectId,
  title: id,
  lifecycle: 'ready',
  updatedAt: stamps.updatedAt ?? null,
  lastOpenedAt: stamps.lastOpenedAt ?? null,
  activeChatId: null,
});

describe('stabilizeProjectSessionOrder', () => {
  it('preserves relative order when only volatile updatedAt changes', () => {
    const previous = [
      session('b', 'p1', { updatedAt: '2026-08-13T10:00:00Z' }),
      session('a', 'p1', { updatedAt: '2026-08-13T09:00:00Z' }),
    ];
    const incoming = [
      session('a', 'p1', { updatedAt: '2026-08-13T12:00:00Z' }),
      session('b', 'p1', { updatedAt: '2026-08-13T11:00:00Z' }),
    ];

    const result = stabilizeProjectSessionOrder(previous, incoming);
    expect(result.map((item) => item.id)).toEqual(['b', 'a']);
    expect(result[0]?.updatedAt).toBe('2026-08-13T11:00:00Z');
    expect(result[1]?.updatedAt).toBe('2026-08-13T12:00:00Z');
  });

  it('moves a session to the top when lastOpenedAt advances', () => {
    const previous = [
      session('new', 'p1', { lastOpenedAt: '2026-08-13T12:00:00Z' }),
      session('old', 'p1', { lastOpenedAt: '2026-08-13T10:00:00Z' }),
    ];
    const incoming = [
      session('old', 'p1', { lastOpenedAt: '2026-08-13T13:00:00Z' }),
      session('new', 'p1', { lastOpenedAt: '2026-08-13T12:00:00Z' }),
    ];

    expect(stabilizeProjectSessionOrder(previous, incoming).map((item) => item.id)).toEqual(['old', 'new']);
  });

  it('prepends brand-new sessions ahead of the stable tail', () => {
    const previous = [
      session('first', 'p1', { updatedAt: '2026-08-13T10:00:00Z' }),
    ];
    const incoming = [
      session('second', 'p1', { updatedAt: '2026-08-13T09:00:00Z' }),
      session('first', 'p1', { updatedAt: '2026-08-13T10:00:00Z' }),
    ];

    expect(stabilizeProjectSessionOrder(previous, incoming).map((item) => item.id)).toEqual(['second', 'first']);
  });
});
