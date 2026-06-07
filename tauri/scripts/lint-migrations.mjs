#!/usr/bin/env node
// Refuses edits to migrations that already exist on origin/develop.
// A "migration" is a block in src-tauri/src/db/mod.rs keyed by its
// 'vN_name' literal inside `run_migrations()`. Once shipped, the block
// is frozen — fix-forward with a new vN+1 migration instead.

import { execSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, "../..");
const MOD_RS = resolve(REPO_ROOT, "tauri/src-tauri/src/db/mod.rs");
const REL_PATH = "tauri/src-tauri/src/db/mod.rs";
const BASE_REF = process.env.MIGRATION_BASE_REF || "origin/develop";

function sh(cmd) {
  return execSync(cmd, { cwd: REPO_ROOT, encoding: "utf8" });
}

function tryShowFromBase() {
  try {
    return sh(`git show ${BASE_REF}:${REL_PATH}`);
  } catch {
    return null;
  }
}

// Parse migration blocks out of mod.rs. We slice the file from the start
// of `fn run_migrations` to the end of that function (best-effort: until
// a top-level `\nfn ` or end of file). Within that slice, every line
// matching `WHERE name = 'vN_xxx'` marks the start of a new block; the
// block ends at the next such line.
function parseMigrationBlocks(source) {
  const fnStart = source.indexOf("fn run_migrations");
  if (fnStart < 0) return new Map();

  // Find end of function: walk braces from the first '{' after fnStart.
  const braceOpen = source.indexOf("{", fnStart);
  if (braceOpen < 0) return new Map();
  let depth = 0;
  let fnEnd = source.length;
  for (let i = braceOpen; i < source.length; i++) {
    const ch = source[i];
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) {
        fnEnd = i + 1;
        break;
      }
    }
  }
  const body = source.slice(braceOpen, fnEnd);

  // Anchor each migration at its `let applied_… = conn.query_row(`
  // opener. The associated 'vN_name' literal appears within ~5 lines
  // (the WHERE clause). Block ends at the next such opener or the
  // function's trailing `Ok(())`.
  const re =
    /let applied[A-Za-z0-9_]*\s*:\s*i64\s*=\s*conn\.query_row\(\s*"SELECT COUNT\(\*\) FROM _migrations WHERE name = '(v\d+_[A-Za-z0-9_]+)'/g;
  const hits = [];
  let m;
  while ((m = re.exec(body)) !== null) {
    hits.push({ name: m[1], index: m.index });
  }

  // For each anchor, find the close of its `if applied_… == 0 { … }`
  // block and use that as the hard end of the slice. This keeps slices
  // stable even when the migration immediately after is new on HEAD
  // (which would otherwise let the base slice run to end-of-function).
  function endOfIfBlock(fromIndex) {
    const ifStart = body.indexOf("if applied", fromIndex);
    if (ifStart < 0) return -1;
    const braceOpen = body.indexOf("{", ifStart);
    if (braceOpen < 0) return -1;
    let d = 0;
    for (let i = braceOpen; i < body.length; i++) {
      if (body[i] === "{") d++;
      else if (body[i] === "}") {
        d--;
        if (d === 0) return i + 1;
      }
    }
    return -1;
  }

  const blocks = new Map();
  for (let i = 0; i < hits.length; i++) {
    const start = hits[i].index;
    const nextAnchor = i + 1 < hits.length ? hits[i + 1].index : body.length;
    const ifEnd = endOfIfBlock(start);
    const end = ifEnd > 0 ? Math.min(ifEnd, nextAnchor) : nextAnchor;
    // Normalize trailing whitespace + collapse blank-line runs so
    // cosmetic formatting diffs don't trip us.
    const text = body
      .slice(start, end)
      .replace(/[ \t]+$/gm, "")
      .replace(/\n{3,}/g, "\n\n")
      .trimEnd();
    if (blocks.has(hits[i].name)) {
      // Duplicate opener for the same name shouldn't happen; if it does,
      // keep the first occurrence so behavior stays deterministic.
      continue;
    }
    blocks.set(hits[i].name, text);
  }
  return blocks;
}

function parseNameList(source) {
  const start = source.indexOf("ALL_MIGRATION_NAMES");
  if (start < 0) return [];
  const open = source.indexOf("[", start);
  const close = source.indexOf("];", open);
  if (open < 0 || close < 0) return [];
  const slice = source.slice(open, close);
  return [...slice.matchAll(/"(v\d+_[A-Za-z0-9_]+)"/g)].map((m) => m[1]);
}

function main() {
  if (!existsSync(MOD_RS)) {
    console.error(`lint-migrations: cannot find ${MOD_RS}`);
    process.exit(2);
  }

  const baseSrc = tryShowFromBase();
  if (baseSrc === null) {
    console.warn(
      `lint-migrations: ${BASE_REF} not available locally — skipping. ` +
        `Run \`git fetch origin\` to enable this check.`,
    );
    process.exit(0);
  }

  const headSrc = readFileSync(MOD_RS, "utf8");
  const baseBlocks = parseMigrationBlocks(baseSrc);
  const headBlocks = parseMigrationBlocks(headSrc);
  const baseNames = new Set(parseNameList(baseSrc));
  const headNames = parseNameList(headSrc);

  const violations = [];

  // 1. Modified blocks for migrations that already exist on the base.
  for (const [name, baseText] of baseBlocks) {
    if (!headBlocks.has(name)) {
      violations.push(
        `removed shipped migration '${name}' — migrations are append-only`,
      );
      continue;
    }
    if (headBlocks.get(name) !== baseText) {
      violations.push(
        `modified shipped migration '${name}' — fix forward with a new vN migration instead`,
      );
    }
  }

  // 2. Removed entries from ALL_MIGRATION_NAMES.
  const headNameSet = new Set(headNames);
  for (const name of baseNames) {
    if (!headNameSet.has(name)) {
      violations.push(
        `removed '${name}' from ALL_MIGRATION_NAMES — existing user DBs depend on it`,
      );
    }
  }

  // 3. Reordering check: shared names must appear in the same relative order.
  const baseOrder = [...baseNames].filter((n) => headNameSet.has(n));
  const headSharedOrder = headNames.filter((n) => baseNames.has(n));
  for (let i = 0; i < baseOrder.length; i++) {
    if (baseOrder[i] !== headSharedOrder[i]) {
      violations.push(
        `ALL_MIGRATION_NAMES reordered around '${baseOrder[i]}' — migration order is part of the contract`,
      );
      break;
    }
  }

  if (violations.length === 0) {
    process.exit(0);
  }

  console.error(`\nlint-migrations: ${violations.length} violation(s)\n`);
  for (const v of violations) console.error(`  ✗ ${v}`);
  console.error(
    `\nWhy: migrations on ${BASE_REF} have already run against users' databases. ` +
      `Editing them creates divergence between fresh installs and upgrades. ` +
      `Add a new vN+1 migration that fixes the prior one forward.\n`,
  );
  process.exit(1);
}

main();
