import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

/**
 * Shared SQLite job store. The MCP server (producer) and the worker
 * (consumer) are separate processes; the database file is the contract
 * between them, so jobs survive the server process exiting / the session
 * going idle.
 */

export const DB_PATH =
  process.env.CCR_DB_PATH ?? "/var/lib/claude-code-remote/jobs.db";

export type JobStatus = "pending" | "done" | "error" | "cancelled";

export interface Job {
  id: string;
  session_id: string;
  run_at: number; // unix seconds
  message: string;
  /** If set (>0), reschedule this many seconds after each fire (recurring). */
  interval_seconds: number | null;
  status: JobStatus;
  attempts: number;
  last_error: string | null;
  created_at: number;
}

export function openDb(path: string = DB_PATH): Database.Database {
  mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.pragma("journal_mode = WAL"); // safe concurrent reader/writer
  db.pragma("busy_timeout = 5000");
  db.exec(`
    CREATE TABLE IF NOT EXISTS jobs (
      id               TEXT PRIMARY KEY,
      session_id       TEXT NOT NULL,
      run_at           INTEGER NOT NULL,
      message          TEXT NOT NULL,
      interval_seconds INTEGER,
      status           TEXT NOT NULL DEFAULT 'pending',
      attempts         INTEGER NOT NULL DEFAULT 0,
      last_error       TEXT,
      created_at       INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_jobs_due
      ON jobs (status, run_at);
  `);
  return db;
}

export function insertJob(db: Database.Database, job: Job): void {
  db.prepare(
    `INSERT INTO jobs
       (id, session_id, run_at, message, interval_seconds,
        status, attempts, last_error, created_at)
     VALUES
       (@id, @session_id, @run_at, @message, @interval_seconds,
        @status, @attempts, @last_error, @created_at)`,
  ).run(job);
}

export function listPending(db: Database.Database): Job[] {
  return db
    .prepare(`SELECT * FROM jobs WHERE status = 'pending' ORDER BY run_at ASC`)
    .all() as Job[];
}

export function claimDueJobs(db: Database.Database, now: number): Job[] {
  return db
    .prepare(
      `SELECT * FROM jobs
       WHERE status = 'pending' AND run_at <= ?
       ORDER BY run_at ASC`,
    )
    .all(now) as Job[];
}

export function markDone(db: Database.Database, id: string): void {
  db.prepare(`UPDATE jobs SET status = 'done' WHERE id = ?`).run(id);
}

export function reschedule(
  db: Database.Database,
  id: string,
  nextRunAt: number,
): void {
  db.prepare(`UPDATE jobs SET run_at = ?, attempts = 0 WHERE id = ?`).run(
    nextRunAt,
    id,
  );
}

export function markError(
  db: Database.Database,
  id: string,
  err: string,
  maxAttempts: number,
): void {
  db.prepare(
    `UPDATE jobs
       SET attempts = attempts + 1,
           last_error = ?,
           status = CASE WHEN attempts + 1 >= ? THEN 'error' ELSE 'pending' END
     WHERE id = ?`,
  ).run(err, maxAttempts, id);
}

export function cancelJob(db: Database.Database, id: string): boolean {
  const info = db
    .prepare(`UPDATE jobs SET status = 'cancelled' WHERE id = ? AND status = 'pending'`)
    .run(id);
  return info.changes > 0;
}
