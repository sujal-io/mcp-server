import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { StrategistError } from "./strategistClient.js";

export function textResult(data: unknown): CallToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
  };
}

// Tool failures are returned as normal results flagged isError, so Claude can
// read the message and explain it, instead of the whole server crashing.
export function errorResult(err: unknown): CallToolResult {
  if (err instanceof StrategistError) {
    return { isError: true, content: [{ type: "text", text: err.message }] };
  }

  console.error("Unexpected tool error:", err);
  return {
    isError: true,
    content: [{ type: "text", text: "Something unexpected went wrong inside the MCP server." }],
  };
}