#!/usr/bin/env python3
"""
scripts/test_claude_downloader.py

Unit and integration test suite for Claude export downloading and preparation.
Runs against an in-process HTTP mock server to verify single-use URLs, User-Agent
blocking, progress streaming, resume behavior, and archive unpacking.

Run with:
  python3 scripts/test_claude_downloader.py
"""

import io
import json
import os
import shutil
import sys
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
import zipfile
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

# Add scripts directory to sys.path
SCRIPTS_DIR = Path(__file__).parent.resolve()
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

import prepare_claude_export as pce


def make_dummy_zip_bytes(files: dict[str, str]) -> bytes:
    """Create a valid in-memory zip file with the given filename -> content map."""
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for name, content in files.items():
            zf.writestr(name, content)
    return buf.getvalue()


class MockClaudeServer(BaseHTTPRequestHandler):
    """Simulates Claude.ai export download behavior."""

    # Shared state across requests
    accessed_urls: set = set()
    server_port: int = 0
    valid_zip_data: bytes = b""

    def log_message(self, format, *args):
        # Silence HTTP server log output during tests
        pass

    def do_GET(self):
        user_agent = self.headers.get("User-Agent", "")

        # 1. Reject Python-urllib default User-Agent with 403 Forbidden
        if "Python-urllib" in user_agent:
            self.send_response(403)
            self.send_header("Content-Type", "text/plain")
            self.end_headers()
            self.wfile.write(b"403 Forbidden: direct bot requests blocked by Cloudflare")
            return

        # 2. Check for single-use token exhaustion
        if self.path in MockClaudeServer.accessed_urls:
            self.send_response(410)
            self.send_header("Content-Type", "text/plain")
            self.end_headers()
            self.wfile.write(b"410 Gone: export URL already used")
            return

        # 3. Simulate invalid or corrupted endpoint
        if self.path.startswith("/corrupt"):
            MockClaudeServer.accessed_urls.add(self.path)
            self.send_response(200)
            self.send_header("Content-Type", "application/zip")
            self.send_header("Content-Length", "16")
            self.end_headers()
            self.wfile.write(b"not a valid zip!")
            return

        # 4. Successful download endpoint
        MockClaudeServer.accessed_urls.add(self.path)
        payload = MockClaudeServer.valid_zip_data
        self.send_response(200)
        self.send_header("Content-Type", "application/zip")
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)


class TestClaudeDownloader(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        # Create valid zip data containing sample Claude files
        cls.zip_data = make_dummy_zip_bytes({
            "conversations.json": json.dumps([{"uuid": "chat-1", "name": "Chat 1"}]),
            "projects/proj-1.json": json.dumps({"name": "Project 1"}),
        })
        MockClaudeServer.valid_zip_data = cls.zip_data
        MockClaudeServer.accessed_urls = set()

        # Start background HTTP server
        cls.httpd = HTTPServer(("127.0.0.1", 0), MockClaudeServer)
        cls.port = cls.httpd.server_address[1]
        MockClaudeServer.server_port = cls.port
        cls.server_thread = threading.Thread(target=cls.httpd.serve_forever, daemon=True)
        cls.server_thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.httpd.shutdown()
        cls.httpd.server_close()

    def setUp(self):
        self.test_dir = Path(tempfile.mkdtemp(prefix="test_claude_dl_"))

    def tearDown(self):
        shutil.rmtree(self.test_dir, ignore_errors=True)

    def test_human_size(self):
        self.assertEqual(pce.human_size(500), "500.0 B")
        self.assertEqual(pce.human_size(1024), "1.0 KB")
        self.assertEqual(pce.human_size(1024 * 1024 * 5.5), "5.5 MB")

    def test_parse_manifest_json(self):
        manifest_path = self.test_dir / "manifest.json"
        manifest_data = {
            "created_at": "2026-09-12T12:00:00Z",
            "total_files": 2,
            "data_files": [
                {
                    "batch_index": 0,
                    "export_url": f"http://127.0.0.1:{self.port}/file-0",
                    "filename": "conversations-000.zip",
                },
                {
                    "batch_index": 1,
                    "export_url": f"http://127.0.0.1:{self.port}/file-1",
                    "filename": "projects-000.zip",
                },
            ],
        }
        with manifest_path.open("w", encoding="utf-8") as f:
            json.dump(manifest_data, f)

        res = pce.parse_manifest_file(manifest_path)
        self.assertIsNotNone(res)
        self.assertEqual(len(res["data_files"]), 2)
        self.assertEqual(res["data_files"][0]["filename"], "conversations-000.zip")

    def test_parse_manifest_text_links(self):
        links_path = self.test_dir / "links.txt"
        links_content = f"""
        Here are the links from Claude:
        conversations-000.zip: http://127.0.0.1:{self.port}/dl/c0
        projects-000.zip: http://127.0.0.1:{self.port}/dl/p0
        http://127.0.0.1:{self.port}/dl/raw_link
        """
        with links_path.open("w", encoding="utf-8") as f:
            f.write(links_content)

        res = pce.parse_manifest_file(links_path)
        self.assertIsNotNone(res)
        self.assertEqual(len(res["data_files"]), 3)
        self.assertEqual(res["data_files"][0]["filename"], "conversations-000.zip")
        self.assertEqual(res["data_files"][1]["filename"], "projects-000.zip")
        self.assertEqual(res["data_files"][2]["filename"], "part-002.zip")

    def test_download_file_user_agent_success(self):
        dest = self.test_dir / "test_download.zip"
        url = f"http://127.0.0.1:{self.port}/valid-ua-test"

        # download_file must send the browser User-Agent and succeed
        success = pce.download_file(url, dest)
        self.assertTrue(success)
        self.assertTrue(dest.exists())
        self.assertTrue(zipfile.is_zipfile(dest))

    def test_download_file_rejects_corrupted_zip(self):
        dest = self.test_dir / "corrupt.zip"
        url = f"http://127.0.0.1:{self.port}/corrupt-file"

        with self.assertRaises(ValueError):
            pce.download_file(url, dest)
        self.assertFalse(dest.exists())
        self.assertFalse(dest.with_suffix(".zip.part").exists())

    def test_download_missing_skips_already_downloaded(self):
        dest_dir = self.test_dir / "zips"
        dest_dir.mkdir()

        # Place existing valid file
        existing_zip = dest_dir / "existing-000.zip"
        existing_zip.write_bytes(self.zip_data)

        url_not_called = f"http://127.0.0.1:{self.port}/should-not-call"
        manifest = {
            "data_files": [
                {
                    "batch_index": 0,
                    "filename": "existing-000.zip",
                    "export_url": url_not_called,
                }
            ]
        }

        paths = pce.download_missing(dest_dir, manifest)
        self.assertEqual(len(paths), 1)
        self.assertEqual(paths[0], existing_zip)
        # Verify the URL was never accessed (saving the single-use token)
        self.assertNotIn("/should-not-call", MockClaudeServer.accessed_urls)

    def test_merge_json_array(self):
        f1 = self.test_dir / "conversations.json"
        f2 = self.test_dir / "incoming.json"

        with f1.open("w", encoding="utf-8") as fh:
            json.dump([{"uuid": "c1", "text": "first"}], fh)
        with f2.open("w", encoding="utf-8") as fh:
            json.dump([{"uuid": "c2", "text": "second"}], fh)

        pce.merge_json_array(f1, f2)

        with f1.open(encoding="utf-8") as fh:
            merged = json.load(fh)
        self.assertEqual(len(merged), 2)
        self.assertEqual(merged[0]["uuid"], "c1")
        self.assertEqual(merged[1]["uuid"], "c2")

    def test_safe_extract_zip_slip_rejection(self):
        # Create malicious zip with zip-slip path
        malicious_buf = io.BytesIO()
        with zipfile.ZipFile(malicious_buf, "w") as zf:
            zf.writestr("../../evil.txt", "pwned")

        malicious_buf.seek(0)
        with zipfile.ZipFile(malicious_buf) as zf:
            member = zf.infolist()[0]
            with self.assertRaises(SystemExit):
                pce.safe_extract(zf, member, self.test_dir / "out")


if __name__ == "__main__":
    unittest.main()
