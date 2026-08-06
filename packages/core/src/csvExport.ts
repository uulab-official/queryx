import type { DriverKind, QueryColumn } from "@queryx/shared";

export interface CsvExportOptions {
  includeBom?: boolean;
  lineEnding?: "\n" | "\r\n";
  protectFormulas?: boolean;
}

export interface MarkdownExportOptions {
  lineEnding?: "\n" | "\r\n";
}

export interface ExcelXmlExportOptions {
  lineEnding?: "\n" | "\r\n";
  worksheetName?: string;
}

export interface SqlInsertExportOptions {
  tableName: string;
  dialect?: DriverKind;
  lineEnding?: "\n" | "\r\n";
  includeTransaction?: boolean;
}

export interface SqlUpdateExportOptions {
  tableName: string;
  keyColumns: readonly string[];
  dialect?: DriverKind;
  lineEnding?: "\n" | "\r\n";
  includeTransaction?: boolean;
  includeOriginalValues?: boolean;
}

export interface SqlRowUpdate {
  originalRow: Record<string, unknown>;
  changes: Readonly<Record<string, unknown>>;
}

export interface SqlRowDelete {
  originalRow: Record<string, unknown>;
}

export interface SqlDeleteExportOptions {
  tableName: string;
  keyColumns: readonly string[];
  dialect?: DriverKind;
  lineEnding?: "\n" | "\r\n";
  includeTransaction?: boolean;
  includeOriginalValues?: boolean;
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

export function serializeRowsToMarkdown(
  columns: readonly Pick<QueryColumn, "name">[],
  rows: readonly Record<string, unknown>[],
  options: MarkdownExportOptions = {},
): string {
  const lineEnding = options.lineEnding ?? "\n";
  if (columns.length === 0) return "";
  const header = `| ${columns.map((column) => escapeMarkdownCell(column.name)).join(" | ")} |`;
  const separator = `| ${columns.map(() => "---").join(" | ")} |`;
  const body = rows.map(
    (row) =>
      `| ${columns.map((column) => escapeMarkdownCell(row[column.name])).join(" | ")} |`,
  );
  return `${[header, separator, ...body].join(lineEnding)}${lineEnding}`;
}

export function serializeRowsToExcelXml(
  columns: readonly Pick<QueryColumn, "name">[],
  rows: readonly Record<string, unknown>[],
  options: ExcelXmlExportOptions = {},
): string {
  const lineEnding = options.lineEnding ?? "\r\n";
  const worksheetName = sanitizeWorksheetName(options.worksheetName);
  const header = columns.map(
    (column) =>
      `<Cell><Data ss:Type="String">${escapeXml(column.name)}</Data></Cell>`,
  );
  const body = rows.map((row) =>
    columns.map((column) => excelCell(row[column.name])).join(""),
  );
  const rowsXml = [
    `    <Row>${header.join("")}</Row>`,
    ...body.map((row) => `    <Row>${row}</Row>`),
  ];
  return (
    [
      '<?xml version="1.0"?>',
      '<?mso-application progid="Excel.Sheet"?>',
      '<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"',
      ' xmlns:o="urn:schemas-microsoft-com:office:office"',
      ' xmlns:x="urn:schemas-microsoft-com:office:excel"',
      ' xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"',
      ' xmlns:html="http://www.w3.org/TR/REC-html40">',
      `  <Worksheet ss:Name="${escapeXml(worksheetName)}">`,
      "  <Table>",
      ...rowsXml,
      "  </Table>",
      "  </Worksheet>",
      "</Workbook>",
    ].join(lineEnding) + lineEnding
  );
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
        .map((column) => serializeSqlValue(row[column.name], dialect))
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

export function serializeRowsToSqlUpdate(
  columns: readonly Pick<QueryColumn, "name">[],
  updates: readonly SqlRowUpdate[],
  options: SqlUpdateExportOptions,
): string {
  const statements = buildRowsToSqlUpdateStatements(columns, updates, options);
  if (statements.length === 0) return "";
  const lineEnding = options.lineEnding ?? "\n";
  const body = statements.join(lineEnding);
  const transaction =
    options.includeTransaction === false ? "" : `BEGIN;${lineEnding}`;
  const commit =
    options.includeTransaction === false
      ? ""
      : `${lineEnding}COMMIT;${lineEnding}`;
  return `${transaction}${body}${commit}`;
}

export function buildRowsToSqlUpdateStatements(
  columns: readonly Pick<QueryColumn, "name">[],
  updates: readonly SqlRowUpdate[],
  options: SqlUpdateExportOptions,
): string[] {
  const tableName = options.tableName.trim();
  if (!tableName) throw new Error("A target table name is required");
  if (columns.length === 0)
    throw new Error("At least one result column is required");
  if (options.keyColumns.length === 0)
    throw new Error("At least one key column is required");
  const columnNames = new Set(columns.map((column) => column.name));
  const missingKey = options.keyColumns.find(
    (columnName) => !columnNames.has(columnName),
  );
  if (missingKey)
    throw new Error(`Result does not include key column: ${missingKey}`);
  const dialect = options.dialect ?? "sqlite";
  const quotedTable = tableName
    .split(".")
    .map((part) => quoteIdentifier(part, dialect))
    .join(".");
  const statements = updates
    .map(({ originalRow, changes }, index) => {
      const changedColumns = columns.filter((column) =>
        Object.hasOwn(changes, column.name),
      );
      if (changedColumns.length === 0) return "";
      const keyValues = options.keyColumns.map((columnName) => {
        const value = originalRow[columnName];
        if (value === null || value === undefined) {
          throw new Error(
            `Row ${index + 1} has a NULL key value for ${columnName}`,
          );
        }
        return `${quoteIdentifier(columnName, dialect)} = ${serializeSqlValue(value, dialect)}`;
      });
      const originalValueConditions =
        options.includeOriginalValues === false
          ? []
          : columns
              .filter(
                (column) =>
                  !options.keyColumns.includes(column.name) &&
                  Object.hasOwn(originalRow, column.name),
              )
              .map((column) =>
                serializeSqlPredicate(
                  column.name,
                  originalRow[column.name],
                  dialect,
                ),
              );
      const assignments = changedColumns
        .map(
          (column) =>
            `${quoteIdentifier(column.name, dialect)} = ${serializeSqlValue(changes[column.name], dialect)}`,
        )
        .join(", ");
      return `UPDATE ${quotedTable} SET ${assignments} WHERE ${[...keyValues, ...originalValueConditions].join(" AND ")};`;
    })
    .filter(Boolean);
  return statements;
}

export function serializeRowsToSqlDelete(
  columns: readonly Pick<QueryColumn, "name">[],
  deletes: readonly SqlRowDelete[],
  options: SqlDeleteExportOptions,
): string {
  const statements = buildRowsToSqlDeleteStatements(columns, deletes, options);
  if (statements.length === 0) return "";
  const lineEnding = options.lineEnding ?? "\n";
  const body = statements.join(lineEnding);
  const transaction =
    options.includeTransaction === false ? "" : `BEGIN;${lineEnding}`;
  const commit =
    options.includeTransaction === false
      ? ""
      : `${lineEnding}COMMIT;${lineEnding}`;
  return `${transaction}${body}${commit}`;
}

export function buildRowsToSqlDeleteStatements(
  columns: readonly Pick<QueryColumn, "name">[],
  deletes: readonly SqlRowDelete[],
  options: SqlDeleteExportOptions,
): string[] {
  const tableName = options.tableName.trim();
  if (!tableName) throw new Error("A target table name is required");
  if (columns.length === 0)
    throw new Error("At least one result column is required");
  if (options.keyColumns.length === 0)
    throw new Error("At least one key column is required");
  const columnNames = new Set(columns.map((column) => column.name));
  const missingKey = options.keyColumns.find(
    (columnName) => !columnNames.has(columnName),
  );
  if (missingKey)
    throw new Error(`Result does not include key column: ${missingKey}`);
  const dialect = options.dialect ?? "sqlite";
  const quotedTable = tableName
    .split(".")
    .map((part) => quoteIdentifier(part, dialect))
    .join(".");
  return deletes.map(({ originalRow }, index) => {
    const keyValues = options.keyColumns.map((columnName) => {
      const value = originalRow[columnName];
      if (value === null || value === undefined) {
        throw new Error(
          `Row ${index + 1} has a NULL key value for ${columnName}`,
        );
      }
      return `${quoteIdentifier(columnName, dialect)} = ${serializeSqlValue(value, dialect)}`;
    });
    const originalValueConditions =
      options.includeOriginalValues === false
        ? []
        : columns
            .filter(
              (column) =>
                !options.keyColumns.includes(column.name) &&
                Object.hasOwn(originalRow, column.name),
            )
            .map((column) =>
              serializeSqlPredicate(
                column.name,
                originalRow[column.name],
                dialect,
              ),
            );
    return `DELETE FROM ${quotedTable} WHERE ${[...keyValues, ...originalValueConditions].join(" AND ")};`;
  });
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
  if (dialect === "sqlserver") return `[${value.replaceAll("]", "]]")}]`;
  const quote = dialect === "mysql" ? "`" : '"';
  return `${quote}${value.replaceAll(quote, `${quote}${quote}`)}${quote}`;
}

function serializeSqlValue(
  value: unknown,
  dialect: SqlInsertExportOptions["dialect"],
): string {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "boolean") {
    return dialect === "sqlserver" || dialect === "oracle"
      ? value
        ? "1"
        : "0"
      : value
        ? "TRUE"
        : "FALSE";
  }
  if (typeof value === "number")
    return Number.isFinite(value) ? String(value) : "NULL";
  if (typeof value === "bigint") return String(value);
  if (value instanceof Date) return quoteSqlString(value.toISOString());
  if (typeof value === "object") {
    return quoteSqlString(JSON.stringify(normalizeJsonValue(value)));
  }
  return quoteSqlString(String(value));
}

function serializeSqlPredicate(
  columnName: string,
  value: unknown,
  dialect: SqlInsertExportOptions["dialect"],
): string {
  const identifier = quoteIdentifier(columnName, dialect);
  if (value === null || value === undefined) return `${identifier} IS NULL`;
  return `${identifier} = ${serializeSqlValue(value, dialect)}`;
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

function escapeMarkdownCell(value: unknown): string {
  return normalizeCell(value)
    .replaceAll("\\", "\\\\")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("|", "\\|")
    .replaceAll(/\r?\n/g, "<br>");
}

function escapeXml(value: string): string {
  const xmlSafeValue = Array.from(value)
    .filter((character) => {
      const code = character.charCodeAt(0);
      return code === 0x09 || code === 0x0a || code === 0x0d || code >= 0x20;
    })
    .join("");
  return xmlSafeValue
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function sanitizeWorksheetName(name: string | undefined): string {
  const normalized = (name?.trim() || "Query Results")
    .replace(/[\\/:?*\[\]]/g, " ")
    .trim();
  return (normalized || "Query Results").slice(0, 31);
}

function excelCell(value: unknown): string {
  if (value instanceof Date) {
    return `<Cell><Data ss:Type="DateTime">${escapeXml(value.toISOString())}</Data></Cell>`;
  }
  if (typeof value === "boolean") {
    return `<Cell><Data ss:Type="Boolean">${value ? "1" : "0"}</Data></Cell>`;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return `<Cell><Data ss:Type="Number">${String(value)}</Data></Cell>`;
  }
  return `<Cell><Data ss:Type="String">${escapeXml(normalizeCell(value))}</Data></Cell>`;
}
