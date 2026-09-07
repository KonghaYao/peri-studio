#!/bin/bash
set -euo pipefail
export LC_ALL=C

# Peri Studio installer. It follows Peri's ~/.peri versioned layout while using
# Studio-specific names so the two products can coexist.
#
# Usage: curl -fsSL https://raw.githubusercontent.com/KonghaYao/peri-studio/main/scripts/install.sh | bash
# Options:
#   PERI_STUDIO_INSTALL_VERSION  Version or tag (0.2.0 / peri-studio-v0.2.0), empty = latest
#   PERI_STUDIO_INSTALL_DIR      Install directory (default: $HOME/.peri)
#   GITHUB_PROXY                 GitHub download proxy prefix
#   GITHUB_TOKEN                 GitHub token for API rate limits
#   PERI_STUDIO_NO_PATH_HINT     Set to 1 to skip PATH setup

REPOSITORY="KonghaYao/peri-studio"
INSTALL_DIR="${PERI_STUDIO_INSTALL_DIR:-${HOME}/.peri}"
GITHUB_API="https://api.github.com/repos/${REPOSITORY}"

fail() { printf '[ERROR] %s\n' "$*" >&2; exit 1; }
info() { printf '[INFO] %s\n' "$*"; }

case "$(uname -s):$(uname -m)" in
    Linux:x86_64|Linux:amd64) TARGET="x86_64-unknown-linux-gnu" ;;
    Darwin:arm64|Darwin:aarch64) TARGET="aarch64-apple-darwin" ;;
    *) fail "Unsupported platform: $(uname -s) $(uname -m)" ;;
esac
command -v curl >/dev/null 2>&1 || fail "curl is required"

AUTH_ARGS=()
if [[ -n "${GITHUB_TOKEN:-}" ]]; then
    AUTH_ARGS=(-H "Authorization: Bearer ${GITHUB_TOKEN}")
fi
github_api() {
    curl -fsSL "${AUTH_ARGS[@]}" "$1"
}

REQUESTED="${PERI_STUDIO_INSTALL_VERSION:-}"
if [[ -n "$REQUESTED" ]]; then
    case "$REQUESTED" in
        peri-studio-v*) TAG="$REQUESTED" ;;
        *[!0-9A-Za-z.+-]*|'') fail "Invalid version: $REQUESTED" ;;
        *) TAG="peri-studio-v${REQUESTED}" ;;
    esac
    RELEASE_JSON="$(github_api "${GITHUB_API}/releases/tags/${TAG}")" || fail "Release not found: ${TAG}"
else
    RELEASES_JSON="$(github_api "${GITHUB_API}/releases?per_page=30")" || fail "Unable to fetch releases"
    TAG="$(printf '%s' "$RELEASES_JSON" | tr ',' '\n' | grep -F '"tag_name"' | grep -F '"peri-studio-v' | head -1 | cut -d'"' -f4)"
    [[ "$TAG" == peri-studio-v* ]] || fail "No Peri Studio release found"
    RELEASE_JSON="$(github_api "${GITHUB_API}/releases/tags/${TAG}")" || fail "Unable to fetch release ${TAG}"
fi
VERSION="${TAG#peri-studio-v}"
ASSET="peri-studio-${VERSION}-${TARGET}"
BASE_URL="https://github.com/${REPOSITORY}/releases/download/${TAG}"
if [[ -n "${GITHUB_PROXY:-}" ]]; then
    BASE_URL="${GITHUB_PROXY%/}/${BASE_URL}"
fi

VERSION_DIR="${INSTALL_DIR}/${TAG}"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/peri-studio-install.XXXXXX")"
trap 'rm -rf "$WORK"' EXIT HUP INT TERM
info "Downloading ${ASSET}"
curl -fSL --retry 3 --progress-bar "${BASE_URL}/${ASSET}" -o "${WORK}/${ASSET}"
curl -fsSL --retry 3 "${BASE_URL}/${ASSET}.sha256" -o "${WORK}/${ASSET}.sha256"
EXPECTED="$(awk 'NR == 1 { print $1 }' "${WORK}/${ASSET}.sha256")"
if command -v sha256sum >/dev/null 2>&1; then
    ACTUAL="$(sha256sum "${WORK}/${ASSET}" | awk '{ print $1 }')"
else
    ACTUAL="$(shasum -a 256 "${WORK}/${ASSET}" | awk '{ print $1 }')"
fi
[[ -n "$EXPECTED" && "$EXPECTED" == "$ACTUAL" ]] || fail "Release checksum mismatch"

mkdir -p "$VERSION_DIR"
TARGET_PATH="${VERSION_DIR}/peri-studio"
TEMP_PATH="${VERSION_DIR}/.peri-studio.install.$$"
cp "${WORK}/${ASSET}" "$TEMP_PATH"
chmod 755 "$TEMP_PATH"
mv -f "$TEMP_PATH" "$TARGET_PATH"
ln -sfn "$TARGET_PATH" "${INSTALL_DIR}/peri-studio"
printf '%s\n' "$TAG" > "${INSTALL_DIR}/peri-studio-current-version.txt"

if [[ "${PERI_STUDIO_NO_PATH_HINT:-}" != "1" ]]; then
    PROFILE=""
    case "${SHELL:-}" in
        */zsh) PROFILE="${HOME}/.zshrc" ;;
        */bash) PROFILE="${HOME}/.bashrc" ;;
        */fish) PROFILE="${HOME}/.config/fish/config.fish" ;;
    esac
    if [[ -n "$PROFILE" ]]; then
        mkdir -p "$(dirname "$PROFILE")"
        if ! grep -Fq "$INSTALL_DIR" "$PROFILE" 2>/dev/null; then
            if [[ "${SHELL:-}" == */fish ]]; then
                printf 'set -gx PATH "%s" $PATH\n' "$INSTALL_DIR" >> "$PROFILE"
            else
                printf 'export PATH="%s:$PATH"\n' "$INSTALL_DIR" >> "$PROFILE"
            fi
            info "Added ${INSTALL_DIR} to PATH in ${PROFILE}"
        fi
    else
        info "Add ${INSTALL_DIR} to PATH manually"
    fi
fi
export PATH="${INSTALL_DIR}:${PATH}"
"${INSTALL_DIR}/peri-studio" --version
info "Installed to ${TARGET_PATH}"
info "Run: peri-studio"
