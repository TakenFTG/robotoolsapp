# robotools.app — A Digital Judging Room for VEX Robotics Competitions

Before robotools.app, judging meant paper rubrics, sticky notes, and hours of sorting through documents. Paper workflows are time‑consuming and hard to organize; determining award winners is tedious and error‑prone. After the event, piles of confidential judging materials must be destroyed securely.

By digitizing the judging steps (interviews, rubrics, nominations, rankings), robotools.app streamlines the process, reduces errors, and keeps materials confidential. Judges can share the same Judges' Room across multiple devices, making collaboration faster and easier.

robotools.app is an open source project aligned with the GRSF VEX Competition judging guidelines. The system is designed to support Judge Advisors and Judges through the process while preserving confidentiality and helping prevent errors. Event Partners may self‑host the application to have full control over the system. A self‑hosting guide is provided below.

## What robotools.app does for you

This system is aligned with the GRSF VEX Competition judging guidelines, mapping app features directly to each judging activity in a typical event.

- Import teams and event info from VEX Events, set up awards and divisions
- Invite Judges to a shared Judges' Room via link
- Submit Interview and Engineering Notebook rubrics digitally
- Shortlist nominees per award and track follow‑ups
- View performance data and Excellence eligibility in real time
- Rank winners and re-order teams without worrying about duplicate judged awards
- Keep confidential materials in one secure place and delete them afterward

## Quick Start (Hosted)

1. Go to `https://robotools.app/app`
2. Paste the Judges' Room invite link to join, or start a new event
3. Follow the on‑screen steps: Event Setup → Role Selection → Workspace

You can always return to the same room from the saved permit on your device.

## Self‑Hosting

Prerequisites:

- Bun
- Node.js 22 or later (the server runs on it, and `better-sqlite3` is built against it)

Steps:

1. Install workspaces

```bash
# From repo root
bun install
```

2. Build the web app for production

```bash
cd web && bun run build
```

This produces static assets in `web/build` (SvelteKit adapter-static).

3. Build and run the server (serves `web/build`)

```bash
cd ../worker && bun run build && bun run start
```

Notes:

- The server serves the static assets from `web/build` by default; set `STATIC_DIR` to override, or `none` to run API-only.
- Default port is http://localhost:8787, configurable with `PORT`.
- Data is written to `worker/data` by default; set `DATA_DIR` to move it.
- Keep the terminal open while running. Press Ctrl+C to stop — it closes the databases cleanly.

### Self-hosting

The server is a single Node process with a directory of SQLite files. There is no external
database, no object store, and no cloud dependency. Team interview photos live in the room's
own database and are deleted with it.

A `Dockerfile` is included. Build it from the repo root and mount a volume at `/data`:

```bash
docker build -t robotools .
docker run -p 8787:8787 -v robotools-data:/data --env-file robotools.env robotools
```

Configuration is by environment variable. All are optional:

- `ROBOTEVENTS_TOKEN`: VEX Events (RobotEvents) API key, used for event import and the Matches tab.
- `ADMIN_USERNAME`, `ADMIN_PASSWORD`: enable the operator admin view at `/admin`. Set both or neither.
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM`, `SMTP_SECURE`, `SMTP_EHLO_NAME`, `PUBLIC_ORIGIN`: email access links to judges. `SMTP_HOST`, `SMTP_FROM` and `PUBLIC_ORIGIN` go together.
- `RETENTION_ENABLED`, `RETENTION_WARN_AFTER_DAYS`, `RETENTION_DELETE_AFTER_DAYS`: delete idle events (defaults: warn after 6 days, delete after 7).
- `PORT`, `HOST`, `DATA_DIR`, `STATIC_DIR`: where the server listens and keeps its files.

For local development, copy `worker/.env.example` to `worker/.env`.

Optional: Update database schema (Drizzle ORM)

```bash
# Generate migrations from schema changes
cd worker && bun run db:generate
```

Self‑hosting responsibilities:

- You are responsible for privacy, security, and compliance when self‑hosting.
- The hosted privacy policy applies only to `robotools.app`. Follow the confidentiality practices in the GRSF judging guidelines (e.g., secure access, destroy materials post‑event).
- Interview photos are stored in the room's own database and are deleted when the room is destroyed. Your obligation is to back up and secure the data directory, and to destroy rooms after an event.

## Judge Advisor access

There is no Judge Advisor PIN. Access links are issued per person and emailed directly, so the
link is the credential: whoever holds a Judge Advisor link enters the room as that advisor. Treat
it like a password, and rotate it from the Users dialog if it goes astray, which signs out every
device still using the old one. An event group link works the same way, for every division in the
group at once, and is rotated from the event group.

Judges are unaffected. Their access links work exactly as before.

### Multiple Judge Advisors

A room can have several Judge Advisors, all with equal powers. Add them from the Users dialog;
each gets their own access link, so no advisor ever knows another's credentials.

- **Independent links.** Rotating your own access link signs out your other devices, not your
  colleagues'.
- **Two removals are refused:** you cannot remove yourself, and you cannot remove the last
  advisor — a room with access control on and no Judge Advisor could never be administered or
  destroyed again.

## How robotools.app aligns with GRSF judging guidelines

- Confidentiality: Deliberation notes, rankings, and materials stay inside the Judges' Room; easy to delete at event end.
- Award types: Supports Performance, Judged (Excellence, Design, Innovate, Judges Award, etc.), and Volunteer Nominated (Sportsmanship, Energy) workflows. Event Partners can add custom awards to the system if needed.
- Deliberations: Supports the GRSF deliberation workflow — nominate candidates, gather additional information, review event data, select winners, enter winners, and secure materials. See the Judging Deliberations and Preparing For and Judging at an Event articles in the GRSF judging guidelines.
- Excellence award guardrails: Helps avoid duplicate judged awards and cascades rankings when winners change.

## Development

### Install

```bash
bun install
```

### Run

```bash
cd web && bun run dev
cd worker && bun run dev
```

## Architecture

- `wrpc`: Bidirectional, type‑safe WebSocket RPC
- `worker`: Node server — HTTP, WebSockets, and a SQLite file per room; serves static assets in production
- `web`: SvelteKit UI built to static site; connects to the server via HTTP/WebSocket
- `protocol`: Zod schemas and shared types

Key configs: `worker/drizzle.config.ts` (and the group/admin variants), `Dockerfile`

## Data Privacy

See https://robotools.app/privacy for more details.

## Attribution

This project is a modified version of [judgesroom.com](https://github.com/Jerrylum/judgesroom.com)
by Jerrylum, used under the [GNU General Public License v3.0](https://www.gnu.org/licenses/gpl-3.0.html).
It has been modified from the original since August 2026.

Modifications include multi-event support with event groups, an operator admin view, a
port from Cloudflare Workers to a self-hosted Node server with SQLite storage, and a new
referee app at `/ref`. In the referee app, referees log match and skills incidents and keep notes, and those notes can be
shared with linked Judges' Rooms for Judge Advisors to see.

This project remains licensed under GPL-3.0. See [LICENSE](LICENSE).
