"""Source-only checks with synthetic HTTP requests; no sockets or external calls."""

from html.parser import HTMLParser
from io import BytesIO
from pathlib import Path
import importlib.util
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("static_server", ROOT / "serve.py")
server = importlib.util.module_from_spec(spec)
spec.loader.exec_module(server)


class PageParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.ids = []
        self.assets = []

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if "id" in attrs:
            self.ids.append(attrs["id"])
        if tag in ("script", "link"):
            url = attrs.get("src") or attrs.get("href", "")
            if not url.startswith("https:"):
                self.assets.append(url)


class SyntheticHandler(server.Handler):
    def __init__(self, path):
        self.path = path
        self.wfile = BytesIO()
        self.headers_sent = {}
        self.response_code = None

    def send_response(self, code, message=None):
        self.response_code = code

    def send_header(self, key, value):
        self.headers_sent[key] = value

    def end_headers(self):
        pass

    def send_error(self, code, message=None, explain=None):
        self.response_code = code


class StaticTests(unittest.TestCase):
    def test_only_public_source_files_are_served(self):
        for path in server.PUBLIC_FILES:
            with self.subTest(path=path):
                handler = SyntheticHandler(path)
                handler.do_GET()
                self.assertEqual(handler.response_code, 200)
                self.assertEqual(len(handler.wfile.getvalue()), int(handler.headers_sent["Content-Length"]))

    def test_private_and_arbitrary_paths_never_read(self):
        for path in ["/.env", "/.git/config", "/data.xlsx", "/addresses.csv", "/../index.html", "/%2e%2e/.env", "/src/../index.html"]:
            with self.subTest(path=path):
                handler = SyntheticHandler(path)
                handler.do_GET()
                self.assertEqual(handler.response_code, 404)
                self.assertEqual(handler.wfile.getvalue(), b"")

    def test_head_and_security_headers(self):
        handler = SyntheticHandler("/")
        handler.do_HEAD()
        self.assertEqual(handler.response_code, 200)
        self.assertEqual(handler.wfile.getvalue(), b"")
        self.assertEqual(handler.headers_sent["Cache-Control"], "no-store")
        self.assertIn("https://data.bs.ch", handler.headers_sent["Content-Security-Policy"])

    def test_html_assets_ids_and_javascript_references(self):
        import re
        parser = PageParser()
        parser.feed((ROOT / "index.html").read_text(encoding="utf-8"))
        self.assertEqual(len(parser.ids), len(set(parser.ids)))
        for asset in parser.assets:
            self.assertTrue((ROOT / asset).is_file(), asset)
        app = (ROOT / "src/app.js").read_text(encoding="utf-8")
        for element_id in re.findall(r"\$\('([^']+)'\)", app):
            self.assertIn(element_id, parser.ids)


if __name__ == "__main__":
    unittest.main()
