#!/usr/bin/env python3
"""Tepu Solutions team time tracker (Python standard library + SQLite)."""
from __future__ import annotations

import hashlib
import hmac
import json
import os
import re
import secrets
import sqlite3
import time
import uuid
from contextlib import contextmanager
from datetime import date, datetime
from http import HTTPStatus
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

ROOT = Path(__file__).resolve().parent
DB_PATH = Path(os.environ.get("TEPU_DB_PATH", ROOT / "tepu_tracker.sqlite3"))
HOST = os.environ.get("TEPU_HOST", "127.0.0.1")
PORT = int(os.environ.get("TEPU_PORT", "8000"))
PBKDF2_ROUNDS = 310_000
SESSION_DAYS = 14
MAX_BODY = 64_000


@contextmanager
def connect():
    con = sqlite3.connect(DB_PATH, timeout=15)
    try:
        con.row_factory = sqlite3.Row
        con.execute("PRAGMA foreign_keys=ON")
        con.execute("PRAGMA busy_timeout=15000")
        yield con
        con.commit()
    except Exception:
        con.rollback()
        raise
    finally:
        con.close()


def init_db():
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    with connect() as con:
        con.execute("PRAGMA journal_mode=WAL")
        con.executescript("""
        CREATE TABLE IF NOT EXISTS members (
            id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE,
            role TEXT NOT NULL CHECK(role IN ('admin','member')),
            password_hash TEXT NOT NULL, password_salt TEXT NOT NULL,
            created_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS sessions (
            token_hash TEXT PRIMARY KEY, member_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
            expires_at INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS entries (
            id TEXT PRIMARY KEY, member_id TEXT NOT NULL REFERENCES members(id),
            description TEXT NOT NULL, project TEXT NOT NULL, work_date TEXT NOT NULL,
            start_clock TEXT NOT NULL, started_at INTEGER NOT NULL, ended_at INTEGER,
            seconds INTEGER, created_at INTEGER NOT NULL,
            CHECK(seconds IS NULL OR seconds >= 0)
        );
        CREATE INDEX IF NOT EXISTS entries_work_date_idx ON entries(work_date);
        CREATE INDEX IF NOT EXISTS entries_member_idx ON entries(member_id);
        CREATE INDEX IF NOT EXISTS sessions_expiry_idx ON sessions(expires_at);
        CREATE UNIQUE INDEX IF NOT EXISTS one_active_timer_per_member
            ON entries(member_id) WHERE ended_at IS NULL;
        """)
        con.execute("DELETE FROM sessions WHERE expires_at < ?", (int(time.time()),))


def make_password(password: str):
    salt = secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, PBKDF2_ROUNDS)
    return salt.hex(), digest.hex()


def verify_password(password, salt_hex, expected_hex):
    try:
        actual = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), bytes.fromhex(salt_hex), PBKDF2_ROUNDS).hex()
    except (ValueError, TypeError):
        return False
    return hmac.compare_digest(actual, expected_hex)


def validated_member(name, email, password, role="member"):
    if not isinstance(name, str) or not name.strip() or len(name.strip()) > 100:
        raise ValueError("Enter a name up to 100 characters.")
    if not isinstance(email, str) or len(email) > 254 or not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", email.strip()):
        raise ValueError("Enter a valid email address.")
    if not isinstance(password, str) or len(password) < 10 or len(password) > 200:
        raise ValueError("Password must be at least 10 characters.")
    if role not in ("admin", "member"):
        raise ValueError("Invalid role.")
    salt, digest = make_password(password)
    return (str(uuid.uuid4()), name.strip(), email.strip().lower(), role, digest, salt, int(time.time()))


def public_member(row):
    return {"id": row["id"], "name": row["name"], "email": row["email"], "role": row["role"]}


def json_object(value):
    if not isinstance(value, dict):
        raise ValueError("Request body must be a JSON object.")
    return value


class Handler(BaseHTTPRequestHandler):
    server_version = "TepuTracker/1.1"

    def log_message(self, fmt, *args):
        print("%s - %s" % (self.address_string(), fmt % args))

    def send_json(self, data, status=HTTPStatus.OK, headers=None):
        raw = json.dumps(data, separators=(",", ":")).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(raw)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "same-origin")
        for key, value in (headers or {}).items():
            self.send_header(key, value)
        self.end_headers()
        self.wfile.write(raw)

    def body(self):
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            raise ValueError("Invalid request length.")
        if length < 0 or length > MAX_BODY:
            raise ValueError("Request body is too large.")
        try:
            return json_object(json.loads(self.rfile.read(length) or b"{}"))
        except (json.JSONDecodeError, UnicodeDecodeError):
            raise ValueError("Invalid JSON request.")

    def current_member(self):
        cookie = SimpleCookie()
        try:
            cookie.load(self.headers.get("Cookie", ""))
            token = cookie["tepu_session"].value
        except Exception:
            return None
        token_hash = hashlib.sha256(token.encode()).hexdigest()
        with connect() as con:
            return con.execute("""SELECT m.* FROM sessions s JOIN members m ON m.id=s.member_id
                WHERE s.token_hash=? AND s.expires_at>=?""", (token_hash, int(time.time()))).fetchone()

    def require_member(self):
        member = self.current_member()
        if member is None:
            self.send_json({"error": "Please sign in to continue."}, HTTPStatus.UNAUTHORIZED)
        return member

    def origin_allowed(self):
        origin = self.headers.get("Origin")
        if not origin:
            return True
        try:
            parsed = urlparse(origin)
            return parsed.netloc.lower() == self.headers.get("Host", "").lower() and parsed.scheme in ("http", "https")
        except Exception:
            return False

    def serve_index(self):
        try:
            content = (ROOT / "index.html").read_bytes()
        except OSError:
            return self.send_json({"error": "Tracker page is missing."}, HTTPStatus.INTERNAL_SERVER_ERROR)
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(content)))
        self.send_header("Cache-Control", "no-cache")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "same-origin")
        self.send_header("Content-Security-Policy", "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; img-src 'self' data:")
        self.end_headers()
        self.wfile.write(content)

    def serve_app(self):
        try:
            content = (ROOT / "app.js").read_bytes()
        except OSError:
            return self.send_json({"error": "Tracker script is missing."}, HTTPStatus.INTERNAL_SERVER_ERROR)
        self.send_response(200)
        self.send_header("Content-Type", "text/javascript; charset=utf-8")
        self.send_header("Content-Length", str(len(content)))
        self.send_header("Cache-Control", "no-cache")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "same-origin")
        self.send_header("Content-Security-Policy", "default-src 'self'; script-src 'self'; connect-src 'self'")
        self.end_headers()
        self.wfile.write(content)

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path == "/healthz":
            return self.send_json({"ok": True})
        if parsed.path == "/api/status":
            with connect() as con:
                count = con.execute("SELECT COUNT(*) n FROM members").fetchone()["n"]
            member = self.current_member()
            return self.send_json({"setup_required": count == 0, "member": public_member(member) if member else None})
        if parsed.path == "/api/me":
            member = self.current_member()
            return self.send_json({"member": public_member(member) if member else None})
        if parsed.path == "/api/data":
            member = self.require_member()
            if member is None:
                return
            month = parse_qs(parsed.query).get("month", [""])[0]
            try:
                first = date.fromisoformat(month + "-01") if re.fullmatch(r"\d{4}-\d{2}", month) else None
            except ValueError:
                first = None
            if first is None:
                return self.send_json({"error": "Choose a valid reporting month."}, HTTPStatus.BAD_REQUEST)
            next_month = date(first.year + (first.month == 12), 1 if first.month == 12 else first.month + 1, 1).isoformat()
            with connect() as con:
                rows = con.execute("""SELECT e.*,m.name AS member_name FROM entries e JOIN members m ON m.id=e.member_id
                    WHERE e.work_date>=? AND e.work_date<? ORDER BY e.started_at DESC LIMIT 5000""", (first.isoformat(), next_month)).fetchall()
                users = con.execute("SELECT id,name,email,role FROM members ORDER BY name COLLATE NOCASE").fetchall()
                active = con.execute("SELECT * FROM entries WHERE member_id=? AND ended_at IS NULL ORDER BY started_at DESC LIMIT 1", (member["id"],)).fetchone()
            now = int(time.time())
            entries = [{"id": r["id"], "member_id": r["member_id"], "member_name": r["member_name"],
                "description": r["description"], "project": r["project"], "date": r["work_date"],
                "start": r["start_clock"], "started_at": r["started_at"], "ended_at": r["ended_at"],
                "seconds": r["seconds"] if r["seconds"] is not None else max(0, now-r["started_at"]),
                "running": r["ended_at"] is None} for r in rows]
            timer = None if active is None else {"id": active["id"], "description": active["description"],
                "project": active["project"], "date": active["work_date"], "start": active["start_clock"],
                "started_at": active["started_at"]}
            return self.send_json({"member": public_member(member), "members": [public_member(u) for u in users],
                "entries": entries, "timer": timer})
        if parsed.path == "/app.js":
            return self.serve_app()
        if parsed.path == "/":
            return self.serve_index()
        return self.send_json({"error": "Not found."}, HTTPStatus.NOT_FOUND)

    def set_session_cookie(self, token):
        secure = "; Secure" if self.headers.get("X-Forwarded-Proto", "").lower() == "https" else ""
        return f"tepu_session={token}; Path=/; HttpOnly; SameSite=Strict; Max-Age={SESSION_DAYS*86400}{secure}"

    def create_session(self, con, member_id):
        token = secrets.token_urlsafe(32)
        con.execute("INSERT INTO sessions(token_hash,member_id,expires_at) VALUES(?,?,?)",
            (hashlib.sha256(token.encode()).hexdigest(), member_id, int(time.time()) + SESSION_DAYS * 86400))
        return token

    def do_POST(self):
        path = urlparse(self.path).path
        if not self.origin_allowed():
            return self.send_json({"error": "Request origin is not allowed."}, HTTPStatus.FORBIDDEN)
        try:
            data = self.body()
            if path == "/api/setup":
                values = validated_member(data.get("name"), data.get("email"), data.get("password"), "admin")
                with connect() as con:
                    con.execute("BEGIN IMMEDIATE")
                    if con.execute("SELECT 1 FROM members LIMIT 1").fetchone():
                        return self.send_json({"error": "Workspace setup is already complete."}, HTTPStatus.CONFLICT)
                    con.execute("INSERT INTO members(id,name,email,role,password_hash,password_salt,created_at) VALUES(?,?,?,?,?,?,?)", values)
                    token = self.create_session(con, values[0])
                return self.send_json({"member": {"id": values[0], "name": values[1], "email": values[2], "role": "admin"}},
                    HTTPStatus.CREATED, {"Set-Cookie": self.set_session_cookie(token)})
            if path == "/api/login":
                email = str(data.get("email", "")).strip().lower()
                password = str(data.get("password", ""))
                with connect() as con:
                    row = con.execute("SELECT * FROM members WHERE email=?", (email,)).fetchone()
                if row is None or not verify_password(password, row["password_salt"], row["password_hash"]):
                    return self.send_json({"error": "Email or password is incorrect."}, HTTPStatus.UNAUTHORIZED)
                with connect() as con:
                    token = self.create_session(con, row["id"])
                return self.send_json({"member": public_member(row)}, headers={"Set-Cookie": self.set_session_cookie(token)})
            if path == "/api/logout":
                cookie = SimpleCookie()
                try:
                    cookie.load(self.headers.get("Cookie", ""))
                    token = cookie["tepu_session"].value
                except Exception:
                    token = ""
                if token:
                    with connect() as con:
                        con.execute("DELETE FROM sessions WHERE token_hash=?", (hashlib.sha256(token.encode()).hexdigest(),))
                return self.send_json({"ok": True}, headers={"Set-Cookie": "tepu_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0"})

            member = self.require_member()
            if member is None:
                return
            if path == "/api/timer/start":
                description = str(data.get("description", "")).strip()[:160]
                project = str(data.get("project", "")).strip()[:100]
                work_date = str(data.get("date", ""))
                start_clock = str(data.get("start", ""))
                try:
                    valid_day = date.fromisoformat(work_date).isoformat() == work_date
                except ValueError:
                    valid_day = False
                try:
                    valid_clock = datetime.strptime(start_clock, "%H:%M").strftime("%H:%M") == start_clock
                except ValueError:
                    valid_clock = False
                if not project or not valid_day or not valid_clock:
                    return self.send_json({"error": "Add a project and use a valid date and start time."}, HTTPStatus.BAD_REQUEST)
                now, entry_id = int(time.time()), str(uuid.uuid4())
                try:
                    with connect() as con:
                        con.execute("INSERT INTO entries(id,member_id,description,project,work_date,start_clock,started_at,created_at) VALUES(?,?,?,?,?,?,?,?)",
                            (entry_id, member["id"], description or project, project, work_date, start_clock, now, now))
                except sqlite3.IntegrityError:
                    return self.send_json({"error": "You already have a timer running. Stop it before starting another."}, HTTPStatus.CONFLICT)
                return self.send_json({"ok": True, "id": entry_id}, HTTPStatus.CREATED)
            if path == "/api/timer/stop":
                with connect() as con:
                    row = con.execute("SELECT * FROM entries WHERE member_id=? AND ended_at IS NULL ORDER BY started_at DESC LIMIT 1", (member["id"],)).fetchone()
                    if row is None:
                        return self.send_json({"error": "You do not have a running timer."}, HTTPStatus.CONFLICT)
                    ended, seconds = int(time.time()), max(1, int(time.time()) - row["started_at"])
                    con.execute("UPDATE entries SET ended_at=?,seconds=? WHERE id=?", (ended, seconds, row["id"]))
                return self.send_json({"ok": True, "seconds": seconds})
            if path == "/api/members":
                if member["role"] != "admin":
                    return self.send_json({"error": "Only an administrator can add team members."}, HTTPStatus.FORBIDDEN)
                values = validated_member(data.get("name"), data.get("email"), data.get("password"), "member")
                try:
                    with connect() as con:
                        con.execute("INSERT INTO members(id,name,email,role,password_hash,password_salt,created_at) VALUES(?,?,?,?,?,?,?)", values)
                except sqlite3.IntegrityError:
                    return self.send_json({"error": "That email already has an account."}, HTTPStatus.CONFLICT)
                return self.send_json({"ok": True, "id": values[0]}, HTTPStatus.CREATED)
            return self.send_json({"error": "Not found."}, HTTPStatus.NOT_FOUND)
        except ValueError as exc:
            return self.send_json({"error": str(exc)}, HTTPStatus.BAD_REQUEST)
        except (BrokenPipeError, ConnectionResetError):
            return


if __name__ == "__main__":
    init_db()
    print(f"Tepu time tracker listening on http://{HOST}:{PORT}")
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()

