import { z } from "zod";

const EnvSchema = z.object({
  STRATEGIST_BASE_URL: z.string().url(),
  STRATEGIST_SERVICE_KEY: z.string().min(16, "must be at least 16 characters"),
  STRATEGIST_TIMEOUT_MS: z.coerce.number().int().positive().default(55000),
});

export type Config = z.infer<typeof EnvSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = EnvSchema.safeParse(env);

  if (!parsed.success) {
    const problems = parsed.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("; ");
    throw new Error(
      `Invalid configuration (${problems}). Check the env section of the server settings.`
    );
  }

  return {
    ...parsed.data,
    STRATEGIST_BASE_URL: parsed.data.STRATEGIST_BASE_URL.replace(/\/+$/, ""),
  };
}