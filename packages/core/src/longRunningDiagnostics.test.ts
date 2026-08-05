import { describe, expect, it } from "vitest";
import type { DatabaseSession } from "@queryx/shared";
import { findLongRunningSessions } from "./longRunningDiagnostics";

const session = (
  id: string,
  state: DatabaseSession["state"],
  durationMs: number | null,
): DatabaseSession => ({
  id,
  user: "queryx",
  database: "app",
  clientAddress: null,
  applicationName: "worker",
  state,
  query: "SELECT 1",
  startedAt: null,
  durationMs,
  waitEvent: null,
  canCancel: true,
});

describe("findLongRunningSessions", () => {
  it("returns active and waiting sessions over the threshold in descending duration", () => {
    const sessions = [
      session("idle-long", "idle", 60_000),
      session("active-short", "active", 4_999),
      session("waiting-long", "waiting", 18_000),
      session("active-long", "active", 30_000),
      session("unknown", "unknown", null),
    ];

    expect(
      findLongRunningSessions(sessions, 5_000).map((item) => item.id),
    ).toEqual(["active-long", "waiting-long"]);
  });
});
