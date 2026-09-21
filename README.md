# UCAS CareerSync AI — Full-Stack Application

A real three-tier application: **browser frontend → Node.js REST API → SQLite database**,
all with **zero external npm dependencies** for the backend (built on Node 22's
built-ins: `node:sqlite`, `crypto`, `http`, `net`/`tls`, `fetch`). This was a
deliberate choice — it means `npm install` can never fail due to a broken
dependency, and it let me actually run and test every piece of this backend
locally rather than writing code I couldn't verify.

Everything described below was run and tested against a live server and a
live database during development — 35 backend HTTP integration tests plus a
16-step real-browser end-to-end test (registration → login → recruiter
approval → job posting → application → interview scheduling → certificates),
all passing against the real, running stack.

---

## 1. Project structure

```
/
├── package.json          — root scripts Render actually runs (start/build/migrate/seed)
├── boot.js                — resilient entrypoint `npm start` actually runs — locates and
│                             starts backend/server.js, and prints a clear diagnostic instead
│                             of a bare crash if the repo/Root Directory is misconfigured
├── render.yaml            — Render Blueprint (Node web service + health check)
├── .env.example            — every real environment variable, documented
├── .gitignore
├── backend/
│   ├── server.js            — HTTP server: serves the API (/api/*) and the frontend (everything else)
│   ├── db.js                 — SQLite connection + full schema (10 tables)
│   ├── migrate.js             — idempotent schema setup (`npm run migrate`)
│   ├── seed.js                  — first-admin bootstrap (`npm run seed:admin`)
│   ├── package.json              — backend-only scripts, for local backend dev
│   ├── test-api.js                — 35-check HTTP integration test suite
│   ├── data/                       — SQLite database file lives here (gitignored)
│   └── lib/
│       ├── auth.js                   — scrypt password hashing + hand-rolled HS256 JWT
│       ├── util.js                    — request helpers, ID generation
│       ├── careerLogic.js              — job-match scoring (server-side source of truth)
│       ├── routes.js                    — every API route (auth, students, jobs, applications,
│       │                                  interviews, certificates, notifications, admin, AI proxy)
│       ├── ai.js                          — Gemini/OpenAI proxy (server holds the key)
│       ├── email.js                        — real SMTP client (hand-rolled, no nodemailer needed)
│       └── sms.js                           — real Twilio REST call (no SDK needed)
└── frontend/
    └── public/
        └── index.html         — the entire frontend: HTML+CSS+JS, calls the backend via fetch
```

## 2. What was actually built (and verified) this pass

- **Real database**: 10-table SQLite schema (`users`, `students`, `recruiters`,
  `admins`, `jobs`, `applications`, `interviews`, `certificates`,
  `notifications`, `audit_logs`), foreign keys, indexes. Verified to persist
  correctly across a full server restart.
- **Real authentication**: scrypt password hashing (no plaintext, no bcrypt
  dependency needed), hand-rolled but RFC-7519-correct HS256 JWTs — verified
  with valid/tampered/expired token tests against Node's actual crypto module.
- **Role-based access control**: student/recruiter/admin routes are enforced
  server-side (not just hidden in the UI) — verified that a student gets 403
  on admin routes, and a recruiter gets 404 (not another recruiter's data)
  when trying to view a different company's applicants.
- **Full workflow, end to end, through the real UI**: student registers →
  logs in → edits profile → recruiter registers → admin approves → recruiter
  posts a job → job appears in the marketplace → student applies through the
  multi-step application wizard → recruiter shortlists → recruiter schedules
  an interview → student sees it → certificates CRUD.
- **First-admin bootstrap**: there's intentionally no public "become an
  admin" endpoint (that would be a security hole). `npm run seed:admin`
  creates the first one from environment variables; every admin after that
  is created from inside the Admin Management page, capped at 3 active
  admins (enforced server-side, tested).
- **Honest AI/email/SMS**: all three have real integration code (a real
  fetch to Gemini/OpenAI, a real hand-rolled SMTP client, a real Twilio REST
  call) gated on environment variables. With no credentials configured, they
  report "not configured" — verified this is what actually happens, not
  assumed.

## 3. What's explicitly NOT migrated to the backend (said plainly, not hidden)

- **Resume builder** still stores resume documents in the browser's
  IndexedDB, not the server — there's no `/api/resumes` route. Everything
  else (profile, jobs, applications, interviews, certificates) is real
  backend data; resumes are the one exception, called out in a code comment
  at `studentResume()` in the frontend.
- **CSV bulk student import** was removed rather than left silently broken —
  it used to write directly to a client-side store that no longer exists.
  Creating accounts one at a time via registration works fully; bulk import
  would need a dedicated backend endpoint, which wasn't built this pass.
- **Recruiter platform-wide candidate search** was intentionally not
  rebuilt — recruiters can only see student profiles through actual
  applications to their own jobs, which is arguably the more correct
  privacy default anyway, but it is a scope reduction from the original ask.
- **Admin-invites-admin by email** exists and is capped at 3, but there's no
  email actually sent to the invitee (the email service exists and is wired
  into registration/application/interview flows, just not this one).

## 4. Database: SQLite now, Postgres later — read this before deploying

Render's **free/standard web service instances have ephemeral disks** — the
SQLite file is wiped on every redeploy and on restarts. That's fine for
demoing and grading, not fine for a real production rollout with real
students. Two ways to fix it when you're ready:

- **Cheapest**: attach a [Render Persistent Disk](https://render.com/docs/disks)
  (paid) and set `DB_PATH` to a path on it.
- **More standard**: swap `backend/db.js` for a Postgres connection using
  Render's managed Postgres and the `pg` npm package. The schema in
  `db.js` is written in portable SQL specifically so this swap is
  mechanical (same table/column names, same query shapes in `routes.js`) —
  not a rewrite of the application logic, "just" a different `db.js`.

## 5. Environment variables — exact list

See `.env.example` for the full documented list. Summary:

| Variable | Required? | Purpose |
|---|---|---|
| `JWT_SECRET` | **Yes** | Signs login sessions. `render.yaml` auto-generates this on Render. |
| `FIRST_ADMIN_EMAIL` / `FIRST_ADMIN_PASSWORD` | Yes, once | Only used by `npm run seed:admin`, not at normal runtime. |
| `PORT` | No | Render sets this automatically. |
| `FRONTEND_ORIGIN` | No | Only needed if frontend and backend are ever split into separate services. |
| `AI_PROVIDER` + `GEMINI_API_KEY` or `OPENAI_API_KEY` | No | Enables real UCASION AI responses. Without it, the app says so honestly. |
| `SMTP_HOST/PORT/USER/PASSWORD/FROM` | No | Enables real email sending. Without it, "not configured." |
| `SMS_ACCOUNT_SID/AUTH_TOKEN/FROM` | No | Enables real SMS via Twilio. Without it, "not configured." |

## 6. Exact commands

```bash
npm install          # no-op today — zero dependencies — but real and safe to run
npm run migrate        # creates the database schema (idempotent, safe to rerun)
FIRST_ADMIN_EMAIL=admin@ucas.edu.in FIRST_ADMIN_PASSWORD="ChangeMe123!" npm run seed:admin
npm start                # starts the combined server on $PORT (default 4000)
npm test                  # runs the 35-check backend integration suite (start the server first)
```

## 7. Exact Render deployment steps

**Step A — push the repo correctly.**
On GitHub.com (in the browser — not just your local folder), the files
`package.json`, `render.yaml`, `boot.js`, `backend/`, and `frontend/` must
be visible **directly at the repo root**. If instead you see a subfolder
(e.g. `ucas-careersync-ai-fullstack/backend/...`), that subfolder is the
single most common cause of `Cannot find module '.../backend/server.js'`
on Render — either move everything up one level and re-push, or set
`rootDir` in `render.yaml` to that subfolder's exact name.

**Step B — deploy on Render.**
1. Render → **New → Blueprint** → point at the repo. `render.yaml`
   configures everything: Node web service, `npm install` → `npm start`,
   a health check at `/health`, and an auto-generated `JWT_SECRET`.
   - Or **New → Web Service** manually with `Build Command: npm install`
     and `Start Command: npm start` if you'd rather not use the Blueprint.
     If you deploy manually, also set **Root Directory** in the service's
     Settings tab — leave it blank/empty if `package.json` is at the repo
     root; this field silently overrides anything in `render.yaml`.
2. Confirm the **Branch** Render is building (Settings tab) is the same
   branch that actually has `backend/server.js` when you view it on
   GitHub.com. A branch mismatch deploys different code than you expect
   and can itself produce this exact error.
3. Deploy, then watch the build/deploy logs. On a successful start you
   will see (from `boot.js` and `server.js`):
   ```
   boot.js: running from /opt/render/project/src
   UCAS CareerSync AI listening on 0.0.0.0:<port>
   ```
   If instead you see `FATAL: backend/server.js could not be found`,
   `boot.js` already searched the whole checkout and it genuinely isn't
   there — go back to Step A and check GitHub.com directly.
4. After the first successful deploy, open a **Shell** from the Render
   dashboard for this service and run:
   ```bash
   FIRST_ADMIN_EMAIL=your-real-admin@ucas.edu.in FIRST_ADMIN_PASSWORD="a-strong-password" npm run seed:admin
   ```
   (Do this once — the script is a no-op if an admin already exists.)
5. In the Environment tab, optionally add `AI_PROVIDER`/`GEMINI_API_KEY`,
   `SMTP_*`, `SMS_*` if you want those features live.
6. Verify:
   - `https://<your-app>.onrender.com/health` → `{"status":"ok","service":"CareerSync AI"}`
   - `https://<your-app>.onrender.com/api/health` → includes a real DB check
   - `https://<your-app>.onrender.com/` → the app loads
   - Log in at `/#/admin/login` with the admin you just seeded.
7. Free-tier services spin down on inactivity — the first request after
   idle will be slow (cold start). Normal for that tier, not a bug.

## 8. What still requires an external service/API key to actually work

- **AI conversation with UCASION** beyond the built-in local knowledge base
  requires a Gemini or OpenAI API key (`AI_PROVIDER` + key).
- **Actual email delivery** requires a real SMTP account (Gmail app
  password, SendGrid, etc.) in `SMTP_*`.
- **Actual SMS delivery** requires a real Twilio account in `SMS_*`.

None of these are faked when absent — the app says "not configured" and
keeps working for everything else.
