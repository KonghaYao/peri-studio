/* 运行时 token 读取：看板数据直接来自已加载样式表，永不与实现漂移。 */

export interface TokenEntry {
  /** 变量名，如 --palette-accent-600 */
  name: string;
  /** 声明值（可能是 var() 引用链） */
  value: string;
}

/** 收集所有样式表 :root 规则上的自定义属性（声明顺序保留，后者覆盖前者）。 */
export function readDesignTokens(): TokenEntry[] {
  const byName = new Map<string, string>();
  for (const sheet of Array.from(document.styleSheets)) {
    let rules: CSSRuleList;
    try {
      rules = sheet.cssRules;
    } catch {
      continue;
    }
    for (const rule of Array.from(rules)) {
      if (rule instanceof CSSStyleRule && rule.selectorText === ':root') {
        for (const name of Array.from(rule.style)) {
          if (name.startsWith('--')) byName.set(name, rule.style.getPropertyValue(name).trim());
        }
      }
    }
  }
  return [...byName.entries()].map(([name, value]) => ({ name, value }));
}

let probe: HTMLDivElement | null = null;

/** 用探针元素把 var() 引用链解析为最终计算值（颜色 → rgb，长度 → px）。 */
export function resolveToken(name: string, property: 'color' | 'width' = 'color'): string {
  if (!probe) {
    probe = document.createElement('div');
    probe.style.display = 'none';
    document.body.appendChild(probe);
  }
  probe.style.setProperty(property, `var(${name})`);
  const resolved = getComputedStyle(probe).getPropertyValue(property).trim();
  probe.style.removeProperty(property);
  return resolved;
}

/** 按前缀分组并保持数值档排序（--palette-accent-600 排在 -50 之后）。 */
export function groupTokens(entries: TokenEntry[], prefix: string): TokenEntry[] {
  return entries
    .filter((entry) => entry.name.startsWith(prefix))
    .sort((left, right) => {
      const ln = Number(left.name.replace(/^\D+|-/g, ' ').trim().split(' ').pop());
      const rn = Number(right.name.replace(/^\D+|-/g, ' ').trim().split(' ').pop());
      if (!Number.isNaN(ln) && !Number.isNaN(rn)) return ln - rn;
      return left.name.localeCompare(right.name);
    });
}
