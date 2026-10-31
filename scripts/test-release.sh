#!/usr/bin/env bash
set -euo pipefail

# Exercise the Makefile in isolation: no real files, commits, tags, or pushes.
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
fixture="$(mktemp -d)"
trap 'rm -rf "$fixture"' EXIT
mkdir -p "$fixture/scripts" "$fixture/bin"
cp "$root/Makefile" "$fixture/Makefile"

cat > "$fixture/scripts/next-version.sh" <<'EOF'
#!/usr/bin/env bash
if [ -f prepared ]; then echo 20261031.2; else echo 20261031.1; fi
EOF
cat > "$fixture/scripts/prepare-version.sh" <<'EOF'
#!/usr/bin/env bash
echo "prepare $1" >> calls
EOF
cat > "$fixture/scripts/build-changelog.sh" <<'EOF'
#!/usr/bin/env bash
echo "changelog $2" >> calls
touch prepared
EOF
cat > "$fixture/bin/git" <<'EOF'
#!/usr/bin/env bash
if [ "$1" = rev-parse ]; then echo main; else echo "git $*" >> calls; fi
EOF
chmod +x "$fixture/scripts/"*.sh "$fixture/bin/git"

cd "$fixture"
PATH="$fixture/bin:$PATH" make release > /dev/null
grep -Fx 'prepare 20261031.1' calls > /dev/null
grep -Fx 'changelog 20261031.1' calls > /dev/null
grep -Fx 'git commit -m chore(release): prepare v20261031.1' calls > /dev/null
grep -Fx 'git tag v20261031.1' calls > /dev/null
grep -Fx 'git push origin v20261031.1' calls > /dev/null

# An explicit version stays authoritative, even after preparation changes state.
: > calls
PATH="$fixture/bin:$PATH" make release VERSION_NO_V=20261031.7 > /dev/null
grep -Fx 'prepare 20261031.7' calls > /dev/null
grep -Fx 'git tag v20261031.7' calls > /dev/null

# Preparation failures must stop the release before any Git action.
: > calls
printf '#!/usr/bin/env bash\nexit 1\n' > scripts/prepare-version.sh
if PATH="$fixture/bin:$PATH" make release > /dev/null 2>&1; then
  echo 'Release succeeded despite a preparation failure' >&2
  exit 1
fi
if [ -s calls ]; then
  echo 'Release continued after a preparation failure' >&2
  exit 1
fi
echo 'Release Makefile tests passed'
