/* 运行时 token 读取：看板数据直接来自已加载样式表，永不与实现漂移。 */

export interface TokenEntry {
  /** 变量名，如 --palette-accent-600 */
  name: string;
  /** 声明值（可能是 var() 引用链） */
  value: string;
}

function isRootSelector(selector: string): boolean {
  return selector.split(',').some((part) => part.trim() === ':root');
}

function collectRootRules(rules: CSSRuleList, byName: Map<string, string>): void {
  for (const rule of Array.from(rules)) {
    if (rule instanceof CSSStyleRule) {
      if (isRootSelector(rule.selectorText)) {
        for (const name of Array.from(rule.style)) {
          if (name.startsWith('--')) byName.set(name, rule.style.getPropertyValue(name).trim());
        }
      }
      continue;
    }
    if (rule instanceof CSSGroupingRule) {
      collectRootRules(rule.cssRules, byName);
    }
  }
}

/** 收集所有样式表 :root 规则上的自定义属性（声明顺序保留，后者覆盖前者）。 */
export function readDesignTokens(): TokenEntry[] {
  const byName = new Map<string, string>();
  for (const sheet of Array.from(document.styleSheets)) {
    try {
      collectRootRules(sheet.cssRules, byName);
    } catch {
      continue;
    }
  }
  return [...byName.entries()].map(([name, value]) => ({ name, value }));
}

/** 读取 :root 上最终生效的 token 值（含 inline 覆写）。 */
export function getTokenCSSValue(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

let probe: HTMLDivElement | null = null;

export type ResolveTokenProperty =
  | 'color'
  | 'width'
  | 'height'
  | 'font-size'
  | 'line-height'
  | 'border-radius'
  | 'box-shadow';

/** 用探针元素把 var() 引用链解析为最终计算值。 */
export function resolveToken(name: string, property: ResolveTokenProperty = 'color'): string {
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
