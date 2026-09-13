#!/usr/bin/env python3
"""
scripts/prepare_claude_export.py

Turn a Claude data export into a single folder Aetherium can import.

Since the 2026-08-30 export change ("v3"), Anthropic delivers a manifest JSON
(or links file) plus five separate .zip files instead of one archive. Unpacking
those by hand is error-prone: on macOS each zip expands into its *own* folder,
which the importer rejects, and a split export (conversations-000 + conversations-001)
merged in Finder silently overwrites half the history. This script does it correctly.

Run from anywhere:

  # Download from manifest JSON and prepare for import:
  python3 scripts/prepare_claude_export.py ~/Downloads/export-2026-08-30.json

  # Download only (do not unpack):
  python3 scripts/prepare_claude_export.py ~/Downloads/manifest.json --download-only -d ~/Downloads/claude-zips

  # URLs already used, but you have the .zip files:
  python3 scripts/prepare_claude_export.py ~/Downloads

  # Pick where the result goes (default: ./claude-export-<date>):
  python3 scripts/prepare_claude_export.py ~/Downloads -o ~/claude-export

Then point Aetherium's Claude importer at the folder it prints.

Stdlib only — no pip install, no jq. Works on macOS, Linux and Windows.
"""

import argparse
import json
import re
import shutil
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import zipfile
from pathlib import Path

# Each export URL works exactly once, so a failed download is unrecoverable
# without requesting a whole new export. Fail loudly rather than half-succeed.
DOWNLOAD_TIMEOUT = 300

# Cloudflare / Claude.ai blocks Python's default User-Agent with HTTP 403 Forbidden.
# A standard browser User-Agent is required to reach the download endpoint.
DEFAULT_USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36"
)

# Categories whose JSON is a single top-level array, so multi-part exports must
# be merged by concatenating the arrays rather than overwriting the file.
MERGEABLE = {"conversations.json"}

URL_REGEX = re.compile(r"https?://[^\s\"'<>]+", re.IGNORECASE)
ZIP_NAME_REGEX = re.compile(r"([a-zA-Z0-9_\-\.]+\.zip)", re.IGNORECASE)


def log(msg: str) -> None:
    print(msg, flush=True)


def die(msg: str) -> "None":
    print(f"\nError: {msg}", file=sys.stderr)
    sys.exit(1)


def human_size(n_bytes: float) -> str:
    """Format byte count into a human-readable string (KB, MB, GB)."""
    for unit in ("B", "KB", "MB", "GB"):
        if abs(n_bytes) < 1024.0:
            return f"{n_bytes:3.1f} {unit}"
        n_bytes /= 1024.0
    return f"{n_bytes:.1f} TB"


def parse_manifest_file(file_path: Path):
    """Attempt to parse a manifest file either as JSON or as plain text links."""
    # 1. Try parsing as JSON manifest
    try:
        with file_path.open(encoding="utf-8") as fh:
            data = json.load(fh)
        if isinstance(data, dict) and "data_files" in data:
            return data
        if isinstance(data, list) and all(isinstance(item, dict) and "export_url" in item for item in data):
            return {"data_files": data, "total_files": len(data), "created_at": "unknown"}
    except (OSError, json.JSONDecodeError, UnicodeDecodeError):
        pass

    # 2. Try parsing as text file with links
    try:
        with file_path.open(encoding="utf-8", errors="replace") as fh:
            content = fh.read()
    except OSError:
        return None

    urls = URL_REGEX.findall(content)
    if not urls:
        return None

    # Deduplicate while preserving order
    seen = set()
    unique_urls = []
    for u in urls:
        clean_url = u.rstrip(".,;:)")
        if clean_url not in seen:
            seen.add(clean_url)
            unique_urls.append(clean_url)

    entries = []
    lines = content.splitlines()
    for idx, url in enumerate(unique_urls):
        # Check if the line containing this URL has a filename hint
        filename = None
        for line in lines:
            if url in line:
                m = ZIP_NAME_REGEX.search(line.replace(url, ""))
                if m:
                    filename = m.group(1)
                break

        if not filename:
            # Check if URL itself ends in a zip filename
            parsed = urllib.parse.urlparse(url)
            path_tail = Path(parsed.path).name
            if path_tail.lower().endswith(".zip"):
                filename = path_tail
            else:
                filename = f"part-{idx:03d}.zip"

        entries.append({
            "batch_index": idx,
            "export_url": url,
            "filename": filename,
            "part": idx,
        })

    return {
        "data_files": entries,
        "total_files": len(entries),
        "created_at": "links file",
        "instructions": "Extracted from text links",
    }


def find_manifest(path: Path):
    """Return (manifest_path, manifest_data) at/under `path`, or None."""
    candidates = [path] if path.is_file() else sorted(path.glob("*.json"))
    for candidate in candidates:
        parsed = parse_manifest_file(candidate)
        if parsed:
            return candidate, parsed

    # If directory has no JSON manifest, check for links/txt files
    if path.is_dir():
        for ext in ("*.txt", "*.md"):
            for candidate in sorted(path.glob(ext)):
                parsed = parse_manifest_file(candidate)
                if parsed:
                    return candidate, parsed

    return None


def parse_cookies_file(path: Path) -> str:
    """Parse a Netscape-format cookies.txt (as exported by browser cookie-export
    extensions) into a `name=value; name=value` Cookie header string."""
    pairs = []
    with path.open(encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            fields = line.split("\t")
            if len(fields) < 7:
                continue
            domain, name, value = fields[0], fields[5], fields[6]
            if "claude.ai" in domain or "anthropic.com" in domain:
                pairs.append(f"{name}={value}")
    if not pairs:
        die(
            f"No claude.ai cookies found in {path}. Export cookies for claude.ai "
            "while logged in (e.g. with a browser cookie-export extension) as a "
            "Netscape-format cookies.txt file."
        )
    return "; ".join(pairs)


def download_file(url: str, dest: Path, timeout: int = DOWNLOAD_TIMEOUT, cookie_header: str = None) -> bool:
    """Download a file with browser User-Agent, chunked streaming, and progress bar."""
    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_suffix(dest.suffix + ".part")

    headers = {
        "User-Agent": DEFAULT_USER_AGENT,
        "Accept": "application/zip, application/octet-stream, */*",
    }
    if cookie_header:
        headers["Cookie"] = cookie_header

    req = urllib.request.Request(url, headers=headers)

    start_time = time.time()
    last_update = 0.0
    downloaded = 0
    total_size = None
    is_tty = sys.stdout.isatty()

    with urllib.request.urlopen(req, timeout=timeout) as resp:
        cl = resp.headers.get("Content-Length")
        if cl and cl.isdigit():
            total_size = int(cl)

        with tmp.open("wb") as out:
            chunk_size = 65536
            while True:
                chunk = resp.read(chunk_size)
                if not chunk:
                    break
                out.write(chunk)
                downloaded += len(chunk)
                now = time.time()

                if is_tty and (now - last_update >= 0.12):
                    last_update = now
                    elapsed = max(now - start_time, 0.001)
                    speed = downloaded / elapsed
                    if total_size and total_size > 0:
                        pct = (downloaded / total_size) * 100.0
                        sys.stdout.write(
                            f"\r  download {dest.name} ... "
                            f"[{human_size(downloaded)} / {human_size(total_size)} ({pct:4.1f}%)] "
                            f"({human_size(speed)}/s)"
                        )
                    else:
                        sys.stdout.write(
                            f"\r  download {dest.name} ... "
                            f"[{human_size(downloaded)}] "
                            f"({human_size(speed)}/s)"
                        )
                    sys.stdout.flush()

    elapsed = max(time.time() - start_time, 0.001)
    speed = downloaded / elapsed
    if is_tty:
        sys.stdout.write(
            f"\r  download {dest.name} ... done: {human_size(downloaded)} "
            f"in {elapsed:.1f}s ({human_size(speed)}/s)              \n"
        )
        sys.stdout.flush()
    else:
        log(
            f"  download {dest.name} ... done: {human_size(downloaded)} "
            f"in {elapsed:.1f}s ({human_size(speed)}/s)"
        )

    # Validate zip integrity if named .zip
    if dest.suffix.lower() == ".zip":
        if not zipfile.is_zipfile(tmp):
            with tmp.open("rb") as fh:
                head = fh.read(256)
            tmp.unlink(missing_ok=True)
            if head.lstrip().startswith(b"<") or b"<html" in head.lower():
                raise ValueError(
                    f"{dest.name} came back as an HTML page, not a zip — you are not "
                    "authenticated. Pass --cookies-file with your claude.ai session cookies."
                )
            raise ValueError(f"{dest.name} is not a valid zip archive (download corrupted or truncated)")

    tmp.replace(dest)
    return True


def download_missing(download_dir: Path, manifest: dict, cookie_header: str = None) -> list:
    """Download any manifest file not already on disk. Returns local zip paths."""
    entries = manifest.get("data_files", [])
    if not entries:
        die("Manifest lists no data_files.")

    download_dir.mkdir(parents=True, exist_ok=True)
    paths = []
    for entry in entries:
        filename = entry.get("filename")
        url = entry.get("export_url")
        if not filename:
            batch = entry.get("batch_index", len(paths))
            cat = entry.get("category", "part")
            filename = f"{cat}-{batch:03d}.zip"
        dest = download_dir / filename
        paths.append(dest)

        if dest.exists() and dest.stat().st_size > 0:
            if dest.suffix.lower() == ".zip" and zipfile.is_zipfile(dest):
                log(f"  have     {filename} ({human_size(dest.stat().st_size)})")
                continue
            elif dest.suffix.lower() != ".zip":
                log(f"  have     {filename} ({human_size(dest.stat().st_size)})")
                continue
            else:
                log(f"  existing {filename} is corrupt; re-downloading...")

        if not url:
            log(f"  MISSING  {filename} (no URL in manifest)")
            continue

        try:
            download_file(url, dest, timeout=DOWNLOAD_TIMEOUT, cookie_header=cookie_header)
        except urllib.error.HTTPError as exc:
            if exc.code in (403, 404, 410):
                log(
                    f"           ! link already used, expired, or forbidden ({exc.code}). "
                    f"Download {filename} manually into {download_dir}."
                )
            else:
                log(f"           ! HTTP {exc.code}: {exc.reason}")
        except (urllib.error.URLError, OSError, ValueError) as exc:
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


def determine_download_dir(source: Path, explicit_dir: Path | None) -> Path:
    """Choose a sensible directory for downloaded .zip files."""
    if explicit_dir is not None:
        return explicit_dir.expanduser().resolve()

    if source.is_dir():
        return source.expanduser().resolve()

    # Source is a file
    parent = source.parent.resolve()
    # If the manifest is located inside a git source tree, don't litter .zip files into it
    is_in_repo = any((parent / marker).exists() for marker in (".git", "package.json", "Cargo.toml"))
    if not is_in_repo:
        # Check parents for repo root
        for ancestor in parent.parents:
            if (ancestor / ".git").exists():
                is_in_repo = True
                break

    if is_in_repo:
        downloads = Path.home() / "Downloads"
        stem = source.stem
        if downloads.exists():
            return (downloads / f"claude-zips-{stem}").resolve()
        return (Path.cwd() / f"claude-zips-{stem}").resolve()

    return parent


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Prepare a Claude data export for import into Aetherium.",
    )
    parser.add_argument(
        "source",
        type=Path,
        help="The export manifest .json, links .txt file, or a folder containing downloaded .zip files.",
    )
    parser.add_argument(
        "-d",
        "--download-dir",
        type=Path,
        default=None,
        help="Directory to store downloaded .zip archives (default: next to manifest, or ~/Downloads if in repo).",
    )
    parser.add_argument(
        "-o",
        "--output",
        type=Path,
        default=None,
        help="Where to write the prepared folder (default: ./claude-export-<name>).",
    )
    parser.add_argument(
        "--download-only",
        action="store_true",
        help="Download and verify .zip archives only; do not unpack.",
    )
    parser.add_argument(
        "--skip-download",
        action="store_true",
        help="Skip downloading even if manifest has URLs; use only existing .zip files.",
    )
    parser.add_argument(
        "--cookies-file",
        type=Path,
        default=None,
        help="Netscape-format cookies.txt with your claude.ai session cookies. "
        "Required because export download URLs need an authenticated session.",
    )
    args = parser.parse_args()

    source = args.source.expanduser().resolve()
    if not source.exists():
        die(f"No such path: {source}")

    cookie_header = None
    if args.cookies_file:
        cookies_path = args.cookies_file.expanduser().resolve()
        if not cookies_path.exists():
            die(f"No such cookies file: {cookies_path}")
        cookie_header = parse_cookies_file(cookies_path)

    download_dir = determine_download_dir(source, args.download_dir)
    found = find_manifest(source)
    zips = []

    if found:
        manifest_path, manifest = found
        created = manifest.get("created_at", "unknown date")
        total_files = manifest.get("total_files", len(manifest.get("data_files", [])))
        log(f"Manifest: {manifest_path.name}  (created: {created})")
        log(f"Listed files: {total_files}")
        log(f"Download destination: {download_dir}\n")

        if not args.skip_download:
            zips = download_missing(download_dir, manifest, cookie_header=cookie_header)
    else:
        log(f"No manifest found — searching for .zip files in {download_dir}\n")

    # Pick up any zips actually present in download_dir
    on_disk = sorted(download_dir.glob("*.zip"))
    for z in on_disk:
        if z not in zips:
            zips.append(z)

    present = [z for z in zips if z.exists() and z.stat().st_size > 0]

    if args.download_only:
        missing = [z.name for z in zips if not (z.exists() and z.stat().st_size > 0)]
        log(f"\nDownload summary in {download_dir}:")
        log(f"  Present: {len(present)} / {len(zips)} file(s)")
        if missing:
            log("  Missing/Failed:")
            for m in missing:
                log(f"    - {m}")
        else:
            log("  All archive files verified.")
            log(f"\nTo unpack and prepare for Aetherium import:")
            log(f"  python3 scripts/prepare_claude_export.py {download_dir}")
        return

    if not present:
        die(
            f"No usable .zip files in {download_dir}.\n"
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
