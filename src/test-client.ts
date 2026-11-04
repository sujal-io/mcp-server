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

const tools = await client.listTools();
console.log("TOOLS:", tools.tools.map((t) => t.name));

console.log("Calling analyze_job_fit (this can take up to a minute)...");
const result = await client.callTool({
  name: "analyze_job_fit",
  arguments: { jobDescription: SAMPLE_JOB_DESCRIPTION },
});

console.log("IS ERROR:", result.isError ?? false);
for (const block of result.content as Array<{ type: string; text?: string }>) {
  if (block.type === "text") console.log(block.text);
}

await client.close();