# Tepu Solutions time tracker

A small, shared team time tracker. It uses a Python standard-library HTTP server and SQLite, so it does not need Node.js or third-party packages.

## Start on Windows

1. Install Python 3.10 or newer.
2. Run `run.bat` (or run `py -3 server.py` from this folder).
3. On the first start, create the workspace administrator account in the console. Passwords must be at least 10 characters.
4. Open [http://127.0.0.1:8000](http://127.0.0.1:8000) and sign in.
5. As the administrator, add each team member from the Productivity snapshot panel. Give each person their account details privately; members can then sign in individually.

The default server listens on this computer only. To let other devices reach it, run it on a private team server with `TEPU_HOST=0.0.0.0` and `TEPU_PORT=8000`, then put an HTTPS reverse proxy in front of it. In PowerShell, set those values with `$env:TEPU_HOST="0.0.0.0"` and `$env:TEPU_PORT="8000"` before `py -3 server.py`. Do not expose the built-in HTTP server directly to the public internet. The SQLite database is created beside `server.py`; keep regular backups of `tepu_tracker.sqlite3`.

## Included

- Individual email and password accounts, with administrator/member roles.
- Passwords hashed with PBKDF2-HMAC-SHA256 and random salts; session tokens are stored hashed and sent in HttpOnly, SameSite cookies.
- Start and stop timer actions with member, description, project, and date.
- Shared daily and monthly hours, team member summaries, and recent entries.
- SQLite persistence across server restarts.

This is a lightweight internal MVP. It has no password reset, invitation email, payroll export, leave calendar, or multi-factor authentication. Use a managed HTTPS reverse proxy for a team deployment and restrict access to the Tepu network.

