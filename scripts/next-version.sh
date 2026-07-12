#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DATE="${1:-$(date +%Y%m%d)}"

if ! echo "$DATE" | grep -Eq '^[0-9]{8}$'; then
  echo "Invalid date '$DATE'. Expected format: YYYYMMDD." >&2
  exit 1
fi

cd "$ROOT_DIR"

# Detect both published tags and locally prepared changelog entries, for example
# v20260712.2 and "## [20260712.2] - 2026-07-12".
highest=0
while IFS= read -r version; do
  [ -z "$version" ] && continue
  sequence="${version#*.}"
  if [ "$sequence" -gt "$highest" ]; then
    highest="$sequence"
  fi
done < <(
  {
    git tag --list "v$DATE.*" | sed -nE "s/^v($DATE\.[0-9]+)$/\1/p"
    if [ -f CHANGELOG.md ]; then
      sed -nE "s/^## \[($DATE\.[0-9]+)\] - .*/\1/p" CHANGELOG.md
    fi
  } | sort -u
)

echo "$DATE.$((highest + 1))"
