#!/usr/bin/env python3
"""将 ui-sandbox 中遗留的 Tailwind ×4 间距刻度换算为 @peri/ui 像素刻度（utility N → N×4）。"""

from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SANDBOX_SRC = ROOT / "ui-sandbox" / "src"

SKIP_FILES = {
    SANDBOX_SRC / "shell" / "SandboxShell.tsx",
    SANDBOX_SRC / "pages" / "shared" / "DemoSection.tsx",
    SANDBOX_SRC / "lib" / "catalog-ui.tsx",
}

PREFIXES = (
    "gap",
    "p",
    "px",
    "py",
    "pt",
    "pb",
    "pl",
    "pr",
    "m",
    "mx",
    "my",
    "mt",
    "mb",
    "ml",
    "mr",
    "w",
    "h",
    "min-w",
    "min-h",
    "max-h",
    "size",
    "space-x",
    "space-y",
    "inset-x",
    "top",
    "right",
    "bottom",
    "left",
)

PATTERN = re.compile(
    r"\b(" + "|".join(PREFIXES) + r")-(\d+(?:\.\d+)?)(?!/)\b"
)


def convert_value(raw: str) -> str:
    value = float(raw)
    scaled = value * 4
    if scaled.is_integer():
        return str(int(scaled))
    return str(scaled).rstrip("0").rstrip(".")


def convert_text(text: str) -> str:
    def repl(match: re.Match[str]) -> str:
        prefix, number = match.group(1), match.group(2)
        return f"{prefix}-{convert_value(number)}"

    return PATTERN.sub(repl, text)


def main() -> int:
    targets = [
        SANDBOX_SRC / "pages" / "TokensPage.tsx",
        SANDBOX_SRC / "pages" / "BlocksPage.tsx",
        SANDBOX_SRC / "components",
        SANDBOX_SRC / "layers",
    ]

    changed = 0
    for target in targets:
        paths = [target] if target.is_file() else sorted(target.rglob("*.tsx"))
        for path in paths:
            if path in SKIP_FILES:
                continue
            original = path.read_text(encoding="utf-8")
            updated = convert_text(original)
            if updated != original:
                path.write_text(updated, encoding="utf-8")
                changed += 1
                print(path.relative_to(ROOT))

    print(f"updated {changed} files")
    return 0


if __name__ == "__main__":
    sys.exit(main())
