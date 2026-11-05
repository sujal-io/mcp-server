import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import {
  StdioClientTransport,
  getDefaultEnvironment,
} from "@modelcontextprotocol/sdk/client/stdio.js";

const SAMPLE_JOB_DESCRIPTION = `Backend Developer Intern
We are looking for a backend developer intern to help build and maintain our REST APIs.
Requirements: Node.js, Express, MongoDB, Git, and a good understanding of REST principles.
Nice to have: TypeScript, Docker, and experience integrating third-party APIs.
You will write clean, tested code, review pull requests, and work with a small agile team.`;

const transport = new StdioClientTransport({
  command: "npx",
  args: ["tsx", "src/index.ts"],
  // A server only receives a few safe variables by default,
  // so we pass our two settings on purpose.
  env: {
    ...getDefaultEnvironment(),
    STRATEGIST_BASE_URL: process.env.STRATEGIST_BASE_URL ?? "",
    STRATEGIST_SERVICE_KEY: process.env.STRATEGIST_SERVICE_KEY ?? "",
  },
});

const client = new Client({ name: "test-client", version: "1.0.0" });
await client.connect(transport);

console.log("TOOLS:", (await client.listTools()).tools.map((t) => t.name));

type Block = { type: string; text?: string };

async function call(name: string, args: Record<string, unknown>) {
  const result = await client.callTool({ name, arguments: args });
  const text = (result.content as Block[]).find((b) => b.type === "text")?.text ?? "";
  console.log(`\n--- ${name} (isError: ${result.isError ?? false})`);
  console.log(text.length > 1500 ? `${text.slice(0, 1500)}\n...(shortened)` : text);
  return { isError: Boolean(result.isError), text };
}

console.log("\nStep 1: analyze the job description (real call, can take up to a minute)");
const first = await call("analyze_job_fit", { jobDescription: SAMPLE_JOB_DESCRIPTION });

if (first.isError) {
  await client.close();
  process.exit(1);
}

const analysis = JSON.parse(first.text) as {
  analysisId: string;
  mostRelevantBullets: Array<{ bulletId: string }>;
};

console.log("\nStep 2: same job description again (should be instant and say cached: true)");
const started = Date.now();
await call("analyze_job_fit", { jobDescription: SAMPLE_JOB_DESCRIPTION });
console.log(`Took ${Date.now() - started} ms`);

const bulletId = analysis.mostRelevantBullets[0]?.bulletId;
if (bulletId) {
  console.log("\nStep 3: rewrite the most relevant bullet for this job");
  await call("rewrite_bullet", { analysisId: analysis.analysisId, bulletId });
}

await client.close();