#!/bin/bash
# lint.sh — run all linters for the Aetherium project

set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
TAURI="$ROOT/tauri"
FAIL=0

# ── Color helpers ────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RESET='\033[0m'
pass() { echo -e "${GREEN}✓ $1${RESET}"; }
fail() { echo -e "${RED}✗ $1${RESET}"; FAIL=1; }
info() { echo -e "${YELLOW}→ $1${RESET}"; }

# ── 1. SwiftLint ─────────────────────────────────────────────────────────────
info "Running SwiftLint..."
if command -v swiftlint &>/dev/null; then
  if (cd "$ROOT/swift" && swiftlint lint --config ".swiftlint.yml" --quiet 2>&1); then
    pass "SwiftLint"
  else
    fail "SwiftLint"
  fi
else
  echo "  swiftlint not found – skipping (install: brew install swiftlint)"
fi

# ── 2. ESLint (TypeScript / React) ───────────────────────────────────────────
info "Running ESLint..."
NODE_BIN=""
for candidate in \
    "$HOME/.nvm/versions/node/v20.19.5/bin" \
    "/usr/local/bin" \
    "/opt/homebrew/bin"; do
  if [ -x "$candidate/node" ]; then
    NODE_BIN="$candidate"
    break
  fi
done

if [ -n "$NODE_BIN" ] && [ -x "$TAURI/node_modules/.bin/eslint" ]; then
  export PATH="$NODE_BIN:$PATH"
  if (cd "$TAURI" && node_modules/.bin/eslint src 2>&1); then
    pass "ESLint"
  else
    fail "ESLint"
  fi
else
  echo "  eslint not found – run: cd tauri && npm install"
fi

# ── 3. TypeScript type-check ─────────────────────────────────────────────────
info "Running TypeScript type-check..."
if [ -n "$NODE_BIN" ] && [ -x "$TAURI/node_modules/.bin/tsc" ]; then
  if (cd "$TAURI" && node_modules/.bin/tsc --noEmit 2>&1); then
    pass "TypeScript"
  else
    fail "TypeScript"
  fi
else
  echo "  tsc not found – run: cd tauri && npm install"
fi

# ── 4. Cargo Clippy ──────────────────────────────────────────────────────────
info "Running Cargo Clippy..."
CARGO="${CARGO_BIN:-$HOME/.cargo/bin/cargo}"
if [ -x "$CARGO" ]; then
  if "$CARGO" clippy \
        --manifest-path "$TAURI/src-tauri/Cargo.toml" \
        -- -D warnings 2>&1; then
    pass "Clippy"
  else
    fail "Clippy"
  fi
else
  echo "  cargo not found – install rustup from https://rustup.rs"
fi

# ── Result ───────────────────────────────────────────────────────────────────
echo ""
if [ "$FAIL" -eq 0 ]; then
  echo -e "${GREEN}All linters passed.${RESET}"
else
  echo -e "${RED}One or more linters failed.${RESET}"
  exit 1
fi
