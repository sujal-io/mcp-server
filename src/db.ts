import Database from "better-sqlite3";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export type Db = Database.Database;

// Claude Desktop starts the server from a folder we cannot predict, so the
// database needs a fixed, absolute home. The user's home folder is stable.
export function defaultDbPath(): string {
  return path.join(os.homedir(), ".application-strategist-mcp", "applications.db");
}

export function openDatabase(dbPath: string): Db {
  if (dbPath !== ":memory:") {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  }

  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");

  db.exec(`
    CREATE TABLE IF NOT EXISTS applications (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      company TEXT NOT NULL,
      role TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'applied'
        CHECK (status IN ('applied', 'interviewing', 'offer', 'rejected', 'withdrawn')),
      source TEXT,
      job_url TEXT,
      match_percentage REAL,
      notes TEXT,
      applied_on TEXT NOT NULL,
      last_touch_at TEXT NOT NULL,
      follow_up_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_applications_status ON applications (status);
  `);

  return db;
}