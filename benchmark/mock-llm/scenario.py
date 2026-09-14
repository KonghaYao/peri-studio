"""OpenAI chat/completions 剧本：每轮 user → 若干 Bash/Read tool → 流式 markdown response，重复 n 轮。"""

from __future__ import annotations

import json
import threading
import uuid
from dataclasses import dataclass, field
from typing import Any

# peri 工具名（OpenAI function calling）
BASH = "Bash"
READ = "Read"

# 工作区内预置、只读的小文件（相对 cwd）
READ_TARGETS = ("notes.txt", "data/sample.md", "data/readme.txt")

# 无害 bash 命令（仅在工作区 cwd 内）
BASH_COMMANDS = (
    "echo benchmark-ok round={round} tool={tool_index}",
    "pwd",
    "ls -la",
    "echo phase={round} step={tool_index}",
)


@dataclass
class ScenarioConfig:
    tool_calls_per_round: int = 15
    markdown_bytes: int = 50_000
    chunk_bytes: int = 512
    delay_ms: int = 0
    markdown_every_n_tools: int = 0  # 0 = 仅在每轮 tool 结束后流式 markdown


@dataclass
class SessionState:
    user_rounds_seen: int = 0
    tool_calls_in_round: int = 0
    markdown_rounds_done: int = 0
    total_tool_calls: int = 0
    total_markdown_bytes: int = 0
    total_requests: int = 0


@dataclass
class ScenarioEngine:
    config: ScenarioConfig
    lock: threading.Lock = field(default_factory=threading.Lock)
    session: SessionState = field(default_factory=SessionState)

    def decide(self, body: dict[str, Any]) -> dict[str, Any]:
        messages = body.get("messages") or []
        wants_stream = bool(body.get("stream"))

        with self.lock:
            self.session.total_requests += 1
            user_count = sum(1 for m in messages if m.get("role") == "user")
            last_role = messages[-1].get("role") if messages else None

            if user_count > self.session.user_rounds_seen:
                self.session.user_rounds_seen = user_count
                self.session.tool_calls_in_round = 0

            if last_role == "user":
                return self._tool_response(
                    tool_index=self.session.tool_calls_in_round,
                    round_num=user_count,
                    stream=wants_stream,
                )

            if last_role == "tool":
                self.session.tool_calls_in_round += 1
                self.session.total_tool_calls += 1

                if self._should_stream_markdown_mid_loop():
                    self.session.markdown_rounds_done += 1
                    return self._markdown_response(
                        label=f"mid-r{user_count}",
                        round_num=user_count,
                        stream=True,
                    )

                if self.session.tool_calls_in_round < self.config.tool_calls_per_round:
                    return self._tool_response(
                        tool_index=self.session.tool_calls_in_round,
                        round_num=user_count,
                        stream=wants_stream,
                    )

                # 本轮 tool 结束 → 流式 markdown → stop，等待下一轮 user
                self.session.markdown_rounds_done += 1
                return self._markdown_response(
                    label=f"end-r{user_count}",
                    round_num=user_count,
                    stream=wants_stream or True,
                )

            if last_role == "assistant":
                if self.session.tool_calls_in_round < self.config.tool_calls_per_round:
                    return self._tool_response(
                        tool_index=self.session.tool_calls_in_round,
                        round_num=user_count,
                        stream=wants_stream,
                    )
                return self._text_response(
                    f"Benchmark round {user_count} complete.",
                    round_num=user_count,
                    stream=wants_stream,
                )

            return self._text_response("benchmark-idle", round_num=0, stream=wants_stream)

    def _should_stream_markdown_mid_loop(self) -> bool:
        n = self.config.markdown_every_n_tools
        if n <= 0:
            return False
        return (
            self.session.tool_calls_in_round > 0
            and self.session.tool_calls_in_round % n == 0
        )

    def _tool_response(
        self, *, tool_index: int, round_num: int, stream: bool
    ) -> dict[str, Any]:
        if tool_index % 2 == 0:
            cmd = BASH_COMMANDS[tool_index % len(BASH_COMMANDS)].format(
                round=round_num, tool_index=tool_index
            )
            name = BASH
            arguments = {"command": cmd}
        else:
            path = READ_TARGETS[tool_index % len(READ_TARGETS)]
            name = READ
            arguments = {"file_path": path}

        call_id = f"call_{uuid.uuid4().hex[:12]}"
        tool_call = {
            "id": call_id,
            "type": "function",
            "function": {
                "name": name,
                "arguments": json.dumps(arguments, ensure_ascii=False),
            },
        }

        if stream:
            return {
                "kind": "tool_stream",
                "round": round_num,
                "tool_index": tool_index,
                "call_id": call_id,
                "tool_call": tool_call,
            }

        return {
            "kind": "tool_json",
            "round": round_num,
            "tool_index": tool_index,
            "payload": {
                "id": f"bench-{self.session.total_requests}",
                "object": "chat.completion",
                "choices": [
                    {
                        "index": 0,
                        "message": {
                            "role": "assistant",
                            "content": None,
                            "tool_calls": [tool_call],
                        },
                        "finish_reason": "tool_calls",
                    }
                ],
            },
        }

    def _build_markdown(self, label: str, round_num: int) -> str:
        size = max(0, self.config.markdown_bytes)
        header = (
            f"# Benchmark response — round {round_num} ({label})\n\n"
            f"> Streaming render stress: headings, lists, code, tables, quotes\n\n"
            "---\n\n"
        )
        section = (
            "## Section {n}\n\n"
            "### Highlights\n\n"
            "1. Ordered item **alpha** for round {round}\n"
            "2. Ordered item *beta* with `inline code`\n\n"
            "- bullet one\n"
            "- bullet two\n\n"
            "> Blockquote line {n}: peri TUI should render this.\n\n"
            "```python\n"
            "def demo_round_{round}(step: int) -> int:\n"
            "    return step + {n}\n"
            "```\n\n"
            "```bash\n"
            "echo \"fence bash block {n}\"\n"
            "```\n\n"
            "| col | val | note |\n"
            "|-----|-----|------|\n"
            "| {n} | ok | round {round} |\n"
            "| tool | Bash/Read | visible |\n\n"
            "**Bold** and _italic_ and ~~strike~~ text.\n\n"
            "---\n\n"
        )
        parts = [header]
        n = 0
        while sum(len(p) for p in parts) < size:
            parts.append(section.format(n=n, round=round_num))
            n += 1
        text = "".join(parts)
        if len(text) > size:
            text = text[:size]
        self.session.total_markdown_bytes += len(text.encode("utf-8"))
        return text

    def _markdown_response(
        self, *, label: str, round_num: int, stream: bool
    ) -> dict[str, Any]:
        text = self._build_markdown(label, round_num)
        if stream:
            return {"kind": "markdown_stream", "round": round_num, "text": text}

        return {
            "kind": "markdown_json",
            "round": round_num,
            "payload": {
                "id": f"bench-md-{self.session.total_requests}",
                "object": "chat.completion",
                "choices": [
                    {
                        "index": 0,
                        "message": {"role": "assistant", "content": text},
                        "finish_reason": "stop",
                    }
                ],
            },
        }

    def _text_response(
        self, text: str, *, round_num: int, stream: bool
    ) -> dict[str, Any]:
        if stream:
            return {"kind": "markdown_stream", "round": round_num, "text": text}
        return {
            "kind": "markdown_json",
            "round": round_num,
            "payload": {
                "id": f"bench-txt-{self.session.total_requests}",
                "object": "chat.completion",
                "choices": [
                    {
                        "index": 0,
                        "message": {"role": "assistant", "content": text},
                        "finish_reason": "stop",
                    }
                ],
            },
        }

    def stats(self) -> dict[str, Any]:
        with self.lock:
            s = self.session
            return {
                "userRoundsSeen": s.user_rounds_seen,
                "totalToolCalls": s.total_tool_calls,
                "totalMarkdownBytes": s.total_markdown_bytes,
                "totalRequests": s.total_requests,
                "markdownRoundsDone": s.markdown_rounds_done,
            }


def chunk_text(text: str, size: int) -> list[str]:
    if size <= 0:
        return [text]
    return [text[i : i + size] for i in range(0, len(text), size)] or [""]
