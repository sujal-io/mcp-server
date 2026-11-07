import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MemoryAnalysisStore } from "../src/analysisStore.js";
import { ANALYSIS_BODY, JD, callTool, createHarness, jsonResponse, strategistStub, TEST_KEY } from "./helpers.js";

type Harness = Awaited<ReturnType<typeof createHarness>>;
let harness: Harness | undefined;

afterEach(async () => {
  await harness?.close();
  harness = undefined;
});

describe("analyze_job_fit", () => {
  it("returns the analysis with an id, empty values as null, and a short extra-skills list", async () => {
    harness = await createHarness({ fetchImpl: strategistStub() });
    const result = await callTool(harness.client, "analyze_job_fit", { jobDescription: JD });

    expect(result.isError).toBe(false);
    expect(result.json).toMatchObject({
      role: "Backend Intern",
      company: null, // the API sent an empty string
      matchPercentage: 88,
      cached: false,
      analysisId: expect.stringMatching(/^an_/),
    });
    expect(result.json.extraSkills).toHaveLength(10);
    expect(result.json.mostRelevantBullets).toHaveLength(2);
  });

  it("sends the job description and the service key to the right endpoint", async () => {
    const fetchImpl = strategistStub();
    harness = await createHarness({ fetchImpl });
    await callTool(harness.client, "analyze_job_fit", { jobDescription: JD });

    const [url, init] = fetchImpl.mock.calls[0]!;
    expect(String(url)).toBe("http://strategist.test/api/job-description/analyze");
    expect(JSON.parse(init!.body as string)).toEqual({ jobDescription: JD });
    expect((init!.headers as Record<string, string>)["x-service-key"]).toBe(TEST_KEY);
  });

  it("answers a repeat from the cache, even when the spacing differs", async () => {
    const fetchImpl = strategistStub();
    harness = await createHarness({ fetchImpl });
    const first = await callTool(harness.client, "analyze_job_fit", { jobDescription: JD });
    const second = await callTool(harness.client, "analyze_job_fit", { jobDescription: `  ${JD.replace(/ /g, "  ")}\n` });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(second.json).toMatchObject({ cached: true, analysisId: first.json.analysisId });
  });

  it("runs a new analysis when refresh is true", async () => {
    const fetchImpl = strategistStub();
    harness = await createHarness({ fetchImpl });
    const first = await callTool(harness.client, "analyze_job_fit", { jobDescription: JD });
    const second = await callTool(harness.client, "analyze_job_fit", { jobDescription: JD, refresh: true });

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(second.json.cached).toBe(false);
    expect(second.json.analysisId).not.toBe(first.json.analysisId);
  });

  it("rejects a too-short job description before any network call", async () => {
    const fetchImpl = strategistStub();
    harness = await createHarness({ fetchImpl });
    const result = await callTool(harness.client, "analyze_job_fit", { jobDescription: "short" });

    expect(result.isError).toBe(true);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each([
    [401, /service key/],
    [429, /Hourly limit/],
    [502, /temporarily unavailable/],
  ] as const)("turns an API %i into a readable error and keeps working", async (status, message) => {
    let calls = 0;
    const fetchImpl = strategistStub({
      analyze: () => (++calls === 1 ? jsonResponse(status, { message: "x" }) : jsonResponse(200, ANALYSIS_BODY)),
    });
    harness = await createHarness({ fetchImpl });

    const failed = await callTool(harness.client, "analyze_job_fit", { jobDescription: JD });
    expect(failed.isError).toBe(true);
    expect(failed.text).toMatch(message);

    const recovered = await callTool(harness.client, "analyze_job_fit", { jobDescription: JD });
    expect(recovered.isError).toBe(false);
  });

  it("does not cache a failed analysis", async () => {
    let calls = 0;
    const fetchImpl = strategistStub({
      analyze: () => (++calls === 1 ? jsonResponse(502, {}) : jsonResponse(200, ANALYSIS_BODY)),
    });
    harness = await createHarness({ fetchImpl });
    await callTool(harness.client, "analyze_job_fit", { jobDescription: JD });
    const second = await callTool(harness.client, "analyze_job_fit", { jobDescription: JD });

    expect(second.json.cached).toBe(false);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("reports a response in an unexpected format", async () => {
    const fetchImpl = strategistStub({ analyze: () => jsonResponse(200, { success: true, data: { nope: 1 } }) });
    harness = await createHarness({ fetchImpl });
    const result = await callTool(harness.client, "analyze_job_fit", { jobDescription: JD });

    expect(result.isError).toBe(true);
    expect(result.text).toMatch(/unexpected format/);
  });
});

describe("rewrite_bullet", () => {
  async function analyzed(fetchImpl = strategistStub(), store?: MemoryAnalysisStore) {
    harness = await createHarness({ fetchImpl, store });
    const analysis = await callTool(harness.client, "analyze_job_fit", { jobDescription: JD });
    return { fetchImpl, analysisId: analysis.json.analysisId as string };
  }

  it("rewrites a bullet and sends the whole stored job description to the API", async () => {
    const { fetchImpl, analysisId } = await analyzed();
    const result = await callTool(harness!.client, "rewrite_bullet", { analysisId, bulletId: "b1" });

    expect(result.json).toMatchObject({
      bulletId: "b1",
      forRole: "Backend Intern",
      originalBullet: "Built 15 REST endpoints",
      rewrittenBullet: "Shipped 15 REST endpoints in Node.js.",
    });

    const [url, init] = fetchImpl.mock.calls[1]!;
    expect(String(url)).toBe("http://strategist.test/api/rewrite");
    const body = JSON.parse(init!.body as string);
    expect(body.bulletId).toBe("b1");
    expect(body.structuredJobDescription.responsibilities).toEqual(["Build APIs"]); // extra fields survive
  });

  it("explains an unknown analysis id", async () => {
    harness = await createHarness({ fetchImpl: strategistStub() });
    const result = await callTool(harness.client, "rewrite_bullet", { analysisId: "an_nope", bulletId: "b1" });

    expect(result.isError).toBe(true);
    expect(result.text).toMatch(/not found or has expired/);
  });

  it("lists the valid bullet ids when the bullet is not part of the analysis", async () => {
    const { analysisId } = await analyzed();
    const result = await callTool(harness!.client, "rewrite_bullet", { analysisId, bulletId: "zzz" });

    expect(result.isError).toBe(true);
    expect(result.text).toContain("b1, b2");
  });

  it("explains when the API says the bullet no longer exists", async () => {
    const fetchImpl = strategistStub({ rewrite: () => jsonResponse(404, { message: "Resume bullet not found." }) });
    const { analysisId } = await analyzed(fetchImpl);
    const result = await callTool(harness!.client, "rewrite_bullet", { analysisId, bulletId: "b2" });

    expect(result.isError).toBe(true);
    expect(result.text).toMatch(/no longer in the stored resume/);
  });

  it("refuses an analysis that has expired", async () => {
    let now = 1_000;
    const store = new MemoryAnalysisStore({ ttlMs: 100, now: () => now });
    const { analysisId } = await analyzed(strategistStub(), store);

    now += 500;
    const result = await callTool(harness!.client, "rewrite_bullet", { analysisId, bulletId: "b1" });
    expect(result.isError).toBe(true);
    expect(result.text).toMatch(/expired/);
  });
});

describe("tracker tools", () => {
  const start = new Date("2026-11-10T12:00:00Z");
  let now = start;

  beforeEach(() => {
    now = start;
  });

  async function open() {
    harness = await createHarness({ fetchImpl: strategistStub(), now: () => now });
    return harness.client;
  }

  it("logs an application and defaults the date to today", async () => {
    const client = await open();
    const result = await callTool(client, "log_application", { company: "Acme", role: "Backend Intern", matchPercentage: 88 });

    expect(result.json).toMatchObject({
      created: true,
      application: { id: 1, appliedOn: "2026-11-10", status: "applied", matchPercentage: 88, followUp: "ok" },
    });
  });

  it("does not create a duplicate for the same company and role", async () => {
    const client = await open();
    await callTool(client, "log_application", { company: "Acme", role: "Backend Intern" });
    const again = await callTool(client, "log_application", { company: "ACME", role: "backend intern" });

    expect(again.json.created).toBe(false);
    expect((await callTool(client, "list_applications", {})).json.count).toBe(1);
  });

  it.each([
    ["2026-02-30", /not a real calendar date/],
    ["2026-11-11", /cannot be in the future/],
    ["10/11/2026", /YYYY-MM-DD/],
  ] as const)("rejects the date %s", async (appliedOn, message) => {
    const client = await open();
    const result = await callTool(client, "log_application", { company: "Acme", role: "Backend Intern", appliedOn });

    expect(result.isError).toBe(true);
    expect(result.text).toMatch(message);
  });

  it("follows an application through its whole follow-up life cycle as time passes", async () => {
    const client = await open();
    await callTool(client, "log_application", { company: "Acme", role: "Backend Intern", appliedOn: "2026-10-31" });

    let due = await callTool(client, "get_followups_due");
    expect(due.json.followUpsDue).toMatchObject([{ id: 1, company: "Acme", overdueByDays: 3, followUpNumber: 1 }]);

    await callTool(client, "update_application", { id: 1, followedUp: true, note: "Emailed recruiter" });
    due = await callTool(client, "get_followups_due");
    expect(due.json.followUpsDue).toEqual([]);
    expect(due.json.message).toMatch(/Nothing needs attention/);

    now = new Date("2026-11-24T12:00:00Z"); // two weeks of silence after the follow-up
    due = await callTool(client, "get_followups_due");
    expect(due.json.followUpsDue).toEqual([]);
    expect(due.json.goneQuiet).toMatchObject([{ id: 1, company: "Acme" }]);

    await callTool(client, "update_application", { id: 1, status: "rejected" });
    due = await callTool(client, "get_followups_due");
    expect(due.json.goneQuiet).toEqual([]);
  });

  it("lists active applications by default and finished ones on request", async () => {
    const client = await open();
    await callTool(client, "log_application", { company: "A", role: "Dev" });
    await callTool(client, "log_application", { company: "B", role: "Dev" });
    await callTool(client, "update_application", { id: 2, status: "rejected" });

    expect((await callTool(client, "list_applications", {})).json.applications.map((a: any) => a.company)).toEqual(["A"]);
    expect((await callTool(client, "list_applications", { filter: "rejected" })).json.applications.map((a: any) => a.company)).toEqual(["B"]);
    expect((await callTool(client, "list_applications", { filter: "all" })).json.count).toBe(2);
  });

  it("explains an unknown id and an update that changes nothing", async () => {
    const client = await open();

    const unknown = await callTool(client, "update_application", { id: 42, status: "offer" });
    expect(unknown.isError).toBe(true);
    expect(unknown.text).toMatch(/No tracked application has id 42/);

    await callTool(client, "log_application", { company: "Acme", role: "Dev" });
    const empty = await callTool(client, "update_application", { id: 1 });
    expect(empty.isError).toBe(true);
    expect(empty.text).toMatch(/at least one of/);
  });
});