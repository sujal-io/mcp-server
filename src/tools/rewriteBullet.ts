import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { AnalysisStore } from "../analysisStore.js";
import { StrategistClient, StrategistError } from "../strategistClient.js";
import { errorResult, plainError, textResult } from "../toolResult.js";

const RewriteResponseSchema = z.object({
  success: z.literal(true),
  originalBullet: z.string(),
  rewrittenBullet: z.string(),
});

export function registerRewriteBullet(
  server: McpServer,
  client: StrategistClient,
  store: AnalysisStore
): void {
  server.registerTool(
    "rewrite_bullet",
    {
      title: "Rewrite a resume bullet for a job",
      description:
        "Rewrites one resume bullet so it fits a job better, using the Application Strategist. " +
        "Needs the analysisId from analyze_job_fit and a bulletId from that analysis's " +
        "mostRelevantBullets. The rewrite only rephrases existing experience, so always show the " +
        "original next to it and remind the user to check it is accurate. Takes a few seconds, " +
        "and the service allows 20 rewrites per hour.",
      inputSchema: {
        analysisId: z
          .string()
          .min(1)
          .max(64)
          .describe("The analysisId returned by analyze_job_fit."),
        bulletId: z
          .string()
          .min(1)
          .max(100)
          .describe("A bulletId taken from mostRelevantBullets in that analysis."),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ analysisId, bulletId }) => {
      try {
        const analysis = await store.getById(analysisId);
        if (!analysis) {
          return plainError(
            "That analysis was not found or has expired. Run analyze_job_fit again to get a fresh analysisId."
          );
        }

        if (!analysis.bulletIds.includes(bulletId)) {
          return plainError(
            `bulletId ${bulletId} is not part of that analysis. Use one of: ${analysis.bulletIds.join(", ")}.`
          );
        }

        const raw = await client.postJson("/api/rewrite", {
          bulletId,
          structuredJobDescription: analysis.structuredJobDescription,
        });
        const parsed = RewriteResponseSchema.safeParse(raw);

        if (!parsed.success) {
          throw new StrategistError(
            "bad_response",
            "The Application Strategist answered in an unexpected format."
          );
        }

        return textResult({
          bulletId,
          forRole: analysis.summary.role ?? null,
          forCompany: analysis.summary.company ?? null,
          originalBullet: parsed.data.originalBullet,
          rewrittenBullet: parsed.data.rewrittenBullet,
        });
      } catch (err) {
        return errorResult(err);
      }
    }
  );
}