#!/usr/bin/env python3
"""Small shared time-tracking server for Tepu Solutions."""
from __future__ import annotations

import getpass
import hashlib
import hmac
import json
import os
import re
import secrets
import sqlite3
import time
import uuid
from datetime import datetime, timezone
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


def connect():
    con = sqlite3.connect(DB_PATH, timeout=15)
    con.row_factory = sqlite3.Row
    con.execute("PRAGMA foreign_keys = ON")
    return con


def init_db():
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    with connect() as con:
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
            seconds INTEGER, created_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS entries_work_date_idx ON entries(work_date);
        CREATE INDEX IF NOT EXISTS entries_member_idx ON entries(member_id);
        CREATE INDEX IF NOT EXISTS sessions_expiry_idx ON sessions(expires_at);
        """)
        con.execute("DELETE FROM sessions WHERE expires_at < ?", (int(time.time()),))


def make_password(password: str):
    salt = secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, PBKDF2_ROUNDS)
    return salt.hex(), digest.hex()


def verify_password(password, salt_hex, expected_hex):
    actual = hashlib.pbkdf2_hmac("sha256", password.encode(), bytes.fromhex(salt_hex), PBKDF2_ROUNDS).hex()
    return hmac.compare_digest(actual, expected_hex)


def create_member(name, email, password, role="member"):
    if not isinstance(name, str) or not name.strip() or len(name.strip()) > 100:
        raise ValueError("Enter a name up to 100 characters.")
    if not isinstance(email, str) or not re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", email.strip()):
        raise ValueError("Enter a valid email address.")
    if not isinstance(password, str) or len(password) < 10 or len(password) > 200:
        raise ValueError("Password must be at least 10 characters.")
    if role not in ("admin", "member"):
        raise ValueError("Invalid role.")
    salt, digest = make_password(password)
    member_id = str(uuid.uuid4())
    with connect() as con:
        con.execute("INSERT INTO members(id,name,email,role,password_hash,password_salt,created_at) VALUES(?,?,?,?,?,?,?)",
                    (member_id, name.strip(), email.strip().lower(), role, digest, salt, int(time.time())))
    return member_id


def bootstrap_admin():
    with connect() as con:
        count = con.execute("SELECT COUNT(*) n FROM members").fetchone()["n"]
    if count:
        return
    print("\nFirst start: create the Tepu workspace administrator.")
    name = input("Admin name: ").strip()
    email = input("Admin email: ").strip()
    while True:
        password = getpass.getpass("Admin password (10+ characters): ")
        if len(password) >= 10:
            break
        print("Use at least 10 characters.")
    create_member(name, email, password, "admin")
    print("Administrator created. Sign in through the tracker page.\n")


def public_member(row):
    return {"id": row["id"], "name": row["name"], "email": row["email"], "role": row["role"]}


class Handler(BaseHTTPRequestHandler):
    server_version = "TepuTracker/1.0"

    def log_message(self, fmt, *args):
        print("%s - %s" % (self.address_string(), fmt % args))

    def send_json(self, data, status=HTTPStatus.OK, headers=None):
        raw = json.dumps(data, separators=(",", ":")).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(raw)))
        self.send_header("Cache-Control", "no-store")
        for key, value in (headers or {}).items():
            self.send_header(key, value)
        self.end_headers()
        self.wfile.write(raw)

    def body(self):
        length = min(int(self.headers.get("Content-Length", "0")), 1_000_000)
        try:
            return json.loads(self.rfile.read(length) or b"{}")
        except (json.JSONDecodeError, UnicodeDecodeError):
            raise ValueError("Invalid JSON request.")

    def current_member(self):
        cookie = SimpleCookie()
        try:
            cookie.load(self.headers.get("Cookie", ""))
            token = cookie["tepu_session"].value
        except (KeyError, Exception):
            return None
        token_hash = hashlib.sha256(token.encode()).hexdigest()
        with connect() as con:
            row = con.execute("SELECT m.* FROM sessions s JOIN members m ON m.id=s.member_id WHERE s.token_hash=? AND s.expires_at>=?",
                              (token_hash, int(time.time()))).fetchone()
        return row

    def require_member(self):
        member = self.current_member()
        if not member:
            self.send_json({"error": "Please sign in to continue."}, HTTPStatus.UNAUTHORIZED)
        return member

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path == "/api/me":
            member = self.current_member()
            return self.send_json({"member": public_member(member) if member else None})
        if parsed.path == "/api/data":
            member = self.require_member()
            if member is None: return
            month = parse_qs(parsed.query).get("month", [""])[0]
            if not re.fullmatch(r"\d{4}-\d{2}", month):
                return self.send_json({"error": "Choose a valid reporting month."}, HTTPStatus.BAD_REQUEST)
            start, end = month + "-01", month + "-32"
            with connect() as con:
                rows = con.execute("""SELECT e.*,m.name AS member_name FROM entries e JOIN members m ON m.id=e.member_id
                    WHERE e.work_date>=? AND e.work_date<? ORDER BY e.started_at DESC LIMIT 5000""", (start, end)).fetchall()
                users = con.execute("SELECT id,name,email,role FROM members ORDER BY name COLLATE NOCASE").fetchall()
                active = con.execute("SELECT * FROM entries WHERE member_id=? AND ended_at IS NULL ORDER BY started_at DESC LIMIT 1", (member["id"],)).fetchone()
            entries = [{"id":r["id"],"member_id":r["member_id"],"member_name":r["member_name"],"description":r["description"],"project":r["project"],"date":r["work_date"],"start":r["start_clock"],"started_at":r["started_at"],"ended_at":r["ended_at"],"seconds":r["seconds"] if r["seconds"] is not None else max(0,int(time.time())-r["started_at"]),"running":r["ended_at"] is None} for r in rows]
            timer = None if not active else {"id":active["id"],"description":active["description"],"project":active["project"],"date":active["work_date"],"start":active["start_clock"],"started_at":active["started_at"]}
            return self.send_json({"member":public_member(member),"members":[public_member(u) for u in users],"entries":entries,"timer":timer})
        if parsed.path == "/":
            return self.serve_index()
        return self.send_json({"error":"Not found."}, HTTPStatus.NOT_FOUND)

    def serve_index(self):
        try:
            data = (ROOT / "index.html").read_bytes()
        except OSError:
            return self.send_json({"error":"Tracker page is missing."}, HTTPStatus.INTERNAL_SERVER_ERROR)
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Content-Security-Policy", "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:")
        self.end_headers()
        self.wfile.write(data)

    def do_POST(self):
        path = urlparse(self.path).path
        try:
            data = self.body()
            if path == "/api/login":
                email = str(data.get("email", "")).strip().lower()
                password = str(data.get("password", ""))
                with connect() as con:
                    row = con.execute("SELECT * FROM members WHERE email=?", (email,)).fetchone()
                if not row or not verify_password(password, row["password_salt"], row["password_hash"]):
                    return self.send_json({"error":"Email or password is incorrect."}, HTTPStatus.UNAUTHORIZED)
                token = secrets.token_urlsafe(32)
                with connect() as con:
                    con.execute("INSERT INTO sessions(token_hash,member_id,expires_at) VALUES(?,?,?)",
                                (hashlib.sha256(token.encode()).hexdigest(), row["id"], int(time.time())+SESSION_DAYS*86400))
                secure = "; Secure" if self.headers.get("X-Forwarded-Proto", "").lower() == "https" else ""
                cookie = f"tepu_session={token}; Path=/; HttpOnly; SameSite=Strict; Max-Age={SESSION_DAYS*86400}{secure}"
                return self.send_json({"member":public_member(row)}, headers={"Set-Cookie":cookie})
            if path == "/api/logout":
                cookie = SimpleCookie()
                try: cookie.load(self.headers.get("Cookie", "")); token = cookie["tepu_session"].value
                except Exception: token = ""
                if token:
                    with connect() as con: con.execute("DELETE FROM sessions WHERE token_hash=?", (hashlib.sha256(token.encode()).hexdigest(),))
                return self.send_json({"ok":True}, headers={"Set-Cookie":"tepu_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0"})
            member = self.require_member()
            if member is None: return
            if path == "/api/timer/start":
                description = str(data.get("description", "")).strip()[:160]
                project = str(data.get("project", "")).strip()[:100]
                work_date = str(data.get("date", ""))
                start_clock = str(data.get("start", ""))
                if not project or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", work_date) or not re.fullmatch(r"\d{2}:\d{2}", start_clock):
                    return self.send_json({"error":"Add a project and use a valid date and start time."}, HTTPStatus.BAD_REQUEST)
                with connect() as con:
                    existing = con.execute("SELECT id FROM entries WHERE member_id=? AND ended_at IS NULL", (member["id"],)).fetchone()
                    if existing: return self.send_json({"error":"You already have a timer running. Stop it before starting another."}, HTTPStatus.CONFLICT)
                    now = int(time.time()); entry_id = str(uuid.uuid4())
                    con.execute("INSERT INTO entries(id,member_id,description,project,work_date,start_clock,started_at,created_at) VALUES(?,?,?,?,?,?,?,?)",
                                (entry_id,member["id"],description or project,project,work_date,start_clock,now,now))
                return self.send_json({"ok":True,"id":entry_id}, HTTPStatus.CREATED)
            if path == "/api/timer/stop":
                with connect() as con:
                    row = con.execute("SELECT * FROM entries WHERE member_id=? AND ended_at IS NULL ORDER BY started_at DESC LIMIT 1",(member["id"],)).fetchone()
                    if not row: return self.send_json({"error":"You do not have a running timer."}, HTTPStatus.CONFLICT)
                    ended = int(time.time()); seconds = max(1,ended-row["started_at"])
                    con.execute("UPDATE entries SET ended_at=?,seconds=? WHERE id=?",(ended,seconds,row["id"]))
                return self.send_json({"ok":True,"seconds":seconds})
            if path == "/api/members":
                if member["role"] != "admin": return self.send_json({"error":"Only an administrator can add team members."}, HTTPStatus.FORBIDDEN)
                name,email,password = data.get("name"),data.get("email"),data.get("password")
                try: member_id=create_member(name,email,password)
                except sqlite3.IntegrityError: return self.send_json({"error":"That email already has an account."}, HTTPStatus.CONFLICT)
                except ValueError as exc: return self.send_json({"error":str(exc)}, HTTPStatus.BAD_REQUEST)
                return self.send_json({"ok":True,"id":member_id}, HTTPStatus.CREATED)
            return self.send_json({"error":"Not found."}, HTTPStatus.NOT_FOUND)
        except ValueError as exc:
            return self.send_json({"error":str(exc)}, HTTPStatus.BAD_REQUEST)
        except (BrokenPipeError, ConnectionResetError):
            return


if __name__ == "__main__":
    init_db()
    bootstrap_admin()
    print(f"Tepu time tracker listening on http://{HOST}:{PORT}")
    print("For a shared team, bind to your private network and put HTTPS in front of this server.")
    ThreadingHTTPServer((HOST, PORT), Handler).serve_forever()

