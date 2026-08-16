/**
 * 通用投递状态机工厂（delivery-state）。
 *
 * message / permission / runtime-control / quick-start 四个投递状态机过去各自
 * 手写 transition + byCommand + remove 助手与 phase 枚举，且容器（单槽
 * signal / Map / Record）、键位（commandId / permissionId / chatId）与返回值
 * （void / boolean）互不一致。本模块把两种容器的「按 commandId 定位 + 更新 /
 * 删除」算法收敛为一份实现：
 *
 * - 单槽容器：`createSingleSlotDelivery` —— 任一时刻最多一条投递；
 * - 按键容器：`createKeyedDelivery` —— 每条投递以 `keyOf(entry)` 为存储键
 *   （permissionId / chatId 等），查找与更新统一按 commandId 定位。
 *
 * `transition` 统一返回 boolean（未定位到 entry 时 false），调用方按需忽略；
 * 各模块的 phase 枚举通过 `DeliveryPhase` 并集按需 Extract/声明子集。
 */

/** 四个投递状态机 phase 的并集；各模块按需声明自己的子集。 */
export type DeliveryPhase =
  | 'sending'
  | 'accepted'
  | 'committed'
  | 'uncertain'
  | 'delivery_unknown'
  | 'failed'
  | 'pending'
  | 'confirmed'
  | 'creating';

/** 投递条目的公共骨架（各模块在此基础上附加领域字段）。 */
export interface DeliveryEntry {
  commandId: string;
  phase: DeliveryPhase;
  detail: string | null;
  retryable: boolean;
}

/**
 * 工厂的最小约束：只要求 commandId 定位键。各模块条目可省略工厂不关心的
 * 字段（如 permission 决策无 detail），phase/retryable 由模块自行声明。
 */
export interface DeliveryEntryLike {
  commandId: string;
}

export interface SingleSlotDelivery<E extends DeliveryEntryLike> {
  /**
   * 按 commandId 定位当前条目并应用更新；无条目或 commandId 不匹配时返回
   * false（不改变状态）。
   */
  transition(commandId: string, update: (current: E) => E): boolean;
}

export interface KeyedDelivery<E extends DeliveryEntryLike, K extends string> {
  /** 按 commandId 线性定位条目（存储键不要求是 commandId）。 */
  byCommand(commandId: string): E | undefined;
  /** 按 commandId 定位条目并以 keyOf 键原位更新；未命中返回 false。 */
  transition(commandId: string, update: (current: E) => E): boolean;
  /** 按存储键移除条目；键不存在返回 false。 */
  remove(key: K): boolean;
}

/** 单槽容器工厂：message-delivery / quick-start-delivery 使用。 */
export function createSingleSlotDelivery<E extends DeliveryEntryLike>(
  get: () => E | null,
  set: (entry: E | null) => void,
): SingleSlotDelivery<E> {
  return {
    transition(commandId, update) {
      const current = get();
      if (!current || current.commandId !== commandId) return false;
      set(update(current));
      return true;
    },
  };
}

/**
 * 按键容器工厂：permission-delivery（permissionId）与 runtime-control
 * （chatId）使用。调用方自持容器读写（signal 的 get/set），工厂只负责
 * 定位与更新的算法，键语义差异通过 `keyOf` 配置。
 */
export function createKeyedDelivery<E extends DeliveryEntryLike, K extends string>(
  get: () => ReadonlyMap<K, E>,
  set: (entries: ReadonlyMap<K, E>) => void,
  keyOf: (entry: E) => K,
): KeyedDelivery<E, K> {
  return {
    byCommand(commandId) {
      for (const entry of get().values()) {
        if (entry.commandId === commandId) return entry;
      }
      return undefined;
    },
    transition(commandId, update) {
      const current = get();
      for (const entry of current.values()) {
        if (entry.commandId !== commandId) continue;
        const next = new Map(current);
        next.set(keyOf(entry), update(entry));
        set(next);
        return true;
      }
      return false;
    },
    remove(key) {
      const current = get();
      if (!current.has(key)) return false;
      const next = new Map(current);
      next.delete(key);
      set(next);
      return true;
    },
  };
}
