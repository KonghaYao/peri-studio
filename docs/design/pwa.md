---
status: accepted
date: 2026-09-13
---

# Peri Studio Web 可安装 PWA

> 对抗证据与实现落点。产品契约仍以 [`architecture.md`](../architecture.md) §3.0 缓存段与 §10 为准。

## 1. 裁决：可安装、在线优先，不上 Service Worker

Chat、Yjs、WebSocket 与 cookie 会话必须在线。现有静态缓存要求页面入口与一切固定名资源 `Cache-Control: no-store`，避免重启后的 server 配上旧 Web 客户端。

根作用域 `/sw.js` 一旦带 `fetch` 处理器，就会变成第二套文档工厂，HTTP `no-store` 立即失效。Chrome 108+ 桌面安装已不再要求 SW。目标环境是 loopback 桌面。规范 loopback 配方是 `http://127.0.0.1:8456/`（文档与默认启动入口）；安装 UI 必须使用**当前页** `location.origin`，不得把该配方硬编码成「这次安装」。

v1 **禁止**：`vite-plugin-pwa` / Workbox、注册 `/sw.js` 或 hashed `/assets/sw-*.js`、Cache Storage、`skipWaiting` / `clients.claim`、用 toast 伪装「应用已更新」。

后续若要 SW，必须另开设计：无 `fetch` 的 no-op 脚本、强制 BUILD_ID、page-level unregister、二进制 kill-switch。

## 2. 静态面（server + `web/public`）

| 资源 | 约束 |
|------|------|
| `manifest.webmanifest` | MIME `application/manifest+json`；固定名 `no-store`；`display: standalone` + `display_override: [window-controls-overlay, standalone]`（见 §5） |
| `/icons/*`、`/apple-touch-icon.png`、`/favicon.svg` | 固定名 `no-store`；**不得**进 `/assets/`（`is_fingerprinted_asset` 会把 maskable PNG 误判 immutable） |
| `/sw.js` | 不发布；`route("/sw.js") == None` |
| `.gitignore` | 根有 `*.png`，必须有 `!web/public/**/*.png` |

`theme_color` 用侧栏灰 `#fafafa`（`--sidebar-bg`），不是 accent，也不是透明/`#00000000`：Chromium 会丢掉 alpha 并压成不透明，`#00000000` 会变成黑条。`background_color` 仍为画布白 `#ffffff`，避免 splash / 首帧黑闪。`localhost` 与 `127.0.0.1` 是两个 origin（两套 cookie / 两套安装）。已安装窗口要换 theme 须卸掉快捷方式再从齿轮 **Install** 重装。

## 3. HTML 与安全区

只改 [`web/index.html`](../../web/index.html)：英文标题 `Peri Studio`、`viewport-fit=cover`、`theme-color`、manifest / apple-touch-icon / favicon、`apple-mobile-web-app-capable` + `status-bar-style=default`。禁止 `transformIndexHtml`（会污染 `sandbox.html`）。`sandbox.html` 与 visual-fixture 不得带 PWA 标签。

T1 `--safe-area-*` 映射 `pt-safe` / `pb-safe` / `p-safe` / `p-safe-min-24`。`--composer-safe-bottom` 复用 `--safe-area-bottom`。AuthGate 登录页父级用 `p-safe-min-24`（`max(space-24, safe-area, titlebar-area)`），不得给 `min(440px, 100%)` 卡片加 `m-24`。AppShell 用 `p-safe`（含底栏 `pb-safe`），**不**把 `--titlebar-area-height` 算进整窗 padding，否则会再造一条空白顶栏。Toast 视口用 `p-safe`。禁止 `pt-[env(...)]`。iOS `visualViewport` 键盘推迟见 [`web-ui-deferrals.md`](web-ui-deferrals.md)。

桌面已安装窗口的标题栏几何走 T1 `--titlebar-area-*`（`env(titlebar-area-x|y|width|height)`，未 overlay 时为 0）。`--titlebar-safe-right` 仅在 `display-mode: window-controls-overlay` 下用 `100vw` 反推右侧 caption 区；未激活时保持 `0px`。侧栏 navbar / ChatHeader 是拖拽条（`ui-titlebar-drag` + WCO `ui-titlebar-overlay` 毛玻璃）；按钮、输入、Composer、齿轮 Settings 菜单与 portaled `[role='menu']` / `[role='dialog']` 为 `ui-titlebar-no-drag`，避免 WCO 拖拽吞掉 Install / System。AuthGate 登录底为 drag（不套 overlay）、卡片为 no-drag，避免 traffic lights 压住表单。

## 4. 前端分层

| 落点 | 职责 |
|------|------|
| `features/pwa` | 模块信号 `canInstall` / `isStandalone` / `isIosLike`（auth-state 模式）；`startPwa()` 捕获一次性 `beforeinstallprompt`；`promptInstall()`；`pwa-install-prompt` 管 origin 级「已问过」与首次登录等待 |
| `widgets/shell/PwaRuntime.tsx` | `onMount` 调 `startPwa()`；无 UI |
| `widgets/shell/PwaInstallPrompt.tsx` | 签入后首次 Dialog（与 `AuthGate` 兄弟）；`PwaInstallDialog` 为 Dialog 本体 |
| `widgets/shell/SidebarChrome.tsx` | 齿轮 Settings 菜单：可安装时 **Install** + **System** |
| `pages/panel` | 与 `AuthGate` **兄弟**组装 `PwaRuntime` + `PwaInstallPrompt`，登录页也能抓住 install 事件 |
| System 弹窗（`SettingsDialog` 文件名保留）About | 「This browser」互斥：Install / Installed / iOS A2HS（仅 loopback 安全上下文）/ Cannot install here |

这是 **System** 诊断弹窗（浏览器 chrome 可含本机安装），不是用户偏好 Settings。`startPwa()` / `PwaRuntime` 只出现在 `pages/panel` 与 `widgets/shell/PwaRuntime.tsx`。`promptInstall()` 必须在 `await prompt()` 之前清空 `deferredPrompt` 并 `setCanInstall(false)`，进行中禁用 Install。

可发现入口：**齿轮 Settings 菜单**（`canInstall` 或 loopback iOS A2HS 时出现 Install；`standalone` / `window-controls-overlay` 均视为已安装并隐藏）以及 **首次签入 Dialog**（`peri_studio:pwa-install-prompt` 记 asked，不写 token）。Dialog 仅在 `canInstall()` 或 `canAddToHomeScreen()` 为真且非已安装窗口时出现；WCO 与 standalone 都不弹；BIP 未到则短等后跳过。Chrome 的 Install 调 `promptInstall()`；iOS 只说明 Share → Add to Home Screen，不提供空 Install。不用 Toast。

不进 `store/index.ts`。不挂 sidebar More、AuthGate 登录卡、`ConnectionProblem`、Toast。无 Reload-for-update。`visual-fixture` 不挂 `PwaRuntime`。不新增 T3 `InstallButton`。

UI 文案英文：`Install`、`Installed`、`Open Share, then Add to Home Screen`、`Cannot install here`。有动作时说明安装的是**当前 origin** 的本机快捷方式；该 server 停止后窗口不可用。iOS A2HS 仅当 `isIosLike && isSecureContext && isLoopbackHost`（`127.0.0.1` / `localhost` / `[::1]`）；LAN HTTP 不得提示 Add to Home Screen。iOS 须提示 Home Screen 应用是独立存储，可能要再登录一次。无安装动作时隐藏安装说明段。

## 5. 已安装窗口 chrome：`window-controls-overlay`，不用 `borderless`

目标是去掉 Chrome 桌面 PWA 自带的白底标题栏（traffic lights + 居中 “Peri Studio” + 浏览器菜单），让工作台顶到窗沿，而不是隐藏应用内「New session」。

`manifest.webmanifest` 保持 `display: standalone` 作为回退，并声明：

```json
"display_override": ["window-controls-overlay", "standalone"]
```

**不**把 `borderless` / `unframed` 放在 override 首位：该模式已收窄为 Isolated Web Apps（ChromeOS / 旗标），不是普通桌面 PWA 的生产能力；浏览器不认识的 override 项会被跳过，但写上去会误导后续维护者。也**不**使用 `display: fullscreen`（会困住用户）。

Chromium 桌面在 WCO 下把原生窗控叠在网页上，并用 `env(titlebar-area-*)` 给出可绘制标题区。不支持 WCO 的引擎忽略 override，继续 `standalone`（保留系统标题栏，窗口仍可拖）。已安装探测必须同时认 `display-mode: standalone` 与 `display-mode: window-controls-overlay`，否则 System About、齿轮 Install 与首次签入 Dialog 会在 WCO 窗口里误显示 Install。

原生 overlay 底色跟 `theme_color`。Blink 解析后 `WebAppBrowserController` 一类路径会 `SkColorSetA(..., SK_AlphaOPAQUE)`，manifest / `<meta name="theme-color">` 的 alpha 不可靠。因此不用 `#00000000` / `transparent`（会变成黑条），改用 `#fafafa` 贴齐侧栏，避免白条压在 sidebar 上。网页拖拽条另加 T1 `--titlebar-overlay-*` 与 `.ui-titlebar-overlay`（侧栏半透明 + `backdrop-filter`）；`html` / `body` / `#app` 在 WCO 下不另画不透明顶栏。`forced-colors` 回退 `Canvas`，`prefers-reduced-transparency` 回退实心 `--sidebar-bg`。AuthGate 登录底保持 `bg-sidebar-bg`（不套 overlay），卡片仍 `p-safe-min-24` + `ui-titlebar-no-drag`。

无 Service Worker 的裁决不变。
