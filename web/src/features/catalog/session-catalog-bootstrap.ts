/**
 * 连接就绪后按项目顺序触发 session/discover，填充 ACP 会话目录（ADR-0003）。
 * server 重启后 Registry 仅有 projects、无 project_sessions，需主动 discover。
 */

export interface SessionCatalogBootstrapDeps {
  isReady: () => boolean;
  isReadOnly: () => boolean;
  activeProjectIds: () => string[];
  /** 返回 false 表示未发起 discover（调用方应继续队列）。 */
  discover: (projectId: string, onSettled: () => void) => boolean;
  onPendingChange?: (pending: ReadonlySet<string>) => void;
}

export interface SessionCatalogBootstrap {
  schedule: () => void;
  reset: () => void;
  pending: () => ReadonlySet<string>;
}

export function createSessionCatalogBootstrap(
  deps: SessionCatalogBootstrapDeps,
): SessionCatalogBootstrap {
  let epoch = 0;
  let scheduled = false;
  let running = false;
  let queue: string[] = [];
  let pending = new Set<string>();

  const publishPending = (next: Set<string>) => {
    pending = next;
    deps.onPendingChange?.(pending);
  };

  const drain = (activeEpoch: number) => {
    if (activeEpoch !== epoch || running) return;
    if (!deps.isReady() || deps.isReadOnly()) {
      publishPending(new Set());
      queue = [];
      return;
    }
    while (queue.length > 0) {
      const projectId = queue[0]!;
      running = true;
      publishPending(new Set([projectId, ...queue.slice(1)]));
      const started = deps.discover(projectId, () => {
        if (activeEpoch !== epoch) return;
        running = false;
        queue = queue.slice(1);
        publishPending(new Set(queue));
        drain(activeEpoch);
      });
      if (!started) {
        running = false;
        queue = queue.slice(1);
        continue;
      }
      return;
    }
    publishPending(new Set());
  };

  return {
    schedule() {
      if (scheduled || !deps.isReady() || deps.isReadOnly()) return;
      const ids = deps.activeProjectIds();
      if (!ids.length) return;
      scheduled = true;
      const activeEpoch = epoch;
      queue = [...ids];
      publishPending(new Set(queue));
      drain(activeEpoch);
    },
    reset() {
      epoch += 1;
      scheduled = false;
      running = false;
      queue = [];
      publishPending(new Set());
    },
    pending: () => pending,
  };
}
