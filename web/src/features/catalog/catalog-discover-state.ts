import { createSignal } from 'solid-js';

const [discoverFailures, setDiscoverFailures] = createSignal<Record<string, string>>({});

export const catalogDiscoverFailures = discoverFailures;

export function setCatalogDiscoverFailure(projectId: string, message: string): void {
  setDiscoverFailures((items) => ({ ...items, [projectId]: message }));
}

export function clearCatalogDiscoverFailure(projectId: string): void {
  setDiscoverFailures((items) => {
    if (!items[projectId]) return items;
    const next = { ...items };
    delete next[projectId];
    return next;
  });
}

export function resetCatalogDiscoverFailures(): void {
  setDiscoverFailures({});
}

export function catalogDiscoverFailure(projectId: string): string | null {
  return discoverFailures()[projectId] ?? null;
}
