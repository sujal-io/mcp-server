import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { Db } from "../db.js";
import { getFollowUpState, STATUSES, type Status } from "../tracker/followupRules.js";
import {
  findActiveDuplicate,
  insertApplication,
  listApplications,
  updateApplication,
  type Application,
} from "../tracker/applicationsRepo.js";
import { plainError, textResult } from "../toolResult.js";

// Today's date in the computer's own time zone, as YYYY-MM-DD.
function todayLocal(now: Date): string {
  return new Date(now.getTime() - now.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
}

// Rejects things like 2026-02-30 that look like dates but are not real days.
function isRealDate(value: string): boolean {
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

// What Claude sees: the stored fields plus the computed follow-up state.
function present(app: Application, now: Date) {
  const follow = getFollowUpState(app, now);
  return {
    id: app.id,
    company: app.company,
    role: app.role,
    status: app.status,
    appliedOn: app.appliedOn,
    source: app.source,
    jobUrl: app.jobUrl,
    matchPercentage: app.matchPercentage,
    notes: app.notes,
    followUpsSent: app.followUpCount,
    daysSinceLastActivity: follow.daysSinceTouch,
    followUp: follow.state,
  };
}

export function registerTrackerTools(server: McpServer, db: Db, clock: () => Date): void {
  server.registerTool(
    "log_application",
    {
      title: "Log a job application",
      description:
        "Saves a job application in the local tracker. Use it when the user says they applied. " +
        "If the same company and role is already being tracked, the existing record is returned " +
        "instead of creating a duplicate. Pass matchPercentage from analyze_job_fit when you have it.",
      inputSchema: {
        company: z.string().trim().min(1).max(120),
        role: z.string().trim().min(1).max(120),
        status: z.enum(STATUSES).default("applied"),
        appliedOn: z
          .string()
          .regex(/^\d{4}-\d{2}-\d{2}$/, "Use the format YYYY-MM-DD.")
          .optional()
          .describe("The date the user applied. Defaults to today."),
        source: z.string().trim().max(80).optional().describe("Where the job was found, for example LinkedIn."),
        jobUrl: z.string().url().max(500).optional(),
        matchPercentage: z.number().min(0).max(100).optional(),
        notes: z.string().trim().max(2000).optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async (args) => {
      const now = clock();
      const appliedOn = args.appliedOn ?? todayLocal(now);

      if (!isRealDate(appliedOn)) {
        return plainError(`${appliedOn} is not a real calendar date.`);
      }
      if (appliedOn > todayLocal(now)) {
        return plainError("The application date cannot be in the future.");
      }

      const existing = findActiveDuplicate(db, args.company, args.role);
      if (existing) {
        return textResult({
          created: false,
          message: "This company and role is already being tracked, so nothing was added.",
          application: present(existing, now),
        });
      }

      const saved = insertApplication(db, { ...args, appliedOn }, now);
      return textResult({ created: true, application: present(saved, now) });
    }
  );

  server.registerTool(
    "update_application",
    {
      title: "Update a tracked application",
      description:
        "Changes the status of a tracked application, adds a note, or records that the user sent " +
        "a follow-up message. Provide at least one of status, note or followedUp. Use the id " +
        "from list_applications or get_followups_due.",
      inputSchema: {
        id: z.number().int().positive(),
        status: z.enum(STATUSES).optional(),
        note: z.string().trim().min(1).max(1000).optional(),
        followedUp: z.boolean().optional().describe("True if the user just sent a follow-up message."),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ id, status, note, followedUp }) => {
      if (status === undefined && note === undefined && !followedUp) {
        return plainError("Provide at least one of status, note or followedUp.");
      }

      const now = clock();
      const updated = updateApplication(db, id, { status, note, followedUp }, now);
      if (!updated) return plainError(`No tracked application has id ${id}.`);

      return textResult({ application: present(updated, now) });
    }
  );

  server.registerTool(
    "list_applications",
    {
      title: "List tracked applications",
      description:
        "Lists tracked job applications with their follow-up state. The default filter 'active' " +
        "shows applied and interviewing. Use 'all' to include finished ones.",
      inputSchema: {
        filter: z.enum(["active", "all", ...STATUSES]).default("active"),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ filter }) => {
      const now = clock();
      const statuses: readonly Status[] =
        filter === "active" ? ["applied", "interviewing"] : filter === "all" ? STATUSES : [filter];

      const items = listApplications(db, statuses).map((app) => present(app, now));
      return textResult({ count: items.length, applications: items });
    }
  );

  server.registerTool(
    "get_followups_due",
    {
      title: "Get follow-ups that are due",
      description:
        "Shows which applications need a follow-up message today, and which have gone quiet long " +
        "enough that the user should consider moving on. Call it when the user asks what needs attention.",
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => {
      const now = clock();
      const due: Array<Record<string, unknown>> = [];
      const stale: Array<Record<string, unknown>> = [];

      for (const app of listApplications(db, ["applied", "interviewing"])) {
        const follow = getFollowUpState(app, now);
        const base = {
          id: app.id,
          company: app.company,
          role: app.role,
          status: app.status,
          daysSinceLastActivity: follow.daysSinceTouch,
        };

        if (follow.state === "follow_up_due") {
          due.push({
            ...base,
            overdueByDays: follow.overdueByDays,
            followUpNumber: app.followUpCount + 1,
            suggestion: `Send a short, polite follow-up (number ${app.followUpCount + 1}).`,
          });
        } else if (follow.state === "stale") {
          stale.push({
            ...base,
            suggestion: "No reply after follow-ups. Treat it as closed and move on, or mark it rejected.",
          });
        }
      }

      due.sort((a, b) => Number(b.overdueByDays) - Number(a.overdueByDays));

      return textResult({
        asOf: todayLocal(now),
        followUpsDue: due,
        goneQuiet: stale,
        message: due.length + stale.length === 0 ? "Nothing needs attention right now." : undefined,
      });
    }
  );
}