export type QuerySafetyOperation =
  | "UPDATE"
  | "DELETE"
  | "TRUNCATE"
  | "DROP"
  | "ALTER";

export interface QuerySafetyReport {
  isDangerous: boolean;
  operation?: QuerySafetyOperation;
  reason: string;
}

interface SqlToken {
  text: string;
  upper: string;
  depth: number;
}

interface DestructiveCandidate {
  operation: QuerySafetyOperation;
  index: number;
}

const clauseKeywords = new Set([
  "AND",
  "AS",
  "BY",
  "FROM",
  "GROUP",
  "HAVING",
  "INTO",
  "JOIN",
  "LIMIT",
  "ON",
  "OR",
  "ORDER",
  "RETURNING",
  "SELECT",
  "SET",
  "UNION",
  "VALUES",
  "WHERE",
]);

/**
 * Inspect destructive DML and high-risk schema operations without treating
 * text, comments, or nested query predicates as a guard for the statement
 * being executed.
 *
 * This is deliberately a small lexical analyzer rather than a vendor parser:
 * it does not claim an affected-row estimate, but it does preserve SQL token
 * boundaries and parenthesis depth so Safe Mode can be conservative across
 * common PostgreSQL, MySQL, SQLite, SQL Server, and Oracle syntax.
 */
export function inspectQuerySafety(sql: string): QuerySafetyReport {
  const tokens = tokenizeSql(sql);
  const candidates: DestructiveCandidate[] = [];
  tokens.forEach((token, index) => {
    if (token.upper === "UPDATE" && isUpdateKeyword(tokens, index)) {
      candidates.push({ operation: "UPDATE", index });
    }
    if (token.upper === "DELETE" && isDeleteKeyword(tokens, index)) {
      candidates.push({ operation: "DELETE", index });
    }
    if (
      (token.upper === "TRUNCATE" ||
        token.upper === "DROP" ||
        token.upper === "ALTER") &&
      isHighRiskKeyword(tokens, index)
    ) {
      candidates.push({
        operation: token.upper,
        index,
      });
    }
  });

  for (const candidate of candidates) {
    if (
      candidate.operation === "TRUNCATE" ||
      candidate.operation === "DROP" ||
      candidate.operation === "ALTER"
    ) {
      return {
        isDangerous: true,
        operation: candidate.operation,
        reason: "High-risk schema operation detected",
      };
    }
    if (hasSameDepthWhere(tokens, candidate.index)) {
      continue;
    }
    return {
      isDangerous: true,
      operation: candidate.operation,
      reason: "No top-level WHERE clause detected",
    };
  }

  const first = candidates[0];
  if (!first) {
    return { isDangerous: false, reason: "No destructive operation detected" };
  }
  return {
    isDangerous: false,
    operation: first.operation,
    reason: "Top-level WHERE clause detected",
  };
}

function isHighRiskKeyword(
  tokens: readonly SqlToken[],
  index: number,
): boolean {
  const token = tokens[index];
  const previous = previousAtDepth(tokens, index, token.depth);
  const next = nextAtDepth(tokens, index, token.depth);
  if (!next || next.upper === "AS") return false;
  if (previous?.text === "." || previous?.text === ",") return false;
  if (previous && clauseKeywords.has(previous.upper)) return false;
  return token.depth === 0 || previous?.text === "(" || previous?.text === ")";
}

function isUpdateKeyword(tokens: readonly SqlToken[], index: number): boolean {
  const token = tokens[index];
  const previous = previousAtDepth(tokens, index, token.depth);
  const next = nextAtDepth(tokens, index, token.depth);
  if (next?.upper === "AS") return false;
  if (!previous) return true;
  if (previous.text === "." || clauseKeywords.has(previous.upper)) return false;
  if (previous.text === ",") return false;
  return token.depth > 0 ? previous.text === "(" : true;
}

function isDeleteKeyword(tokens: readonly SqlToken[], index: number): boolean {
  const token = tokens[index];
  const next = nextAtDepth(tokens, index, token.depth);
  if (next?.upper !== "FROM") return false;
  const previous = previousAtDepth(tokens, index, token.depth);
  if (!previous) return true;
  if (previous.text === "." || clauseKeywords.has(previous.upper)) return false;
  if (previous.text === ",") return false;
  return token.depth > 0 ? previous.text === "(" : true;
}

function hasSameDepthWhere(
  tokens: readonly SqlToken[],
  index: number,
): boolean {
  const depth = tokens[index]?.depth;
  if (depth === undefined) return false;
  for (let cursor = index + 1; cursor < tokens.length; cursor += 1) {
    const token = tokens[cursor];
    if (token.depth < depth) return false;
    if (token.depth === depth && token.text === ";") return false;
    if (token.depth === depth && token.upper === "WHERE") return true;
  }
  return false;
}

function previousAtDepth(
  tokens: readonly SqlToken[],
  index: number,
  depth: number,
): SqlToken | undefined {
  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    if (tokens[cursor]?.depth === depth) return tokens[cursor];
  }
  return undefined;
}

function nextAtDepth(
  tokens: readonly SqlToken[],
  index: number,
  depth: number,
): SqlToken | undefined {
  for (let cursor = index + 1; cursor < tokens.length; cursor += 1) {
    if (tokens[cursor]?.depth < depth) return undefined;
    if (tokens[cursor]?.depth === depth) return tokens[cursor];
  }
  return undefined;
}

function tokenizeSql(sql: string): SqlToken[] {
  const tokens: SqlToken[] = [];
  let depth = 0;
  let index = 0;

  while (index < sql.length) {
    const character = sql[index];
    const next = sql[index + 1];

    if (/\s/.test(character)) {
      index += 1;
      continue;
    }
    if (character === "-" && next === "-") {
      index = skipLineComment(sql, index + 2);
      continue;
    }
    if (character === "#") {
      index = skipLineComment(sql, index + 1);
      continue;
    }
    if (character === "/" && next === "*") {
      index = skipBlockComment(sql, index + 2);
      continue;
    }
    if (character === "'" || character === '"' || character === "`") {
      index = skipQuoted(sql, index, character);
      continue;
    }
    if (character === "[") {
      index = skipBracketIdentifier(sql, index);
      continue;
    }
    if (character === "$") {
      const end = skipDollarQuoted(sql, index);
      if (end !== null) {
        index = end;
        continue;
      }
    }
    if (/[A-Za-z_]/.test(character)) {
      const start = index;
      index += 1;
      while (index < sql.length && /[A-Za-z0-9_$]/.test(sql[index])) {
        index += 1;
      }
      const text = sql.slice(start, index);
      tokens.push({ text, upper: text.toUpperCase(), depth });
      continue;
    }

    if (character === "(") {
      tokens.push({ text: character, upper: character, depth });
      depth += 1;
      index += 1;
      continue;
    }
    if (character === ")") {
      depth = Math.max(0, depth - 1);
      tokens.push({ text: character, upper: character, depth });
      index += 1;
      continue;
    }
    if (character === ";") {
      tokens.push({ text: character, upper: character, depth });
    }
    index += 1;
  }

  return tokens;
}

function skipLineComment(sql: string, index: number): number {
  const newline = sql.indexOf("\n", index);
  return newline === -1 ? sql.length : newline + 1;
}

function skipBlockComment(sql: string, index: number): number {
  let depth = 1;
  let cursor = index;
  while (cursor < sql.length && depth > 0) {
    if (sql[cursor] === "/" && sql[cursor + 1] === "*") {
      depth += 1;
      cursor += 2;
    } else if (sql[cursor] === "*" && sql[cursor + 1] === "/") {
      depth -= 1;
      cursor += 2;
    } else {
      cursor += 1;
    }
  }
  return cursor;
}

function skipQuoted(sql: string, start: number, quote: string): number {
  let cursor = start + 1;
  while (cursor < sql.length) {
    if (sql[cursor] === "\\") {
      cursor += 2;
      continue;
    }
    if (sql[cursor] === quote) {
      if (sql[cursor + 1] === quote) {
        cursor += 2;
        continue;
      }
      return cursor + 1;
    }
    cursor += 1;
  }
  return sql.length;
}

function skipBracketIdentifier(sql: string, start: number): number {
  let cursor = start + 1;
  while (cursor < sql.length) {
    if (sql[cursor] === "]") {
      if (sql[cursor + 1] === "]") {
        cursor += 2;
        continue;
      }
      return cursor + 1;
    }
    cursor += 1;
  }
  return sql.length;
}

function skipDollarQuoted(sql: string, start: number): number | null {
  const match = sql.slice(start).match(/^\$[A-Za-z_][A-Za-z0-9_]*\$|^\$\$/);
  if (!match) return null;
  const delimiter = match[0];
  const end = sql.indexOf(delimiter, start + delimiter.length);
  return end === -1 ? sql.length : end + delimiter.length;
}
