import { describe, expect, it } from "vitest";
import type { DatabaseSession } from "@queryx/shared";
import {
  buildSessionAuditEntry,
  fingerprintSqlForAudit,
  redactSqlForAudit,
  retainSessionAuditHistory,
} from "./sessionAudit";

const activeSession: DatabaseSession = {
  id: "42",
  user: "queryx",
  database: "app",
  clientAddress: null,
  applicationName: "worker",
  state: "active",
  query: "SELECT * FROM users WHERE email = 'secret@example.com'",
  startedAt: null,
  durationMs: 12_000,
  waitEvent: null,
  canCancel: true,
};

describe("session audit SQL redaction", () => {
  it("removes literal and comment contents before local persistence", () => {
    const redacted = redactSqlForAudit(
      "SELECT * FROM users WHERE email = 'alice@example.com' AND id = 42 /* token=secret */ -- api-key=private",
    );

    expect(redacted).not.toContain("alice@example.com");
    expect(redacted).not.toContain("42");
    expect(redacted).not.toContain("secret");
    expect(redacted).not.toContain("private");
    expect(redacted).toContain("?");
    expect(redacted).toContain("/* redacted */");
  });

  it("redacts double-quoted and backtick-delimited values conservatively", () => {
    const redacted = redactSqlForAudit(
      'SELECT "private-value" AS value, `credential_column` FROM users',
    );

    expect(redacted).not.toContain("private-value");
    expect(redacted).not.toContain("credential_column");
  });

  it("gives equivalent literal values the same query fingerprint", () => {
    expect(fingerprintSqlForAudit("SELECT * FROM users WHERE id = 1")).toBe(
      fingerprintSqlForAudit("SELECT * FROM users WHERE id = 99"),
    );
    expect(fingerprintSqlForAudit("SELECT * FROM users WHERE id = 1")).not.toBe(
      fingerprintSqlForAudit("DELETE FROM users WHERE id = 1"),
    );
  });

  it("builds an audit entry without persisting the raw query", () => {
    const entry = buildSessionAuditEntry(
      activeSession,
      "postgres",
      "production",
      "2026-08-05T12:00:00.000Z",
    );

    expect(entry).toMatchObject({
      driver: "postgres",
      connectionName: "production",
      sessionId: "42",
      database: "app",
      observedAt: "2026-08-05T12:00:00.000Z",
      queryPreview: "SELECT * FROM users WHERE email = ?",
    });
    expect(entry.queryPreview).not.toContain("secret@example.com");
    expect(entry.queryFingerprint).toMatch(/^[0-9a-f]{8}$/);
  });

  it("retains only entries inside the configured local window", () => {
    const current = buildSessionAuditEntry(
      activeSession,
      "postgres",
      "production",
      "2026-08-05T12:00:00.000Z",
    );
    const old = {
      ...current,
      id: "old",
      observedAt: "2026-07-01T12:00:00.000Z",
    };

    expect(
      retainSessionAuditHistory(
        [old],
        [current],
        7,
        new Date("2026-08-05T12:00:00.000Z"),
      ),
    ).toEqual([current]);
  });
});
