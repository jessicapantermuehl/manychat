import { describe, expect, it } from "vitest";
import { computeFunnel, rate, stagesOf } from "../analytics";
import type { ActivityRecord, Automation } from "../types";

const auto = { id: "r1", name: "Guide" } as Automation;
const row = (over: Partial<ActivityRecord>): ActivityRecord => ({
  commentId: "c",
  igUserId: "acct",
  automationId: "r1",
  fromUsername: "fan",
  commentText: "",
  status: "sent",
  detail: "",
  createdAt: "2026-09-16T10:00:00.000Z",
  ...over,
});

describe("stagesOf", () => {
  it("classifies the runner's detail strings", () => {
    expect(stagesOf(row({ detail: "public reply posted; asked for opt-in" }))).toMatchObject({ triggered: true, optedIn: false, delivered: false });
    expect(stagesOf(row({ detail: "opted in; link sent; 2 follow-ups sent" }))).toMatchObject({ triggered: false, optedIn: true, delivered: true });
    expect(stagesOf(row({ detail: "story reply trigger; link sent" }))).toMatchObject({ triggered: true, delivered: true });
    expect(stagesOf(row({ status: "captured", detail: "email a@b.co; GHL contact created; link sent" }))).toMatchObject({ delivered: true, email: true });
    expect(stagesOf(row({ status: "captured", detail: "email a@b.co; GHL contact created; confirmation sent; delivery by email" }))).toMatchObject({ delivered: true, email: true });
    expect(stagesOf(row({ status: "skipped", detail: "no matching automation" }))).toMatchObject({ triggered: false, delivered: false });
    expect(stagesOf(row({ status: "failed", detail: "opted in; DM failed: boom" }))).toMatchObject({ triggered: false, optedIn: false, delivered: false });
    expect(stagesOf(row({ status: "failed", detail: "public reply posted; DM failed: boom" }))).toMatchObject({ triggered: true, delivered: false });
  });
});

describe("computeFunnel", () => {
  const now = new Date("2026-09-17T12:00:00.000Z");
  const activity: ActivityRecord[] = [
    row({ detail: "public reply posted; asked for opt-in", createdAt: "2026-09-16T10:00:00.000Z" }),
    row({ detail: "opted in; link sent", createdAt: "2026-09-16T10:01:00.000Z" }),
    row({ detail: "public reply posted; asked for opt-in", createdAt: "2026-09-17T09:00:00.000Z", category: "lead" }),
    row({ detail: "DM keyword trigger; link sent", createdAt: "2026-09-17T09:30:00.000Z" }),
    row({ status: "skipped", automationId: null, detail: "no matching automation", createdAt: "2026-09-17T09:40:00.000Z", category: "praise" }),
    row({ status: "failed", detail: "opted in; DM failed: x", createdAt: "2026-09-17T09:50:00.000Z" }),
  ];

  it("counts stages per automation and in total", () => {
    const f = computeFunnel(activity, [auto], 7, now);
    expect(f.rows).toHaveLength(1);
    expect(f.rows[0]).toMatchObject({ name: "Guide", triggered: 3, optedIn: 1, delivered: 2, emails: 0, failed: 1 });
    expect(f.totals).toMatchObject({ triggered: 3, optedIn: 1, delivered: 2, unmatched: 1, failed: 1 });
    expect(f.categories).toEqual({ lead: 1, praise: 1 });
  });

  it("builds a zero-filled daily series over the range", () => {
    const f = computeFunnel(activity, [auto], 7, now);
    expect(f.daily).toHaveLength(7);
    expect(f.daily.at(-1)).toEqual({ day: "2026-09-17", triggered: 2, delivered: 1 });
    expect(f.daily.at(-2)).toEqual({ day: "2026-09-16", triggered: 1, delivered: 1 });
    expect(f.daily[0]).toEqual({ day: "2026-09-11", triggered: 0, delivered: 0 });
  });

  it("formats rates", () => {
    expect(rate(1, 4)).toBe("25%");
    expect(rate(0, 0)).toBe("–");
  });
});
