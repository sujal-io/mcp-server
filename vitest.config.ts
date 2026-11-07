import { defineConfig } from "vitest/config";

// Dates depend on the computer's time zone, so tests always run in UTC.
process.env.TZ = "UTC";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    testTimeout: 10_000,
  },
});