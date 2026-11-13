# robotools.app

Judging and referee tools for VEX Robotics Competitions, in the browser.

robotools.app runs an event's judging without paper. Judges score team interviews and engineering
notebooks on their own devices, a Judge Advisor sees every rubric and nomination as it comes in,
and the award deliberation happens in the same room. When the event is over, the Judge Advisor
destroys the room and every confidential note, score and photo goes with it.

Referees get their own space at `/ref` for match and skills incident notes. Those notes can be
shared with the Judges' Room, so Judge Advisors see a team's on-field record while deciding awards.

The hosted version is at [robotools.app](https://robotools.app). Event Partners who would rather
keep everything on their own hardware can run it themselves; see [Running your own](#running-your-own).

This project is a modified version of [judgesroom.com](https://github.com/Jerrylum/judgesroom.com)
by Jerrylum, used under the [GNU General Public License v3.0](https://www.gnu.org/licenses/gpl-3.0.html).
It has been modified from the original since August 2026.

## Features

**Judging**

- Pull teams, divisions and matches straight from VEX Events, then choose the awards on offer.
- Score interview and engineering notebook rubrics on any device.
- Nominate teams for each award and keep track of the follow-up interviews still to do.
- Check Excellence eligibility against live performance data.
- Rank each award's finalists. A team can win only one judged award, so placing a team
  moves the next one up in every other ranking.
- Run several divisions as one event group, with Judge Advisors who look after all of them.

**Referees**

- Log match and skills incidents by team, with the rule codes the event uses most a tap away.
- Keep notes private to the referees, or share them with linked Judges' Rooms.

**Access and privacy**

- Everyone gets their own access link, by email or QR code. There are no shared PINs, and a
  lost link can be replaced, which signs out the old one.
- Events nobody has opened for a week are deleted automatically, after a warning to export results.

## Using the hosted version

Go to [robotools.app](https://robotools.app) and choose **Access Judging** or **Access Referee**.
Start a new event there, or open the access link you were sent. Once a device has joined, it can
reopen the room without the link.

## Running your own

The server is one Node process that keeps a SQLite file per room. It needs no external database,
object store or cloud service.

### With Docker

```bash
docker build -t robotools .
docker run -p 8787:8787 -v robotools-data:/data --env-file robotools.env robotools
```

The app is then at http://localhost:8787. Everything it stores is in the `/data` volume.

### From source

You need Bun and Node.js 22 or later.

```bash
bun install
cd web && bun run build
cd ../worker && bun run build && bun run start
```

The server listens on port 8787, serves the built web app from `web/build`, and writes its data
to `worker/data`. Stop it with Ctrl+C, which closes the databases cleanly.

### Configuration

Everything is set by environment variable, and all of it is optional:

| Variables | What they do |
|---|---|
| `ROBOTEVENTS_TOKEN` | VEX Events API key, for importing events and the Matches tab. |
| `ADMIN_USERNAME`, `ADMIN_PASSWORD` | Turn on the operator view at `/admin`. Set both or neither. |
| `SMTP_HOST`, `SMTP_FROM`, `PUBLIC_ORIGIN` | Email access links. These three go together. |
| `SMTP_PORT`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_SECURE`, `SMTP_EHLO_NAME` | Fine-tune the mail connection. |
| `RETENTION_ENABLED`, `RETENTION_WARN_AFTER_DAYS`, `RETENTION_DELETE_AFTER_DAYS` | Idle-event deletion. On by default: warn at 6 days, delete at 7. |
| `PORT`, `HOST`, `DATA_DIR`, `STATIC_DIR` | Where the server listens and keeps its files. `STATIC_DIR=none` serves the API only. |

### Your responsibilities

If you run your own copy, its privacy, security and backups are yours to look after. The
robotools.app [privacy policy](https://robotools.app/privacy) covers only the hosted version. Back
up and protect the data directory, and destroy rooms once an event is over.

## Judge Advisor access

There is no Judge Advisor PIN. Access links are issued per person and emailed directly, so the
link is the credential: whoever holds a Judge Advisor link enters the room as that advisor. Treat
it like a password, and rotate it from the Users dialog if it goes astray, which signs out every
device still using the old one. An event group link works the same way, for every division in the
group at once, and is rotated from the event group.

### Multiple Judge Advisors

A room can have several Judge Advisors, all with equal powers. Add them from the Users dialog;
each gets their own access link, so no advisor ever knows another's credentials.

- **Independent links.** Rotating your own access link signs out your other devices, not your
  colleagues'.
- **Two removals are refused:** you cannot remove yourself, and you cannot remove the last
  advisor — a room with access control on and no Judge Advisor could never be administered or
  destroyed again.

## Developing

```bash
bun install
cd web && bun run dev      # the web app, with hot reload
cd worker && bun run dev   # the server, in a second terminal
```

For local VEX Events access, copy `worker/.env.example` to `worker/.env` and add your key. After
changing a database schema, generate its migration with `cd worker && bun run db:generate`.

The repo has four packages:

- `web`: the SvelteKit app, built as a static site.
- `worker`: the Node server. It handles HTTP and WebSockets and keeps the SQLite files.
- `protocol`: data schemas and types shared by both.
- `wrpc`: the typed RPC layer the app and server talk over.

## Attribution

This project is a modified version of [judgesroom.com](https://github.com/Jerrylum/judgesroom.com)
by Jerrylum, used under the [GNU General Public License v3.0](https://www.gnu.org/licenses/gpl-3.0.html).
It has been modified from the original since August 2026.

Modifications include multi-event support with event groups, an operator admin view, a
port from Cloudflare Workers to a self-hosted Node server with SQLite storage, and a new
referee app at `/ref`. In the referee app, referees log match and skills incidents and keep notes, and those notes can be
shared with linked Judges' Rooms for Judge Advisors to see. Judges no longer join through one
shared link and pick their name from a list: each judge has their own access link, which can be
emailed to them and replaced if lost.

This project is licensed under GPL-3.0. See [LICENSE](LICENSE).
