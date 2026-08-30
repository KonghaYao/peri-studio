---
status: accepted
date: 2026-08-30
---

# Web 前端五层目录与依赖边界

## 背景

`web/src/panel` 将页面、组件与领域逻辑扁平混放，缺少「基础组件 / 业务组件 / 页面 / 外壳」的权威分层，维护成本随功能增长上升。

## 决策

采用 **app → pages → widgets → features → entities/shared** 五层结构（详见 [frontend-architecture.md](../design/frontend-architecture.md)）：

1. **shared**：设计系统（ui）与无业务工具（lib、protocol 帧类型）。
2. **entities**：Yjs 只读投影类型与 `render*` 函数。
3. **features**：可测试领域控制器（禁止 import store，依赖注入）。
4. **widgets**：Solid 业务组合块（可读 store，不直发协议）。
5. **pages / app**：页面装配与 bootstrap。

迁移采用绞杀者模式：新路径 + 旧路径 re-export，分阶段迁移 Composer、Session/Catalog，最后收口 store 并删除 `panel/` shim。

## 后果

- 短期存在双路径 import；文档与 alias 必须同步。
- 需在 Phase 1 配置 `@/` 路径别名。
- 长期 `panel/` 目录删除，仅保留 `store` 组合根（或迁入 `app`）。
