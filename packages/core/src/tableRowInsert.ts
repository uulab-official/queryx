import type { DriverKind, TableMetadata } from "@queryx/shared";
import { serializeRowsToSqlInsert } from "./csvExport";

export interface TableRowInsertValue {
  columnName: string;
  value: unknown;
}

export interface TableRowInsertPlan {
  statement: string;
  sql: string;
  columns: string[];
  errors: string[];
  warnings: string[];
}

function quoteIdentifier(value: string, driver: DriverKind): string {
  if (driver === "sqlserver") return `[${value.replaceAll("]", "]]")}]`;
  const quote = driver === "mysql" ? "`" : '"';
  return `${quote}${value.replaceAll(quote, `${quote}${quote}`)}${quote}`;
}

export function buildTableRowInsertPlan(
  table: Pick<TableMetadata, "schema" | "name" | "columns">,
  values: readonly TableRowInsertValue[],
  driver: DriverKind,
): TableRowInsertPlan {
  const errors: string[] = [];
  const selected = new Map<string, TableRowInsertValue>();
  const tableColumns = new Map(
    table.columns.map((column) => [column.name, column]),
  );

  if (!table.schema.trim() || !table.name.trim()) {
    errors.push("Table schema and name are required");
  }
  if (table.columns.length === 0) {
    errors.push("Table must expose at least one column");
  }

  for (const value of values) {
    if (selected.has(value.columnName)) {
      errors.push(`Column selected more than once: ${value.columnName}`);
      continue;
    }
    selected.set(value.columnName, value);
    const column = tableColumns.get(value.columnName);
    if (!column) {
      errors.push(`Column does not exist: ${value.columnName}`);
      continue;
    }
    if (value.value === null && !column.nullable) {
      errors.push(`Column cannot be NULL: ${value.columnName}`);
    }
  }

  const omittedColumns = table.columns
    .filter((column) => !selected.has(column.name))
    .map((column) => column.name);
  const warnings =
    omittedColumns.length > 0
      ? [`Omitted columns use database defaults: ${omittedColumns.join(", ")}`]
      : [];
  const emptyPlan = { statement: "", sql: "", columns: [], errors, warnings };
  if (errors.length > 0) return emptyPlan;

  const tableName = `${table.schema}.${table.name}`;
  if (selected.size === 0) {
    if (driver === "oracle") {
      return {
        ...emptyPlan,
        errors: [
          "Oracle default-only inserts require an explicit column default expression",
        ],
      };
    }
    const quotedTable = `${quoteIdentifier(table.schema, driver)}.${quoteIdentifier(table.name, driver)}`;
    const statement =
      driver === "mysql"
        ? `INSERT INTO ${quotedTable} () VALUES ();`
        : `INSERT INTO ${quotedTable} DEFAULT VALUES;`;
    return { statement, sql: statement, columns: [], errors, warnings };
  }

  const columns = table.columns.filter((column) => selected.has(column.name));
  const row = Object.fromEntries(
    columns.map((column) => [column.name, selected.get(column.name)?.value]),
  );
  const statement = serializeRowsToSqlInsert(columns, [row], {
    tableName,
    dialect: driver,
    includeTransaction: false,
  });
  return {
    statement,
    sql: statement,
    columns: columns.map((column) => column.name),
    errors,
    warnings,
  };
}
