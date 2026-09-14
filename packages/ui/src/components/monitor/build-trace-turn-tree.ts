/**
 * Trace 全量 observation 树构建（自 peri-fuse `observation-tree.tsx` 的 `buildTree` / `isNoiseObservation`）。
 */

export type MonitorTraceObservationFlat = {
  id: string;
  parentId: string | null;
  type: string;
  name: string | null;
  startTime: string;
  endTime: string | null;
  level: string | null;
  output?: unknown;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
};

export type MonitorTraceTurnTreeNode = {
  observation: MonitorTraceObservationFlat;
  children: MonitorTraceTurnTreeNode[];
};

export type MonitorTraceTurnInput = {
  id: string;
  label: string;
  observations: MonitorTraceObservationFlat[];
};

export type BuildTraceTurnTreeOptions = {
  /** 默认 true；对应 fuse `buildTree` 的 `omitNoise`。 */
  omitNoise?: boolean;
  /** 可注入 predicate；传 `() => false` 可关闭过滤。 */
  isNoise?: (observation: MonitorTraceObservationFlat) => boolean;
};

/**
 * fuse `isNoiseObservation`：`stage-*` span 为中间噪音；ERROR 始终保留。
 */
export function defaultIsNoiseObservation(observation: MonitorTraceObservationFlat): boolean {
  if (observation.level?.toUpperCase() === 'ERROR') return false;
  return observation.name?.startsWith('stage-') ?? false;
}

function compareByStartTime(
  left: MonitorTraceObservationFlat,
  right: MonitorTraceObservationFlat,
): number {
  return left.startTime.localeCompare(right.startTime);
}

function sortTreeRec(nodes: MonitorTraceTurnTreeNode[]): void {
  nodes.sort((left, right) => compareByStartTime(left.observation, right.observation));
  for (const node of nodes) sortTreeRec(node.children);
}

/**
 * 自扁平 observation 列表构建森林（fuse `buildTree`）。
 * 缺失父节点时作为根；omitNoise 时隐藏噪音节点并将其子节点提升到最近可见祖先。
 */
export function buildTraceTurnTree(
  observations: MonitorTraceObservationFlat[],
  opts: BuildTraceTurnTreeOptions = {},
): MonitorTraceTurnTreeNode[] {
  const omitNoise = opts.omitNoise ?? true;
  const isNoise = opts.isNoise ?? defaultIsNoiseObservation;
  const nodes = new Map<string, MonitorTraceTurnTreeNode>();
  const hidden = new Set<string>();

  for (const observation of observations) {
    nodes.set(observation.id, { observation, children: [] });
    if (omitNoise && isNoise(observation)) hidden.add(observation.id);
  }

  const roots: MonitorTraceTurnTreeNode[] = [];
  for (const node of nodes.values()) {
    if (hidden.has(node.observation.id)) continue;

    const visited = new Set<string>();
    let parentId = node.observation.parentId;
    while (parentId && hidden.has(parentId) && !visited.has(parentId)) {
      visited.add(parentId);
      const parentNode = nodes.get(parentId);
      if (!parentNode) break;
      parentId = parentNode.observation.parentId;
    }

    const parent = parentId ? nodes.get(parentId) : undefined;
    if (parent && parent !== node) parent.children.push(node);
    else roots.push(node);
  }

  sortTreeRec(roots);
  return roots;
}

/** 多 turn 输入：每个 turn 独立构建子树（turn 边界由调用方划分）。 */
export function buildTraceTurnSections(
  turns: MonitorTraceTurnInput[],
  opts: BuildTraceTurnTreeOptions = {},
): { turn: MonitorTraceTurnInput; nodes: MonitorTraceTurnTreeNode[] }[] {
  return turns.map((turn) => ({
    turn,
    nodes: buildTraceTurnTree(turn.observations, opts),
  }));
}

/** 深度优先收集节点 id（用于键盘导航）。 */
export function collectTraceTurnTreeNodeIds(
  nodes: MonitorTraceTurnTreeNode[],
  expanded: ReadonlySet<string>,
): string[] {
  const ids: string[] = [];
  const walk = (list: MonitorTraceTurnTreeNode[]) => {
    for (const node of list) {
      ids.push(node.observation.id);
      if (node.children.length > 0 && expanded.has(node.observation.id)) {
        walk(node.children);
      }
    }
  };
  walk(nodes);
  return ids;
}

/** 在森林中按 id 查找节点。 */
export function findTraceTurnTreeNode(
  nodes: MonitorTraceTurnTreeNode[],
  id: string,
): MonitorTraceTurnTreeNode | null {
  for (const node of nodes) {
    if (node.observation.id === id) return node;
    const child = findTraceTurnTreeNode(node.children, id);
    if (child) return child;
  }
  return null;
}
