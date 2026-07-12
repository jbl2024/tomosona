#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

usage() {
  echo "Usage: $0 <version>"
  echo "Example: $0 20260712.1"
}

if [ "$#" -ne 1 ]; then
  usage
  exit 1
fi

RAW_VERSION="$1"
VERSION="${RAW_VERSION#v}"

if ! echo "$VERSION" | grep -Eq '^[0-9]{8}\.[1-9][0-9]*$'; then
  echo "Invalid version '$RAW_VERSION'. Expected format: YYYYMMDD.N (optionally prefixed with v)."
  exit 1
fi

# Cargo requires three SemVer components, while WiX additionally limits the
# major/minor fields to 255. Encode 20260712.1 as 26.7.12001 internally:
# (year - 2000).month.(day * 1000 + daily sequence).
date_part="${VERSION%%.*}"
sequence="${VERSION#*.}"
year=$((10#${date_part:0:4}))
month=$((10#${date_part:4:2}))
day=$((10#${date_part:6:2}))

if [ "$year" -lt 2000 ] || [ "$year" -gt 2255 ] || [ "$month" -lt 1 ] || [ "$month" -gt 12 ] || [ "$day" -lt 1 ] || [ "$day" -gt 31 ]; then
  echo "Invalid calendar date in version '$RAW_VERSION'."
  exit 1
fi

if [ "$sequence" -gt 999 ]; then
  echo "Invalid sequence in version '$RAW_VERSION'. At most 999 releases per day are supported."
  exit 1
fi

BUILD_VERSION="$((year - 2000)).$month.$((day * 1000 + sequence))"

cd "$ROOT_DIR"

node -e 'const fs=require("fs");const p="package.json";const d=JSON.parse(fs.readFileSync(p,"utf8"));d.version=process.argv[1];fs.writeFileSync(p,JSON.stringify(d,null,2)+"\n");' "$BUILD_VERSION"

if [ -f package-lock.json ]; then
  node -e 'const fs=require("fs");const p="package-lock.json";const d=JSON.parse(fs.readFileSync(p,"utf8"));d.version=process.argv[1];if(d.packages&&d.packages[""]){d.packages[""].version=process.argv[1];}fs.writeFileSync(p,JSON.stringify(d,null,2)+"\n");' "$BUILD_VERSION"
fi

node -e 'const fs=require("fs");const p="src-tauri/tauri.conf.json";const d=JSON.parse(fs.readFileSync(p,"utf8"));d.version=process.argv[1];fs.writeFileSync(p,JSON.stringify(d,null,2)+"\n");' "$BUILD_VERSION"

node -e 'const fs=require("fs");const p="index.html";const source=fs.readFileSync(p,"utf8");const next=source.replace(/<div class="startup-brand-meta">v[^<]+<\/div>/, `<div class="startup-brand-meta">v${process.argv[1]}</div>`);if(next===source){throw new Error("Could not update startup splash version in index.html");}fs.writeFileSync(p,next);' "$VERSION"

tmp_file="$(mktemp)"
awk -v v="$BUILD_VERSION" '
  BEGIN { in_pkg=0 }
  /^\[package\]$/ { in_pkg=1 }
  /^\[/ { if ($0 != "[package]") in_pkg=0 }
  in_pkg && /^version = "/ { $0 = "version = \"" v "\"" }
  { print }
' src-tauri/Cargo.toml > "$tmp_file"
mv "$tmp_file" src-tauri/Cargo.toml

tmp_file="$(mktemp)"
awk -v v="$BUILD_VERSION" '
  BEGIN { in_pkg=0; is_tomosona=0 }
  /^\[\[package\]\]$/ { in_pkg=1; is_tomosona=0 }
  in_pkg && /^name = "tomosona"$/ { is_tomosona=1 }
  in_pkg && is_tomosona && /^version = "/ {
    $0 = "version = \"" v "\""
    in_pkg=0
    is_tomosona=0
  }
  { print }
' src-tauri/Cargo.lock > "$tmp_file"
mv "$tmp_file" src-tauri/Cargo.lock

if [ -f package-lock.json ]; then
  echo "Updated release display to $VERSION and build metadata to $BUILD_VERSION in package.json, package-lock.json, index.html, src-tauri/tauri.conf.json, src-tauri/Cargo.toml, and src-tauri/Cargo.lock"
else
  echo "Updated release display to $VERSION and build metadata to $BUILD_VERSION in package.json, index.html, src-tauri/tauri.conf.json, src-tauri/Cargo.toml, and src-tauri/Cargo.lock"
fi
