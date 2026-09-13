---
status: accepted
date: 2026-09-13
---

# Peri Studio Web 可安装 PWA

> 对抗证据与实现落点。产品契约仍以 [`architecture.md`](../architecture.md) §3.0 缓存段与 §10 为准。

## 1. 裁决：可安装、在线优先，不上 Service Worker

Chat、Yjs、WebSocket 与 cookie 会话必须在线。现有静态缓存要求页面入口与一切固定名资源 `Cache-Control: no-store`，避免重启后的 server 配上旧 Web 客户端。

根作用域 `/sw.js` 一旦带 `fetch` 处理器，就会变成第二套文档工厂，HTTP `no-store` 立即失效。Chrome 108+ 桌面安装已不再要求 SW。目标环境是 loopback 桌面（规范入口 `http://127.0.0.1:8456/`）。

v1 **禁止**：`vite-plugin-pwa` / Workbox、注册 `/sw.js` 或 hashed `/assets/sw-*.js`、Cache Storage、`skipWaiting` / `clients.claim`、用 toast 伪装「应用已更新」。

后续若要 SW，必须另开设计：无 `fetch` 的 no-op 脚本、强制 BUILD_ID、page-level unregister、二进制 kill-switch。

## 2. 静态面（server + `web/public`）

| 资源 | 约束 |
|------|------|
| `manifest.webmanifest` | MIME `application/manifest+json`；固定名 `no-store` |
| `/icons/*`、`/apple-touch-icon.png`、`/favicon.svg` | 固定名 `no-store`；**不得**进 `/assets/`（`is_fingerprinted_asset` 会把 maskable PNG 误判 immutable） |
| `/sw.js` | 不发布；`route("/sw.js") == None` |
| `.gitignore` | 根有 `*.png`，必须有 `!web/public/**/*.png` |

`theme_color` / `background_color` 为画布白 `#ffffff`，不是 accent。`localhost` 与 `127.0.0.1` 是两个 origin（两套 cookie / 两套安装）。

## 3. HTML 与安全区

只改 [`web/index.html`](../../web/index.html)：英文标题 `Peri Studio`、`viewport-fit=cover`、`theme-color`、manifest / apple-touch-icon / favicon、`apple-mobile-web-app-capable` + `status-bar-style=default`。禁止 `transformIndexHtml`（会污染 `sandbox.html`）。`sandbox.html` 与 visual-fixture 不得带 PWA 标签。

T1 `--safe-area-*` 映射 `pt-safe` / `pb-safe` 等。`--composer-safe-bottom` 复用 `--safe-area-bottom`。应用到 AuthGate、AppShell、Toast 视口。禁止 `pt-[env(...)]`。iOS `visualViewport` 键盘推迟见 [`web-ui-deferrals.md`](web-ui-deferrals.md)。

## 4. 前端分层

| 落点 | 职责 |
|------|------|
| `features/pwa` | 模块信号 `canInstall` / `isStandalone` / `isIosLike`（auth-state 模式）；`startPwa()` 捕获一次性 `beforeinstallprompt`；`promptInstall()` |
| `widgets/shell/PwaRuntime.tsx` | `onMount` 调 `startPwa()`；无 UI |
| `pages/panel` | 与 `AuthGate` **兄弟**组装，登录页也能抓住 install 事件 |
| `SettingsDialog` About | 「This browser」：Install / Installed / Safari A2HS |

不进 `store/index.ts`。不挂 sidebar More、AuthGate 登录卡、`ConnectionProblem`、Toast。无 Reload-for-update。`visual-fixture` 不挂 `PwaRuntime`。不新增 T3 `InstallButton`。

UI 文案英文：`Install`、`Installed`、`Open Share, then Add to Home Screen`。说明安装的是本机快捷方式；断开本机 server 后窗口不可用。iOS 须提示 Home Screen 应用是独立存储，可能要再登录一次。
