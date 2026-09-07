#!/bin/sh
# 校验 GitHub Release 单一二进制、摘要和源码元数据。
set -eu

REQUIRE_CLEAN=0
EXPECTED_REVISION=""
ASSET=""
usage() {
    printf '%s\n' "usage: verify-release-binary.sh [--require-clean] [--expected-revision SHA] <asset>" >&2
}
while [ "$#" -gt 0 ]; do
    case "$1" in
        --require-clean) REQUIRE_CLEAN=1; shift ;;
        --expected-revision)
            [ "$#" -ge 2 ] || { usage; exit 2; }
            EXPECTED_REVISION="$2"
            shift 2
            ;;
        -*) usage; exit 2 ;;
        *) [ -z "$ASSET" ] || { usage; exit 2; }; ASSET="$1"; shift ;;
    esac
done
[ -n "$ASSET" ] && [ -f "$ASSET" ] || { usage; exit 2; }

CHECKSUM="${ASSET}.sha256"
METADATA="${ASSET}.metadata"
[ -f "$CHECKSUM" ] || { printf 'missing checksum: %s\n' "$CHECKSUM" >&2; exit 1; }
[ -f "$METADATA" ] || { printf 'missing metadata: %s\n' "$METADATA" >&2; exit 1; }
EXPECTED="$(awk 'NR == 1 { print $1 }' "$CHECKSUM")"
if command -v sha256sum >/dev/null 2>&1; then
    ACTUAL="$(sha256sum "$ASSET" | awk '{ print $1 }')"
else
    ACTUAL="$(shasum -a 256 "$ASSET" | awk '{ print $1 }')"
fi
[ -n "$EXPECTED" ] && [ "$EXPECTED" = "$ACTUAL" ] || {
    printf '%s\n' "release checksum mismatch" >&2
    exit 1
}
VERSION="$($ASSET --version)"
case "$VERSION" in peri-studio\ *) ;; *) printf '%s\n' "invalid binary version output" >&2; exit 1 ;; esac
if [ -n "$EXPECTED_REVISION" ]; then
    grep -Fqx "source_revision=${EXPECTED_REVISION}" "$METADATA" || {
        printf '%s\n' "source revision mismatch" >&2
        exit 1
    }
fi
if [ "$REQUIRE_CLEAN" -eq 1 ] && [ -n "$(git status --porcelain --untracked-files=normal)" ]; then
    printf '%s\n' "source tree is dirty" >&2
    exit 1
fi
printf 'release binary verified: %s\n' "$ASSET"
