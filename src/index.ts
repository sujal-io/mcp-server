import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { loadConfig } from "./config.js";
import { defaultDbPath, openDatabase } from "./db.js";
import { StrategistClient } from "./strategistClient.js";
import { registerAnalyzeJobFit } from "./tools/analyzeJobFit.js";
import { registerTrackerTools } from "./tools/trackerTools.js";

async function main() {
  const config = loadConfig();
  const client = new StrategistClient(config);

  const dbPath = config.TRACKER_DB_PATH ?? defaultDbPath();
  const db = openDatabase(dbPath);
  console.error(`Tracker database: ${dbPath}`);

  const server = new McpServer({
    name: "application-strategist-mcp",
    version: "0.3.0",
  });

  registerAnalyzeJobFit(server, client);
  registerTrackerTools(server, db, () => new Date());

  await server.connect(new StdioServerTransport());
  console.error("MCP server running on stdio");

  client.warmUp();
}

main().catch((err) => {
  console.error("Fatal error:", err instanceof Error ? err.message : err);
  process.exit(1);
});