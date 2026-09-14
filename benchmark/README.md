# Peri TUI 多轮压测环境

在 **tmux** 里以日常方式启动 **peri 交互式 TUI**，用 `send-keys` 发送 **n 条 user prompt**；每条 prompt 触发 mock 的一轮完整剧本：**tool calls → 流式 markdown response**。采集 **peri 进程 CPU/RSS**。

> **peri-studio 本身没有 TUI**。本 benchmark 压测外部 **`peri` 二进制** 的终端交互路径。

## 一轮的定义（重要）

**完整一轮** = 下面三步顺序执行，然后重复 n 次：

1. **user** 发一条 prompt（drive 用 tmux `send-keys`）
2. **tool calls**：mock 返回若干次 `Bash` / `Read`，peri **真实执行**（无害命令、工作区内只读文件）
3. **response**：assistant 最终回复，**SSE 流式 markdown**（标题、有序/无序列表、代码块、表格、引用等 TUI 常见块）

```
user ≫ tool₁ ≫ tool₂ ≫ … ≫ toolₖ ≫ markdown response
         └──────── 一轮 ────────┘
              × n 轮
```

**不是**「1–3 次 user + 每次挂 2000 个 tool 自转」。session 要拉长，请加大 **`BENCHMARK_ROUNDS`**（例如 50、200、500、1000），而不是把 tool 堆在一轮里。

## 三个压测场景

| 场景 | 实现 | 压什么 |
|------|------|--------|
| **超大 markdown 流式渲染** | OpenAI SSE `delta.content`，分 chunk 推送长文 | peri TUI 流式 markdown |
| **tool call** | 标准 OpenAI `tool_calls`，交替 `Bash` / `Read` | TUI tool 卡片 + 真实执行 |
| **多轮 user 驱动** | drive 发 **n 条** user；每轮等 TUI **idle** 后再发下一条 | 真实长 session 形态 |

## 工作区配置（唯一 LLM 上游入口）

peri 从 **当前工作目录** 读取：

```
<out>/<run>/workspace/.peri/settings.json
```

TUI 启动时 `cd` 到 `workspace/`，**不**修改 `~/.peri/settings.json`，**不**依赖 `OPENAI_BASE_URL` / `OPENAI_API_KEY` 环境变量。

**如何确认走了 mock**：

1. TUI 状态栏模型名应为 **`gpt-4o-benchmark`**
2. `mock-llm-audit.jsonl` 每轮有 `tool_stream` + `markdown_stream`
3. TUI transcript 可见 Bash/Read 工具卡片与流式 markdown

## 架构

```
tmux pane 2: peri TUI（cwd = workspace/，读 ./.peri/settings.json）
    ↓ OpenAI HTTP /v1/chat/completions
tmux pane 0: mock-llm（每轮：tools → markdown SSE）
    ↑
tmux pane 3: drive-tui（n 次 send-keys，每轮等 idle）
tmux pane 1: metrics（ps 采样 peri PID）
```

## 目录结构

```
benchmark/
├── mock-llm/           # server.py + scenario.py（OpenAI 标准协议）
├── drive-tui/          # n 轮 user prompt 驱动
├── fixtures/           # user-prompts.json
├── metrics/
├── scripts/
└── out/                # gitignore
```

## 依赖

- **`peri`**：`~/.peri/peri` 或 `PATH` / `PERI_BIN`
- **`tmux`**
- **`python3`**

不需要 `cargo build peri-studio` 或 `./dev.sh`。

## Smoke（短剧本）

```bash
cd benchmark
chmod +x scripts/*.sh metrics/*.sh drive-tui/*.sh mock-llm/server.py
./scripts/run-smoke.sh
```

默认：**3 轮**，每轮 **12** 次 tool + **~8KB** markdown。

观察：

```bash
tmux attach -t peri-benchmark   # pane 2 = peri TUI
```

Smoke 结束会自动 `kill-session`；手动长跑结束后：

```bash
tmux kill-session -t peri-benchmark
```

## 长跑（多轮 session）

```bash
cd benchmark
./scripts/run-benchmark.sh
```

默认：**50 轮**，每轮 **15** tool + **50KB** markdown。

想看 **几百 / 上千轮** 超长 session（在 tmux 里盯着看）：

```bash
BENCHMARK_ROUNDS=200 ./scripts/run-benchmark.sh
# 或
BENCHMARK_ROUNDS=1000 \
BENCHMARK_TOOL_CALLS_PER_ROUND=12 \
BENCHMARK_MARKDOWN_BYTES=30000 \
./scripts/run-benchmark.sh
```

总 tool 次数 ≈ `BENCHMARK_ROUNDS × BENCHMARK_TOOL_CALLS_PER_ROUND`（例如 200×15 = 3000）。

## 剧本参数

| 变量 | smoke 默认 | 长跑默认 | 说明 |
|------|-----------|---------|------|
| **`BENCHMARK_ROUNDS`**（或 `BENCHMARK_TURNS`） | 3 | 50 | **完整轮次数**（每轮含 user + tools + response） |
| `BENCHMARK_TOOL_CALLS_PER_ROUND` | 12 | 15 | 每轮 tool 次数（建议 8–20） |
| `BENCHMARK_MARKDOWN_BYTES` | 8000 | 50000 | 每轮 response markdown 体积 |
| `BENCHMARK_CHUNK_BYTES` | 256 | 512 | SSE chunk 大小 |
| `BENCHMARK_DELAY_MS` | 0 | 0 | chunk 间延迟 |
| `BENCHMARK_MARKDOWN_EVERY_N_TOOLS` | 0 | 0 | >0 时在 tool 中途穿插 markdown（一般不用） |
| `BENCHMARK_PROMPT_TIMEOUT_SEC` | 600 | 7200 | 单轮（user→结束）等 idle 超时 |
| `BENCHMARK_PERI_ALIAS` | haiku | haiku | peri `--model` |
| `PERI_BIN` | auto | auto | peri 可执行文件 |

兼容旧名：`BENCHMARK_USER_PROMPTS` = rounds；`BENCHMARK_TOOL_CALLS_PER_PROMPT` = per round。

User 文案：`fixtures/user-prompts.json`（可覆盖 `BENCHMARK_USER_PROMPTS_FILE`）；超出条数时用通用 round 文案。

## 产物

| 文件 | 内容 |
|------|------|
| `workspace/.peri/settings.json` | 工作区 OpenAI → mock 配置 |
| `mock-llm-audit.jsonl` | 每次 completion 的 kind / round / stats |
| `drive-summary.json` | 完成轮数、每轮耗时 |
| `metrics-timeseries.csv` | CPU/RSS 采样 |

## 手动分步

```bash
./scripts/setup-env.sh
source benchmark/out/<run-id>/.env

python3 mock-llm/server.py --port "$BENCHMARK_MOCK_PORT" --audit-file "$BENCHMARK_MOCK_AUDIT" \
  --tool-calls-per-round 12 --markdown-bytes 8000

cd "$BENCHMARK_WORKSPACE"
"$BENCHMARK_PERI_BIN" --permission-mode bypass --dangerously-skip-permissions \
  --db-path "$BENCHMARK_THREADS_DB" --model "$BENCHMARK_PERI_ALIAS"

# 另一终端
bash drive-tui/drive.sh --rounds 3
```

## 已知限制

1. 就绪检测依赖 TUI `❯` 提示符与「待发送」队列文本；peri UI 改版需调整 `drive-tui/drive.sh`。
2. 指标为进程级 RSS（`ps`），非 heap profiler。
3. mock 仅实现 OpenAI `/v1/chat/completions` + `/v1/models`。
