#!/bin/bash
# Build a deterministic native Unix release archive from already-built binaries.
set -euo pipefail
umask 077

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BIN_DIR="${ROOT}/target/release"
OUT_DIR="${ROOT}/dist"
TARGET="$(rustc -vV | sed -n 's/^host: //p')"

usage() {
    echo "usage: $0 [--bin-dir DIR] [--out-dir DIR] [--target TRIPLE]" >&2
}

while [ "$#" -gt 0 ]; do
    case "$1" in
        --bin-dir) BIN_DIR="$2"; shift 2 ;;
        --out-dir) OUT_DIR="$2"; shift 2 ;;
        --target) TARGET="$2"; shift 2 ;;
        -h|--help) usage; exit 0 ;;
        *) usage; exit 2 ;;
    esac
done

VERSION="$(sed -n '/^\[workspace.package\]/,/^\[/ s/^version = "\([^"]*\)"/\1/p' "${ROOT}/Cargo.toml" | head -1)"
if [ -z "${VERSION}" ] || [ -z "${TARGET}" ]; then
    echo "unable to resolve release version or target" >&2
    exit 1
fi

SERVER_BIN="${BIN_DIR}/peri-studio-server"
INSTANCE_BIN="${BIN_DIR}/peri-instance"
for binary in "${SERVER_BIN}" "${INSTANCE_BIN}"; do
    if ! [ -x "${binary}" ]; then
        echo "missing executable release binary: ${binary}" >&2
        exit 1
    fi
done
if ! [ -f "${ROOT}/web/dist/index.html" ]; then
    echo "web/dist is missing; build and test the Web client before Rust release binaries" >&2
    exit 1
fi

if [ "$("${SERVER_BIN}" --version)" != "peri-studio-server ${VERSION}" ]; then
    echo "server binary version does not match workspace ${VERSION}" >&2
    exit 1
fi
if [ "$("${INSTANCE_BIN}" --version)" != "peri-instance ${VERSION}" ]; then
    echo "instance binary version does not match workspace ${VERSION}" >&2
    exit 1
fi

# Capture source provenance before creating caller-selected output directories.
# Otherwise a second reproducibility pass such as `--out-dir dist-repeat` can
# make its own untracked directory change source_dirty and therefore the bytes.
SOURCE_REVISION="$(git -C "${ROOT}/.." rev-parse HEAD 2>/dev/null || printf unknown)"
if [ -n "$(git -C "${ROOT}/.." status --porcelain --untracked-files=normal 2>/dev/null || true)" ]; then
    SOURCE_DIRTY=true
else
    SOURCE_DIRTY=false
fi

PACKAGE="peri-studio-${VERSION}-${TARGET}"
mkdir -p "${OUT_DIR}"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/peri-studio-package.XXXXXX")"
trap 'rm -rf "${WORK}"' EXIT
STAGE="${WORK}/${PACKAGE}"
mkdir -p "${STAGE}/bin" "${STAGE}/deploy" "${STAGE}/docs/design" "${STAGE}/web"

cp "${SERVER_BIN}" "${STAGE}/bin/peri-studio-server"
cp "${INSTANCE_BIN}" "${STAGE}/bin/peri-instance"
cp "${ROOT}/../LICENSE" "${STAGE}/LICENSE"
cp "${ROOT}/README.md" "${STAGE}/README.md"
cp "${ROOT}/SECURITY.md" "${STAGE}/SECURITY.md"
cp "${ROOT}/deny.toml" "${STAGE}/deny.toml"
cp "${ROOT}/Cargo.lock" "${STAGE}/Cargo.lock"
cp "${ROOT}/web/bun.lock" "${STAGE}/web/bun.lock"
cp -R "${ROOT}/deploy/." "${STAGE}/deploy/"
cp "${ROOT}/docs/architecture.md" "${STAGE}/docs/architecture.md"
cp "${ROOT}/docs/terminology.md" "${STAGE}/docs/terminology.md"
cp "${ROOT}/docs/design/prompt-recovery-provenance.md" "${STAGE}/docs/design/"
printf '%s\n' "${VERSION}" > "${STAGE}/VERSION"
cat > "${STAGE}/BUILD-METADATA" <<EOF
version=${VERSION}
target=${TARGET}
source_revision=${SOURCE_REVISION}
source_dirty=${SOURCE_DIRTY}
EOF

chmod 755 "${STAGE}/bin/peri-studio-server" "${STAGE}/bin/peri-instance"
chmod 755 "${STAGE}/deploy/provision-instance-token.sh"
find "${STAGE}" -type f ! -perm -0100 -exec chmod 644 {} +
find "${STAGE}" -exec touch -t 198001010000 {} +

LIST="${WORK}/members.txt"
(cd "${WORK}" && find "${PACKAGE}" -type f -print | LC_ALL=C sort) > "${LIST}"
TAR="${WORK}/${PACKAGE}.tar"
if tar --version 2>/dev/null | grep -q 'GNU tar'; then
    tar -c --format=ustar --owner=0 --group=0 --numeric-owner \
        -f "${TAR}" -C "${WORK}" -T "${LIST}"
else
    COPYFILE_DISABLE=1 tar -c --format=ustar --uid 0 --gid 0 --numeric-owner \
        -f "${TAR}" -C "${WORK}" -T "${LIST}"
fi
ARCHIVE="${OUT_DIR}/${PACKAGE}.tar.gz"
gzip -n -9 -c "${TAR}" > "${ARCHIVE}"

if command -v sha256sum >/dev/null 2>&1; then
    (cd "${OUT_DIR}" && sha256sum "${PACKAGE}.tar.gz") > "${ARCHIVE}.sha256"
else
    (cd "${OUT_DIR}" && shasum -a 256 "${PACKAGE}.tar.gz") > "${ARCHIVE}.sha256"
fi

"${ROOT}/scripts/verify-release.sh" "${ARCHIVE}"
echo "release archive ready: ${ARCHIVE}"
