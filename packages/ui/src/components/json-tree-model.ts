/** 展开后可见行数超过此阈值时启用虚拟滚动。 */
export const DEFAULT_VIRTUALIZE_AFTER = 500;

export type JsonTreeRow = {
  path: string;
  name?: string;
  value: unknown;
  depth: number;
  expandable: boolean;
  expanded: boolean;
};

export function isExpandable(value: unknown): boolean {
  return value !== null && typeof value === 'object';
}

export function valuePreview(value: unknown): string {
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  if (typeof value === 'string') {
    const trimmed = value.length > 48 ? `${value.slice(0, 48)}…` : value;
    return `"${trimmed}"`;
  }
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return `Array(${value.length})`;
  if (typeof value === 'object') return `Object(${Object.keys(value as object).length})`;
  return String(value);
}

export function valueToneClass(value: unknown): string | undefined {
  if (typeof value === 'string') return 'text-success';
  if (typeof value === 'number') return 'text-warning';
  if (typeof value === 'boolean') return 'text-accent-solid';
  if (value === null || value === undefined) return 'text-content-muted';
  return undefined;
}

export function getEntries(value: unknown): Array<{ key: string; name: string; value: unknown }> {
  if (Array.isArray(value)) {
    return value.map((item, index) => ({
      key: String(index),
      name: String(index),
      value: item,
    }));
  }
  if (value && typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>).map(([key, item]) => ({
      key,
      name: key,
      value: item,
    }));
  }
  return [];
}

/** 行级 copy 载荷：叶子复制 JSON 值，容器复制 path。 */
export function copyPayloadForRow(path: string, value: unknown, expandable: boolean): string {
  if (!expandable) {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return path;
}

export function isInitiallyExpanded(depth: number, defaultCollapsedDepth: number): boolean {
  return depth < defaultCollapsedDepth;
}

/** 按初始折叠深度预计算各节点展开状态。 */
export function buildInitialExpansionPaths(
  value: unknown,
  defaultCollapsedDepth: number,
  path = 'root',
  depth = 0,
): Record<string, boolean> {
  const result: Record<string, boolean> = {};
  if (!isExpandable(value)) return result;

  const expanded = isInitiallyExpanded(depth, defaultCollapsedDepth);
  result[path] = expanded;
  if (expanded) {
    for (const entry of getEntries(value)) {
      Object.assign(
        result,
        buildInitialExpansionPaths(entry.value, defaultCollapsedDepth, `${path}.${entry.key}`, depth + 1),
      );
    }
  }
  return result;
}

/** 在当前展开状态下扁平化可见行。 */
export function flattenVisibleRows(
  value: unknown,
  expanded: Record<string, boolean>,
  path = 'root',
  name?: string,
  depth = 0,
): JsonTreeRow[] {
  const expandable = isExpandable(value);
  const isExpanded = expanded[path] ?? false;
  const rows: JsonTreeRow[] = [{
    path,
    name,
    value,
    depth,
    expandable,
    expanded: isExpanded,
  }];

  if (expandable && isExpanded) {
    for (const entry of getEntries(value)) {
      rows.push(
        ...flattenVisibleRows(entry.value, expanded, `${path}.${entry.key}`, entry.name, depth + 1),
      );
    }
  }
  return rows;
}

/** 全展开时的总行数，用于 IoViewer 等场景预判是否走虚拟化。 */
export function countFullyExpandedRows(value: unknown): number {
  if (!isExpandable(value)) return 1;
  let count = 1;
  for (const entry of getEntries(value)) {
    count += countFullyExpandedRows(entry.value);
  }
  return count;
}

/** 生成用于演示/测试的大嵌套对象。 */
export function buildLargeJsonFixture(leafCount: number): Record<string, unknown> {
  const items: Record<string, unknown> = {};
  for (let index = 0; index < leafCount; index += 1) {
    items[`field_${index}`] = { index, note: `value-${index}` };
  }
  return { items };
}
