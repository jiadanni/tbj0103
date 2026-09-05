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
# A check we could not run is not a check that passed. Record it so the final
# summary reports it loudly instead of exiting 0 as if the gate had run.
SKIPPED=()
skip() { echo -e "${YELLOW}⚠ skipped: $1${RESET}"; echo "  $2"; SKIPPED+=("$1"); }

# ── 1. SwiftLint ─────────────────────────────────────────────────────────────
info "Running SwiftLint..."
if command -v swiftlint &>/dev/null; then
  if (cd "$ROOT/swift" && swiftlint lint --config ".swiftlint.yml" --quiet 2>&1); then
    pass "SwiftLint"
  else
    fail "SwiftLint"
  fi
else
  skip "SwiftLint" "swiftlint not found (install: brew install swiftlint)"
fi

# ── 2. ESLint (TypeScript / React) ───────────────────────────────────────────
info "Running ESLint..."
# The project pins Node 22 via .nvmrc, but the exact installed patch version
# varies by machine — discover the newest rather than hardcoding one.
NODE_BIN=""
NVM_NEWEST=""
if [ -d "$HOME/.nvm/versions/node" ]; then
  NVM_NEWEST="$(find "$HOME/.nvm/versions/node" -maxdepth 1 -mindepth 1 -type d \
    | sort -V | tail -1)/bin"
fi
for candidate in \
    "$NVM_NEWEST" \
    "/usr/local/bin" \
    "/opt/homebrew/bin" \
    "$(dirname "$(command -v node 2>/dev/null || echo /nonexistent)")"; do
  if [ -n "$candidate" ] && [ -x "$candidate/node" ]; then
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
  skip "ESLint" "eslint not found – run: cd tauri && npm install"
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
  skip "TypeScript" "tsc not found – run: cd tauri && npm install"
fi

# ── 4. Migration freeze check ────────────────────────────────────────────────
info "Running migration freeze check..."
if [ -n "$NODE_BIN" ]; then
  if "$NODE_BIN/node" "$TAURI/scripts/lint-migrations.mjs"; then
    pass "Migrations"
  else
    fail "Migrations"
  fi
else
  skip "Migrations" "node not found – run: cd tauri && npm install"
fi

# ── 5. Cargo Clippy ──────────────────────────────────────────────────────────
info "Running Cargo Clippy..."
# Prefer an explicit CARGO_BIN, then rustup's own path, then whatever is on
# PATH — a system cargo (/usr/bin/cargo) is just as valid as a rustup one.
CARGO="${CARGO_BIN:-}"
if [ -z "$CARGO" ]; then
  for candidate in "$HOME/.cargo/bin/cargo" "$(command -v cargo 2>/dev/null || true)"; do
    if [ -n "$candidate" ] && [ -x "$candidate" ]; then
      CARGO="$candidate"
      break
    fi
  done
fi
if [ -n "$CARGO" ] && [ -x "$CARGO" ]; then
  # --all-targets so test code is linted too; without it, warnings inside
  # #[cfg(test)] modules never surface here.
  if "$CARGO" clippy \
        --manifest-path "$TAURI/src-tauri/Cargo.toml" \
        --all-targets \
        -- -D warnings 2>&1; then
    pass "Clippy"
  else
    fail "Clippy"
  fi
else
  skip "Clippy" "cargo not found – install rustup from https://rustup.rs"
fi

# ── 6 & 7. Test suites ───────────────────────────────────────────────────────
# Both are skipped with SKIP_TESTS=1 for a fast lint-only pass.
if [ "${SKIP_TESTS:-0}" = "1" ]; then
  info "Skipping tests (SKIP_TESTS=1)"
else
  # ── 6. Frontend tests (vitest) ─────────────────────────────────────────────
  #
  info "Running frontend tests (vitest)..."
  if [ -n "$NODE_BIN" ] && [ -x "$TAURI/node_modules/.bin/vitest" ]; then
    if (cd "$TAURI" && node_modules/.bin/vitest run 2>&1); then
      pass "Vitest"
    else
      fail "Vitest"
    fi
  else
    skip "Vitest" "vitest not found – run: cd tauri && npm install"
  fi

  # ── 7. Rust tests (cargo test) ─────────────────────────────────────────────
  info "Running Rust tests (cargo test)..."
  if [ -n "$CARGO" ] && [ -x "$CARGO" ]; then
    if "$CARGO" test \
          --manifest-path "$TAURI/src-tauri/Cargo.toml" \
          --quiet 2>&1; then
      pass "Cargo test"
    else
      fail "Cargo test"
    fi
  else
    skip "Cargo test" "cargo not found – install rustup from https://rustup.rs"
  fi
fi

# ── Result ───────────────────────────────────────────────────────────────────
echo ""
if [ "${#SKIPPED[@]}" -gt 0 ]; then
  echo -e "${YELLOW}Skipped ${#SKIPPED[@]} check(s): ${SKIPPED[*]}${RESET}"
  echo -e "${YELLOW}These tools were not found, so those checks did NOT run.${RESET}"
fi

if [ "$FAIL" -ne 0 ]; then
  echo -e "${RED}One or more linters failed.${RESET}"
  exit 1
fi

if [ "${#SKIPPED[@]}" -gt 0 ]; then
  # Exiting 0 here would report a green gate for checks that never ran.
  # ALLOW_SKIPPED_LINTERS=1 opts out when a tool is genuinely unavailable
  # (e.g. swiftlint on Linux).
  if [ "${ALLOW_SKIPPED_LINTERS:-0}" = "1" ]; then
    echo -e "${GREEN}Linters that ran all passed (skips allowed).${RESET}"
  else
    echo -e "${RED}Refusing to report success with skipped checks.${RESET}"
    echo -e "${RED}Install the missing tools, or re-run with ALLOW_SKIPPED_LINTERS=1.${RESET}"
    exit 1
  fi
else
  echo -e "${GREEN}All linters passed.${RESET}"
fi
