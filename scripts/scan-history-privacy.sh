#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "${ROOT_DIR}"

home_path_pattern="/""Users/"

patterns=(
  "${home_path_pattern}"
  "/Applications/[A-Za-z0-9._ -]+"
  "192\\.168\\."
)

labels=(
  "local home absolute path"
  "local applications absolute path"
  "private IPv4 literal"
)

if [[ -n "${USER:-}" ]]; then
  patterns+=("$(printf '%s' "${USER}" | sed -e 's/[][(){}.^$*+?|\\]/\\&/g')")
  labels+=("local machine username")
fi

if [[ -n "${TOKENPILOT_HISTORY_PRIVATE_PATTERNS:-}" ]]; then
  while IFS= read -r pattern; do
    [[ -z "${pattern}" ]] && continue
    patterns+=("${pattern}")
    labels+=("operator-supplied private pattern")
  done <<< "${TOKENPILOT_HISTORY_PRIVATE_PATTERNS}"
fi

exclude_pathspecs=(
  ":(exclude)package-lock.json"
  ":(exclude)scripts/verify-web-safety.ts"
  ":(exclude)scripts/scan-history-privacy.sh"
)

tmpfile="$(mktemp)"
reportfile="$(mktemp)"
trap 'rm -f "${tmpfile}" "${reportfile}"' EXIT

report_path() {
  local label="$1"
  local rev="$2"
  local file="$3"
  printf '%s %s %s\n' "${label}" "${rev:0:12}" "${file}" >> "${reportfile}"
}

scan_tokenpilot_hosts() {
  local rev="$1"
  if git grep -I -n -E "(https?://|Host:[[:space:]]*)tokenpilot\\.[[:alnum:].-]+\\.[[:alpha:]]{2,}" "${rev}" -- . "${exclude_pathspecs[@]}" > "${tmpfile}"; then
    while IFS= read -r match; do
      [[ -z "${match}" ]] && continue
      [[ "${match}" == *"tokenpilot.example.com"* ]] && continue
      rest="${match#*:}"
      file="${rest%%:*}"
      report_path "non-placeholder TokenPilot deployment host" "${rev}" "${file}"
    done < "${tmpfile}"
  fi
}

while IFS= read -r rev; do
  scan_tokenpilot_hosts "${rev}"

  for i in "${!patterns[@]}"; do
    if git grep -I -E -l "${patterns[$i]}" "${rev}" -- . "${exclude_pathspecs[@]}" > "${tmpfile}"; then
      while IFS= read -r match; do
        [[ -z "${match}" ]] && continue
        file="${match#*:}"
        report_path "${labels[$i]}" "${rev}" "${file}"
      done < "${tmpfile}"
    fi
  done
done < <(git rev-list --all)

sort -u "${reportfile}"
findings="$(sort -u "${reportfile}" | wc -l | tr -d '[:space:]')"

if (( findings > 0 )); then
  printf 'HISTORY_PRIVACY_SCAN_FAILED findings=%s\n' "${findings}" >&2
  printf 'Rewrite Git history before treating old commits as public-safe.\n' >&2
  exit 1
fi

printf 'HISTORY_PRIVACY_SCAN_OK\n'
