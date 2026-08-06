import type { DriverKind, QueryColumn, TableMetadata } from "@queryx/shared";
import { serializeRowsToSqlInsert } from "./csvExport";

export interface TableSnapshotOptions {
  dialect: DriverKind;
  reportedRowCount?: number;
}

export function serializeTableSnapshot(
  table: Pick<TableMetadata, "schema" | "name" | "columns">,
  rows: readonly Record<string, unknown>[],
  options: TableSnapshotOptions,
): string {
  const dialect = options.dialect;
  const qualifiedName = [table.schema, table.name]
    .filter(Boolean)
    .map((part) => quoteIdentifier(part, dialect))
    .join(".");
  const columns: QueryColumn[] = table.columns.map((column) => ({
    name: column.name,
    type: column.type,
    nullable: column.nullable,
  }));
  const reportedRowCount = options.reportedRowCount ?? rows.length;
  const complete = rows.length >= reportedRowCount;
  const rowCoverage = complete
    ? `${rows.length} of ${reportedRowCount} (complete)`
    : `${rows.length} of ${reportedRowCount} (partial)`;
  const lines = [
    "-- QueryX table data snapshot",
    `-- Table: ${table.schema}.${table.name}`,
    `-- Rows: ${rowCoverage}`,
    "-- Review the CREATE TABLE types and constraints before restoring.",
    "BEGIN;",
  ];

  const definitions = table.columns
    .map((column) => {
      const type = safeType(column.type);
      if (!type) return null;
      return `  ${quoteIdentifier(column.name, dialect)} ${type}${column.nullable ? "" : " NOT NULL"}`;
    })
    .filter((definition): definition is string => definition !== null);
  const primaryKeyColumns = table.columns
    .filter((column) => column.primaryKey)
    .map((column) => quoteIdentifier(column.name, dialect));
  if (primaryKeyColumns.length > 0) {
    definitions.push(`  PRIMARY KEY (${primaryKeyColumns.join(", ")})`);
  }
  if (
    definitions.length ===
    table.columns.length + (primaryKeyColumns.length > 0 ? 1 : 0)
  ) {
    lines.push(
      `CREATE TABLE ${qualifiedName} (\n${definitions.join(",\n")}\n);`,
    );
  } else {
    lines.push(
      "-- CREATE TABLE omitted because one or more database type labels require manual review.",
    );
  }

  const inserts = serializeRowsToSqlInsert(columns, rows, {
    tableName: [table.schema, table.name].filter(Boolean).join("."),
    dialect,
    includeTransaction: false,
  });
  if (inserts) lines.push(inserts);
  lines.push("COMMIT;");
  return `${lines.join("\n")}\n`;
}

function safeType(type: string): string | null {
  const normalized = type.trim();
  if (!normalized || !/^[A-Za-z][A-Za-z0-9_ .(),\[\]"']*$/.test(normalized)) {
    return null;
  }
  return normalized;
}

function quoteIdentifier(value: string, dialect: DriverKind): string {
  if (dialect === "sqlserver") {
    return `[${value.replaceAll("]", "]]")}]`;
  }
  const quote = dialect === "mysql" ? "`" : '"';
  return `${quote}${value.replaceAll(quote, `${quote}${quote}`)}${quote}`;
}
