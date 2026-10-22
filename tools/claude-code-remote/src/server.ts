#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { openDb, insertJob, listPending, cancelJob, type Job } from "./db.js";

/**
 * MCP server exposing the scheduling tools. This process only ENQUEUES jobs
 * into the shared SQLite store — the separate worker process fires them and
 * wakes the session. Keeping them decoupled means a scheduled check-in still
 * fires even after this server / the session has gone idle.
 */

const db = openDb();

/** The session to resume defaults to the env var Claude Code sets for the
 *  current conversation, so the agent normally doesn't need to pass it. */
function resolveSessionId(explicit?: string): string {
  const sid =
    explicit ??
    process.env.CLAUDE_SESSION_ID ??
    process.env.CCR_DEFAULT_SESSION_ID;
  if (!sid) {
    throw new Error(
      "No session_id provided and CLAUDE_SESSION_ID is unset; cannot target a session to wake.",
    );
  }
  return sid;
}

const server = new McpServer({ name: "claude-code-remote", version: "0.1.0" });

server.tool(
  "send_later",
  "Schedule a message to be delivered back to this Claude Code session later " +
    "(a self check-in). Provide exactly one of delay_seconds or run_at_iso. " +
    "Set interval_seconds to re-arm the check-in on a recurring cadence.",
  {
    message: z
      .string()
      .min(1)
      .describe("The text delivered to the session as a new user turn when the job fires."),
    delay_seconds: z
      .number()
      .int()
      .positive()
      .optional()
      .describe("Fire this many seconds from now. Mutually exclusive with run_at_iso."),
    run_at_iso: z
      .string()
      .datetime()
      .optional()
      .describe("Absolute ISO-8601 time to fire. Mutually exclusive with delay_seconds."),
    interval_seconds: z
      .number()
      .int()
      .positive()
      .optional()
      .describe("If set, re-schedule the job this many seconds after each fire (recurring)."),
    session_id: z
      .string()
      .optional()
      .describe("Session to wake. Defaults to CLAUDE_SESSION_ID for the current conversation."),
  },
  async (args) => {
    if ((args.delay_seconds == null) === (args.run_at_iso == null)) {
      throw new Error("Provide exactly one of delay_seconds or run_at_iso.");
    }
    const now = Math.floor(Date.now() / 1000);
    const runAt =
      args.run_at_iso != null
        ? Math.floor(new Date(args.run_at_iso).getTime() / 1000)
        : now + (args.delay_seconds as number);
    if (runAt <= now) {
      throw new Error("Computed run time is in the past.");
    }

    const job: Job = {
      id: randomUUID(),
      session_id: resolveSessionId(args.session_id),
      run_at: runAt,
      message: args.message,
      interval_seconds: args.interval_seconds ?? null,
      status: "pending",
      attempts: 0,
      last_error: null,
      created_at: now,
    };
    insertJob(db, job);

    const when = new Date(runAt * 1000).toISOString();
    const recur = job.interval_seconds
      ? `, recurring every ${job.interval_seconds}s`
      : "";
    return {
      content: [
        {
          type: "text",
          text: `Scheduled job ${job.id} to fire at ${when}${recur}.`,
        },
      ],
    };
  },
);

server.tool(
  "list_scheduled",
  "List pending scheduled messages (self check-ins) for inspection.",
  {},
  async () => {
    const jobs = listPending(db).map((j) => ({
      id: j.id,
      run_at: new Date(j.run_at * 1000).toISOString(),
      recurring_seconds: j.interval_seconds,
      session_id: j.session_id,
      message: j.message,
    }));
    return {
      content: [{ type: "text", text: JSON.stringify(jobs, null, 2) }],
    };
  },
);

server.tool(
  "cancel_scheduled",
  "Cancel a pending scheduled message by its job id.",
  { job_id: z.string().describe("The id returned by send_later.") },
  async (args) => {
    const ok = cancelJob(db, args.job_id);
    return {
      content: [
        {
          type: "text",
          text: ok
            ? `Cancelled job ${args.job_id}.`
            : `No pending job ${args.job_id} to cancel.`,
        },
      ],
    };
  },
);

const transport = new StdioServerTransport();
await server.connect(transport);
