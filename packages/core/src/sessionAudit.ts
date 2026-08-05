import type {
  DatabaseSession,
  DriverKind,
  SessionAuditEntry,
} from "@queryx/shared";

const identifierCharacter = /[A-Za-z_$]/;

function consumeDelimitedValue(
  sql: string,
  start: number,
  delimiter: string,
): number {
  let index = start + 1;
  while (index < sql.length) {
    if (sql[index] === "\\") {
      index += 2;
      continue;
    }
    if (sql[index] === delimiter && sql[index + 1] === delimiter) {
      index += 2;
      continue;
    }
    if (sql[index] === delimiter) return index + 1;
    index += 1;
  }
  return sql.length;
}

function dollarQuoteEnd(sql: string, start: number): number | null {
  if (sql[start] !== "$" || sql[start + 1] === "$") {
    return sql[start] === "$" && sql[start + 1] === "$" ? start + 2 : null;
  }
  let index = start + 1;
  while (index < sql.length && /[A-Za-z0-9_]/.test(sql[index] ?? "")) {
    index += 1;
  }
  if (sql[index] !== "$") return null;
  const delimiter = sql.slice(start, index + 1);
  const end = sql.indexOf(delimiter, index + 1);
  return end < 0 ? sql.length : end + delimiter.length;
}

function consumeNumber(sql: string, start: number): number {
  let index = start;
  while (index < sql.length && /[0-9A-Fa-fxX._+-]/.test(sql[index] ?? "")) {
    index += 1;
  }
  return index;
}

export function redactSqlForAudit(sql: string): string {
  let result = "";
  let index = 0;
  while (index < sql.length) {
    const current = sql[index];
    const next = sql[index + 1];
    if (current === "-" && next === "-") {
      const end = sql.indexOf("\n", index + 2);
      result += " /* redacted */ ";
      index = end < 0 ? sql.length : end;
      continue;
    }
    if (current === "/" && next === "*") {
      const end = sql.indexOf("*/", index + 2);
      result += " /* redacted */ ";
      index = end < 0 ? sql.length : end + 2;
      continue;
    }
    if (current === "'" || current === '"' || current === "`") {
      result += "?";
      index = consumeDelimitedValue(sql, index, current);
      continue;
    }
    const dollarEnd = dollarQuoteEnd(sql, index);
    if (dollarEnd !== null) {
      result += "?";
      index = dollarEnd;
      continue;
    }
    if (
      /[0-9]/.test(current ?? "") &&
      (index === 0 || !identifierCharacter.test(sql[index - 1] ?? ""))
    ) {
      result += "?";
      index = consumeNumber(sql, index);
      continue;
    }
    result += current;
    index += 1;
  }
  return result.replace(/\s+/g, " ").trim();
}

export function fingerprintSqlForAudit(sql: string): string {
  let hash = 2_166_136_261;
  for (const character of redactSqlForAudit(sql).toLowerCase()) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16_777_619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function buildSessionAuditEntry(
  session: DatabaseSession,
  driver: DriverKind,
  connectionName: string,
  observedAt: string,
): SessionAuditEntry {
  const redactedQuery = session.query?.trim()
    ? redactSqlForAudit(session.query)
    : null;
  return {
    id: `session:${driver}:${connectionName}:${session.id}:${observedAt}`,
    driver,
    connectionName,
    sessionId: session.id,
    database: session.database,
    observedAt,
    state: session.state,
    durationMs: session.durationMs,
    waitEvent: session.waitEvent,
    queryPreview: redactedQuery ? redactedQuery.slice(0, 240) : null,
    queryFingerprint: redactedQuery
      ? fingerprintSqlForAudit(redactedQuery)
      : null,
  };
}

export function retainSessionAuditHistory(
  existing: readonly SessionAuditEntry[],
  incoming: readonly SessionAuditEntry[],
  retentionDays: number,
  now = new Date(),
): SessionAuditEntry[] {
  if (retentionDays <= 0) return [];
  const cutoff = now.getTime() - retentionDays * 24 * 60 * 60 * 1000;
  const unique = new Map<string, SessionAuditEntry>();
  for (const entry of [...incoming, ...existing]) {
    const observedAt = Date.parse(entry.observedAt);
    if (!Number.isFinite(observedAt) || observedAt < cutoff) continue;
    if (!unique.has(entry.id)) unique.set(entry.id, entry);
  }
  return [...unique.values()]
    .sort((left, right) => right.observedAt.localeCompare(left.observedAt))
    .slice(0, 500);
}
