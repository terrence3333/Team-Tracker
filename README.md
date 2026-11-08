# Tepu Solutions time tracker

A small, shared team time tracker. It uses a Python standard-library HTTP server and SQLite, so it does not need Node.js or third-party packages.

## Deploy on Render

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/terrence3333/Team-Tracker)

The included Render Blueprint uses a Singapore web service and a 1 GB persistent disk for the SQLite database. Current listed pricing is about **$7/month for the small web service plus $0.25/month for the disk**, before taxes and currency conversion. Render requires a paid web service for persistent disks; its free service filesystem is temporary, so it is not suitable for this database. See [Render pricing](https://render.com/pricing), [persistent disk behavior](https://render.com/docs/disks), and [Blueprint configuration](https://render.com/docs/blueprint-spec).

After Render deploys, open the service URL and copy the generated `TEPU_SETUP_KEY` from the service's Environment page into the first-run setup form. This prevents someone else from claiming the public workspace before you. Create the administrator account, then add employee accounts in the Productivity snapshot panel. Keep the database disk attached; it stores all member accounts and time entries.

## Start on Windows

1. Install Python 3.10 or newer.
2. Run `run.bat` (or run `py -3 server.py` from this folder).
3. Open [http://127.0.0.1:8000](http://127.0.0.1:8000). The first visitor creates the workspace administrator in the setup screen. Use a unique password with at least 10 characters.
4. Sign in as the administrator and add employee accounts from the Productivity snapshot panel. Share the initial password privately; employees can sign in individually and start their own timers.

The default server listens on this computer only. To let other devices reach it, host it on a private team server with `TEPU_HOST=0.0.0.0` and `TEPU_PORT=8000`, then put an HTTPS reverse proxy in front of it. In PowerShell, set those values with `$env:TEPU_HOST="0.0.0.0"` and `$env:TEPU_PORT="8000"` before `py -3 server.py`. Do not expose the built-in HTTP server directly to the public internet. The SQLite database is created beside `server.py`; the included `.gitignore` keeps it out of Git. Keep regular backups of `tepu_tracker.sqlite3`.

## Included

- Individual email and password accounts, with administrator/member roles.
- Passwords hashed with PBKDF2-HMAC-SHA256 and random salts; session tokens are stored hashed and sent in HttpOnly, SameSite cookies.
- Start and stop timer actions with member, description, project, and date.
- Shared daily and monthly hours, team member summaries, and recent entries.
- SQLite persistence across server restarts.
- First-run admin setup from the browser; the setup endpoint locks after the first account is created.
- A health check at `/healthz` for host monitoring.
- Automated API integration checks: run `py -3 -m unittest -v test_server.py`.

This is a lightweight internal app. It has no password reset, invitation email, payroll export, leave calendar, or multi-factor authentication. Use a managed HTTPS reverse proxy for team deployment and restrict access to the Tepu network.

