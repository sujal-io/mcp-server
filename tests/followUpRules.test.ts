import { describe, expect, it } from "vitest";
import { getFollowUpState } from "../src/tracker/followupRules.js";

const NOW = new Date("2026-11-30T12:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString();

describe("getFollowUpState", () => {
  // status, follow-ups already sent, days of silence, expected state
  it.each([
    ["applied", 0, 0, "ok"],
    ["applied", 0, 6, "ok"],
    ["applied", 0, 7, "follow_up_due"],
    ["applied", 0, 30, "follow_up_due"], // never nudged, so still a nudge and not "gone quiet"
    ["applied", 1, 6, "ok"],
    ["applied", 1, 7, "follow_up_due"],
    ["applied", 1, 14, "stale"],
    ["applied", 2, 13, "ok"], // both follow-ups used, so no more reminders yet
    ["applied", 2, 14, "stale"],
    ["interviewing", 0, 4, "ok"],
    ["interviewing", 0, 5, "follow_up_due"],
  ] as const)("%s with %i follow-ups and %i quiet days is %s", (status, followUpCount, days, expected) => {
    const result = getFollowUpState({ status, followUpCount, lastTouchAt: daysAgo(days) }, NOW);
    expect(result.state).toBe(expected);
  });

  it.each(["offer", "rejected", "withdrawn"] as const)("%s is closed and never needs a follow-up", (status) => {
    const result = getFollowUpState({ status, followUpCount: 0, lastTouchAt: daysAgo(100) }, NOW);
    expect(result.state).toBe("closed");
  });

  it("reports how many days a follow-up is overdue", () => {
    const result = getFollowUpState({ status: "applied", followUpCount: 0, lastTouchAt: daysAgo(10) }, NOW);
    expect(result).toMatchObject({ state: "follow_up_due", daysSinceTouch: 10, overdueByDays: 3 });
  });

  it("never reports negative days when the timestamp is in the future", () => {
    const result = getFollowUpState({ status: "applied", followUpCount: 0, lastTouchAt: daysAgo(-3) }, NOW);
    expect(result).toMatchObject({ state: "ok", daysSinceTouch: 0 });
  });
});