#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "${ROOT_DIR}"

git_bin="$(command -v git)"
if [[ "$(uname -s)" == "Darwin" && -x "/Library/Developer/CommandLineTools/usr/bin/git" ]]; then
  git_bin="/Library/Developer/CommandLineTools/usr/bin/git"
fi
export GIT_CONFIG_GLOBAL=/dev/null
export GIT_CONFIG_NOSYSTEM=1
export GIT_NO_REPLACE_OBJECTS=1

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

if [[ -n "${USER:-}" && ! "${USER}" =~ ^(runner|root|node|ubuntu|actions)$ ]]; then
  patterns+=("$(printf '%s' "${USER}" | sed -e 's/[][(){}.^$*+?|\\]/\\&/g')")
  labels+=("local machine username")
fi

history_private_patterns="${CHATCOCKPIT_HISTORY_PRIVATE_PATTERNS:-${TOKENPILOT_HISTORY_PRIVATE_PATTERNS:-}}"
if [[ -n "${history_private_patterns}" ]]; then
  while IFS= read -r pattern; do
    [[ -z "${pattern}" ]] && continue
    patterns+=("${pattern}")
    labels+=("operator-supplied private pattern")
  done <<< "${history_private_patterns}"
fi

exclude_pathspecs=(
  ":(exclude)package-lock.json"
  ":(exclude)scripts/verify-web-safety.ts"
  ":(exclude)scripts/scan-history-privacy.sh"
)

tmp_root="${TMPDIR:-${TMP:-${TEMP:-/tmp}}}"
tmpfile="$(mktemp "${tmp_root%/}/chatcockpit-history-privacy.XXXXXX")"
reportfile="$(mktemp "${tmp_root%/}/chatcockpit-history-privacy-report.XXXXXX")"
revisionsfile="$(mktemp "${tmp_root%/}/chatcockpit-history-privacy-revisions.XXXXXX")"
trap 'rm -f "${tmpfile}" "${reportfile}" "${revisionsfile}"' EXIT

"${git_bin}" rev-list --all > "${revisionsfile}"

report_path() {
  local label="$1"
  local rev="$2"
  local file="$3"
  printf '%s %s %s\n' "${label}" "${rev:0:12}" "${file}" >> "${reportfile}"
}

scan_product_hosts() {
  local rev="$1"
  if "${git_bin}" grep -I -n -E "(https?://|Host:[[:space:]]*)(chatcockpit|tokenpilot)\\.[[:alnum:].-]+\\.[[:alpha:]]{2,}" "${rev}" -- . "${exclude_pathspecs[@]}" > "${tmpfile}"; then
    while IFS= read -r match; do
      [[ -z "${match}" ]] && continue
      [[ "${match}" == *"chatcockpit.example.com"* ]] && continue
      [[ "${match}" == *"tokenpilot.example.com"* ]] && continue
      [[ "${match}" == *".example.invalid"* ]] && continue
      rest="${match#*:}"
      file="${rest%%:*}"
      report_path "non-placeholder ChatCockpit/legacy deployment host" "${rev}" "${file}"
    done < "${tmpfile}"
  else
    status=$?
    if (( status != 1 )); then
      printf 'HISTORY_PRIVACY_SCAN_ERROR git grep failed status=%s rev=%s\n' "${status}" "${rev:0:12}" >&2
      return "${status}"
    fi
  fi
}

while IFS= read -r rev; do
  scan_product_hosts "${rev}"

  for i in "${!patterns[@]}"; do
    if "${git_bin}" grep -I -E -l "${patterns[$i]}" "${rev}" -- . "${exclude_pathspecs[@]}" > "${tmpfile}"; then
      while IFS= read -r match; do
        [[ -z "${match}" ]] && continue
        file="${match#*:}"
        report_path "${labels[$i]}" "${rev}" "${file}"
      done < "${tmpfile}"
    else
      status=$?
      if (( status != 1 )); then
        printf 'HISTORY_PRIVACY_SCAN_ERROR git grep failed status=%s rev=%s pattern=%s\n' "${status}" "${rev:0:12}" "${labels[$i]}" >&2
        exit "${status}"
      fi
    fi
  done
done < "${revisionsfile}"

sort -u "${reportfile}"
findings="$(sort -u "${reportfile}" | wc -l | tr -d '[:space:]')"

if (( findings > 0 )); then
  printf 'HISTORY_PRIVACY_SCAN_FAILED findings=%s\n' "${findings}" >&2
  printf 'Rewrite Git history before treating old commits as public-safe.\n' >&2
  exit 1
fi

printf 'HISTORY_PRIVACY_SCAN_OK\n'
