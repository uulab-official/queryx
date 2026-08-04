import type { QueryColumn } from "@queryx/shared";

export interface CsvExportOptions {
  includeBom?: boolean;
  lineEnding?: "\n" | "\r\n";
  protectFormulas?: boolean;
}

export interface SqlInsertExportOptions {
  tableName: string;
  dialect?: "mysql" | "postgres" | "sqlite";
  lineEnding?: "\n" | "\r\n";
  includeTransaction?: boolean;
}

const FORMULA_PREFIX = /^[=+\-@\t\r]/;

export function serializeRowsToCsv(
  columns: readonly Pick<QueryColumn, "name">[],
  rows: readonly Record<string, unknown>[],
  options: CsvExportOptions = {},
): string {
  const {
    includeBom = true,
    lineEnding = "\r\n",
    protectFormulas = true,
  } = options;
  const records = [
    columns.map((column) => encodeCell(column.name, protectFormulas)),
    ...rows.map((row) =>
      columns.map((column) =>
        encodeCell(normalizeCell(row[column.name]), protectFormulas),
      ),
    ),
  ];
  const csv = records.map((record) => record.join(",")).join(lineEnding);
  return `${includeBom ? "\uFEFF" : ""}${csv}${lineEnding}`;
}

export function serializeRowsToJson(
  columns: readonly Pick<QueryColumn, "name">[],
  rows: readonly Record<string, unknown>[],
): string {
  const projectedRows = rows.map((row) =>
    Object.fromEntries(
      columns.map((column) => [
        column.name,
        normalizeJsonValue(row[column.name]),
      ]),
    ),
  );
  return `${JSON.stringify(projectedRows, null, 2)}\n`;
}

export function serializeRowsToSqlInsert(
  columns: readonly Pick<QueryColumn, "name">[],
  rows: readonly Record<string, unknown>[],
  options: SqlInsertExportOptions,
): string {
  const tableName = options.tableName.trim();
  if (!tableName) throw new Error("A target table name is required");
  if (columns.length === 0)
    throw new Error("At least one result column is required");
  const dialect = options.dialect ?? "sqlite";
  const lineEnding = options.lineEnding ?? "\n";
  const quotedTable = tableName
    .split(".")
    .map((part) => quoteIdentifier(part, dialect))
    .join(".");
  const quotedColumns = columns
    .map((column) => quoteIdentifier(column.name, dialect))
    .join(", ");
  const statements = rows.map(
    (row) =>
      `INSERT INTO ${quotedTable} (${quotedColumns}) VALUES (${columns
        .map((column) => serializeSqlValue(row[column.name]))
        .join(", ")});`,
  );
  const body = statements.join(lineEnding);
  if (statements.length === 0) return "";
  const transaction =
    options.includeTransaction === false ? "" : `BEGIN;${lineEnding}`;
  const commit =
    options.includeTransaction === false
      ? ""
      : `${lineEnding}COMMIT;${lineEnding}`;
  return `${transaction}${body}${commit}`;
}

function normalizeCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") {
    try {
      return JSON.stringify(value, (_key, nested) =>
        typeof nested === "bigint" ? String(nested) : nested,
      );
    } catch {
      return String(value);
    }
  }
  return String(value);
}

function normalizeJsonValue(value: unknown): unknown {
  if (typeof value === "bigint") return String(value);
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(normalizeJsonValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, nested]) => [
        key,
        normalizeJsonValue(nested),
      ]),
    );
  }
  return value;
}

function quoteIdentifier(
  value: string,
  dialect: SqlInsertExportOptions["dialect"],
): string {
  const quote = dialect === "mysql" ? "`" : '"';
  return `${quote}${value.replaceAll(quote, `${quote}${quote}`)}${quote}`;
}

function serializeSqlValue(value: unknown): string {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  if (typeof value === "number")
    return Number.isFinite(value) ? String(value) : "NULL";
  if (typeof value === "bigint") return String(value);
  if (value instanceof Date) return quoteSqlString(value.toISOString());
  if (typeof value === "object") {
    return quoteSqlString(JSON.stringify(normalizeJsonValue(value)));
  }
  return quoteSqlString(String(value));
}

function quoteSqlString(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function encodeCell(value: string, protectFormulas: boolean): string {
  const safeValue =
    protectFormulas && FORMULA_PREFIX.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safeValue)
    ? `"${safeValue.replaceAll('"', '""')}"`
    : safeValue;
}
