import type { DriverKind, QueryColumn } from "@queryx/shared";

export interface QueryPagePlan {
  sql: string;
  limit: number;
  offset: number;
  errors: string[];
}

export type QueryResultSortDirection = "asc" | "desc";

export interface QueryResultFilterPlan extends QueryPagePlan {
  filter: string;
  sortBy: string | null;
  sortDirection: QueryResultSortDirection;
  warnings: string[];
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

function quoteString(value: string, driver: DriverKind): string {
  const escapedQuotes = value.replaceAll("'", "''");
  if (driver === "mysql" && value.includes("\\")) {
    return `'${escapedQuotes.replaceAll("\\", "\\\\")}'`;
  }
  if (driver === "postgres" && value.includes("\\")) {
    return `E'${escapedQuotes.replaceAll("\\", "\\\\")}'`;
  }
  return `'${escapedQuotes}'`;
}

function escapeLikePattern(value: string): string {
  return value
    .replaceAll("!", "!!")
    .replaceAll("%", "!%")
    .replaceAll("_", "!_");
}

function castAsText(identifier: string, driver: DriverKind): string {
  return `CAST(${identifier} AS ${driver === "mysql" ? "CHAR" : driver === "sqlserver" ? "NVARCHAR(MAX)" : driver === "oracle" ? "VARCHAR2(4000)" : "TEXT"})`;
}

function validatePageRequest(
  sql: string,
  limit: number,
  offset: number,
): { analysis: StatementAnalysis; errors: string[] } {
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
  return { analysis, errors };
}

function paginationSuffix(
  driver: DriverKind,
  limit: number,
  offset: number,
  orderBy: string,
): string {
  return driver === "sqlserver" || driver === "oracle"
    ? `ORDER BY ${orderBy} OFFSET ${offset} ROWS FETCH NEXT ${limit} ROWS ONLY;`
    : `${orderBy ? `ORDER BY ${orderBy} ` : ""}LIMIT ${limit} OFFSET ${offset};`;
}

export function buildQueryPagePlan(
  sql: string,
  driver: DriverKind,
  limit: number,
  offset: number,
): QueryPagePlan {
  const { analysis, errors } = validatePageRequest(sql, limit, offset);
  if (errors.length > 0) {
    return { sql: "", limit, offset, errors };
  }

  const alias = quoteIdentifier("__queryx_page", driver);
  const aliasClause = driver === "oracle" ? alias : `AS ${alias}`;
  return {
    sql:
      driver === "sqlserver" || driver === "oracle"
        ? `SELECT * FROM (\n${analysis.statement}\n) ${aliasClause} ${paginationSuffix(driver, limit, offset, driver === "oracle" ? "1" : "(SELECT 1)")}`
        : `SELECT * FROM (\n${analysis.statement}\n) ${aliasClause} ${paginationSuffix(driver, limit, offset, "")}`,
    limit,
    offset,
    errors: [],
  };
}

export function buildQueryResultFilterPlan(
  sql: string,
  columns: readonly Pick<QueryColumn, "name">[],
  driver: DriverKind,
  limit: number,
  offset: number,
  filter = "",
  sortBy: string | null = null,
  sortDirection: QueryResultSortDirection = "asc",
): QueryResultFilterPlan {
  const warnings: string[] = [];
  const normalizedFilter = filter.trim();
  const normalizedSortBy = sortBy?.trim() || null;
  const { analysis, errors } = validatePageRequest(sql, limit, offset);
  if (columns.length === 0) errors.push("The result has no columns to filter");
  if (
    normalizedSortBy &&
    !columns.some((column) => column.name === normalizedSortBy)
  ) {
    errors.push(`Sort column does not exist: ${normalizedSortBy}`);
  }
  if (sortDirection !== "asc" && sortDirection !== "desc") {
    errors.push("Result sort direction must be asc or desc");
  }
  if (errors.length > 0) {
    return {
      sql: "",
      limit,
      offset,
      filter: normalizedFilter,
      sortBy: normalizedSortBy,
      sortDirection,
      errors,
      warnings,
    };
  }

  const alias = quoteIdentifier("__queryx_result", driver);
  const aliasClause = driver === "oracle" ? alias : `AS ${alias}`;
  const qualifiedColumns = columns.map(
    (column) => `${alias}.${quoteIdentifier(column.name, driver)}`,
  );
  const where = normalizedFilter
    ? `WHERE (${qualifiedColumns
        .map(
          (column) =>
            `LOWER(${castAsText(column, driver)}) LIKE LOWER(${quoteString(`%${escapeLikePattern(normalizedFilter)}%`, driver)}) ESCAPE '!'`,
        )
        .join(" OR ")})`
    : "";
  const orderBy = normalizedSortBy
    ? `${alias}.${quoteIdentifier(normalizedSortBy, driver)} ${sortDirection.toUpperCase()}`
    : driver === "oracle"
      ? "1"
      : driver === "sqlserver"
        ? "(SELECT 1)"
        : "";
  const pageSql = paginationSuffix(driver, limit, offset, orderBy);
  return {
    sql: `SELECT * FROM (\n${analysis.statement}\n) ${aliasClause}${where ? `\n${where}` : ""} ${pageSql}`,
    limit,
    offset,
    filter: normalizedFilter,
    sortBy: normalizedSortBy,
    sortDirection,
    errors: [],
    warnings,
  };
}
