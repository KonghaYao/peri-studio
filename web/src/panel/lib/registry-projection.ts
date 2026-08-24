import type * as Y from 'yjs';
import { renderRegistry, type RegistryView } from './registry-view';

const sameFields = <T extends object>(left: T, right: T): boolean => {
  const keys = Object.keys(right) as Array<keyof T>;
  return keys.length === Object.keys(left).length && keys.every((key) => left[key] === right[key]);
};

const reconcileById = <T extends object>(
  previous: readonly T[],
  incoming: T[],
  identity: (value: T) => string,
): T[] => {
  const previousById = new Map(previous.map((value) => [identity(value), value]));
  const reconciled = incoming.map((value) => {
    const existing = previousById.get(identity(value));
    return existing && sameFields(existing, value) ? existing : value;
  });
  return reconciled.length === previous.length
    && reconciled.every((value, index) => value === previous[index])
    ? previous as T[]
    : reconciled;
};

/** Registry 只读投影的结构共享边界；低频字段更新不替换无关目录对象。 */
export class RegistryProjection {
  private doc: Y.Doc | null = null;
  private view: RegistryView | null = null;

  project(doc: Y.Doc): RegistryView {
    if (this.doc !== doc) this.dispose();
    this.doc = doc;
    const incoming = renderRegistry(doc);
    const previous = this.view;
    if (!previous) {
      this.view = incoming;
      return incoming;
    }
    const next: RegistryView = {
      ...incoming,
      instances: reconcileById(previous.instances, incoming.instances, (value) => value.id),
      chats: reconcileById(previous.chats, incoming.chats, (value) => value.id),
      sessions: reconcileById(previous.sessions, incoming.sessions, (value) => value.sessionId),
      workspaces: reconcileById(previous.workspaces, incoming.workspaces, (value) => value.id),
      projects: reconcileById(previous.projects, incoming.projects, (value) => value.id),
      projectSessions: reconcileById(previous.projectSessions, incoming.projectSessions, (value) => value.id),
    };
    this.view = next;
    return next;
  }

  dispose(): void {
    this.doc = null;
    this.view = null;
  }
}
