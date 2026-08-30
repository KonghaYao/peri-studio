# shared/ui

本目录是 Peri Studio Web 前端的**设计系统层**：基于 Kobalte 封装的通用 UI 组件（Button、Dialog、Listbox 等），不含 server / session / project 等业务语义。对外唯一入口为 `shared/ui/index.ts`（别名 `@/shared/ui`）；迁移期间 `components/ui` 仅作 re-export shim。
