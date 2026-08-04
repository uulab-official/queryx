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
