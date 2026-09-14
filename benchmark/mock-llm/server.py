#!/usr/bin/env python3
"""OpenAI-compatible mock LLM：标准 /v1/chat/completions + SSE，每轮 user → tools → markdown response。"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any

from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from scenario import ScenarioConfig, ScenarioEngine, chunk_text  # noqa: E402

AUDIT_PATH = ""
ENGINE = ScenarioEngine(ScenarioConfig())


def audit(event: str, **fields: Any) -> None:
    if not AUDIT_PATH:
        return
    row = {"ts": time.time(), "event": event, **fields}
    with open(AUDIT_PATH, "a", encoding="utf-8") as fh:
        fh.write(json.dumps(row, ensure_ascii=False) + "\n")


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt: str, *args: Any) -> None:
        sys.stderr.write("[mock-llm] " + (fmt % args) + "\n")

    def _send_json(self, code: int, payload: dict[str, Any]) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _write_sse_chunk(
        self,
        *,
        req_id: str,
        delta: dict[str, Any],
        finish_reason: str | None = None,
    ) -> None:
        chunk = {
            "id": req_id,
            "object": "chat.completion.chunk",
            "choices": [{"index": 0, "delta": delta, "finish_reason": finish_reason}],
        }
        self.wfile.write(f"data: {json.dumps(chunk)}\n\n".encode("utf-8"))
        self.wfile.flush()

    def _stream_tool_call(self, req_id: str, tool_call: dict[str, Any]) -> None:
        fn = tool_call["function"]
        self._write_sse_chunk(
            req_id=req_id,
            delta={
                "role": "assistant",
                "content": None,
                "tool_calls": [
                    {
                        "index": 0,
                        "id": tool_call["id"],
                        "type": "function",
                        "function": {"name": fn["name"], "arguments": ""},
                    }
                ],
            },
        )
        args = fn["arguments"]
        step = max(1, len(args) // 4)
        for i in range(0, len(args), step):
            self._write_sse_chunk(
                req_id=req_id,
                delta={
                    "tool_calls": [
                        {
                            "index": 0,
                            "function": {"arguments": args[i : i + step]},
                        }
                    ]
                },
            )
            if ENGINE.config.delay_ms > 0:
                time.sleep(ENGINE.config.delay_ms / 1000.0)
        self._write_sse_chunk(req_id=req_id, delta={}, finish_reason="tool_calls")

    def _stream_markdown(self, req_id: str, text: str) -> None:
        pieces = chunk_text(text, max(1, ENGINE.config.chunk_bytes))
        self._write_sse_chunk(req_id=req_id, delta={"role": "assistant", "content": ""})
        for piece in pieces:
            self._write_sse_chunk(req_id=req_id, delta={"content": piece})
            if ENGINE.config.delay_ms > 0:
                time.sleep(ENGINE.config.delay_ms / 1000.0)
        self._write_sse_chunk(req_id=req_id, delta={}, finish_reason="stop")

    def do_GET(self) -> None:
        if self.path.rstrip("/").endswith("/models"):
            self._send_json(
                200,
                {"data": [{"id": "gpt-4o-benchmark"}, {"id": "gpt-4o"}]},
            )
            return
        if self.path.rstrip("/").endswith("/health"):
            self._send_json(200, {"ok": True, "stats": ENGINE.stats()})
            return
        self.send_response(404)
        self.end_headers()

    def do_POST(self) -> None:
        if not self.path.rstrip("/").endswith("/chat/completions"):
            self.send_response(404)
            self.end_headers()
            return

        length = int(self.headers.get("Content-Length", "0") or 0)
        raw = self.rfile.read(length) if length else b""
        try:
            body = json.loads(raw.decode("utf-8"))
        except json.JSONDecodeError:
            body = {}

        decision = ENGINE.decide(body)
        req_id = f"bench-{ENGINE.session.total_requests}"
        kind = decision["kind"]
        audit(
            "completion",
            kind=kind,
            round=decision.get("round"),
            toolIndex=decision.get("tool_index"),
            stream=bool(body.get("stream")),
            bytes=len(raw),
            **ENGINE.stats(),
        )

        if kind == "tool_json":
            self._send_json(200, decision["payload"])
            return
        if kind == "markdown_json":
            self._send_json(200, decision["payload"])
            return

        # SSE paths
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Cache-Control", "no-cache")
        self.end_headers()

        if kind == "tool_stream":
            self._stream_tool_call(req_id, decision["tool_call"])
        elif kind == "markdown_stream":
            self._stream_markdown(req_id, decision["text"])
        self.wfile.write(b"data: [DONE]\n\n")


def _env_int(*names: str, default: str) -> int:
    for name in names:
        raw = os.environ.get(name)
        if raw is not None and str(raw).strip() != "":
            return int(raw)
    return int(default)


def main() -> int:
    global AUDIT_PATH, ENGINE

    tool_calls_default = str(
        _env_int(
            "BENCHMARK_TOOL_CALLS_PER_ROUND",
            "BENCHMARK_TOOL_CALLS_PER_PROMPT",
            default="15",
        )
    )

    parser = argparse.ArgumentParser(description="OpenAI-compatible mock for peri TUI benchmark")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, required=True)
    parser.add_argument("--audit-file", default="")
    parser.add_argument(
        "--tool-calls-per-round",
        "--tool-calls-per-prompt",
        dest="tool_calls_per_round",
        type=int,
        default=int(tool_calls_default),
    )
    parser.add_argument(
        "--markdown-bytes",
        type=int,
        default=int(os.environ.get("BENCHMARK_MARKDOWN_BYTES", "50000")),
    )
    parser.add_argument(
        "--chunk-bytes",
        type=int,
        default=int(os.environ.get("BENCHMARK_CHUNK_BYTES", "512")),
    )
    parser.add_argument(
        "--delay-ms",
        type=int,
        default=int(os.environ.get("BENCHMARK_DELAY_MS", "0")),
    )
    parser.add_argument(
        "--markdown-every-n-tools",
        type=int,
        default=int(os.environ.get("BENCHMARK_MARKDOWN_EVERY_N_TOOLS", "0")),
    )
    args = parser.parse_args()

    AUDIT_PATH = args.audit_file
    ENGINE = ScenarioEngine(
        ScenarioConfig(
            tool_calls_per_round=args.tool_calls_per_round,
            markdown_bytes=args.markdown_bytes,
            chunk_bytes=args.chunk_bytes,
            delay_ms=args.delay_ms,
            markdown_every_n_tools=args.markdown_every_n_tools,
        )
    )

    if AUDIT_PATH:
        open(AUDIT_PATH, "a", encoding="utf-8").close()

    httpd = ThreadingHTTPServer((args.host, args.port), Handler)
    audit(
        "listening",
        host=args.host,
        port=args.port,
        toolCallsPerRound=args.tool_calls_per_round,
        markdownBytes=args.markdown_bytes,
    )
    print(
        f"[mock-llm] OpenAI /v1 on http://{args.host}:{args.port}/v1 "
        f"(tools/round={args.tool_calls_per_round}, markdown/round={args.markdown_bytes}B)",
        flush=True,
    )
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        httpd.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
