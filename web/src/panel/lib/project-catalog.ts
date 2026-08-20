import type { ProjectInfo } from './registry-view';

export const selectActiveProjects = (items: readonly ProjectInfo[]) => items.filter((project) => !project.archivedAt);
export const selectArchivedProjects = (items: readonly ProjectInfo[]) => items.filter((project) => !!project.archivedAt);
