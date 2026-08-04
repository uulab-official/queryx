import type { DriverKind, TableMetadata } from "@queryx/shared";

export interface CreateTableColumnInput {
  name: string;
  type: string;
  nullable: boolean;
  primaryKey: boolean;
}

export interface CreateTableInput {
  schema: string;
  name: string;
  columns: CreateTableColumnInput[];
}

export interface CreateTablePlan {
  sql: string;
  errors: string[];
}

export interface AddColumnInput {
  name: string;
  type: string;
  nullable: boolean;
}

export interface AddColumnPlan {
  sql: string;
  errors: string[];
}

export interface EditTableColumnInput {
  name: string;
  type: string;
  nullable: boolean;
  primaryKey: boolean;
  remove: boolean;
}

export interface EditTableColumnsPlan {
  sql: string;
  statements: string[];
  errors: string[];
  manual: string[];
}

export interface CreateIndexInput {
  name: string;
  columns: string[];
  unique: boolean;
}

export interface CreateIndexPlan {
  sql: string;
  errors: string[];
  warnings: string[];
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

function normalizeIdentifier(value: string): string {
  return value.trim();
}

function identifierError(label: string, value: string): string | null {
  if (!value) return `${label} is required`;
  if (value.includes("\u0000")) return `${label} contains an invalid character`;
  return null;
}

function typeError(
  column: Pick<CreateTableColumnInput, "name" | "type">,
): string | null {
  const type = column.type.trim();
  if (!type) return `Column ${column.name || "(unnamed)"} needs a type`;
  if (/[;'"`]|--|\/\*/.test(type)) {
    return `Column ${column.name || "(unnamed)"} type cannot contain SQL delimiters`;
  }
  if (
    !/^[A-Za-z][A-Za-z0-9_ ]*(?:\([0-9]+(?:\s*,\s*[0-9]+)*\))?(?:\[\])?$/.test(
      type,
    )
  ) {
    return `Column ${column.name || "(unnamed)"} type contains unsupported characters`;
  }
  return null;
}

export function buildCreateTablePlan(
  input: CreateTableInput,
  driver: DriverKind,
): CreateTablePlan {
  const schema = normalizeIdentifier(input.schema);
  const name = normalizeIdentifier(input.name);
  const errors = [
    identifierError("Schema", schema),
    identifierError("Table name", name),
  ].filter((error): error is string => Boolean(error));
  const columns = input.columns.map((column) => ({
    ...column,
    name: normalizeIdentifier(column.name),
    type: column.type.trim(),
  }));
  if (columns.length === 0) errors.push("Add at least one column");
  const seen = new Set<string>();
  for (const column of columns) {
    const error = identifierError("Column name", column.name);
    if (error) errors.push(error);
    const normalizedName = column.name.toLocaleLowerCase();
    if (seen.has(normalizedName)) {
      errors.push(`Duplicate column name: ${column.name}`);
    }
    seen.add(normalizedName);
    const columnTypeError = typeError(column);
    if (columnTypeError) errors.push(columnTypeError);
  }
  if (errors.length > 0) return { sql: "", errors };

  const primaryKeys = columns.filter((column) => column.primaryKey);
  const definitions = columns.map((column) => {
    const inlinePrimaryKey = primaryKeys.length === 1 && column.primaryKey;
    return [
      quoteIdentifier(column.name, driver),
      column.type,
      column.nullable ? "" : "NOT NULL",
      inlinePrimaryKey ? "PRIMARY KEY" : "",
    ]
      .filter(Boolean)
      .join(" ");
  });
  if (primaryKeys.length > 1) {
    definitions.push(
      `PRIMARY KEY (${primaryKeys.map((column) => quoteIdentifier(column.name, driver)).join(", ")})`,
    );
  }
  return {
    sql: `CREATE TABLE ${qualifiedName(schema, name, driver)} (\n  ${definitions.join(",\n  ")}\n);`,
    errors: [],
  };
}

export function buildAddColumnPlan(
  table: Pick<TableMetadata, "schema" | "name" | "columns">,
  input: AddColumnInput,
  driver: DriverKind,
): AddColumnPlan {
  const name = normalizeIdentifier(input.name);
  const type = input.type.trim();
  const errors = [identifierError("Column name", name)].filter(
    (error): error is string => Boolean(error),
  );
  if (
    table.columns.some(
      (column) => column.name.toLocaleLowerCase() === name.toLocaleLowerCase(),
    )
  ) {
    errors.push(`Column already exists: ${name}`);
  }
  const columnTypeError = typeError({ name, type });
  if (columnTypeError) errors.push(columnTypeError);
  if (errors.length > 0) return { sql: "", errors };
  return {
    sql: `ALTER TABLE ${qualifiedName(table.schema, table.name, driver)} ADD COLUMN ${quoteIdentifier(name, driver)} ${type}${input.nullable ? "" : " NOT NULL"};`,
    errors: [],
  };
}

export function buildEditTableColumnsPlan(
  table: Pick<TableMetadata, "schema" | "name" | "columns">,
  input: EditTableColumnInput[],
  driver: DriverKind,
): EditTableColumnsPlan {
  const errors: string[] = [];
  const manual: string[] = [];
  const statements: string[] = [];
  const existing = new Map(
    table.columns.map((column) => [column.name.toLocaleLowerCase(), column]),
  );
  const seen = new Set<string>();
  for (const column of input) {
    const name = normalizeIdentifier(column.name);
    const normalizedName = name.toLocaleLowerCase();
    if (seen.has(normalizedName)) errors.push(`Duplicate column name: ${name}`);
    seen.add(normalizedName);
    const current = existing.get(normalizedName);
    if (!current) {
      errors.push(`Unknown column: ${name}`);
      continue;
    }
    const type = column.type.trim();
    const columnTypeError = typeError({ name, type });
    if (columnTypeError) errors.push(columnTypeError);
    if (column.primaryKey !== Boolean(current.primaryKey)) {
      manual.push(`Primary-key change requires manual review: ${name}`);
      continue;
    }
    if (column.remove) {
      if (column.primaryKey) {
        manual.push(
          `Cannot automatically remove a primary-key column: ${name}`,
        );
      } else if (driver === "sqlite") {
        manual.push(
          `SQLite column drop requires manual table rebuild: ${name}`,
        );
      } else {
        statements.push(
          `ALTER TABLE ${qualifiedName(table.schema, table.name, driver)} DROP COLUMN ${quoteIdentifier(name, driver)};`,
        );
      }
      continue;
    }
    const typeChanged = type !== current.type;
    const nullabilityChanged = column.nullable !== current.nullable;
    if (!typeChanged && !nullabilityChanged) continue;
    if (driver === "sqlite") {
      manual.push(
        `SQLite column alteration requires manual table rebuild: ${name}`,
      );
      continue;
    }
    const qualified = qualifiedName(table.schema, table.name, driver);
    const identifier = quoteIdentifier(name, driver);
    if (driver === "mysql") {
      statements.push(
        `ALTER TABLE ${qualified} MODIFY COLUMN ${identifier} ${type}${column.nullable ? "" : " NOT NULL"};`,
      );
      continue;
    }
    if (typeChanged) {
      statements.push(
        `ALTER TABLE ${qualified} ALTER COLUMN ${identifier} TYPE ${type};`,
      );
    }
    if (nullabilityChanged) {
      statements.push(
        `ALTER TABLE ${qualified} ALTER COLUMN ${identifier} ${column.nullable ? "DROP NOT NULL" : "SET NOT NULL"};`,
      );
    }
  }
  if (errors.length > 0) {
    return { sql: "", statements: [], errors, manual };
  }
  if (input.every((column) => column.remove)) {
    errors.push("Keep at least one column in the table");
  }
  if (statements.length === 0 && manual.length === 0 && errors.length === 0) {
    errors.push("Change at least one column before continuing");
  }
  const preview = [
    ...manual.map((message) => `-- MANUAL REVIEW REQUIRED: ${message}`),
    ...statements,
  ].join("\n\n");
  return { sql: preview, statements, errors, manual };
}

export function buildCreateIndexPlan(
  table: Pick<TableMetadata, "schema" | "name" | "columns" | "indexes">,
  input: CreateIndexInput,
  driver: DriverKind,
): CreateIndexPlan {
  const name = normalizeIdentifier(input.name);
  const errors = [identifierError("Index name", name)].filter(
    (error): error is string => Boolean(error),
  );
  const columns = input.columns.map(normalizeIdentifier).filter(Boolean);
  if (columns.length === 0) errors.push("Select at least one column");
  const seen = new Set<string>();
  for (const column of columns) {
    if (seen.has(column.toLocaleLowerCase())) {
      errors.push(`Duplicate index column: ${column}`);
    }
    seen.add(column.toLocaleLowerCase());
    if (!table.columns.some((candidate) => candidate.name === column)) {
      errors.push(`Column does not exist: ${column}`);
    }
  }
  if (
    table.indexes.some(
      (index) => index.name.toLocaleLowerCase() === name.toLocaleLowerCase(),
    )
  ) {
    errors.push(`Index already exists: ${name}`);
  }
  if (errors.length > 0) return { sql: "", errors, warnings: [] };
  const sameColumns = table.indexes.some(
    (index) =>
      index.columns.length === columns.length &&
      index.columns.every(
        (column, indexPosition) => column === columns[indexPosition],
      ),
  );
  const warnings = sameColumns
    ? ["An index with the same column order already exists"]
    : [];
  const indexName =
    driver === "mysql"
      ? quoteIdentifier(name, driver)
      : qualifiedName(table.schema, name, driver);
  const tableName = qualifiedName(table.schema, table.name, driver);
  return {
    sql: `CREATE ${input.unique ? "UNIQUE " : ""}INDEX ${indexName} ON ${tableName} (${columns.map((column) => quoteIdentifier(column, driver)).join(", ")});`,
    errors: [],
    warnings,
  };
}
