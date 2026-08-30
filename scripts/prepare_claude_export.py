#!/usr/bin/env python3
"""
scripts/prepare_claude_export.py

Turn a Claude data export into a single folder Aetherium can import.

Since the 2026-08-30 export change ("v3"), Anthropic delivers a manifest JSON
plus five separate .zip files instead of one archive. Unpacking those by hand is
error-prone: on macOS each zip expands into its *own* folder, which the importer
rejects, and a split export (conversations-000 + conversations-001) merged in
Finder silently overwrites half the history. This script does it correctly.

Run from anywhere:

  # You still have the manifest and haven't spent the download URLs yet:
  python3 scripts/prepare_claude_export.py ~/Downloads/export-2026-08-30.json

  # URLs already used, but you have the .zip files:
  python3 scripts/prepare_claude_export.py ~/Downloads

  # Pick where the result goes (default: ./claude-export-<date>)
  python3 scripts/prepare_claude_export.py ~/Downloads -o ~/claude-export

Then point Aetherium's Claude importer at the folder it prints.

Stdlib only — no pip install, no jq. Works on macOS, Linux and Windows.
"""

import argparse
import json
import shutil
import sys
import urllib.error
import urllib.request
import zipfile
from pathlib import Path

# Each export URL works exactly once, so a failed download is unrecoverable
# without requesting a whole new export. Fail loudly rather than half-succeed.
DOWNLOAD_TIMEOUT = 300

# Categories whose JSON is a single top-level array, so multi-part exports must
# be merged by concatenating the arrays rather than overwriting the file.
MERGEABLE = {"conversations.json"}


def log(msg: str) -> None:
    print(msg, flush=True)


def die(msg: str) -> "None":
    print(f"\nError: {msg}", file=sys.stderr)
    sys.exit(1)


def find_manifest(path: Path):
    """Return the export manifest at/under `path`, or None."""
    candidates = [path] if path.is_file() else sorted(path.glob("*.json"))
    for candidate in candidates:
        try:
            with candidate.open(encoding="utf-8") as fh:
                data = json.load(fh)
        except (OSError, json.JSONDecodeError, UnicodeDecodeError):
            continue
        if isinstance(data, dict) and "data_files" in data:
            return candidate, data
    return None


def download_missing(manifest_dir: Path, manifest: dict) -> list:
    """Download any manifest file not already on disk. Returns local zip paths."""
    entries = manifest.get("data_files", [])
    if not entries:
        die("Manifest lists no data_files.")

    paths = []
    for entry in entries:
        filename = entry.get("filename")
        url = entry.get("export_url")
        if not filename:
            continue
        dest = manifest_dir / filename
        paths.append(dest)

        if dest.exists() and dest.stat().st_size > 0:
            log(f"  have     {filename}")
            continue
        if not url:
            log(f"  MISSING  {filename} (no URL in manifest)")
            continue

        log(f"  download {filename} ...")
        try:
            with urllib.request.urlopen(url, timeout=DOWNLOAD_TIMEOUT) as resp:
                # Stream to a .part file so an interrupted download is never
                # mistaken for a complete one on a later run.
                tmp = dest.with_suffix(dest.suffix + ".part")
                with tmp.open("wb") as out:
                    shutil.copyfileobj(resp, out)
                tmp.replace(dest)
        except urllib.error.HTTPError as exc:
            if exc.code in (403, 404, 410):
                log(
                    f"           ! link already used or expired ({exc.code}). "
                    f"Download {filename} manually into {manifest_dir}."
                )
            else:
                log(f"           ! HTTP {exc.code}: {exc.reason}")
        except (urllib.error.URLError, OSError) as exc:
            log(f"           ! {exc}")

    return paths


def safe_extract(zf: zipfile.ZipFile, member: zipfile.ZipInfo, dest_root: Path) -> Path:
    """Extract one member, refusing paths that escape `dest_root` (zip-slip)."""
    name = member.filename
    if name.startswith("/") or ".." in Path(name).parts:
        die(f"Refusing suspicious path in archive: {name!r}")
    target = (dest_root / name).resolve()
    if not str(target).startswith(str(dest_root.resolve())):
        die(f"Refusing path escaping the output folder: {name!r}")
    target.parent.mkdir(parents=True, exist_ok=True)
    with zf.open(member) as src, target.open("wb") as out:
        shutil.copyfileobj(src, out)
    return target


def merge_json_array(existing: Path, incoming: Path) -> None:
    """Concatenate two top-level JSON arrays in place (multi-part exports)."""
    with existing.open(encoding="utf-8") as fh:
        a = json.load(fh)
    with incoming.open(encoding="utf-8") as fh:
        b = json.load(fh)
    if not isinstance(a, list) or not isinstance(b, list):
        die(f"Cannot merge {existing.name}: expected JSON arrays.")
    with existing.open("w", encoding="utf-8") as fh:
        json.dump(a + b, fh)
    log(f"           merged {len(b)} more into {existing.name} ({len(a) + len(b)} total)")


def unpack(zips: list, out_dir: Path) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)
    for zpath in zips:
        if not zpath.exists():
            continue
        log(f"  unpack   {zpath.name}")
        with zipfile.ZipFile(zpath) as zf:
            for member in zf.infolist():
                if member.is_dir():
                    continue
                target = out_dir / member.filename
                # A second part carrying the same filename must be merged, not
                # allowed to overwrite the first.
                if target.exists() and target.name in MERGEABLE:
                    staged = safe_extract(zf, member, out_dir / ".part")
                    merge_json_array(target, staged)
                    shutil.rmtree(out_dir / ".part", ignore_errors=True)
                else:
                    safe_extract(zf, member, out_dir)


def verify(out_dir: Path) -> bool:
    """Report what the importer will find. Returns True if it looks importable."""
    conversations = out_dir / "conversations.json"
    projects = out_dir / "projects"
    memories_dir = out_dir / "memories"
    memories_file = out_dir / "memories.json"

    log("\nResult:")
    ok = True

    if conversations.is_file():
        try:
            with conversations.open(encoding="utf-8") as fh:
                n = len(json.load(fh))
            log(f"  conversations.json   {n} conversations")
        except (OSError, json.JSONDecodeError):
            log("  conversations.json   present (unreadable)")
            ok = False
    else:
        log("  conversations.json   MISSING")
        ok = False

    if projects.is_dir():
        log(f"  projects/            {len(list(projects.glob('*.json')))} projects")
    else:
        log("  projects/            MISSING")
        ok = False

    if memories_dir.is_dir():
        log(f"  memories/            {len(list(memories_dir.glob('*.json')))} file(s)  [v3]")
    elif memories_file.is_file():
        log("  memories.json        present  [v2]")
    else:
        log("  memories/            none (no memories in this export)")

    design = out_dir / "design_chats"
    if design.is_dir():
        log(f"  design_chats/        {len(list(design.glob('*.json')))} chat(s)")

    return ok


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Prepare a Claude data export for import into Aetherium.",
    )
    parser.add_argument(
        "source",
        type=Path,
        help="The export manifest .json, or a folder containing the downloaded .zip files.",
    )
    parser.add_argument(
        "-o",
        "--output",
        type=Path,
        default=None,
        help="Where to write the prepared folder (default: ./claude-export-<name>).",
    )
    args = parser.parse_args()

    source = args.source.expanduser().resolve()
    if not source.exists():
        die(f"No such path: {source}")

    search_dir = source.parent if source.is_file() else source

    found = find_manifest(source)
    zips = []
    if found:
        manifest_path, manifest = found
        created = manifest.get("created_at", "unknown date")
        log(f"Manifest: {manifest_path.name}  (created {created})")
        log(f"Listed files: {manifest.get('total_files', len(manifest.get('data_files', [])))}\n")
        zips = download_missing(search_dir, manifest)
    else:
        log(f"No manifest found — using .zip files in {search_dir}\n")

    # Whether or not a manifest was found, pick up any zips actually present.
    on_disk = sorted(search_dir.glob("*.zip"))
    for z in on_disk:
        if z not in zips:
            zips.append(z)

    present = [z for z in zips if z.exists() and z.stat().st_size > 0]
    if not present:
        die(
            f"No usable .zip files in {search_dir}.\n"
            "  If your download links are already spent, download the files\n"
            "  manually from the export email and re-run against that folder."
        )

    missing = [z.name for z in zips if not z.exists()]
    if missing:
        log("\n  Warning: these files are missing and will not be imported:")
        for name in missing:
            log(f"    - {name}")

    out_dir = args.output
    if out_dir is None:
        stem = source.stem if source.is_file() else source.name
        out_dir = Path.cwd() / f"claude-export-{stem}"
    out_dir = out_dir.expanduser().resolve()

    if out_dir.exists() and any(out_dir.iterdir()):
        die(f"Output folder is not empty: {out_dir}\n  Remove it or pass -o with a new path.")

    log("")
    unpack(present, out_dir)
    ok = verify(out_dir)

    log(f"\nPrepared: {out_dir}")
    if missing:
        log("This export is INCOMPLETE — see the warning above before importing.")
    elif ok:
        log("Point Aetherium's Claude importer at that folder.")
    else:
        log("Some expected files are absent; the import may be partial.")


if __name__ == "__main__":
    main()
