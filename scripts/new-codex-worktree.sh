#!/usr/bin/env bash

set -euo pipefail

usage() {
  local script_name
  script_name="$(basename "${BASH_SOURCE[0]}")"
  cat <<EOF
Usage: scripts/$script_name [session-name] [base-branch]
       scripts/$script_name --list

Creates or reuses a dedicated git worktree for a Codex session.

Defaults:
  session-name  session-YYYYmmdd-HHMMSS
  base-branch   develop

Environment overrides:
  CODEX_WORKTREE_ROOT           Parent directory for all session worktrees
  CODEX_WORKTREE_BRANCH_PREFIX  Branch prefix (default: codex)
EOF
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

repo_root="$(git rev-parse --show-toplevel)"
repo_name="$(basename "$repo_root")"

timestamp="$(date +%Y%m%d-%H%M%S)"
session_name="${1:-session-$timestamp}"
base_branch="${2:-develop}"
branch_prefix="${CODEX_WORKTREE_BRANCH_PREFIX:-codex}"
worktree_root="${CODEX_WORKTREE_ROOT:-$repo_root/.worktrees}"
branch_name="$branch_prefix/$session_name"
worktree_path="$worktree_root/$session_name"

if [[ "${1:-}" == "--list" ]]; then
  git -C "$repo_root" worktree list
  exit 0
fi

if ! git -C "$repo_root" rev-parse --verify "$base_branch" >/dev/null 2>&1; then
  echo "Base branch '$base_branch' does not exist locally." >&2
  exit 1
fi

if [[ -d "$worktree_path" ]]; then
  echo "Session already exists:"
  echo "  branch:  $branch_name"
  echo "  path:    $worktree_path"
  echo
  echo "Next:"
  echo "  cd \"$worktree_path\""
  exit 0
fi

if git -C "$repo_root" show-ref --verify --quiet "refs/heads/$branch_name"; then
  echo "Branch '$branch_name' already exists without a matching worktree at '$worktree_path'." >&2
  echo "Either attach it manually or choose a different session name." >&2
  exit 1
fi

if [[ -e "$worktree_path" ]]; then
  echo "Path '$worktree_path' already exists. Choose a different session name." >&2
  exit 1
fi

mkdir -p "$worktree_root"
git -C "$repo_root" worktree add -b "$branch_name" "$worktree_path" "$base_branch"

cat <<EOF
Created worktree:
  repo:    $repo_root
  branch:  $branch_name
  path:    $worktree_path
  base:    $base_branch

Next:
  cd "$worktree_path"
EOF
