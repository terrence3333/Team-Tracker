"""Integration checks for the tracker API, using only Python's standard library."""
import http.cookiejar
import json
import sys
import tempfile
import threading
import unittest
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import HTTPCookieProcessor, Request, build_opener

sys.path.insert(0, str(Path(__file__).resolve().parent))
import server as tracker


class TrackerApiTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        tracker.DB_PATH = Path(self.temp.name) / "test.sqlite3"
        tracker.init_db()
        self.httpd = tracker.ThreadingHTTPServer(("127.0.0.1", 0), tracker.Handler)
        self.thread = threading.Thread(target=self.httpd.serve_forever, daemon=True)
        self.thread.start()
        self.base = f"http://127.0.0.1:{self.httpd.server_address[1]}"
        self.cookies = http.cookiejar.CookieJar()
        self.client = build_opener(HTTPCookieProcessor(self.cookies))

    def tearDown(self):
        self.httpd.shutdown()
        self.httpd.server_close()
        self.thread.join(timeout=2)
        self.temp.cleanup()

    def request(self, path, payload=None, expected=200):
        body = None if payload is None else json.dumps(payload).encode()
        req = Request(self.base + path, data=body, headers={"Content-Type": "application/json"})
        try:
            response = self.client.open(req, timeout=5)
            status, content = response.status, response.read()
        except HTTPError as error:
            status, content = error.code, error.read()
        self.assertEqual(status, expected, content.decode())
        return json.loads(content or b"{}")

    def test_first_run_setup_and_admin_member_creation(self):
        self.assertTrue(self.request("/api/status")["setup_required"])
        created = self.request("/api/setup", {"name":"Tepu Admin","email":"admin@example.com","password":"a-long-test-password"}, 201)
        self.assertEqual(created["member"]["role"], "admin")
        self.assertFalse(self.request("/api/status")["setup_required"])
        self.request("/api/setup", {"name":"Intruder","email":"other@example.com","password":"another-long-password"}, 409)
        result = self.request("/api/members", {"name":"Test Member","email":"member@example.com","password":"member-test-password"}, 201)
        self.assertTrue(result["id"])

    def test_timer_persists_and_month_report_includes_entry(self):
        self.request("/api/setup", {"name":"Tepu Admin","email":"admin@example.com","password":"a-long-test-password"}, 201)
        self.request("/api/timer/start", {"description":"Review client work","project":"Client delivery","date":"2026-11-08","start":"09:30"}, 201)
        self.request("/api/timer/start", {"description":"Second timer","project":"Administration","date":"2026-11-08","start":"09:31"}, 409)
        self.request("/api/timer/stop", {}, 200)
        report = self.request("/api/data?month=2026-11")
        self.assertEqual(len(report["entries"]), 1)
        self.assertGreaterEqual(report["entries"][0]["seconds"], 1)
        self.assertIsNone(report["timer"])

    def test_validation_and_auth_guards(self):
        self.request("/api/data?month=2026-13", None, 401)
        self.request("/api/setup", {"name":"A","email":"bad","password":"short"}, 400)
        self.request("/api/setup", {"name":"Tepu Admin","email":"admin@example.com","password":"a-long-test-password"}, 201)
        self.request("/api/data?month=2026-13", None, 400)
        self.request("/api/timer/start", {"project":"Test","date":"2026-02-30","start":"99:99"}, 400)
        self.request("/api/timer/start", {"project":"Test","date":"2026-11-08","start":"99:99"}, 400)


if __name__ == "__main__":
    unittest.main()

