import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { StrategistClient, StrategistError } from "../strategistClient.js";
import { errorResult, textResult } from "../toolResult.js";

// Describe the part of the API response we rely on. If the Application
// Strategist ever changes its output, we find out here with a clear error.
const AnalysisResponseSchema = z.object({
  success: z.literal(true),
  data: z.object({
    structuredJobDescription: z
      .object({
        company: z.string().optional(),
        role: z.string().optional(),
        requiredSkills: z.array(z.string()).default([]),
        preferredSkills: z.array(z.string()).default([]),
      })
      .passthrough(),
    matchResult: z.object({
      matchPercentage: z.number(),
      matchingSkills: z.array(z.string()),
      missingSkills: z.array(z.string()),
      extraSkills: z.array(z.string()),
    }),
    recommendations: z.object({
      summary: z.string(),
      strengths: z.array(z.string()),
      improvements: z.array(z.string()),
      recommendedProjects: z.array(z.string()),
    }),
    retrievedBullets: z.array(
      z.object({
        bulletId: z.string(),
        text: z.string(),
        similarity: z.number(),
      })
    ),
  }),
});

export function registerAnalyzeJobFit(server: McpServer, client: StrategistClient): void {
  server.registerTool(
    "analyze_job_fit",
    {
      title: "Analyze job fit",
      description:
        "Compares a job description with the owner's stored resume using the Application Strategist. " +
        "Returns the match percentage, matching and missing skills, written recommendations, and the " +
        "resume bullets most relevant to the role. Takes roughly 10 to 30 seconds. The service allows " +
        "only 5 analyses per hour, so do not call it again for the same job description.",
      inputSchema: {
        jobDescription: z
          .string()
          .min(50, "The job description is too short to analyze.")
          .max(20000, "The job description is too long (limit 20000 characters).")
          .describe("The full text of the job description to analyze."),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async ({ jobDescription }) => {
      try {
        const raw = await client.postJson("/api/job-description/analyze", { jobDescription });
        const parsed = AnalysisResponseSchema.safeParse(raw);

        if (!parsed.success) {
          throw new StrategistError(
            "bad_response",
            "The Application Strategist answered in an unexpected format."
          );
        }

        const { structuredJobDescription, matchResult, recommendations, retrievedBullets } =
          parsed.data.data;

        return textResult({
          role: structuredJobDescription.role ?? null,
          company: structuredJobDescription.company ?? null,
          matchPercentage: matchResult.matchPercentage,
          matchingSkills: matchResult.matchingSkills,
          missingSkills: matchResult.missingSkills,
          extraSkills: matchResult.extraSkills,
          summary: recommendations.summary,
          strengths: recommendations.strengths,
          improvements: recommendations.improvements,
          recommendedProjects: recommendations.recommendedProjects,
          mostRelevantBullets: retrievedBullets,
        });
      } catch (err) {
        return errorResult(err);
      }
    }
  );
}