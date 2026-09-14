// 连接就绪后按活跃项目顺序 discover session 目录（组合根装配）。

import { createEffect, createRoot, type Accessor } from 'solid-js';
import { createSessionCatalogBootstrap } from '@/features/catalog/session-catalog-bootstrap';
import { selectActiveProjects } from '@/features/catalog/project-catalog';
import {
  clearCatalogDiscoverFailure,
  resetCatalogDiscoverFailures,
  setCatalogDiscoverFailure,
} from '@/features/catalog/catalog-discover-state';
import type { CatalogActions } from '@/features/catalog/catalog-actions';
import type { ProjectInfo } from '@/entities/registry/registry-view';

let sessionCatalogBootstrap: ReturnType<typeof createSessionCatalogBootstrap> | null = null;

export function getSessionCatalogBootstrap() {
  return sessionCatalogBootstrap;
}

export function scheduleSessionCatalogBootstrap(): void {
  sessionCatalogBootstrap?.schedule();
}

export function resetSessionCatalogBootstrap(): void {
  sessionCatalogBootstrap?.reset();
  resetCatalogDiscoverFailures();
}

export function isProjectCatalogBootstrapPending(projectId: string): boolean {
  return sessionCatalogBootstrap?.pending().has(projectId) ?? false;
}

export function wireSessionCatalogBootstrap(deps: {
  connectionReady: () => boolean;
  readOnly: () => boolean;
  projects: Accessor<ProjectInfo[]>;
  registryHydrated: () => boolean;
  catalogActions: CatalogActions;
  toast: (message: string) => void;
}): void {
  sessionCatalogBootstrap = createSessionCatalogBootstrap({
    isReady: deps.connectionReady,
    isReadOnly: deps.readOnly,
    activeProjectIds: () => selectActiveProjects(deps.projects()).map((project) => project.id),
    discover: (projectId, onSettled) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        onSettled();
      };
      const started = deps.catalogActions.discoverSessions(
        projectId,
        () => {
          clearCatalogDiscoverFailure(projectId);
          finish();
        },
        (message) => {
          setCatalogDiscoverFailure(projectId, message);
          deps.toast(message);
          finish();
        },
      );
      if (!started) finish();
      return started;
    },
  });

  createRoot(() => {
    createEffect(() => {
      if (deps.connectionReady() && deps.registryHydrated()) scheduleSessionCatalogBootstrap();
    });
  });
}
