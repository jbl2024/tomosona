#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CHANGELOG_PATH="$ROOT_DIR/CHANGELOG.md"
DATE="$(date +%F)"
DRY_RUN="false"
FROM_TAG=""

usage() {
  cat <<USAGE
Usage: $0 --version <version> [options]

Options:
  --version <version>   Release version (YYYYMMDD.N or vYYYYMMDD.N)
  --date <YYYY-MM-DD>  Override release date (default: today)
  --from-tag <tag>      Use explicit lower-bound tag
  --changelog <path>    Changelog path (default: CHANGELOG.md)
  --dry-run             Print generated release block only
USAGE
}

VERSION=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    --version)
      VERSION="${2:-}"
      shift 2
      ;;
    --date)
      DATE="${2:-}"
      shift 2
      ;;
    --from-tag)
      FROM_TAG="${2:-}"
      shift 2
      ;;
    --changelog)
      CHANGELOG_PATH="${2:-}"
      shift 2
      ;;
    --dry-run)
      DRY_RUN="true"
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown argument: $1"
      usage
      exit 1
      ;;
  esac
done

if [ -z "$VERSION" ]; then
  usage
  exit 1
fi

VERSION="${VERSION#v}"
if ! echo "$VERSION" | grep -Eq '^[0-9]{8}\.[1-9][0-9]*$'; then
  echo "Invalid version '$VERSION'. Expected format: YYYYMMDD.N (optionally prefixed with v)."
  exit 1
fi

if ! echo "$DATE" | grep -Eq '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'; then
  echo "Invalid date '$DATE'. Expected format: YYYY-MM-DD."
  exit 1
fi

cd "$ROOT_DIR"

if [ ! -f "$CHANGELOG_PATH" ]; then
  echo "Changelog not found: $CHANGELOG_PATH"
  exit 1
fi

if rg -n "^## \[$VERSION\] - " "$CHANGELOG_PATH" >/dev/null; then
  echo "Version $VERSION already exists in $CHANGELOG_PATH"
  exit 1
fi

if [ -n "$FROM_TAG" ]; then
  PREV_TAG="$FROM_TAG"
else
  PREV_TAG="$(git describe --tags --abbrev=0 --match 'v[0-9]*.[0-9]*' 2>/dev/null || true)"
fi

LOG_ARGS=(--pretty=format:'%h%x09%s')
if [ -n "$PREV_TAG" ]; then
  LOG_ARGS+=("$PREV_TAG..HEAD")
fi

LOG_OUTPUT="$(git log "${LOG_ARGS[@]}")"
if [ -z "$LOG_OUTPUT" ]; then
  echo "No commits found to include in changelog."
  exit 1
fi

added_entries=()
changed_entries=()
fixed_entries=()

while IFS=$'\t' read -r hash subject; do
  [ -z "$hash" ] && continue
  [ -z "$subject" ] && continue

  entry="- $subject ($hash)"
  type_prefix="$(echo "$subject" | sed -E 's/^([a-zA-Z]+)(\(.*\))?:.*/\1/' | tr '[:upper:]' '[:lower:]')"

  case "$type_prefix" in
    feat)
      added_entries+=("$entry")
      ;;
    fix|bug)
      fixed_entries+=("$entry")
      ;;
    *)
      changed_entries+=("$entry")
      ;;
  esac
done <<< "$LOG_OUTPUT"

if [ "${#added_entries[@]}" -eq 0 ] && [ "${#changed_entries[@]}" -eq 0 ] && [ "${#fixed_entries[@]}" -eq 0 ]; then
  echo "No changelog entries generated."
  exit 1
fi

release_block_file="$(mktemp)"
{
  echo "## [$VERSION] - $DATE"
  echo
  if [ "${#added_entries[@]}" -gt 0 ]; then
    echo "### Added"
    printf '%s\n' "${added_entries[@]}"
    echo
  fi
  if [ "${#changed_entries[@]}" -gt 0 ]; then
    echo "### Changed"
    printf '%s\n' "${changed_entries[@]}"
    echo
  fi
  if [ "${#fixed_entries[@]}" -gt 0 ]; then
    echo "### Fixed"
    printf '%s\n' "${fixed_entries[@]}"
    echo
  fi
} > "$release_block_file"

if [ "$DRY_RUN" = "true" ]; then
  cat "$release_block_file"
  rm -f "$release_block_file"
  exit 0
fi

new_changelog_file="$(mktemp)"
awk -v block="$release_block_file" '
  BEGIN { inserted=0 }
  {
    if (!inserted && $0 ~ /^## \[/ && $0 !~ /^## \[Unreleased\]/) {
      while ((getline line < block) > 0) {
        print line
      }
      close(block)
      inserted=1
    }
    print
  }
  END {
    if (!inserted) {
      while ((getline line < block) > 0) {
        print line
      }
      close(block)
    }
  }
' "$CHANGELOG_PATH" > "$new_changelog_file"

mv "$new_changelog_file" "$CHANGELOG_PATH"
rm -f "$release_block_file"

echo "Added $VERSION release notes to $CHANGELOG_PATH"
