import type { Db } from "../db.js";
import type { Status } from "./followupRules.js";

export interface Application {
  id: number;
  company: string;
  role: string;
  status: Status;
  source: string | null;
  jobUrl: string | null;
  matchPercentage: number | null;
  notes: string | null;
  appliedOn: string;
  lastTouchAt: string;
  followUpCount: number;
  createdAt: string;
}

// The shape of a row exactly as SQLite stores it (snake_case column names).
interface Row {
  id: number;
  company: string;
  role: string;
  status: Status;
  source: string | null;
  job_url: string | null;
  match_percentage: number | null;
  notes: string | null;
  applied_on: string;
  last_touch_at: string;
  follow_up_count: number;
  created_at: string;
}

function toApplication(row: Row): Application {
  return {
    id: row.id,
    company: row.company,
    role: row.role,
    status: row.status,
    source: row.source,
    jobUrl: row.job_url,
    matchPercentage: row.match_percentage,
    notes: row.notes,
    appliedOn: row.applied_on,
    lastTouchAt: row.last_touch_at,
    followUpCount: row.follow_up_count,
    createdAt: row.created_at,
  };
}

export interface NewApplication {
  company: string;
  role: string;
  status: Status;
  source?: string;
  jobUrl?: string;
  matchPercentage?: number;
  notes?: string;
  appliedOn: string; // YYYY-MM-DD
}

export function getApplication(db: Db, id: number): Application | undefined {
  const row = db.prepare("SELECT * FROM applications WHERE id = ?").get(id) as Row | undefined;
  return row ? toApplication(row) : undefined;
}

export function insertApplication(db: Db, input: NewApplication, now: Date): Application {
  const result = db
    .prepare(
      `INSERT INTO applications
         (company, role, status, source, job_url, match_percentage, notes,
          applied_on, last_touch_at, follow_up_count, created_at)
       VALUES
         (@company, @role, @status, @source, @jobUrl, @matchPercentage, @notes,
          @appliedOn, @lastTouchAt, 0, @createdAt)`
    )
    .run({
      company: input.company,
      role: input.role,
      status: input.status,
      source: input.source ?? null,
      jobUrl: input.jobUrl ?? null,
      matchPercentage: input.matchPercentage ?? null,
      notes: input.notes ?? null,
      appliedOn: input.appliedOn,
      // The follow-up clock starts on the day you applied, not the day you logged it.
      lastTouchAt: `${input.appliedOn}T00:00:00.000Z`,
      createdAt: now.toISOString(),
    });

  return getApplication(db, Number(result.lastInsertRowid)) as Application;
}

export function findActiveDuplicate(
  db: Db,
  company: string,
  role: string
): Application | undefined {
  const row = db
    .prepare(
      `SELECT * FROM applications
       WHERE lower(company) = lower(?) AND lower(role) = lower(?)
         AND status IN ('applied', 'interviewing')
       LIMIT 1`
    )
    .get(company, role) as Row | undefined;
  return row ? toApplication(row) : undefined;
}

export function listApplications(db: Db, statuses: readonly Status[]): Application[] {
  // Only the number of ? marks is built here. The values still go in as parameters.
  const marks = statuses.map(() => "?").join(", ");
  const rows = db
    .prepare(
      `SELECT * FROM applications WHERE status IN (${marks})
       ORDER BY last_touch_at DESC LIMIT 100`
    )
    .all(...statuses) as Row[];
  return rows.map(toApplication);
}

export interface Changes {
  status?: Status;
  note?: string;
  followedUp?: boolean;
}

export function updateApplication(
  db: Db,
  id: number,
  changes: Changes,
  now: Date
): Application | undefined {
  const current = getApplication(db, id);
  if (!current) return undefined;

  const timestamp = now.toISOString();
  const statusChanged = changes.status !== undefined && changes.status !== current.status;

  const notes = changes.note
    ? [current.notes, `[${timestamp.slice(0, 10)}] ${changes.note}`].filter(Boolean).join("\n")
    : current.notes;

  // A new stage (for example applied to interviewing) starts a fresh follow-up count.
  let followUpCount = statusChanged ? 0 : current.followUpCount;
  if (changes.followedUp) followUpCount += 1;

  const touched = statusChanged || Boolean(changes.followedUp) || Boolean(changes.note);

  db.prepare(
    `UPDATE applications
     SET status = @status, notes = @notes, follow_up_count = @followUpCount,
         last_touch_at = @lastTouchAt
     WHERE id = @id`
  ).run({
    id,
    status: changes.status ?? current.status,
    notes,
    followUpCount,
    lastTouchAt: touched ? timestamp : current.lastTouchAt,
  });

  return getApplication(db, id);
}