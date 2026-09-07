#!/bin/sh
# 将当前平台的唯一产品可执行文件复制为可复现的 GitHub Release 资产。
set -eu
umask 077

ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
BIN_DIR="${ROOT}/target/release"
OUT_DIR="${ROOT}/dist"
TARGET="$(rustc -vV | sed -n 's/^host: //p')"
ALLOW_DIRTY=0

usage() {
    printf '%s\n' "usage: package-release-binary.sh [--allow-dirty] [--bin-dir DIR] [--out-dir DIR] [--target TRIPLE]" >&2
}

while [ "$#" -gt 0 ]; do
    case "$1" in
        --bin-dir|--out-dir|--target)
            [ "$#" -ge 2 ] || { usage; exit 2; }
            case "$1" in
                --bin-dir) BIN_DIR="$2" ;;
                --out-dir) OUT_DIR="$2" ;;
                --target) TARGET="$2" ;;
            esac
            shift 2
            ;;
        --allow-dirty) ALLOW_DIRTY=1; shift ;;
        -h|--help) usage; exit 0 ;;
        *) usage; exit 2 ;;
    esac
done

VERSION="$(sed -n '/^\[workspace.package\]/,/^\[/ s/^version = "\([^"]*\)"/\1/p' "${ROOT}/Cargo.toml" | head -1)"
SOURCE_REVISION="$(git -C "$ROOT" rev-parse HEAD 2>/dev/null || printf unknown)"
if [ -n "$(git -C "$ROOT" status --porcelain --untracked-files=normal 2>/dev/null || true)" ] && [ "$ALLOW_DIRTY" -ne 1 ]; then
    printf '%s\n' "refusing to package a dirty source tree (use --allow-dirty only for local diagnostics)" >&2
    exit 1
fi

SOURCE="${BIN_DIR}/peri-studio"
[ -x "$SOURCE" ] || { printf 'missing executable: %s\n' "$SOURCE" >&2; exit 1; }
[ "$($SOURCE --version)" = "peri-studio ${VERSION}" ] || {
    printf '%s\n' "binary version does not match workspace" >&2
    exit 1
}

ASSET="peri-studio-${VERSION}-${TARGET}"
mkdir -p "$OUT_DIR"
TEMP="${OUT_DIR}/.${ASSET}.tmp.$$"
trap 'rm -f "$TEMP"' EXIT HUP INT TERM
cp "$SOURCE" "$TEMP"
chmod 755 "$TEMP"
mv -f "$TEMP" "${OUT_DIR}/${ASSET}"

if command -v sha256sum >/dev/null 2>&1; then
    (cd "$OUT_DIR" && sha256sum "$ASSET") > "${OUT_DIR}/${ASSET}.sha256"
else
    (cd "$OUT_DIR" && shasum -a 256 "$ASSET") > "${OUT_DIR}/${ASSET}.sha256"
fi
printf 'version=%s\ntarget=%s\nsource_revision=%s\n' "$VERSION" "$TARGET" "$SOURCE_REVISION" > "${OUT_DIR}/${ASSET}.metadata"
printf 'release binary ready: %s\n' "${OUT_DIR}/${ASSET}"
