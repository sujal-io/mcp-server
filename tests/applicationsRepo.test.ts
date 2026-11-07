import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDatabase, type Db } from "../src/db.js";
import {
  findActiveDuplicate,
  getApplication,
  insertApplication,
  listApplications,
  updateApplication,
  type NewApplication,
} from "../src/tracker/applicationsRepo.js";

const NOW = new Date("2026-11-10T09:00:00Z");
const base: NewApplication = {
  company: "Acme",
  role: "Backend Intern",
  status: "applied",
  appliedOn: "2026-11-01",
};

let db: Db;
beforeEach(() => {
  db = openDatabase(":memory:");
});
afterEach(() => {
  db.close();
});

describe("insertApplication", () => {
  it("saves a record whose follow-up clock starts on the day applied", () => {
    const saved = insertApplication(db, base, NOW);
    expect(saved).toMatchObject({
      id: 1,
      company: "Acme",
      status: "applied",
      followUpCount: 0,
      lastTouchAt: "2026-11-01T00:00:00.000Z",
      createdAt: NOW.toISOString(),
      notes: null,
    });
  });

  it("stores text that looks like SQL as plain text, because values are parameters", () => {
    const nasty = "Robert'); DROP TABLE applications;--";
    insertApplication(db, { ...base, company: nasty }, NOW);

    expect(listApplications(db, ["applied"])).toHaveLength(1);
    expect(getApplication(db, 1)?.company).toBe(nasty);
  });

  it("refuses a status the database does not allow", () => {
    expect(() => insertApplication(db, { ...base, status: "bogus" as never }, NOW)).toThrow(/CHECK/);
  });
});

describe("findActiveDuplicate", () => {
  it("matches the same company and role regardless of letter case", () => {
    insertApplication(db, base, NOW);
    expect(findActiveDuplicate(db, "ACME", "backend intern")?.id).toBe(1);
  });

  it("ignores finished applications, so you can apply again", () => {
    insertApplication(db, base, NOW);
    updateApplication(db, 1, { status: "rejected" }, NOW);
    expect(findActiveDuplicate(db, "Acme", "Backend Intern")).toBeUndefined();
  });

  it("does not match a different role at the same company", () => {
    insertApplication(db, base, NOW);
    expect(findActiveDuplicate(db, "Acme", "Frontend Intern")).toBeUndefined();
  });
});

describe("listApplications", () => {
  it("filters by status and puts the most recent activity first", () => {
    insertApplication(db, { ...base, company: "Old", appliedOn: "2026-10-01" }, NOW);
    insertApplication(db, { ...base, company: "New", appliedOn: "2026-11-05" }, NOW);
    insertApplication(db, { ...base, company: "Done", status: "rejected" }, NOW);

    expect(listApplications(db, ["applied", "interviewing"]).map((a) => a.company)).toEqual(["New", "Old"]);
    expect(listApplications(db, ["rejected"]).map((a) => a.company)).toEqual(["Done"]);
  });
});

describe("updateApplication", () => {
  it("returns undefined for an unknown id", () => {
    expect(updateApplication(db, 99, { status: "offer" }, NOW)).toBeUndefined();
  });

  it("counts a follow-up and restarts the clock", () => {
    insertApplication(db, base, NOW);
    const updated = updateApplication(db, 1, { followedUp: true }, NOW);
    expect(updated).toMatchObject({ followUpCount: 1, lastTouchAt: NOW.toISOString() });
  });

  it("starts a fresh follow-up count when the status changes", () => {
    insertApplication(db, base, NOW);
    updateApplication(db, 1, { followedUp: true }, NOW);
    const updated = updateApplication(db, 1, { status: "interviewing" }, NOW);
    expect(updated).toMatchObject({ status: "interviewing", followUpCount: 0 });
  });

  it("appends dated notes instead of replacing them", () => {
    insertApplication(db, base, NOW);
    updateApplication(db, 1, { note: "Emailed recruiter" }, NOW);
    const updated = updateApplication(db, 1, { note: "Recruiter replied" }, NOW);
    expect(updated?.notes).toBe("[2026-11-10] Emailed recruiter\n[2026-11-10] Recruiter replied");
  });

  it("leaves the clock alone when nothing meaningful changed", () => {
    insertApplication(db, base, NOW);
    const updated = updateApplication(db, 1, {}, new Date("2026-12-01T00:00:00Z"));
    expect(updated?.lastTouchAt).toBe("2026-11-01T00:00:00.000Z");
  });
});