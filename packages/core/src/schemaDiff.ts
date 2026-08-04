import type {
  ColumnMetadata,
  DriverKind,
  ForeignKeyMetadata,
  IndexMetadata,
  TableMetadata,
  DatabaseMetadata,
  ViewMetadata,
} from "@queryx/shared";

export type SchemaDiffKind =
  | "tableAdded"
  | "tableRemoved"
  | "columnAdded"
  | "columnRemoved"
  | "columnChanged"
  | "indexAdded"
  | "indexRemoved"
  | "foreignKeyAdded"
  | "foreignKeyRemoved"
  | "viewAdded"
  | "viewRemoved"
  | "viewChanged";

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

function foreignKeySignature(foreignKey: ForeignKeyMetadata): string {
  return [
    foreignKey.name ?? foreignKey.id,
    foreignKey.columns
      .map(
        (column) => `${column.sourceColumn}:${column.referencedColumn ?? ""}`,
      )
      .join(","),
    `${foreignKey.referencedRelation.schema}.${foreignKey.referencedRelation.name}`,
    foreignKey.onUpdate,
    foreignKey.onDelete,
    foreignKey.match ?? "",
    foreignKey.deferrable ?? "",
    foreignKey.initiallyDeferred ?? "",
  ].join("\u0000");
}

function foreignKeySql(
  table: TableMetadata,
  foreignKey: ForeignKeyMetadata,
  driver: DriverKind,
): string | null {
  if (
    driver === "sqlite" ||
    foreignKey.columns.some((column) => !column.referencedColumn)
  ) {
    return null;
  }
  const constraintName = foreignKey.name
    ? `CONSTRAINT ${quoteIdentifier(foreignKey.name, driver)} `
    : "";
  const sourceColumns = foreignKey.columns
    .map((column) => quoteIdentifier(column.sourceColumn, driver))
    .join(", ");
  const referencedColumns = foreignKey.columns
    .map((column) => quoteIdentifier(column.referencedColumn ?? "", driver))
    .join(", ");
  const actions = [foreignKey.onUpdate, foreignKey.onDelete]
    .map((action, index) => {
      const normalized = action.trim().toUpperCase();
      if (!normalized) return "";
      return `${index === 0 ? "ON UPDATE" : "ON DELETE"} ${normalized}`;
    })
    .filter(Boolean)
    .join(" ");
  return `ALTER TABLE ${qualifiedName(table.schema, table.name, driver)} ADD ${constraintName}FOREIGN KEY (${sourceColumns}) REFERENCES ${qualifiedName(foreignKey.referencedRelation.schema, foreignKey.referencedRelation.name, driver)} (${referencedColumns})${actions ? ` ${actions}` : ""};`;
}

function dropForeignKeySql(
  table: TableMetadata,
  foreignKey: ForeignKeyMetadata,
  driver: DriverKind,
): string | null {
  if (driver === "sqlite" || !foreignKey.name) return null;
  const clause = driver === "mysql" ? "DROP FOREIGN KEY" : "DROP CONSTRAINT";
  return `ALTER TABLE ${qualifiedName(table.schema, table.name, driver)} ${clause} ${quoteIdentifier(foreignKey.name, driver)};`;
}

function viewCreateSql(view: ViewMetadata, driver: DriverKind): string | null {
  const definition = view.definition?.trim();
  if (!definition) return null;
  return `CREATE VIEW ${qualifiedName(view.schema, view.name, driver)} AS ${definition.replace(/;$/, "")};`;
}

function viewReplaceSql(view: ViewMetadata, driver: DriverKind): string | null {
  const definition = view.definition?.trim();
  if (!definition || driver === "sqlite") return null;
  return `CREATE OR REPLACE VIEW ${qualifiedName(view.schema, view.name, driver)} AS ${definition.replace(/;$/, "")};`;
}

function viewDropSql(view: ViewMetadata, driver: DriverKind): string {
  return `DROP VIEW ${qualifiedName(view.schema, view.name, driver)};`;
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
      for (const index of table.indexes) {
        if (index.primary) continue;
        addChange(changes, {
          kind: "indexAdded",
          label: `Add index ${table.schema}.${table.name}.${index.name}`,
          detail: index.columns.join(", "),
          sql: indexSql(table, index, driver),
          destructive: false,
        });
      }
      for (const foreignKey of table.foreignKeys) {
        addChange(changes, {
          kind: "foreignKeyAdded",
          label: `Add foreign key ${table.schema}.${table.name}.${foreignKey.name ?? foreignKey.id}`,
          detail: `${foreignKey.columns.map((column) => column.sourceColumn).join(", ")} → ${foreignKey.referencedRelation.schema}.${foreignKey.referencedRelation.name}`,
          sql: foreignKeySql(table, foreignKey, driver),
          destructive: false,
        });
      }
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

    const baselineForeignKeys = new Map(
      baselineTable.foreignKeys.map((foreignKey) => [
        foreignKeySignature(foreignKey),
        foreignKey,
      ]),
    );
    const currentForeignKeys = new Map(
      table.foreignKeys.map((foreignKey) => [
        foreignKeySignature(foreignKey),
        foreignKey,
      ]),
    );
    for (const foreignKey of table.foreignKeys) {
      if (!baselineForeignKeys.has(foreignKeySignature(foreignKey))) {
        addChange(changes, {
          kind: "foreignKeyAdded",
          label: `Add foreign key ${table.schema}.${table.name}.${foreignKey.name ?? foreignKey.id}`,
          detail: `${foreignKey.columns.map((column) => column.sourceColumn).join(", ")} → ${foreignKey.referencedRelation.schema}.${foreignKey.referencedRelation.name}`,
          sql: foreignKeySql(table, foreignKey, driver),
          destructive: false,
        });
      }
    }
    for (const foreignKey of baselineTable.foreignKeys) {
      if (!currentForeignKeys.has(foreignKeySignature(foreignKey))) {
        addChange(changes, {
          kind: "foreignKeyRemoved",
          label: `Drop foreign key ${table.schema}.${table.name}.${foreignKey.name ?? foreignKey.id}`,
          detail: `${foreignKey.columns.map((column) => column.sourceColumn).join(", ")} → ${foreignKey.referencedRelation.schema}.${foreignKey.referencedRelation.name}`,
          sql: dropForeignKeySql(table, foreignKey, driver),
          destructive: true,
        });
      }
    }
  }

  for (const table of baseline.tables) {
    if (!currentTables.has(tableKey(table))) {
      for (const foreignKey of table.foreignKeys) {
        addChange(changes, {
          kind: "foreignKeyRemoved",
          label: `Drop foreign key ${table.schema}.${table.name}.${foreignKey.name ?? foreignKey.id}`,
          detail: `${foreignKey.columns.map((column) => column.sourceColumn).join(", ")} → ${foreignKey.referencedRelation.schema}.${foreignKey.referencedRelation.name}`,
          sql: dropForeignKeySql(table, foreignKey, driver),
          destructive: true,
        });
      }
      addChange(changes, {
        kind: "tableRemoved",
        label: `Drop table ${table.schema}.${table.name}`,
        detail: `${table.columns.length} column${table.columns.length === 1 ? "" : "s"}`,
        sql: `DROP TABLE ${qualifiedName(table.schema, table.name, driver)};`,
        destructive: true,
      });
    }
  }

  const baselineViews = new Map(
    baseline.views.map((view) => [tableKey(view), view]),
  );
  const currentViews = new Map(
    current.views.map((view) => [tableKey(view), view]),
  );
  for (const view of current.views) {
    const previous = baselineViews.get(tableKey(view));
    if (!previous) {
      addChange(changes, {
        kind: "viewAdded",
        label: `Add view ${view.schema}.${view.name}`,
        detail: view.definition?.trim() || "View definition unavailable",
        sql: viewCreateSql(view, driver),
        destructive: false,
      });
    } else if (previous.definition?.trim() !== view.definition?.trim()) {
      addChange(changes, {
        kind: "viewChanged",
        label: `Change view ${view.schema}.${view.name}`,
        detail: "View definition changed",
        sql: viewReplaceSql(view, driver),
        destructive: true,
      });
    }
  }
  for (const view of baseline.views) {
    if (!currentViews.has(tableKey(view))) {
      addChange(changes, {
        kind: "viewRemoved",
        label: `Drop view ${view.schema}.${view.name}`,
        detail: "View no longer exists in the current schema",
        sql: viewDropSql(view, driver),
        destructive: true,
      });
    }
  }

  const changeOrder: Record<SchemaDiffKind, number> = {
    tableAdded: 0,
    columnAdded: 1,
    indexAdded: 2,
    foreignKeyAdded: 3,
    viewAdded: 4,
    columnChanged: 5,
    foreignKeyRemoved: 6,
    indexRemoved: 7,
    columnRemoved: 8,
    viewChanged: 9,
    viewRemoved: 10,
    tableRemoved: 11,
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
    changed: changes.filter(
      (change) =>
        change.kind === "columnChanged" || change.kind === "viewChanged",
    ).length,
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
