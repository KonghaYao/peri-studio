#!/usr/bin/env bash
# 拉取 Vercel AI Elements 源码到 .tmp/ 供 T2 对齐参考（已 gitignore）。
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TARGET="${ROOT}/.tmp/ai-elements-reference"
REPO="https://github.com/vercel/ai-elements.git"

MIRRORS=(
  "https://ghfast.top/${REPO}"
  "https://mirror.ghproxy.com/${REPO}"
  "${REPO}"
)

rm -rf "${TARGET}"

for url in "${MIRRORS[@]}"; do
  echo "Trying ${url} ..."
  if git clone --depth 1 "${url}" "${TARGET}"; then
    echo "Cloned to ${TARGET}"
    cp "${ROOT}/scripts/ai-elements-reference.README.md" "${TARGET}/README.peri.md"
    exit 0
  fi
done

echo "All mirrors failed." >&2
exit 1
