import type { DriverKind } from "@queryx/shared";

export interface QueryPagePlan {
  sql: string;
  limit: number;
  offset: number;
  errors: string[];
}

interface StatementAnalysis {
  statement: string;
  executable: string;
  hasMultipleStatements: boolean;
  hasUnterminatedQuote: boolean;
}

function quoteIdentifier(value: string, driver: DriverKind): string {
  if (driver === "sqlserver") return `[${value.replaceAll("]", "]]")}]`;
  const quote = driver === "mysql" ? "`" : '"';
  return `${quote}${value.replaceAll(quote, `${quote}${quote}`)}${quote}`;
}

function stripLeadingComments(sql: string): string {
  let remaining = sql;
  while (true) {
    remaining = remaining.trimStart();
    if (remaining.startsWith("--")) {
      const newline = remaining.indexOf("\n");
      remaining = newline === -1 ? "" : remaining.slice(newline + 1);
      continue;
    }
    if (remaining.startsWith("/*")) {
      const end = remaining.indexOf("*/", 2);
      remaining = end === -1 ? "" : remaining.slice(end + 2);
      continue;
    }
    return remaining;
  }
}

function analyzeStatement(sql: string): StatementAnalysis {
  let quote: "'" | '"' | "`" | null = null;
  let lineComment = false;
  let blockComment = false;
  let semicolonIndex = -1;
  let hasMultipleStatements = false;

  for (let index = 0; index < sql.length; index += 1) {
    const character = sql[index];
    const next = sql[index + 1];
    if (lineComment) {
      if (character === "\n") lineComment = false;
      continue;
    }
    if (blockComment) {
      if (character === "*" && next === "/") {
        blockComment = false;
        index += 1;
      }
      continue;
    }
    if (quote) {
      if (character === "\\" && quote !== '"') {
        index += 1;
        continue;
      }
      if (character === quote) {
        if (next === quote) {
          index += 1;
        } else {
          quote = null;
        }
      }
      continue;
    }
    if (character === "-" && next === "-") {
      lineComment = true;
      index += 1;
      continue;
    }
    if (character === "/" && next === "*") {
      blockComment = true;
      index += 1;
      continue;
    }
    if (character === "'" || character === '"' || character === "`") {
      quote = character;
      continue;
    }
    if (character === ";") {
      if (semicolonIndex !== -1) {
        hasMultipleStatements = true;
        continue;
      }
      semicolonIndex = index;
      continue;
    }
    if (semicolonIndex !== -1 && !/\s/.test(character)) {
      hasMultipleStatements = true;
    }
  }

  const statement =
    semicolonIndex !== -1 && !hasMultipleStatements
      ? sql.slice(0, semicolonIndex).trim()
      : sql.trim();
  return {
    statement,
    executable: stripLeadingComments(statement),
    hasMultipleStatements,
    hasUnterminatedQuote: Boolean(quote) || blockComment,
  };
}

function hasMutationOrLockingClause(sql: string): boolean {
  const executable = sql.replace(/(['"`])(?:\\.|\1\1|[\s\S])*?\1/g, " ");
  return (
    /\b(?:INSERT|UPDATE|DELETE|MERGE|CALL|DO|COPY|INTO)\b/i.test(executable) ||
    /\bFOR\s+(?:UPDATE|SHARE|NO\s+KEY\s+UPDATE)\b/i.test(executable)
  );
}

export function buildQueryPagePlan(
  sql: string,
  driver: DriverKind,
  limit: number,
  offset: number,
): QueryPagePlan {
  const errors: string[] = [];
  if (!Number.isInteger(limit) || limit < 1 || limit > 10_000) {
    errors.push("Page size must be an integer between 1 and 10000");
  }
  if (!Number.isInteger(offset) || offset < 0) {
    errors.push("Page offset must be a non-negative integer");
  }

  const analysis = analyzeStatement(sql.trim());
  if (!analysis.statement) errors.push("Enter a query before loading a page");
  if (!/^(SELECT|WITH)\b/i.test(analysis.executable)) {
    errors.push("Only SELECT or WITH queries can be server-paged");
  }
  if (analysis.hasMultipleStatements) {
    errors.push("Server paging accepts one SQL statement at a time");
  }
  if (analysis.hasUnterminatedQuote) {
    errors.push("Query contains an unterminated quote or comment");
  }
  if (hasMutationOrLockingClause(analysis.statement)) {
    errors.push("Server paging excludes mutating or locking query clauses");
  }
  if (errors.length > 0) {
    return { sql: "", limit, offset, errors };
  }

  const alias = quoteIdentifier("__queryx_page", driver);
  return {
    sql:
      driver === "sqlserver"
        ? `SELECT * FROM (\n${analysis.statement}\n) AS ${alias} ORDER BY (SELECT 1) OFFSET ${offset} ROWS FETCH NEXT ${limit} ROWS ONLY;`
        : `SELECT * FROM (\n${analysis.statement}\n) AS ${alias} LIMIT ${limit} OFFSET ${offset};`,
    limit,
    offset,
    errors: [],
  };
}
