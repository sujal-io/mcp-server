export const STATUSES = [
  "applied",
  "interviewing",
  "offer",
  "rejected",
  "withdrawn",
] as const;

export type Status = (typeof STATUSES)[number];

// The follow-up policy lives in one place so it is easy to read and change.
export const RULES = {
  followUpAfterDays: { applied: 7, interviewing: 5 },
  staleAfterDays: 14,
  maxFollowUps: 2,
} as const;

export type FollowUpState = "ok" | "follow_up_due" | "stale" | "closed";

export interface FollowUpInput {
  status: Status;
  lastTouchAt: string;
  followUpCount: number;
}

export interface FollowUpResult {
  state: FollowUpState;
  daysSinceTouch: number;
  overdueByDays: number;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

// A pure function: the same inputs always give the same answer, and it never
// reads the clock itself. That makes it easy to test.
export function getFollowUpState(app: FollowUpInput, now: Date): FollowUpResult {
  const elapsed = now.getTime() - new Date(app.lastTouchAt).getTime();
  const daysSinceTouch = Math.max(0, Math.floor(elapsed / MS_PER_DAY));

  if (app.status === "offer" || app.status === "rejected" || app.status === "withdrawn") {
    return { state: "closed", daysSinceTouch, overdueByDays: 0 };
  }

  // You already nudged them at least once and two weeks of silence followed.
  if (app.followUpCount >= 1 && daysSinceTouch >= RULES.staleAfterDays) {
    return {
      state: "stale",
      daysSinceTouch,
      overdueByDays: daysSinceTouch - RULES.staleAfterDays,
    };
  }

  const threshold = RULES.followUpAfterDays[app.status];
  if (app.followUpCount < RULES.maxFollowUps && daysSinceTouch >= threshold) {
    return {
      state: "follow_up_due",
      daysSinceTouch,
      overdueByDays: daysSinceTouch - threshold,
    };
  }

  return { state: "ok", daysSinceTouch, overdueByDays: 0 };
}