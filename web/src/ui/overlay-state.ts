// 覆盖层（overlay）计数与 inert 管理（P1 迁移：原 .mjs，纯函数无 DOM）。
//
// Dialog / Drawer / Popover / Menu 共用：acquireOverlay 压栈并跟踪最顶层
//（isTop 决定 Escape 与焦点陷阱是否生效），acquireInert 对目标元素做
// 引用计数的 inert 置位/还原。release 幂等，返回当前活动覆盖层数。

let activeOverlays = 0;
const targetCounts = new WeakMap<{ inert: boolean }, number>();
const targetInitialInert = new WeakMap<{ inert: boolean }, boolean>();
const stack: symbol[] = [];

export interface OverlayHandle {
  isTop: () => boolean;
  release: () => number;
}

export const acquireOverlay = (target: { inert: boolean } | null): OverlayHandle => {
  const token = Symbol('overlay');
  stack.push(token);
  const releaseInert = acquireInert(target);
  let released = false;
  return {
    isTop: () => stack.at(-1) === token,
    release: () => {
      if (released) return activeOverlays;
      released = true;
      const index = stack.lastIndexOf(token);
      if (index >= 0) stack.splice(index, 1);
      return releaseInert();
    },
  };
};

export const acquireInert = (target: { inert: boolean } | null): (() => number) => {
  activeOverlays += 1;
  if (target) {
    if (!targetCounts.has(target)) targetInitialInert.set(target, !!target.inert);
    targetCounts.set(target, (targetCounts.get(target) || 0) + 1);
    target.inert = true;
  }
  let released = false;
  return () => {
    if (released) return activeOverlays;
    released = true;
    activeOverlays = Math.max(0, activeOverlays - 1);
    if (target) {
      const remaining = Math.max(0, (targetCounts.get(target) || 1) - 1);
      if (remaining) targetCounts.set(target, remaining);
      else {
        targetCounts.delete(target);
        target.inert = targetInitialInert.get(target) || false;
        targetInitialInert.delete(target);
      }
    }
    return activeOverlays;
  };
};

export const activeOverlayCount = (): number => activeOverlays;
