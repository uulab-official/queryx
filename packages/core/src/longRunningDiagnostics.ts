import type { DatabaseSession } from "@queryx/shared";

export function findLongRunningSessions(
  sessions: readonly DatabaseSession[],
  thresholdMs: number,
): DatabaseSession[] {
  const threshold = Math.max(0, thresholdMs);
  return sessions
    .filter(
      (session) =>
        (session.state === "active" || session.state === "waiting") &&
        session.durationMs !== null &&
        session.durationMs >= threshold,
    )
    .sort((left, right) => (right.durationMs ?? 0) - (left.durationMs ?? 0));
}
