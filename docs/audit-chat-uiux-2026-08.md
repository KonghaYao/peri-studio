# Chat 内容与整体 UI/UX 十轮审计（2026-08）

基线：`888778e`。审计覆盖 Chat Doc/Control Doc/Registry/Resource 投影、浏览器协议边界、桌面与移动端实际交互，以及 1280×900、1024×820、768×1024、390×844、390×430 五类视口。优先级按数据泄漏/越权、不可恢复死锁、主路径不可用、可访问性与视觉一致性排序。

## 结论

本轮确认 3 个 P0、26 个 P1、17 个 P2。当前实现已闭环本报告全部 P0/P1，并补充协议、Rust 投影、组件、触屏、短视口、高对比和键盘浏览器回归；剩余 P2 按深模块切片保留，不用局部视觉补丁掩盖状态模型问题。

### 本轮已修复

1. `resource:*` Yjs update 通过严格 DocId 解码；resource result 同时校验 `docId === resource:{viewId}`。
2. Resource session 只接受已登记且仍存活的请求；旧 project 的迟到 view 仅 release，不 subscribe；未租赁 update 不创建 Doc。
3. `hidden` reasoning 不再写入浏览器共享 Chat Doc；Web 仅渲染明确的 `summary`，未知值 fail closed。
4. 权限卡展示 `Allow once` / `Allow for this session`，并回传 Control Doc 投影的精确 opaque optionId；server 对 chat、原请求身份与 scope 三重校验，篡改、跨 chat 抢占和恢复证据失配均 fail closed。无 reject option 时仍可按 ACP `cancelled` 拒绝；旧客户端缺省 ID 时才保留最小权限兼容选档。
5. 权限卡显示 server 投影期限的秒级倒计时；本地到期后禁用裁决与重试，显式无效时间戳 fail closed，旧投影缺省期限仍兼容。
6. 1024px 状态栏资源入口改为受控 Workbench view，点击能真实打开 Explorer。
7. 补齐缺失的 19/25/35/90/100/210/360/420 数字 token，并新增静态契约，防止 `h-35` 回退为 140px。
8. coarse pointer 下 Resource/SCM/StatusBar 主要目标达到 44px；状态栏行高与抽屉底边同步。
9. modal 打开时 diff 不再消费同一次 Escape。
10. 390×430 启动页转为流式可滚动布局，避免 prompt 与 composer 重叠。
11. 主按钮文字对比修复为白色；关键 instance 名与文件目录从 faint 提升至 muted。
12. `delivery_unknown` 增加 acknowledge-and-continue：不恢复或重发原文，保留只读证据，同时只解除所属 durable session 的 Composer 单飞锁。
13. accepted prompt 改用 Chat/Control 投影进度续租 30 秒 inactivity lease，正常长回复不再按固定墙钟误报 uncertain。
14. 2,000 条长会话改为 keyed `ChatProjection` 与变量高度 `TranscriptWindow`：流式尾部只重读关联 entry/tool，DOM/Markdown 仅挂载有界窗口，异步增高与历史前插保持可见 ID 锚点；兼容数组视图的轻量 O(n) 顺序装配仍保留，后续 keyed store 可继续消除。
15. Registry heartbeat 改经 `RegistryProjection` 与 keyed instance 分组结构共享；仅 `last_heartbeat` 变化时 project/session slice、rename row/input DOM、草稿与焦点均保持稳定。
16. Permission/Elicitation Queue 共用 identity-selection；远端前插请求不再静默换题，当前请求消失才按原位置回退，草稿、焦点和 DOM 身份保持稳定。
17. Elicitation 一次性回答改由独立 delivery 状态机持有；terminal ACK、已写入后的 action error、超时、断线、`DELIVERY_UNKNOWN` 与刷新后仍为 `responding` 均保持不可重放门禁，用户可重取 Control Doc 或在保留证据后仅本地隐藏；只有 transport 明确未接受 frame 才回滚本地占位。
18. Explorer/Source Control 以稳定资源键记录预览来源；移动端文件或 diff 打开后焦点进入带完整路径/比较上下文的 editor heading，Escape 关闭后重开原资源视图并恢复原行焦点。Explorer 展开项、active path、滚动位置，以及按 project/repository 隔离的 commit draft 与在途提交身份跨 Dialog 卸载保留；active row 被删除或切 project 时回退到存活祖先/首项，始终保留唯一 Tab 入口；commit 失败保留草稿，精确成功才清空未改写草稿；桌面来源被远端删除时回退到同 view 活动按钮。
19. Chat reader 按权威 `block_order` 生成稳定 `blocks[]`；正文、reasoning、tool 与 resource 不再分组重排。回放明确区分 Verified/Unverified history；远程图片同意前显示 hostname 且不发网络请求。
20. 消息投递改为按 durable session single-flight，独立 session 可并发。Ready 协商 `maxPromptBytes`，Web/server 统一按 UTF-8 字节门控；Composer 展示字节预算。草稿以 principal/project/session 复合键持久化到 IndexedDB，revision fence 阻止迟到 hydration 覆盖新输入。
21. 权限卡展示与同一 toolCallId 精确绑定的服务端公开输入摘要：顶层白名单、URL origin、命令可执行文件/参数数量、512 字符上限，未知/嵌套/凭据默认拒绝。
22. Resource request/view 显式绑定 project generation；浏览器严格解析并消费 `leaseExpiresAt`，首帧前过期会 unsubscribe/release/drop，迟到结果与 update 不能污染新 project。
23. 侧栏领域术语统一为 instance；diff 原路径、chat id、Loading 与问题页码等真实内容从 faint 提升为 secondary/muted，faint 只保留装饰与禁用状态。
24. 正式 Chromium 矩阵新增 768px 全场景、纯键盘资源路径、forced-colors 安全边界及 35/34/25/24px 关键密度断言；真实内置浏览器复测 768px 无横向溢出。

## Round 1 — Chat 信息架构与可信度

| 优先级 | 发现 | 决策 |
|---|---|---|
| P0 | `hidden` reasoning 被共享投影和 UI 展示 | 已双层 fail-close |
| P1 | reader 读取 `block_order` 后仍把 text/tool/resource 分组重排 | 已改为稳定 discriminated `blocks[]` 并按权威顺序渲染 |
| P1 | verified 与 inferred 回放都只显示 `Recovered` | 已改为正文可见的 Verified/Unverified history |
| P2 | workspace resource 卡片无 Open/Preview/Copy 动作 | 后续接入 ResourceWorkbench 的受权导航 |
| P2 | 未知 role 被归因为 Peri | 后续使用中性来源并上报协议诊断 |

## Round 2 — 流式、长内容、代码与工具

| 优先级 | 发现 | 后续接口 |
|---|---|---|
| P1 | active turn 无正文时视觉上没有 working 状态 | 已增加仅在无可见内容时出现、reduced-motion-safe 的工作状态行 |
| P1 | cancelled/interrupted/failed 的部分回答无终态标记 | 已在尾部与复制证据同步标记 partial terminal state |
| P1 | 长对话全量 DOM + 每次 update 全量 Markdown 解析 | 已由 `TranscriptWindow` + keyed `ChatProjection` 闭环 |
| P2 | 大代码块仍生成无限 token DOM | 字节/行预算，超限纯文本窗口化，完整下载保留 |
| P1 | 远程图片加载前不展示域名 | 已在同意前展示规范化 hostname，且保持零网络请求 |

## Round 3 — Composer、命令与发送状态

| 优先级 | 发现 | 后续接口 |
|---|---|---|
| P0 | `delivery_unknown` 永久占据全局单槽，所有会话不能继续发送 | 已保留不可重发证据并增加 acknowledge-and-continue |
| P1 | 普通在途消息也全局阻塞独立会话 | 已按 durable session keyed；仅同 session single-flight |
| P1 | Composer 无协商字节上限和 UTF-8 计数 | Ready 协商上限，Web/server 边界均按 UTF-8 字节验证 |
| P1 | 草稿只在进程内存，刷新即丢失 | 已使用 principal + project + session scoped IndexedDB |
| P2 | `/` 零匹配时菜单消失并可能当普通 prompt 发送 | 明确 No matching command 状态 |

## Round 4 — 权限、询问、错误与恢复

| 优先级 | 发现 | 决策 |
|---|---|---|
| P0 | allow-once/session 被压成无范围的 Allow | 已完成范围披露、精确 optionId 回传、服务端 scope 校验与恢复绑定；旧客户端缺省 ID 时保留最小权限兼容 |
| P1 | 权限卡缺少与 toolCallId 绑定的可核验证据 | 已投影并校验 toolCall 绑定的白名单脱敏输入摘要 |
| P1 | `expiresAt` 只排序，UI 不显示或本地禁用 | 已增加秒级倒计时与到期 fail-close；显式畸形期限同样禁用，缺省期限兼容旧投影 |
| P1 | Elicitation Queue 按数组 index，前插会静默换题 | 已按 elicitationId 保存选择身份，并与 Permission Queue 共用插入/删除回退算法 |
| P1 | Elicitation `DELIVERY_UNKNOWN` 形成不可恢复锁 | 已增加 Control Doc refresh-status 与保留不可重放证据的 local dismiss；刷新后仍从 `responding` 恢复未知锁 |

## Round 5 — 导航、会话、项目与工作台

| 优先级 | 发现 | 决策 |
|---|---|---|
| P1 | 1024px 状态栏资源入口无效果 | 已修复为受控 view |
| P2 | 多项目时 New session 无解释禁用 | 打开项目选择器，复用 Quick Start |
| P2 | 四个未实现导航项挤占移动端首屏 | 上线前隐藏或收进 Coming later |
| P2 | 长项目/会话名截断后不可区分 | 仅溢出时提供可聚焦 tooltip |
| P2 | commit 成功后 message 不清空 | 仅服务端成功且新 generation 投影后清空 |

## Round 6 — 响应式、触屏、键盘与无障碍

| 优先级 | 发现 | 决策 |
|---|---|---|
| P1 | Resource/SCM/StatusBar 触控目标 22–38px | 主要路径已提升至 coarse 44px |
| P1 | Escape 同时关闭 modal 与底层 diff | 已修复层级消费 |
| P1 | 移动端打开文件后焦点仍回到旧触发器 | 已覆盖文件与 Git diff 的 Enter/Escape 焦点往返 |
| P2 | Explorer 当前项被删除后可能无 tabindex=0 | entries 更新时归位父项或首项 |
| P2 | forced-colors 下连接状态可能只剩色点 | 显示文字/系统色边框并加入矩阵 |

## Round 7 — 视觉系统、密度、排版与动效

| 优先级 | 发现 | 决策 |
|---|---|---|
| P1 | 缺失 spacing/text token 产生 4 倍尺寸回退 | 已补齐并新增静态完整性测试 |
| P1 | faint 关键文本仅约 2.06:1 | 所有真实内容已提升为 secondary/muted；faint 仅保留装饰/禁用状态 |
| P2 | SCM 操作与错误压到 10–11px | 操作/错误目标至少 12px |
| P2 | 三个主区域全白，层级依赖 hairline | Remote Workspace 使用克制冷色 surface/signature |
| P2 | 异步 Markdown 增高不能保持 bottom anchor | 已接入 ResizeObserver + stick/anchor 双模式 |

## Round 8 — 状态模块深度、性能与并发

| 优先级 | 发现 | 推荐深模块 |
|---|---|---|
| P1 | Resource project 切换无 request generation/lease fence | 已加入 project generation owner、租约 deadline 与 orphan release |
| P1 | 每次 heartbeat 全量重建 Sidebar，可擦掉 rename draft | keyed `RegistryProjection` + instance group 结构共享已闭环 |
| P1 | 2,000 条 transcript 的流式尾部导致近 O(n²) 解析与 DOM 工作 | keyed `ChatProjection` + `TranscriptWindow` 已消除全量 Yjs/Markdown/DOM；数组顺序装配列为后续 P2 |
| P1 | prompt 固定 30s wall timeout 与 server activity lease 冲突 | 已由 `CommandTracker.touch()` 接入 runtime projection inactivity lease |
| P2 | async cache 的旧 rejection 可删掉同 key 新任务 | identity-checked delete + weighted LRU |
| P2 | DocStore update 失败只有计数，无 quarantine/reload | typed failure callback + 单次权威 resubscribe |

## Round 9 — 真实浏览器多尺寸对抗

| 优先级 | 发现 | 决策 |
|---|---|---|
| P1 | 正式矩阵缺 768、coarse、forced-colors、keyboard-only | 已扩充为真实操作矩阵，不只做渲染断言 |
| P1 | visual contract 只看 shell/横向溢出，漏掉 140px header | 已门禁 editor 35/34px、SCM 25/24px 与 token 完整性 |
| P1 | 390×430 prompt/composer 重叠 104px | 已改短视口流式布局 |
| P2 | Resource 交互只在 1280 执行 | 已增加 390px 往返与 768px keyboard-only 操作路径 |
| P2 | 缺本地化、相同前缀、长错误压力场景 | 新增 stress-copy fixture 与稳定截图基线 |

## Round 10 — Standards / Spec 复审

复审固定点为 `888778e`，同时检查仓库 `CLAUDE.md`、权威架构、术语表与本报告。两个独立只读审查均无遗留 P0 或功能阻断；复审发现的未知 reasoning visibility 降级、资源协议模块环、遗漏的 coarse 触控目标、未租赁 update 测试缺口、浏览器测试文件超限与报告计数均已闭环。当前生产文件均不超过 500 行；接近阈值的 `doc_manager_persist.rs` / `gateway.rs`（498）、`doc_manager_apply_command.rs`（491）、`resource_service.rs`（484）、`permission_resolution.rs`（483）与 `aggregator.rs`（482）保留为后续结构预警。Web `resource-store.ts` 已拆出 `resource-state.ts`，组合根 `store.ts` 为 484 行。

最终门禁数字以本轮结束时的实际全量命令为准（见提交说明）；矩阵固定包含 2,000 条有界 transcript、1024/768 入口、390×430 短视口、真实 coarse pointer 44px、forced-colors、keyboard-only、移动端 FS/Git 焦点往返和桌面来源删除回退。禁止在命令完成前预填测试计数。

后续双轴复审又闭环三项：metadata `accepted` 不再误续墙钟 timeout，只有显式 prompt inactivity lease 可由 runtime progress 续租；acknowledged `delivery_unknown` 证据上限为 20 条，满额后 fail-closed 而不静默淘汰；已确认继续的历史证据改用普通 group 语义，不再作为新 alert 重复打断读屏。

## 推荐路线

1. 扩展 P2 压力场景：本地化、相同前缀、长错误与大代码块窗口化。
