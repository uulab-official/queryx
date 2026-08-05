import type {
  DatabaseMetadata,
  DriverKind,
  TableMetadata,
} from "@queryx/shared";

export type DataCompareChangeKind = "insert" | "update" | "delete";

export interface DataCompareChange {
  id: string;
  kind: DataCompareChangeKind;
  key: string;
  label: string;
  changedColumns: string[];
  source: Record<string, unknown> | null;
  target: Record<string, unknown> | null;
  sql: string;
  destructive: boolean;
}

export interface DataCompareResult {
  schema: string;
  table: string;
  columns: string[];
  primaryKeys: string[];
  sourceCount: number;
  targetCount: number;
  matchedCount: number;
  changes: DataCompareChange[];
  errors: string[];
}

export const dataCompareMaxRows = 10_000;

function quoteIdentifier(value: string, driver: DriverKind): string {
  if (driver === "sqlserver") return `[${value.replaceAll("]", "]]")}]`;
  const quote = driver === "mysql" ? "`" : '"';
  return `${quote}${value.replaceAll(quote, `${quote}${quote}`)}${quote}`;
}

function qualifiedTable(
  table: Pick<TableMetadata, "schema" | "name">,
  driver: DriverKind,
): string {
  return `${quoteIdentifier(table.schema, driver)}.${quoteIdentifier(table.name, driver)}`;
}

function rowValue(row: Record<string, unknown>, column: string): unknown {
  return Object.prototype.hasOwnProperty.call(row, column)
    ? row[column]
    : undefined;
}

function stableValue(value: unknown): string {
  if (value === undefined) return "__queryx_undefined__";
  if (typeof value === "number" && Number.isNaN(value)) return "__queryx_nan__";
  return JSON.stringify(value) ?? String(value);
}

function valuesEqual(left: unknown, right: unknown): boolean {
  return stableValue(left) === stableValue(right);
}

function primaryKeyValue(
  row: Record<string, unknown>,
  primaryKeys: string[],
): string {
  return JSON.stringify(primaryKeys.map((column) => rowValue(row, column)));
}

function keyLabel(row: Record<string, unknown>, primaryKeys: string[]): string {
  return primaryKeys
    .map((column) => `${column}=${String(rowValue(row, column) ?? "NULL")}`)
    .join(", ");
}

function sqlLiteral(value: unknown, driver: DriverKind): string {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "boolean") {
    return driver === "postgres" || driver === "sqlite"
      ? value
        ? "TRUE"
        : "FALSE"
      : value
        ? "1"
        : "0";
  }
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  const serialized =
    typeof value === "string"
      ? value
      : (JSON.stringify(value) ?? String(value));
  return `'${serialized.replaceAll("'", "''")}'`;
}

function whereClause(
  row: Record<string, unknown>,
  columns: string[],
  driver: DriverKind,
): string {
  return columns
    .map((column) => {
      const identifier = quoteIdentifier(column, driver);
      const value = rowValue(row, column);
      return value === null || value === undefined
        ? `${identifier} IS NULL`
        : `${identifier} = ${sqlLiteral(value, driver)}`;
    })
    .join(" AND ");
}

function buildChangeSql(
  table: TableMetadata,
  driver: DriverKind,
  kind: DataCompareChangeKind,
  source: Record<string, unknown> | null,
  target: Record<string, unknown> | null,
  columns: string[],
  primaryKeys: string[],
): string {
  const relation = qualifiedTable(table, driver);
  if (kind === "insert" && source) {
    const names = columns.map((column) => quoteIdentifier(column, driver));
    const values = columns.map((column) =>
      sqlLiteral(rowValue(source, column), driver),
    );
    return `INSERT INTO ${relation} (${names.join(", ")}) VALUES (${values.join(", ")});`;
  }
  if (kind === "delete" && target) {
    return `DELETE FROM ${relation} WHERE ${whereClause(target, primaryKeys, driver)};`;
  }
  if (kind === "update" && source && target) {
    const changedColumns = columns.filter(
      (column) =>
        !primaryKeys.includes(column) &&
        !valuesEqual(rowValue(source, column), rowValue(target, column)),
    );
    const assignments = changedColumns.map(
      (column) =>
        `${quoteIdentifier(column, driver)} = ${sqlLiteral(rowValue(source, column), driver)}`,
    );
    return `UPDATE ${relation} SET ${assignments.join(", ")} WHERE ${whereClause(target, columns, driver)};`;
  }
  return "";
}

function rowMap(
  rows: readonly Record<string, unknown>[],
  primaryKeys: string[],
  side: "source" | "target",
  errors: string[],
): Map<string, Record<string, unknown>> {
  const map = new Map<string, Record<string, unknown>>();
  for (const row of rows) {
    if (primaryKeys.some((column) => rowValue(row, column) === undefined)) {
      errors.push(`${side} row is missing a primary-key column`);
      continue;
    }
    if (primaryKeys.some((column) => rowValue(row, column) === null)) {
      errors.push(`${side} row has a NULL primary-key value`);
      continue;
    }
    const key = primaryKeyValue(row, primaryKeys);
    if (map.has(key)) {
      errors.push(
        `${side} contains duplicate primary key ${keyLabel(row, primaryKeys)}`,
      );
      continue;
    }
    map.set(key, row);
  }
  return map;
}

export function compareTableData(
  table: TableMetadata,
  sourceRows: readonly Record<string, unknown>[],
  targetRows: readonly Record<string, unknown>[],
  driver: DriverKind,
): DataCompareResult {
  const columns = table.columns.map((column) => column.name);
  const primaryKeys = table.columns
    .filter((column) => column.primaryKey)
    .map((column) => column.name);
  const errors: string[] = [];
  if (primaryKeys.length === 0) {
    errors.push("Data Compare requires at least one primary-key column");
  }
  const source =
    primaryKeys.length > 0
      ? rowMap(sourceRows, primaryKeys, "source", errors)
      : new Map<string, Record<string, unknown>>();
  const target =
    primaryKeys.length > 0
      ? rowMap(targetRows, primaryKeys, "target", errors)
      : new Map<string, Record<string, unknown>>();
  const changes: DataCompareChange[] = [];
  const keys = new Set([...source.keys(), ...target.keys()]);
  for (const key of keys) {
    const sourceRow = source.get(key) ?? null;
    const targetRow = target.get(key) ?? null;
    if (sourceRow && !targetRow) {
      changes.push({
        id: `insert:${key}`,
        kind: "insert",
        key,
        label: `Insert (${keyLabel(sourceRow, primaryKeys)})`,
        changedColumns: columns,
        source: sourceRow,
        target: null,
        sql: buildChangeSql(
          table,
          driver,
          "insert",
          sourceRow,
          null,
          columns,
          primaryKeys,
        ),
        destructive: false,
      });
      continue;
    }
    if (!sourceRow && targetRow) {
      changes.push({
        id: `delete:${key}`,
        kind: "delete",
        key,
        label: `Delete (${keyLabel(targetRow, primaryKeys)})`,
        changedColumns: columns,
        source: null,
        target: targetRow,
        sql: buildChangeSql(
          table,
          driver,
          "delete",
          null,
          targetRow,
          columns,
          primaryKeys,
        ),
        destructive: true,
      });
      continue;
    }
    if (!sourceRow || !targetRow) continue;
    const changedColumns = columns.filter(
      (column) =>
        !primaryKeys.includes(column) &&
        !valuesEqual(rowValue(sourceRow, column), rowValue(targetRow, column)),
    );
    if (changedColumns.length > 0) {
      changes.push({
        id: `update:${key}`,
        kind: "update",
        key,
        label: `Update (${keyLabel(sourceRow, primaryKeys)})`,
        changedColumns,
        source: sourceRow,
        target: targetRow,
        sql: buildChangeSql(
          table,
          driver,
          "update",
          sourceRow,
          targetRow,
          columns,
          primaryKeys,
        ),
        destructive: false,
      });
    }
  }
  const kindOrder: Record<DataCompareChangeKind, number> = {
    insert: 0,
    update: 1,
    delete: 2,
  };
  changes.sort(
    (left, right) =>
      left.key.localeCompare(right.key) ||
      kindOrder[left.kind] - kindOrder[right.kind],
  );
  return {
    schema: table.schema,
    table: table.name,
    columns,
    primaryKeys,
    sourceCount: sourceRows.length,
    targetCount: targetRows.length,
    matchedCount: [...source.keys()].filter((key) => target.has(key)).length,
    changes,
    errors: [...new Set(errors)],
  };
}

export function buildDataSyncStatements(
  comparison: DataCompareResult,
  selectedChangeIds?: readonly string[],
): string[] {
  const selected = selectedChangeIds ? new Set(selectedChangeIds) : null;
  return comparison.changes
    .filter((change) => !selected || selected.has(change.id))
    .map((change) => change.sql)
    .filter(Boolean);
}

export function buildDataSyncSql(
  comparison: DataCompareResult,
  selectedChangeIds?: readonly string[],
): string {
  const selected = selectedChangeIds ? new Set(selectedChangeIds) : null;
  return comparison.changes
    .filter((change) => !selected || selected.has(change.id))
    .map((change) => `-- ${change.label}\n${change.sql}`)
    .join("\n\n");
}

export function buildDataSelectSql(
  table: Pick<TableMetadata, "schema" | "name" | "columns">,
  driver: DriverKind,
  limit = dataCompareMaxRows + 1,
): string {
  const columns = table.columns
    .map((column) => quoteIdentifier(column.name, driver))
    .join(", ");
  const relation = qualifiedTable(table, driver);
  if (driver === "sqlserver")
    return `SELECT TOP ${limit} ${columns} FROM ${relation};`;
  const suffix =
    driver === "oracle" ? ` FETCH FIRST ${limit} ROWS ONLY` : ` LIMIT ${limit}`;
  return `SELECT ${columns} FROM ${relation}${suffix};`;
}

export function buildDataCountSql(
  table: Pick<TableMetadata, "schema" | "name">,
  driver: DriverKind,
): string {
  return `SELECT COUNT(*) AS queryx_count FROM ${qualifiedTable(table, driver)};`;
}

export function findTable(
  metadata: DatabaseMetadata,
  schema: string,
  name: string,
): TableMetadata | undefined {
  return metadata.tables.find(
    (table) => table.schema === schema && table.name === name,
  );
}
