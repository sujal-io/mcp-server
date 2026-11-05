import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import {
  StdioClientTransport,
  getDefaultEnvironment,
} from "@modelcontextprotocol/sdk/client/stdio.js";

// A throwaway database, so your real tracker is never touched.
const dbPath = path.join(os.tmpdir(), `tracker-test-${Date.now()}.db`);

const transport = new StdioClientTransport({
  command: "npx",
  args: ["tsx", "src/index.ts"],
  env: {
    ...getDefaultEnvironment(),
    STRATEGIST_BASE_URL: "http://localhost:1", // unused here, but required settings
    STRATEGIST_SERVICE_KEY: "x".repeat(32),
    TRACKER_DB_PATH: dbPath,
  },
});

const client = new Client({ name: "tracker-test", version: "1.0.0" });
await client.connect(transport);

const daysAgo = (n: number) =>
  new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);

async function call(label: string, name: string, args: Record<string, unknown> = {}) {
  const result = await client.callTool({ name, arguments: args });
  const blocks = result.content as Array<{ type: string; text?: string }>;
  console.log(`\n--- ${label} (isError: ${result.isError ?? false})`);
  console.log(blocks[0]?.text);
}

await call("Log an application from 10 days ago", "log_application", {
  company: "Acme",
  role: "Backend Intern",
  appliedOn: daysAgo(10),
});
await call("Log the same one again (should not duplicate)", "log_application", {
  company: "acme",
  role: "backend intern",
});
await call("What needs a follow-up?", "get_followups_due");
await call("Record that you followed up", "update_application", {
  id: 1,
  followedUp: true,
  note: "Emailed the recruiter",
});
await call("What needs a follow-up now?", "get_followups_due");
await call("Try an impossible date", "log_application", {
  company: "Test",
  role: "Test",
  appliedOn: "2026-02-30",
});

await client.close();
for (const suffix of ["", "-wal", "-shm"]) fs.rmSync(`${dbPath}${suffix}`, { force: true });