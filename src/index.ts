import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createCache } from "./cache.js";
import { loadConfig } from "./config.js";
import { defaultDbPath, openDatabase } from "./db.js";
import { StrategistClient } from "./strategistClient.js";
import { registerAnalyzeJobFit } from "./tools/analyzeJobFit.js";
import { registerRewriteBullet } from "./tools/rewriteBullet.js";
import { registerTrackerTools } from "./tools/trackerTools.js";

async function main() {
  const config = loadConfig();
  const client = new StrategistClient(config);

  const dbPath = config.TRACKER_DB_PATH ?? defaultDbPath();
  const db = openDatabase(dbPath);
  console.error(`Tracker database: ${dbPath}`);

  const cache = createCache(config);

  const server = new McpServer({
    name: "application-strategist-mcp",
    version: "0.5.0",
  });

  registerAnalyzeJobFit(server, client, cache.store);
  registerRewriteBullet(server, client, cache.store);
  registerTrackerTools(server, db, () => new Date());

  // A Redis connection keeps the process alive. When Claude Desktop closes the
  // pipe we must shut down ourselves, or the server would linger in the background.
  const shutdown = () => {
    cache.close();
    db.close();
    process.exit(0);
  };
  process.stdin.on("end", shutdown);
  process.stdin.on("close", shutdown);

  await server.connect(new StdioServerTransport());
  console.error("MCP server running on stdio");

  client.warmUp();
}

main().catch((err) => {
  console.error("Fatal error:", err instanceof Error ? err.message : err);
  process.exit(1);
});