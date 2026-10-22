# claude-code-remote — `send_later` MCP server

A minimal MCP server that lets a Claude Code session **schedule a message to be
delivered back to itself later** (a "self check-in"), plus a worker that
**wakes the session** when the job is due.

This is the pattern behind a `send_later` tool: the agent schedules a re-check
(e.g. "re-inspect this PR in an hour"), goes idle, and is woken at the right
time to act — including events webhooks never deliver (CI success, merge
state, merge-conflict transitions).

> Note: this is a standalone utility that happens to live in `tools/`. It is
> not a security "skill" and is unrelated to the `skills/` library.

## How it works

```
send_later(message, delay) ──► [ SQLite jobs.db ] ◄── worker polls due jobs
   (MCP server, enqueues)            (contract)        │
                                                       ▼
                                  claude --resume <session_id> -p "<message>"
                                  (re-enters the same conversation as a new turn)
```

Two **decoupled** processes share one SQLite file:

- **`server.ts`** — the MCP server. Exposes `send_later`, `list_scheduled`,
  `cancel_scheduled`. It only *enqueues*; it never fires jobs. This matters
  because the server process (and the session) may be idle when a job is due.
- **`worker.ts`** — a long-running daemon that polls the store and, for each
  due job, runs `claude --resume <session_id> -p "<message>"`. That resume is
  the wake mechanism: it reopens the exact conversation with full context and
  feeds the scheduled text as the next user turn. Recurring jobs
  (`interval_seconds`) re-arm themselves after each fire.

## Tools

| Tool | Args | Purpose |
|---|---|---|
| `send_later` | `message`, one of `delay_seconds`/`run_at_iso`, optional `interval_seconds`, optional `session_id` | Schedule a check-in. `interval_seconds` makes it recurring. |
| `list_scheduled` | — | List pending jobs. |
| `cancel_scheduled` | `job_id` | Cancel a pending job. |

`session_id` defaults to `CLAUDE_SESSION_ID` (the env var for the current
conversation), so the agent usually doesn't pass it.

## Install

```bash
cd tools/claude-code-remote
npm install
npm run build      # emits dist/
```

Register the server with Claude Code (see `mcp.example.json`) — e.g. add to
`.mcp.json` / project settings:

```json
{ "mcpServers": { "claude-code-remote": {
    "command": "node", "args": ["/abs/path/dist/server.js"],
    "env": { "CCR_DB_PATH": "/var/lib/claude-code-remote/jobs.db" } } } }
```

Run the worker as a service (see `systemd/claude-code-remote-worker.service`):

```bash
sudo cp systemd/claude-code-remote-worker.service /etc/systemd/system/
sudo systemctl enable --now claude-code-remote-worker
```

The worker and the server **must point at the same `CCR_DB_PATH`**, and the
worker's `claude` binary must be the one authenticated for those sessions.

## Configuration (env)

| Var | Default | Used by | Meaning |
|---|---|---|---|
| `CCR_DB_PATH` | `/var/lib/claude-code-remote/jobs.db` | both | Shared job store. |
| `CLAUDE_SESSION_ID` | — | server | Default session to wake. |
| `CCR_POLL_INTERVAL_MS` | `30000` | worker | Poll cadence. |
| `CCR_MAX_ATTEMPTS` | `3` | worker | Retries before a job is marked `error`. |
| `CCR_WAKE_CMD` | `claude` | worker | Wake command; swap for an Agent SDK runner if desired. |

## Caveats

- **Persistence is the point.** Jobs live in SQLite, not process memory — the
  server can exit and jobs still fire.
- **Resume targets the right session.** A wrong/expired `session_id` resumes
  the wrong conversation or fails; the worker records the error and retries up
  to `CCR_MAX_ATTEMPTS`.
- **Cost.** Each fire is a real model invocation. Use sensible intervals and
  cancel jobs you no longer need.
- **Alternative wake mechanism.** If you run your own persistent orchestrator
  that holds session input streams, replace the `spawn(...)` in `worker.ts`
  with a direct push of a `user` message into the session (how the hosted
  remote harness injects webhook events) instead of shelling out to `claude`.
