#!/usr/bin/env bash
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
cd "${ROOT}"

version="${1:-$(node -p "require('./package.json').version")}"
version="${version#v}"
out_dir="${ROOT}/dist/release"
archive="${out_dir}/tokenpilot-source-v${version}.tar.gz"
checksum="${archive}.sha256"

mkdir -p "${out_dir}"
git archive --format=tar.gz --prefix="tokenpilot-v${version}/" --output="${archive}" HEAD
shasum -a 256 "${archive}" | tee "${checksum}"
echo "created ${archive}"
