import type {
  ColumnMetadata,
  DriverKind,
  IndexMetadata,
  TableMetadata,
  DatabaseMetadata,
} from "@queryx/shared";

export type SchemaDiffKind =
  | "tableAdded"
  | "tableRemoved"
  | "columnAdded"
  | "columnRemoved"
  | "columnChanged"
  | "indexAdded"
  | "indexRemoved";

export interface SchemaDiffChange {
  kind: SchemaDiffKind;
  label: string;
  detail: string;
  sql: string | null;
  destructive: boolean;
}

export interface SchemaDiff {
  changes: SchemaDiffChange[];
  added: number;
  removed: number;
  changed: number;
  manual: number;
}

function quoteIdentifier(value: string, driver: DriverKind): string {
  const quote = driver === "mysql" ? "`" : '"';
  return `${quote}${value.replaceAll(quote, `${quote}${quote}`)}${quote}`;
}

function qualifiedName(
  schema: string,
  name: string,
  driver: DriverKind,
): string {
  return `${quoteIdentifier(schema, driver)}.${quoteIdentifier(name, driver)}`;
}

function tableKey(table: Pick<TableMetadata, "schema" | "name">): string {
  return `${table.schema}\u0000${table.name}`;
}

function columnKey(column: Pick<ColumnMetadata, "name">): string {
  return column.name;
}

function columnDefinition(
  column: ColumnMetadata,
  driver: DriverKind,
  inlinePrimaryKey = false,
): string {
  const type = column.type.trim() || (driver === "mysql" ? "TEXT" : "text");
  return [
    quoteIdentifier(column.name, driver),
    type,
    column.nullable ? "" : "NOT NULL",
    inlinePrimaryKey ? "PRIMARY KEY" : "",
  ]
    .filter(Boolean)
    .join(" ");
}

function createTableSql(table: TableMetadata, driver: DriverKind): string {
  const primaryKeys = table.columns.filter((column) => column.primaryKey);
  const columns = table.columns.map((column) =>
    columnDefinition(
      column,
      driver,
      primaryKeys.length === 1 && column.primaryKey,
    ),
  );
  if (primaryKeys.length > 1) {
    columns.push(
      `PRIMARY KEY (${primaryKeys.map((column) => quoteIdentifier(column.name, driver)).join(", ")})`,
    );
  }
  return `CREATE TABLE ${qualifiedName(table.schema, table.name, driver)} (\n  ${columns.join(",\n  ")}\n);`;
}

function indexSql(
  table: TableMetadata,
  index: IndexMetadata,
  driver: DriverKind,
): string {
  const uniqueness = index.unique ? "UNIQUE " : "";
  const columns = index.columns
    .map((column) => quoteIdentifier(column, driver))
    .join(", ");
  return `CREATE ${uniqueness}INDEX ${quoteIdentifier(index.name, driver)} ON ${qualifiedName(table.schema, table.name, driver)} (${columns});`;
}

function dropIndexSql(
  table: TableMetadata,
  index: IndexMetadata,
  driver: DriverKind,
): string {
  if (driver === "mysql") {
    return `DROP INDEX ${quoteIdentifier(index.name, driver)} ON ${qualifiedName(table.schema, table.name, driver)};`;
  }
  return `DROP INDEX ${qualifiedName(table.schema, index.name, driver)};`;
}

function addColumnSql(
  table: TableMetadata,
  column: ColumnMetadata,
  driver: DriverKind,
): string {
  return `ALTER TABLE ${qualifiedName(table.schema, table.name, driver)} ADD COLUMN ${columnDefinition(column, driver)};`;
}

function dropColumnSql(
  table: TableMetadata,
  column: ColumnMetadata,
  driver: DriverKind,
): string | null {
  if (driver === "sqlite") return null;
  return `ALTER TABLE ${qualifiedName(table.schema, table.name, driver)} DROP COLUMN ${quoteIdentifier(column.name, driver)};`;
}

function alterColumnSql(
  table: TableMetadata,
  column: ColumnMetadata,
  driver: DriverKind,
): string | null {
  if (driver === "sqlite") return null;
  if (driver === "mysql") {
    return `ALTER TABLE ${qualifiedName(table.schema, table.name, driver)} MODIFY COLUMN ${columnDefinition(column, driver)};`;
  }
  const tableName = qualifiedName(table.schema, table.name, driver);
  const columnName = quoteIdentifier(column.name, driver);
  const statements = [
    `ALTER TABLE ${tableName} ALTER COLUMN ${columnName} TYPE ${column.type};`,
  ];
  statements.push(
    column.nullable
      ? `ALTER TABLE ${tableName} ALTER COLUMN ${columnName} DROP NOT NULL;`
      : `ALTER TABLE ${tableName} ALTER COLUMN ${columnName} SET NOT NULL;`,
  );
  return statements.join("\n");
}

function indexSignature(index: IndexMetadata): string {
  return `${index.name}\u0000${index.columns.join(",")}\u0000${index.unique}\u0000${index.primary}\u0000${index.type}`;
}

function addChange(
  changes: SchemaDiffChange[],
  change: SchemaDiffChange,
): void {
  changes.push(change);
}

export function compareSchemaSnapshots(
  baseline: DatabaseMetadata,
  current: DatabaseMetadata,
  driver: DriverKind,
): SchemaDiff {
  const changes: SchemaDiffChange[] = [];
  const baselineTables = new Map(
    baseline.tables.map((table) => [tableKey(table), table]),
  );
  const currentTables = new Map(
    current.tables.map((table) => [tableKey(table), table]),
  );

  for (const table of current.tables) {
    if (!baselineTables.has(tableKey(table))) {
      addChange(changes, {
        kind: "tableAdded",
        label: `Add table ${table.schema}.${table.name}`,
        detail: `${table.columns.length} column${table.columns.length === 1 ? "" : "s"}`,
        sql: createTableSql(table, driver),
        destructive: false,
      });
      continue;
    }
    const baselineTable = baselineTables.get(tableKey(table));
    if (!baselineTable) continue;
    const baselineColumns = new Map(
      baselineTable.columns.map((column) => [columnKey(column), column]),
    );
    const currentColumns = new Map(
      table.columns.map((column) => [columnKey(column), column]),
    );
    for (const column of table.columns) {
      const previous = baselineColumns.get(columnKey(column));
      if (!previous) {
        addChange(changes, {
          kind: "columnAdded",
          label: `Add column ${table.schema}.${table.name}.${column.name}`,
          detail: columnDefinition(column, driver),
          sql: addColumnSql(table, column, driver),
          destructive: false,
        });
      } else if (
        previous.type !== column.type ||
        previous.nullable !== column.nullable ||
        previous.primaryKey !== column.primaryKey
      ) {
        addChange(changes, {
          kind: "columnChanged",
          label: `Change column ${table.schema}.${table.name}.${column.name}`,
          detail: `${previous.type} → ${column.type}${previous.nullable === column.nullable ? "" : ", nullability changed"}`,
          sql: alterColumnSql(table, column, driver),
          destructive: true,
        });
      }
    }
    for (const column of baselineTable.columns) {
      if (!currentColumns.has(columnKey(column))) {
        addChange(changes, {
          kind: "columnRemoved",
          label: `Drop column ${table.schema}.${table.name}.${column.name}`,
          detail: column.type,
          sql: dropColumnSql(table, column, driver),
          destructive: true,
        });
      }
    }

    const baselineIndexes = new Map(
      baselineTable.indexes.map((index) => [indexSignature(index), index]),
    );
    const currentIndexes = new Map(
      table.indexes.map((index) => [indexSignature(index), index]),
    );
    for (const index of table.indexes) {
      if (!baselineIndexes.has(indexSignature(index))) {
        addChange(changes, {
          kind: "indexAdded",
          label: `Add index ${table.schema}.${table.name}.${index.name}`,
          detail: index.columns.join(", "),
          sql: indexSql(table, index, driver),
          destructive: false,
        });
      }
    }
    for (const index of baselineTable.indexes) {
      if (!currentIndexes.has(indexSignature(index))) {
        addChange(changes, {
          kind: "indexRemoved",
          label: `Drop index ${table.schema}.${table.name}.${index.name}`,
          detail: index.columns.join(", "),
          sql: dropIndexSql(table, index, driver),
          destructive: true,
        });
      }
    }
  }

  for (const table of baseline.tables) {
    if (!currentTables.has(tableKey(table))) {
      addChange(changes, {
        kind: "tableRemoved",
        label: `Drop table ${table.schema}.${table.name}`,
        detail: `${table.columns.length} column${table.columns.length === 1 ? "" : "s"}`,
        sql: `DROP TABLE ${qualifiedName(table.schema, table.name, driver)};`,
        destructive: true,
      });
    }
  }

  const changeOrder: Record<SchemaDiffKind, number> = {
    tableAdded: 0,
    columnAdded: 1,
    columnChanged: 2,
    indexAdded: 3,
    indexRemoved: 4,
    columnRemoved: 5,
    tableRemoved: 6,
  };
  changes.sort(
    (left, right) =>
      changeOrder[left.kind] - changeOrder[right.kind] ||
      left.label.localeCompare(right.label),
  );
  return {
    changes,
    added: changes.filter((change) => !change.destructive).length,
    removed: changes.filter((change) => change.destructive).length,
    changed: changes.filter((change) => change.kind === "columnChanged").length,
    manual: changes.filter((change) => change.sql === null).length,
  };
}

export function buildSchemaMigrationSql(diff: SchemaDiff): string {
  return diff.changes
    .map((change) => {
      if (change.sql) return `-- ${change.label}\n${change.sql}`;
      return `-- MANUAL REVIEW REQUIRED: ${change.label}\n-- ${change.detail}`;
    })
    .join("\n\n");
}
