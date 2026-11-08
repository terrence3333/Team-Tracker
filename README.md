# Tepu Solutions team time tracker

A shared time tracker for Tepu Solutions Limited. Employees sign in with individual accounts, start and stop work timers, and view daily and monthly team hours. The hosted version uses Netlify Functions for the API and Supabase Postgres for persistent shared data.

## Deploy to Netlify

The repository is configured for Netlify. Import [terrence3333/Team-Tracker](https://github.com/terrence3333/Team-Tracker) in Netlify, keep the build command `npm run build` and publish directory `dist`, then deploy. Netlify builds the static interface and the serverless `/api/*` backend from the same repository.

### Connect the database

1. Create or choose a Supabase project for this tracker.
2. In Supabase SQL Editor, run [`supabase/migrations/20261108000000_team_tracker.sql`](supabase/migrations/20261108000000_team_tracker.sql). It creates the tracker-prefixed tables and enables row level security.
3. In Netlify site settings, add these environment variables for Functions (or all scopes):

   | Name | Value |
   | --- | --- |
   | `SUPABASE_URL` | The project URL from Supabase API settings |
   | `SUPABASE_SECRET_KEY` | A Supabase secret key; keep it private and server-side |
   | `TEPU_SETUP_KEY` | A long, random value used once to protect initial admin setup |

   The legacy `SUPABASE_SERVICE_ROLE_KEY` is accepted as a fallback, but a Supabase secret key is preferred. Do not put either key in `index.html`, `app.js`, or any other browser code.

4. Trigger a redeploy after adding the variables. Open the Netlify site, enter the setup key and create the administrator account. Then sign in and create each employee profile from the Productivity snapshot panel.

The setup key is needed only to create the first administrator. Store it in a password manager and do not share it with employees. Employee passwords are stored as salted PBKDF2 hashes; session tokens are stored as hashes and sent in secure, HTTP-only cookies.

## Local development

1. Install Python 3.10 or newer.
2. Run `run.bat` (or run `py -3 server.py` from this folder).
3. Open [http://127.0.0.1:8000](http://127.0.0.1:8000). Create the first admin account, then add employee accounts from the Productivity snapshot panel.

The local Python server stores its data in `tepu_tracker.sqlite3` beside `server.py`. Keep this file private and back it up. Local development and Netlify use separate databases; the Netlify deployment starts with a new Supabase database.

## Verify changes locally

```powershell
py -3 -m unittest -v test_server.py
node --check app.js
npm install
npm run build
```

## Features

- Individual employee accounts and administrator/member roles.
- Start and stop timers with project, description, date, and time.
- Daily and monthly team totals, employee summaries, and recent sessions.
- Shared Supabase storage for the hosted deployment.
- Secure first-admin setup and session handling.
- Local Python/SQLite development mode.

The tracker does not currently include password reset emails, payroll exports, leave tracking, or multi-factor authentication.

