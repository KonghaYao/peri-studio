# Realtime Voice

> 状态：v2，已接入 peri-studio（server 代理 + Composer 口述）  
> 日期：2026-09-13  
> crate：`realtime-voice/`（`peri-realtime-voice`）

## 1. 目标

厂商无关的实时语音：浏览器采麦 → 同源 `ws://…/voice` → server 异步代理上游 typeless JSON + `pcm_s16le`。API key 只留在 server 进程，不进浏览器、日志或 health。

## 2. 环境变量

| 变量 | 含义 |
|------|------|
| `PERI_REALTIME_VOICE_BASE_URL` | 上游 base URL。`https://` 会收成 `wss://`，`http://` 收成 `ws://`。只写 origin（如 `http://127.0.0.1:8000`）时补 `/v1/transcribe/stream` 与默认 model |
| `PERI_REALTIME_VOICE_API_KEY` | Bearer API key |

也可写进 `config.toml` 的 `realtime_voice_base_url` / `realtime_voice_api_key`，或 CLI `--realtime-voice-base-url` / `--realtime-voice-api-key`。优先级：CLI / env > 配置文件。无默认上游。

探测 CLI 另认 `PERI_REALTIME_VOICE_URL` / `PERI_REALTIME_VOICE_TOKEN` 别名。

本地 typeless HTTP 流（如 `.tmp/deno-voice`）：

```bash
export PERI_REALTIME_VOICE_BASE_URL=http://127.0.0.1:8000
# 可选：export PERI_REALTIME_VOICE_API_KEY=...
```

## 3. 运行时接线

```
Composer mic → getUserMedia → 16 kHz pcm_s16le
        → cookie 认证的 /voice
        → LiveVoiceSession（独立 tokio 任务）
        → 上游 typeless realtime
        → transcript.partial 在输入框内替换式预览
        → transcript.final / 会话 result 只提交一次，不把预览再拼一遍
```

- 录音态只做麦克风图标动画，不使用 Listening 浮窗
- `/api/health` 只暴露 `realtimeVoice: bool`，不含 URL / key
- 未配置上游时 `/voice` 回 `voice_not_configured` 并关闭
- `app` / `instance` 不直接依赖本 crate；server 以 `default-features = false` 接入（不链 cpal）

## 4. 线协议

控制面与事件面都是 UTF-8 JSON 对象；音频面是原始二进制帧。详见 crate `protocol` 模块。浏览器只连 peri-studio，不直连上游。
