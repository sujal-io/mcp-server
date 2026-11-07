import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { vi } from "vitest";
import { MemoryAnalysisStore, type AnalysisStore } from "../src/analysisStore.js";
import { loadConfig } from "../src/config.js";
import { openDatabase } from "../src/db.js";
import { StrategistClient } from "../src/strategistClient.js";
import { registerAnalyzeJobFit } from "../src/tools/analyzeJobFit.js";
import { registerRewriteBullet } from "../src/tools/rewriteBullet.js";
import { registerTrackerTools } from "../src/tools/trackerTools.js";

export const TEST_KEY = "k".repeat(32);

// The trailing slash is deliberate: the config should remove it.
export const TEST_CONFIG = loadConfig({
  STRATEGIST_BASE_URL: "http://strategist.test/",
  STRATEGIST_SERVICE_KEY: TEST_KEY,
});

export const JD =
  "We are hiring a backend developer intern who knows Node.js, Express and MongoDB for REST APIs.";

export const ANALYSIS_BODY = {
  success: true,
  data: {
    structuredJobDescription: {
      company: "",
      role: "Backend Intern",
      requiredSkills: ["Node.js"],
      preferredSkills: [],
      responsibilities: ["Build APIs"],
    },
    matchResult: {
      matchPercentage: 88,
      matchingSkills: ["Node.js"],
      missingSkills: ["Docker"],
      extraSkills: Array.from({ length: 15 }, (_, i) => `Extra ${i + 1}`),
    },
    recommendations: {
      summary: "Good fit.",
      strengths: ["APIs"],
      improvements: ["Add Docker"],
      recommendedProjects: ["Containerize a service"],
    },
    retrievedBullets: [
      { bulletId: "b1", text: "Built 15 REST endpoints", similarity: 0.82 },
      { bulletId: "b2", text: "Used MongoDB", similarity: 0.7 },
    ],
  },
};

export const REWRITE_BODY = {
  success: true,
  originalBullet: "Built 15 REST endpoints",
  rewrittenBullet: "Shipped 15 REST endpoints in Node.js.",
};

export function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

// A fake Application Strategist. Tests decide what each endpoint answers.
export function strategistStub(overrides: { analyze?: () => Response; rewrite?: () => Response } = {}) {
  return vi.fn(async (input: string | URL | Request, _init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith("/api/job-description/analyze")) {
      return (overrides.analyze ?? (() => jsonResponse(200, ANALYSIS_BODY)))();
    }
    if (url.endsWith("/api/rewrite")) {
      return (overrides.rewrite ?? (() => jsonResponse(200, REWRITE_BODY)))();
    }
    return jsonResponse(404, { message: "not found" });
  });
}

export function makeClient(fetchImpl: ReturnType<typeof strategistStub>): StrategistClient {
  return new StrategistClient(TEST_CONFIG, fetchImpl as unknown as typeof fetch);
}

// Starts a real MCP server and client joined by an in-memory pipe, so tests
// exercise the same code path as Claude Desktop without launching a process.
export async function createHarness(options: {
  fetchImpl: ReturnType<typeof strategistStub>;
  now?: () => Date;
  store?: AnalysisStore;
}) {
  const db = openDatabase(":memory:");
  const store = options.store ?? new MemoryAnalysisStore();
  const server = new McpServer({ name: "test-server", version: "0.0.0" });

  registerAnalyzeJobFit(server, makeClient(options.fetchImpl), store);
  registerRewriteBullet(server, makeClient(options.fetchImpl), store);
  registerTrackerTools(server, db, options.now ?? (() => new Date()));

  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
  await server.connect(serverSide);
  const client = new Client({ name: "test-client", version: "0.0.0" });
  await client.connect(clientSide);

  return {
    client,
    db,
    close: async () => {
      await client.close();
      db.close();
    },
  };
}

// Calls a tool and returns a simple result. Input-validation failures may
// arrive as a thrown error or as an isError result, so both are handled.
export async function callTool(client: Client, name: string, args: Record<string, unknown> = {}) {
  try {
    const result = await client.callTool({ name, arguments: args });
    const text = (result.content as Array<{ type: string; text?: string }>)[0]?.text ?? "";
    let json: any;
    try {
      json = JSON.parse(text);
    } catch {
      json = undefined;
    }
    return { isError: Boolean(result.isError), text, json };
  } catch (err) {
    return { isError: true, text: err instanceof Error ? err.message : String(err), json: undefined };
  }
}