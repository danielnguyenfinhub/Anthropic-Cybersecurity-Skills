#!/usr/bin/env node
import { spawn } from "node:child_process";
import {
  openDb,
  claimDueJobs,
  markDone,
  markError,
  reschedule,
  type Job,
} from "./db.js";

/**
 * Long-running worker (run under systemd / a container). It polls the shared
 * job store and, when a job is due, WAKES the target session by re-entering
 * the same conversation non-interactively and feeding the scheduled message
 * as the next turn:
 *
 *   claude --resume <session_id> -p "<message>"
 *
 * This is the mechanism that turns "schedule a check-in" into the session
 * actually waking up and acting an hour later.
 */

const POLL_INTERVAL_MS = Number(process.env.CCR_POLL_INTERVAL_MS ?? 30_000);
const MAX_ATTEMPTS = Number(process.env.CCR_MAX_ATTEMPTS ?? 3);
// Allow swapping the wake command (e.g. an Agent SDK runner) without code edits.
const WAKE_CMD = process.env.CCR_WAKE_CMD ?? "claude";

const db = openDb();

function wake(job: Job): Promise<void> {
  return new Promise((resolve, reject) => {
    // claude --resume <session_id> -p <message>
    const child = spawn(WAKE_CMD, ["--resume", job.session_id, "-p", job.message], {
      stdio: "ignore",
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${WAKE_CMD} exited with code ${code}`));
    });
  });
}

async function tick(): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  const due = claimDueJobs(db, now);
  for (const job of due) {
    try {
      await wake(job);
      if (job.interval_seconds && job.interval_seconds > 0) {
        // Re-arm relative to the intended fire time to avoid drift.
        reschedule(db, job.id, job.run_at + job.interval_seconds);
      } else {
        markDone(db, job.id);
      }
      log(`fired job ${job.id} -> session ${job.session_id}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      markError(db, job.id, msg, MAX_ATTEMPTS);
      log(`job ${job.id} failed (attempt logged): ${msg}`);
    }
  }
}

function log(line: string): void {
  process.stderr.write(`[claude-code-remote worker] ${new Date().toISOString()} ${line}\n`);
}

log(`started; polling every ${POLL_INTERVAL_MS}ms, wake cmd "${WAKE_CMD}"`);

let running = true;
for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    running = false;
    log(`received ${sig}, shutting down`);
  });
}

while (running) {
  try {
    await tick();
  } catch (err) {
    log(`tick error: ${err instanceof Error ? err.message : String(err)}`);
  }
  await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
}

db.close();
process.exit(0);
