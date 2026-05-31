#!/usr/bin/env bash
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
cd "${ROOT}"

if [[ -n "$(git status --porcelain --untracked-files=no)" ]]; then
  echo "Working tree has tracked changes. Commit or stash them before release dry-run." >&2
  git status --short --untracked-files=no >&2
  exit 1
fi

tmp_dir="$(mktemp -d)"
cleanup() {
  rm -rf "${tmp_dir}"
}
trap cleanup EXIT

archive="${tmp_dir}/tokenpilot-source.tar.gz"
extract_dir="${tmp_dir}/extract"

git archive --format=tar.gz --output="${archive}" HEAD
mkdir -p "${extract_dir}"
tar -xzf "${archive}" -C "${extract_dir}"

blocked_paths=(
  ".tokenpilot"
  ".codex"
  ".servbay"
  "node_modules"
  "dist"
  "web/dist"
)

for blocked in "${blocked_paths[@]}"; do
  if [[ -e "${extract_dir}/${blocked}" ]]; then
    echo "Release archive contains blocked path: ${blocked}" >&2
    exit 1
  fi
done

if find "${extract_dir}" \( -name ".env" -o -name ".env.*" -o -name "server.env" \) ! -name ".env.example" | grep -q .; then
  echo "Release archive contains non-example env file(s)." >&2
  exit 1
fi

pushd "${extract_dir}" >/dev/null
npm ci
npm audit --audit-level=moderate
npm run build
npm run verify:web:safety
popd >/dev/null

shasum -a 256 "${archive}"
echo "VERIFY_RELEASE_DRY_RUN_OK"
