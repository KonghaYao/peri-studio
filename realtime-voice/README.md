# realtime-voice

Typeless realtime voice client for Peri Studio. The product binary uses this crate only as a server-side library (`default-features = false`, no microphone). The `realtime-voice` CLI is a probe and is not shipped.

Inject the upstream from the environment (preferred):

```bash
export PERI_REALTIME_VOICE_BASE_URL=https://voice.example/v1/realtime
export PERI_REALTIME_VOICE_API_KEY=...
```

`https://` is rewritten to `wss://`. The browser never sees the key: it talks to cookie-authenticated `ws://<studio>/voice`.

Protocol: JSON control/events + raw `pcm_s16le` frames. See `docs/design/realtime-voice.md`.

```bash
# File probe
cargo run -q -p peri-realtime-voice -- transcribe speech.wav --url wss://voice.example/realtime --token-file /secure/voice.token --stream

# Microphone probe
cargo run -q -p peri-realtime-voice -- mic --url wss://voice.example/realtime --token "$PERI_REALTIME_VOICE_API_KEY"
```

Optional probe config: `~/.config/peri-studio/realtime-voice.json`

```json
{"url":"wss://voice.example/realtime","token":null,"headers":{}}
```
