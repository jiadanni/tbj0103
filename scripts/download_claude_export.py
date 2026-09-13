#!/usr/bin/env python3
"""
scripts/download_claude_export.py

Dedicated helper to download Claude export .zip files from a manifest JSON or
links text file.

Anthropic exports deliver a manifest JSON (e.g. manifest-*.json) or links file
containing single-use download URLs for individual archives (conversations,
projects, memories, design_chats, light_metadata).

Usage:
  # Download all archives into ~/Downloads/claude-zips:
  python3 scripts/download_claude_export.py manifest.json -d ~/Downloads/claude-zips

  # Download from a plain text file containing export links:
  python3 scripts/download_claude_export.py links.txt -d ~/Downloads/claude-zips

  # Download AND unpack/prepare in one step:
  python3 scripts/download_claude_export.py manifest.json --unpack

Stdlib only — works on macOS, Linux, and Windows.
"""

import sys
from pathlib import Path

# Ensure scripts directory is on sys.path
SCRIPTS_DIR = Path(__file__).parent.resolve()
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

from prepare_claude_export import main as prepare_main

if __name__ == "__main__":
    # If --unpack is present, remove it and run prepare mode (download + unpack).
    # Otherwise, default to --download-only mode.
    if "--unpack" in sys.argv:
        sys.argv.remove("--unpack")
    elif "--download-only" not in sys.argv:
        sys.argv.append("--download-only")

    prepare_main()
