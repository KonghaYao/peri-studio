#!/bin/bash
# Verify checksum, safe membership and executable provenance of one native archive.
set -euo pipefail
umask 077

EXECUTE_BINARIES=1
REQUIRE_CLEAN=0
EXPECTED_REVISION=""
ARCHIVE=""
usage() {
    echo "usage: $0 [--no-exec] [--require-clean] [--expected-revision SHA] <peri-studio-*.tar.gz>" >&2
}

while [ "$#" -gt 0 ]; do
    case "$1" in
        --no-exec) EXECUTE_BINARIES=0; shift ;;
        --require-clean) REQUIRE_CLEAN=1; shift ;;
        --expected-revision)
            [ "$#" -ge 2 ] || { usage; exit 2; }
            EXPECTED_REVISION="$2"
            shift 2
            ;;
        -*) usage; exit 2 ;;
        *)
            [ -z "${ARCHIVE}" ] || { usage; exit 2; }
            ARCHIVE="$1"
            shift
            ;;
    esac
done
if [ -z "${ARCHIVE}" ] || ! [ -f "${ARCHIVE}" ]; then
    usage
    exit 2
fi
CHECKSUM="${ARCHIVE}.sha256"
if ! [ -f "${CHECKSUM}" ]; then
    echo "missing checksum: ${CHECKSUM}" >&2
    exit 1
fi

EXPECTED="$(awk 'NR == 1 { print $1 }' "${CHECKSUM}")"
if command -v sha256sum >/dev/null 2>&1; then
    ACTUAL="$(sha256sum "${ARCHIVE}" | awk '{ print $1 }')"
else
    ACTUAL="$(shasum -a 256 "${ARCHIVE}" | awk '{ print $1 }')"
fi
if [ -z "${EXPECTED}" ] || [ "${EXPECTED}" != "${ACTUAL}" ]; then
    echo "release checksum mismatch" >&2
    exit 1
fi

WORK="$(mktemp -d "${TMPDIR:-/tmp}/peri-studio-verify-release.XXXXXX")"
trap 'rm -rf "${WORK}"' EXIT
MEMBERS="${WORK}/members.txt"
tar -tzf "${ARCHIVE}" > "${MEMBERS}"
if LC_ALL=C sort "${MEMBERS}" | uniq -d | grep -q .; then
    echo "release archive contains duplicate members" >&2
    exit 1
fi
if awk '/^\// || /(^|\/)\.\.($|\/)/ { bad=1 } END { exit bad ? 0 : 1 }' "${MEMBERS}"; then
    echo "release archive contains an absolute or traversal path" >&2
    exit 1
fi
if tar -tvzf "${ARCHIVE}" | awk 'substr($0, 1, 1) != "-" { bad=1 } END { exit bad ? 0 : 1 }'; then
    echo "release archive contains a non-regular member" >&2
    exit 1
fi

ROOT_NAME="$(awk -F/ 'NF { print $1 }' "${MEMBERS}" | LC_ALL=C sort -u)"
if [ -z "${ROOT_NAME}" ] || [ "$(printf '%s\n' "${ROOT_NAME}" | wc -l | tr -d ' ')" != "1" ]; then
    echo "release archive must contain exactly one root directory" >&2
    exit 1
fi
for required in \
    "${ROOT_NAME}/VERSION" \
    "${ROOT_NAME}/BUILD-METADATA" \
    "${ROOT_NAME}/LICENSE" \
    "${ROOT_NAME}/README.md" \
    "${ROOT_NAME}/SECURITY.md" \
    "${ROOT_NAME}/deny.toml" \
    "${ROOT_NAME}/Cargo.lock" \
    "${ROOT_NAME}/web/bun.lock" \
    "${ROOT_NAME}/docs/architecture.md" \
    "${ROOT_NAME}/docs/terminology.md" \
    "${ROOT_NAME}/bin/peri-studio-server" \
    "${ROOT_NAME}/bin/peri-instance" \
    "${ROOT_NAME}/deploy/provision-instance-token.sh" \
    "${ROOT_NAME}/deploy/systemd/peri-studio-server.service" \
    "${ROOT_NAME}/deploy/systemd/peri-instance.service" \
    "${ROOT_NAME}/deploy/launchd/com.perihelion.peri-studio.plist" \
    "${ROOT_NAME}/deploy/launchd/com.perihelion.peri-instance.plist"; do
    if ! grep -Fqx "${required}" "${MEMBERS}"; then
        echo "release archive is missing ${required}" >&2
        exit 1
    fi
done
if grep -E '(^|/)(test-child|tokens\.toml|instance\.token|metadata\.sqlite3)($|/)' "${MEMBERS}" >/dev/null; then
    echo "release archive contains a test binary, credential or runtime data" >&2
    exit 1
fi

tar -xzf "${ARCHIVE}" -C "${WORK}/"
ROOT="${WORK}/${ROOT_NAME}"
if find "${ROOT}" -type l -print -quit | grep -q .; then
    echo "release archive contains a symbolic link" >&2
    exit 1
fi
VERSION="$(cat "${ROOT}/VERSION")"
case "${ROOT_NAME}" in
    "peri-studio-${VERSION}-"*) ;;
    *) echo "archive root does not match packaged version" >&2; exit 1 ;;
esac
if ! grep -Fqx "version=${VERSION}" "${ROOT}/BUILD-METADATA"; then
    echo "build metadata version mismatch" >&2
    exit 1
fi
if ! grep -Fqx "target=${ROOT_NAME#peri-studio-${VERSION}-}" "${ROOT}/BUILD-METADATA"; then
    echo "build metadata target mismatch" >&2
    exit 1
fi
if ! grep -Eq '^source_revision=([0-9a-f]{40}|unknown)$' "${ROOT}/BUILD-METADATA"; then
    echo "build metadata source revision is invalid" >&2
    exit 1
fi
if ! grep -Eq '^source_dirty=(true|false)$' "${ROOT}/BUILD-METADATA"; then
    echo "build metadata dirty marker is invalid" >&2
    exit 1
fi
if [ -n "${EXPECTED_REVISION}" ] &&
   ! grep -Fqx "source_revision=${EXPECTED_REVISION}" "${ROOT}/BUILD-METADATA"; then
    echo "build metadata source revision does not match the release commit" >&2
    exit 1
fi
if [ "${REQUIRE_CLEAN}" -eq 1 ] &&
   ! grep -Fqx 'source_dirty=false' "${ROOT}/BUILD-METADATA"; then
    echo "release artifact was built from a dirty source tree" >&2
    exit 1
fi
if [ "${EXECUTE_BINARIES}" -eq 1 ]; then
    if [ "$("${ROOT}/bin/peri-studio-server" --version)" != "peri-studio-server ${VERSION}" ]; then
        echo "packaged server version mismatch" >&2
        exit 1
    fi
    if [ "$("${ROOT}/bin/peri-instance" --version)" != "peri-instance ${VERSION}" ]; then
        echo "packaged instance version mismatch" >&2
        exit 1
    fi
fi
bash -n "${ROOT}/deploy/provision-instance-token.sh"
echo "release archive verified: ${ARCHIVE}"
