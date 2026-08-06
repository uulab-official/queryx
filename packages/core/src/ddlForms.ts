import type {
  DriverKind,
  ForeignKeyMetadata,
  TableMetadata,
  ViewMetadata,
} from "@queryx/shared";

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
  originalName?: string;
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

export interface AlterIndexInput {
  columns: string[];
  unique: boolean;
}

export interface AlterIndexPlan {
  sql: string;
  statements: string[];
  errors: string[];
  manual: string[];
  warnings: string[];
}

export type TableConstraintKind = "unique" | "check";

export interface CreateTableConstraintInput {
  kind: TableConstraintKind;
  name: string;
  columns: string[];
  expression: string;
}

export interface CreateTableConstraintPlan {
  sql: string;
  statements: string[];
  errors: string[];
  manual: string[];
  warnings: string[];
}

export interface DropIndexPlan {
  sql: string;
  errors: string[];
  manual: string[];
}

export type DatabaseDefinitionKind = "routine" | "trigger" | "eventTrigger";

export interface EditDatabaseDefinitionInput {
  kind: DatabaseDefinitionKind;
  definition: string;
}

export interface EditDatabaseDefinitionPlan {
  sql: string;
  statements: string[];
  errors: string[];
  manual: string[];
  warnings: string[];
}

export interface RenameIndexPlan {
  sql: string;
  statements: string[];
  errors: string[];
  manual: string[];
}

export interface AddForeignKeyInput {
  name: string;
  columns: string[];
  referencedColumns: string[];
  referencedSchema: string;
  referencedTable: string;
  onUpdate: string;
  onDelete: string;
}

export interface AddForeignKeyPlan {
  sql: string;
  statements: string[];
  errors: string[];
  manual: string[];
  warnings: string[];
}

export interface DropForeignKeyPlan {
  sql: string;
  statements: string[];
  errors: string[];
  manual: string[];
}

export interface CreateViewInput {
  schema: string;
  name: string;
  definition: string;
}

export interface CreateViewPlan {
  sql: string;
  errors: string[];
}

export interface AlterViewPlan {
  sql: string;
  statements: string[];
  errors: string[];
  warnings: string[];
}

export interface DropViewPlan {
  sql: string;
  statements: string[];
  errors: string[];
  warnings: string[];
}

function quoteIdentifier(value: string, driver: DriverKind): string {
  if (driver === "sqlserver") return `[${value.replaceAll("]", "]]")}]`;
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

function quoteSqlString(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function normalizeIdentifier(value: string): string {
  return value.trim();
}

function identifierError(label: string, value: string): string | null {
  if (!value) return `${label} is required`;
  if (value.includes("\u0000")) return `${label} contains an invalid character`;
  return null;
}

function constraintExpressionError(expression: string): string | null {
  if (expression.includes("\u0000")) {
    return "CHECK expression contains an invalid character";
  }
  if (
    expression.includes(";") ||
    expression.includes("--") ||
    expression.includes("/*")
  ) {
    return "CHECK expression cannot contain comments or statement delimiters";
  }
  const withoutQuotedText = expression.replace(
    /'(?:''|[^'])*'|"(?:""|[^"])*"|`(?:``|[^`])*`/g,
    " ",
  );
  if (
    /\b(?:INSERT|UPDATE|DELETE|MERGE|DROP|ALTER|CREATE|TRUNCATE|EXEC|CALL|COPY|GRANT|REVOKE)\b/i.test(
      withoutQuotedText,
    )
  ) {
    return "CHECK expression contains a mutating or DDL keyword";
  }
  let depth = 0;
  for (const character of withoutQuotedText) {
    if (character === "(") depth += 1;
    if (character === ")") depth -= 1;
    if (depth < 0) return "CHECK expression has unbalanced parentheses";
  }
  return depth === 0 ? null : "CHECK expression has unbalanced parentheses";
}

function foreignKeyActionError(label: string, action: string): string | null {
  const normalized = action.trim().toUpperCase().replace(/\s+/g, " ");
  if (!/^(NO ACTION|RESTRICT|CASCADE|SET NULL|SET DEFAULT)$/.test(normalized)) {
    return `${label} must be NO ACTION, RESTRICT, CASCADE, SET NULL, or SET DEFAULT`;
  }
  return null;
}

function normalizedForeignKeyAction(action: string): string {
  return action.trim().toUpperCase().replace(/\s+/g, " ");
}

function inspectViewDefinition(definition: string): {
  hasDelimiterOrComment: boolean;
  hasMutatingKeyword: boolean;
  hasUnterminatedQuote: boolean;
  executable: string;
} {
  let quote: "'" | '"' | "`" | null = null;
  let lineComment = false;
  let blockComment = false;
  let executable = "";
  let hasDelimiterOrComment = false;

  for (let index = 0; index < definition.length; index += 1) {
    const character = definition[index];
    const next = definition[index + 1];
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
      hasDelimiterOrComment = true;
      index += 1;
      continue;
    }
    if (character === "/" && next === "*") {
      blockComment = true;
      hasDelimiterOrComment = true;
      index += 1;
      continue;
    }
    if (character === "'" || character === '"' || character === "`") {
      quote = character;
      executable += " ";
      continue;
    }
    if (character === ";") {
      hasDelimiterOrComment = true;
      executable += ";";
      continue;
    }
    executable += character;
  }

  return {
    hasDelimiterOrComment,
    hasMutatingKeyword:
      /\b(?:INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|GRANT|REVOKE)\b/i.test(
        executable,
      ),
    hasUnterminatedQuote: Boolean(quote) || blockComment,
    executable,
  };
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
    sql: `ALTER TABLE ${qualifiedName(table.schema, table.name, driver)} ${driver === "sqlserver" || driver === "oracle" ? "ADD" : "ADD COLUMN"} ${quoteIdentifier(name, driver)} ${type}${input.nullable ? "" : " NOT NULL"};`,
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
    const originalName = normalizeIdentifier(
      column.originalName ?? column.name,
    );
    const normalizedName = name.toLocaleLowerCase();
    const normalizedOriginalName = originalName.toLocaleLowerCase();
    const nameError = identifierError("Column name", name);
    if (nameError) errors.push(nameError);
    if (seen.has(normalizedName)) errors.push(`Duplicate column name: ${name}`);
    seen.add(normalizedName);
    const current = existing.get(normalizedOriginalName);
    if (!current) {
      errors.push(`Unknown column: ${originalName}`);
      continue;
    }
    const type = column.type.trim();
    const columnTypeError = typeError({ name, type });
    if (columnTypeError) errors.push(columnTypeError);
    if (column.primaryKey !== Boolean(current.primaryKey)) {
      manual.push(`Primary-key change requires manual review: ${name}`);
      continue;
    }
    const renamed = originalName !== name;
    if (renamed && column.remove) {
      errors.push(`Cannot rename and remove the same column: ${originalName}`);
      continue;
    }
    if (column.remove) {
      if (column.primaryKey) {
        manual.push(
          `Cannot automatically remove a primary-key column: ${originalName}`,
        );
      } else if (driver === "sqlite") {
        manual.push(
          `SQLite column drop requires manual table rebuild: ${originalName}`,
        );
      } else {
        statements.push(
          `ALTER TABLE ${qualifiedName(table.schema, table.name, driver)} DROP COLUMN ${quoteIdentifier(originalName, driver)};`,
        );
      }
      continue;
    }
    if (renamed && driver === "sqlite") {
      manual.push(
        `SQLite column rename requires manual table rebuild: ${originalName} → ${name}`,
      );
      continue;
    }
    const typeChanged = type !== current.type;
    const nullabilityChanged = column.nullable !== current.nullable;
    if (!renamed && !typeChanged && !nullabilityChanged) continue;
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
        renamed
          ? `ALTER TABLE ${qualified} CHANGE COLUMN ${quoteIdentifier(originalName, driver)} ${identifier} ${type}${column.nullable ? "" : " NOT NULL"};`
          : `ALTER TABLE ${qualified} MODIFY COLUMN ${identifier} ${type}${column.nullable ? "" : " NOT NULL"};`,
      );
      continue;
    }
    if (renamed && driver === "sqlserver") {
      statements.push(
        `EXEC sys.sp_rename N${quoteSqlString(`${qualified}.${quoteIdentifier(originalName, driver)}`)}, N${quoteSqlString(name)}, 'COLUMN';`,
      );
    } else if (renamed) {
      statements.push(
        `ALTER TABLE ${qualified} RENAME COLUMN ${quoteIdentifier(originalName, driver)} TO ${identifier};`,
      );
    }
    if (!typeChanged && !nullabilityChanged) continue;
    if (driver === "sqlserver") {
      statements.push(
        `ALTER TABLE ${qualified} ALTER COLUMN ${identifier} ${type}${column.nullable ? " NULL" : " NOT NULL"};`,
      );
      continue;
    }
    if (driver === "oracle") {
      statements.push(
        `ALTER TABLE ${qualified} MODIFY (${identifier} ${type}${column.nullable ? " NULL" : " NOT NULL"});`,
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
    driver === "mysql" || driver === "sqlserver"
      ? quoteIdentifier(name, driver)
      : qualifiedName(table.schema, name, driver);
  const tableName = qualifiedName(table.schema, table.name, driver);
  return {
    sql: `CREATE ${input.unique ? "UNIQUE " : ""}INDEX ${indexName} ON ${tableName} (${columns.map((column) => quoteIdentifier(column, driver)).join(", ")});`,
    errors: [],
    warnings,
  };
}

export function buildAlterIndexPlan(
  table: Pick<TableMetadata, "schema" | "name" | "columns" | "indexes">,
  indexName: string,
  input: AlterIndexInput,
  driver: DriverKind,
): AlterIndexPlan {
  const name = normalizeIdentifier(indexName);
  const errors = [identifierError("Index name", name)].filter(
    (error): error is string => Boolean(error),
  );
  const index = table.indexes.find((candidate) => candidate.name === name);
  if (!index && name) errors.push(`Index does not exist: ${name}`);
  const columns = input.columns.map(normalizeIdentifier).filter(Boolean);
  if (columns.length === 0) errors.push("Select at least one column");
  const seen = new Set<string>();
  for (const column of columns) {
    const normalized = column.toLocaleLowerCase();
    if (seen.has(normalized)) errors.push(`Duplicate index column: ${column}`);
    seen.add(normalized);
    if (!table.columns.some((candidate) => candidate.name === column)) {
      errors.push(`Column does not exist: ${column}`);
    }
  }
  if (index?.primary) {
    const message = `Primary index cannot be altered from the index form: ${name}`;
    return {
      sql: `-- MANUAL REVIEW REQUIRED: ${message}`,
      statements: [],
      errors,
      manual: errors.length > 0 ? [] : [message],
      warnings: [],
    };
  }
  if (
    index &&
    index.unique === input.unique &&
    index.columns.length === columns.length &&
    index.columns.every((column, position) => column === columns[position])
  ) {
    errors.push("Change at least one index property before continuing");
  }
  if (errors.length > 0 || !index) {
    return { sql: "", statements: [], errors, manual: [], warnings: [] };
  }
  if (driver === "sqlite") {
    const message = `SQLite index alteration requires manual review: ${name}`;
    return {
      sql: `-- MANUAL REVIEW REQUIRED: ${message}`,
      statements: [],
      errors: [],
      manual: [message],
      warnings: [],
    };
  }
  const qualifiedTable = qualifiedName(table.schema, table.name, driver);
  const quotedIndex = quoteIdentifier(name, driver);
  const create = `CREATE ${input.unique ? "UNIQUE " : ""}INDEX ${driver === "mysql" || driver === "sqlserver" ? quotedIndex : qualifiedName(table.schema, name, driver)} ON ${qualifiedTable} (${columns.map((column) => quoteIdentifier(column, driver)).join(", ")});`;
  const warnings = ["This operation drops and recreates the selected index"];
  if (driver === "mysql") {
    const statement = `ALTER TABLE ${qualifiedTable} DROP INDEX ${quotedIndex}, ADD ${input.unique ? "UNIQUE " : ""}INDEX ${quotedIndex} (${columns.map((column) => quoteIdentifier(column, driver)).join(", ")});`;
    return {
      sql: statement,
      statements: [statement],
      errors: [],
      manual: [],
      warnings,
    };
  }
  const drop =
    driver === "sqlserver"
      ? `DROP INDEX ${quotedIndex} ON ${qualifiedTable};`
      : `DROP INDEX ${qualifiedName(table.schema, name, driver)};`;
  const statements = [drop, create];
  return {
    sql: statements.join("\n"),
    statements,
    errors: [],
    manual: [],
    warnings,
  };
}

export function buildCreateTableConstraintPlan(
  table: Pick<TableMetadata, "schema" | "name" | "columns" | "indexes">,
  input: CreateTableConstraintInput,
  driver: DriverKind,
): CreateTableConstraintPlan {
  const name = normalizeIdentifier(input.name);
  const errors = [identifierError("Constraint name", name)].filter(
    (error): error is string => Boolean(error),
  );
  const warnings: string[] = [];
  const manual: string[] = [];
  const columns = input.columns.map(normalizeIdentifier).filter(Boolean);
  const seen = new Set<string>();
  if (input.kind === "unique") {
    if (columns.length === 0) errors.push("Select at least one column");
    for (const column of columns) {
      const normalized = column.toLocaleLowerCase();
      if (seen.has(normalized)) {
        errors.push(`Duplicate constraint column: ${column}`);
      }
      seen.add(normalized);
      if (!table.columns.some((candidate) => candidate.name === column)) {
        errors.push(`Column does not exist: ${column}`);
      }
    }
    const duplicateUnique = table.indexes.some(
      (index) =>
        index.unique &&
        index.columns.length === columns.length &&
        index.columns.every((column, position) => column === columns[position]),
    );
    if (duplicateUnique) {
      warnings.push("A unique index already covers the same column order");
    }
  } else if (input.kind === "check") {
    const expression = input.expression.trim();
    if (!expression) errors.push("CHECK expression is required");
    const expressionError = constraintExpressionError(expression);
    if (expressionError) errors.push(expressionError);
  } else {
    errors.push("Constraint type must be UNIQUE or CHECK");
  }
  if (
    table.indexes.some(
      (index) => index.name.toLocaleLowerCase() === name.toLocaleLowerCase(),
    )
  ) {
    errors.push(`Constraint name conflicts with an existing index: ${name}`);
  }
  if (errors.length > 0) {
    return { sql: "", statements: [], errors, manual, warnings };
  }
  if (driver === "sqlite") {
    const message = `SQLite table constraints require a manual table rebuild: ${input.kind.toUpperCase()} ${name}`;
    return {
      sql: `-- MANUAL REVIEW REQUIRED: ${message}`,
      statements: [],
      errors: [],
      manual: [message],
      warnings,
    };
  }
  const qualified = qualifiedName(table.schema, table.name, driver);
  const constraint =
    input.kind === "unique"
      ? `UNIQUE (${columns.map((column) => quoteIdentifier(column, driver)).join(", ")})`
      : `CHECK (${input.expression.trim()})`;
  const statement = `ALTER TABLE ${qualified} ADD CONSTRAINT ${quoteIdentifier(name, driver)} ${constraint};`;
  return {
    sql: statement,
    statements: [statement],
    errors: [],
    manual,
    warnings,
  };
}

export function buildDropIndexPlan(
  table: Pick<TableMetadata, "schema" | "name" | "indexes">,
  indexName: string,
  driver: DriverKind,
): DropIndexPlan {
  const name = normalizeIdentifier(indexName);
  const errors = [identifierError("Index name", name)].filter(
    (error): error is string => Boolean(error),
  );
  const index = table.indexes.find((candidate) => candidate.name === name);
  if (!index && name) errors.push(`Index does not exist: ${name}`);
  if (errors.length > 0 || !index) {
    return { sql: "", errors, manual: [] };
  }
  if (index.primary) {
    const message = `Primary index cannot be removed from the index form: ${name}`;
    return {
      sql: `-- MANUAL REVIEW REQUIRED: ${message}`,
      errors: [],
      manual: [message],
    };
  }
  const qualifiedTable = qualifiedName(table.schema, table.name, driver);
  const sql =
    driver === "mysql" || driver === "sqlserver"
      ? `DROP INDEX ${quoteIdentifier(name, driver)} ON ${qualifiedTable};`
      : `DROP INDEX ${qualifiedName(table.schema, name, driver)};`;
  return { sql, errors: [], manual: [] };
}

export function buildRenameIndexPlan(
  table: Pick<TableMetadata, "schema" | "name" | "indexes">,
  currentName: string,
  nextName: string,
  driver: DriverKind,
): RenameIndexPlan {
  const current = normalizeIdentifier(currentName);
  const next = normalizeIdentifier(nextName);
  const errors = [
    identifierError("Current index name", current),
    identifierError("New index name", next),
  ].filter((error): error is string => Boolean(error));
  const index = table.indexes.find((candidate) => candidate.name === current);
  if (!index && current) errors.push(`Index does not exist: ${current}`);
  if (
    current &&
    next &&
    current.toLocaleLowerCase() === next.toLocaleLowerCase()
  ) {
    errors.push("New index name must differ from the current name");
  }
  if (
    next &&
    table.indexes.some(
      (candidate) =>
        candidate.name.toLocaleLowerCase() === next.toLocaleLowerCase() &&
        candidate.name !== current,
    )
  ) {
    errors.push(`New index name conflicts with an existing index: ${next}`);
  }
  if (errors.length > 0 || !index) {
    return { sql: "", statements: [], errors, manual: [] };
  }
  if (index.primary) {
    const message = `Primary index cannot be renamed from the index form: ${current}`;
    return {
      sql: `-- MANUAL REVIEW REQUIRED: ${message}`,
      statements: [],
      errors: [],
      manual: [message],
    };
  }
  if (driver === "sqlite") {
    const message = `SQLite index rename requires manual review: ${current} → ${next}`;
    return {
      sql: `-- MANUAL REVIEW REQUIRED: ${message}`,
      statements: [],
      errors: [],
      manual: [message],
    };
  }
  const qualifiedTable = qualifiedName(table.schema, table.name, driver);
  const statement =
    driver === "mysql"
      ? `ALTER TABLE ${qualifiedTable} RENAME INDEX ${quoteIdentifier(current, driver)} TO ${quoteIdentifier(next, driver)};`
      : driver === "sqlserver"
        ? `EXEC sys.sp_rename ${quoteSqlString(`${qualifiedTable}.${quoteIdentifier(current, driver)}`)}, ${quoteSqlString(next)}, 'INDEX';`
        : `ALTER INDEX ${qualifiedName(table.schema, current, driver)} RENAME TO ${quoteIdentifier(next, driver)};`;
  return { sql: statement, statements: [statement], errors: [], manual: [] };
}

export function buildAddForeignKeyPlan(
  table: Pick<TableMetadata, "schema" | "name" | "columns" | "foreignKeys">,
  referencedTable: Pick<TableMetadata, "schema" | "name" | "columns">,
  input: AddForeignKeyInput,
  driver: DriverKind,
): AddForeignKeyPlan {
  const name = normalizeIdentifier(input.name);
  const referencedSchema = normalizeIdentifier(input.referencedSchema);
  const referencedTableName = normalizeIdentifier(input.referencedTable);
  const columns = input.columns.map(normalizeIdentifier);
  const referencedColumns = input.referencedColumns.map(normalizeIdentifier);
  const errors = [
    identifierError("Constraint name", name),
    identifierError("Referenced schema", referencedSchema),
    identifierError("Referenced table", referencedTableName),
    foreignKeyActionError("ON UPDATE", input.onUpdate),
    foreignKeyActionError("ON DELETE", input.onDelete),
  ].filter((error): error is string => Boolean(error));
  const manual: string[] = [];
  const warnings: string[] = [];
  if (columns.length === 0) errors.push("Select at least one source column");
  if (columns.length !== referencedColumns.length) {
    errors.push("Source and referenced column counts must match");
  }
  const sourceSeen = new Set<string>();
  for (const column of columns) {
    const normalized = column.toLocaleLowerCase();
    if (!column) errors.push("Source column name is required");
    if (sourceSeen.has(normalized))
      errors.push(`Duplicate source column: ${column}`);
    sourceSeen.add(normalized);
    if (!table.columns.some((candidate) => candidate.name === column)) {
      errors.push(`Source column does not exist: ${column}`);
    }
  }
  const referencedSeen = new Set<string>();
  for (const column of referencedColumns) {
    const normalized = column.toLocaleLowerCase();
    if (!column) errors.push("Referenced column name is required");
    if (referencedSeen.has(normalized)) {
      errors.push(`Duplicate referenced column: ${column}`);
    }
    referencedSeen.add(normalized);
    if (
      !referencedTable.columns.some((candidate) => candidate.name === column)
    ) {
      errors.push(`Referenced column does not exist: ${column}`);
    }
  }
  if (
    table.foreignKeys.some(
      (foreignKey) =>
        foreignKey.name?.toLocaleLowerCase() === name.toLocaleLowerCase(),
    )
  ) {
    errors.push(`Foreign-key constraint already exists: ${name}`);
  }
  if (
    referencedTable.schema.toLocaleLowerCase() !==
      referencedSchema.toLocaleLowerCase() ||
    referencedTable.name.toLocaleLowerCase() !==
      referencedTableName.toLocaleLowerCase()
  ) {
    errors.push(
      `Referenced table metadata does not match: ${referencedSchema}.${referencedTableName}`,
    );
  }
  if (driver === "sqlite") {
    manual.push("SQLite foreign-key additions require a manual table rebuild");
  }
  if (errors.length > 0 || manual.length > 0) {
    return { sql: "", statements: [], errors, manual, warnings };
  }
  const qualifiedTable = qualifiedName(table.schema, table.name, driver);
  const sourceSql = columns
    .map((column) => quoteIdentifier(column, driver))
    .join(", ");
  const referencedSql = referencedColumns
    .map((column) => quoteIdentifier(column, driver))
    .join(", ");
  const statement = `ALTER TABLE ${qualifiedTable} ADD CONSTRAINT ${quoteIdentifier(name, driver)} FOREIGN KEY (${sourceSql}) REFERENCES ${qualifiedName(referencedSchema, referencedTableName, driver)} (${referencedSql}) ON UPDATE ${normalizedForeignKeyAction(input.onUpdate)} ON DELETE ${normalizedForeignKeyAction(input.onDelete)};`;
  return { sql: statement, statements: [statement], errors, manual, warnings };
}

export function buildDropForeignKeyPlan(
  table: Pick<TableMetadata, "schema" | "name">,
  foreignKeys: ForeignKeyMetadata[],
  foreignKeyId: string,
  driver: DriverKind,
): DropForeignKeyPlan {
  const foreignKey = foreignKeys.find(
    (candidate) => candidate.id === foreignKeyId,
  );
  const errors: string[] = [];
  const manual: string[] = [];
  if (!foreignKey) errors.push(`Foreign key does not exist: ${foreignKeyId}`);
  if (!foreignKey) return { sql: "", statements: [], errors, manual };
  if (!foreignKey.name) {
    manual.push(
      "This foreign key has no physical name and requires manual review",
    );
  } else if (driver === "sqlite") {
    manual.push("SQLite foreign-key removal requires a manual table rebuild");
  }
  if (errors.length > 0 || manual.length > 0) {
    return { sql: "", statements: [], errors, manual };
  }
  const foreignKeyName = foreignKey.name;
  if (!foreignKeyName) {
    return {
      sql: "",
      statements: [],
      errors,
      manual: [
        "This foreign key has no physical name and requires manual review",
      ],
    };
  }
  const clause = driver === "mysql" ? "DROP FOREIGN KEY" : "DROP CONSTRAINT";
  const statement = `ALTER TABLE ${qualifiedName(table.schema, table.name, driver)} ${clause} ${quoteIdentifier(foreignKeyName, driver)};`;
  return { sql: statement, statements: [statement], errors, manual };
}

export function buildCreateViewPlan(
  input: CreateViewInput,
  existingViews: Pick<ViewMetadata, "schema" | "name">[],
  driver: DriverKind,
): CreateViewPlan {
  const schema = normalizeIdentifier(input.schema);
  const name = normalizeIdentifier(input.name);
  const definition = input.definition.trim().replace(/;\s*$/, "");
  const errors = [
    identifierError("Schema", schema),
    identifierError("View name", name),
  ].filter((error): error is string => Boolean(error));
  if (!definition) errors.push("View definition is required");
  if (!/^(SELECT|WITH)\b/i.test(definition)) {
    errors.push("View definition must start with SELECT or WITH");
  }
  const safety = inspectViewDefinition(definition);
  if (safety.hasDelimiterOrComment) {
    errors.push("View definition cannot contain SQL delimiters or comments");
  }
  if (safety.hasMutatingKeyword) {
    errors.push("View definition must be a read-only query");
  }
  if (safety.hasUnterminatedQuote) {
    errors.push("View definition contains an unterminated quote or comment");
  }
  if (
    existingViews.some(
      (view) =>
        view.schema.toLocaleLowerCase() === schema.toLocaleLowerCase() &&
        view.name.toLocaleLowerCase() === name.toLocaleLowerCase(),
    )
  ) {
    errors.push(`View already exists: ${schema}.${name}`);
  }
  if (errors.length > 0) return { sql: "", errors };
  return {
    sql: `CREATE VIEW ${qualifiedName(schema, name, driver)} AS ${definition};`,
    errors: [],
  };
}

export function buildAlterViewPlan(
  input: CreateViewInput,
  existingViews: Pick<ViewMetadata, "schema" | "name">[],
  driver: DriverKind,
): AlterViewPlan {
  const schema = normalizeIdentifier(input.schema);
  const name = normalizeIdentifier(input.name);
  const existing = existingViews.some(
    (view) =>
      view.schema.toLocaleLowerCase() === schema.toLocaleLowerCase() &&
      view.name.toLocaleLowerCase() === name.toLocaleLowerCase(),
  );
  const createPlan = buildCreateViewPlan(
    input,
    existingViews.filter(
      (view) =>
        view.schema.toLocaleLowerCase() !== schema.toLocaleLowerCase() ||
        view.name.toLocaleLowerCase() !== name.toLocaleLowerCase(),
    ),
    driver,
  );
  const errors = existing
    ? createPlan.errors
    : [`View does not exist: ${schema}.${name}`, ...createPlan.errors];
  if (errors.length > 0) {
    return { sql: "", statements: [], errors, warnings: [] };
  }

  const qualified = qualifiedName(schema, name, driver);
  const definition = input.definition.trim().replace(/;\s*$/, "");
  const statements =
    driver === "sqlite"
      ? [
          `DROP VIEW ${qualified};`,
          `CREATE VIEW ${qualified} AS ${definition};`,
        ]
      : [`CREATE OR REPLACE VIEW ${qualified} AS ${definition};`];
  return {
    sql: statements.join("\n"),
    statements,
    errors: [],
    warnings:
      driver === "sqlite"
        ? [
            "SQLite replaces a view by dropping and recreating it; dependent objects may need review",
          ]
        : [],
  };
}

export function buildEditDatabaseDefinitionPlan(
  input: EditDatabaseDefinitionInput,
  driver: DriverKind,
): EditDatabaseDefinitionPlan {
  const definition = input.definition.trim();
  const errors: string[] = [];
  if (!definition) errors.push("Definition is required");
  if (definition && !/^(CREATE|ALTER)\b/i.test(definition)) {
    errors.push("Definition must start with CREATE or ALTER");
  }
  if (definition) {
    const safety = inspectViewDefinition(definition);
    if (safety.hasUnterminatedQuote) {
      errors.push("Definition contains an unterminated quote or comment");
    }
    const executable = safety.executable.replace(/;\s*$/, "");
    if (
      /;\s*(?:CREATE|ALTER|DROP|GRANT|REVOKE|TRUNCATE|EXEC|CALL)\b/i.test(
        executable,
      )
    ) {
      errors.push("Definition cannot contain multiple top-level statements");
    }
  }
  if (errors.length > 0) {
    return { sql: "", statements: [], errors, manual: [], warnings: [] };
  }
  if (driver === "sqlite") {
    const message = `SQLite definition replacement requires manual review: ${input.kind}`;
    return {
      sql: `-- MANUAL REVIEW REQUIRED: ${message}`,
      statements: [],
      errors: [],
      manual: [message],
      warnings: [],
    };
  }
  return {
    sql: definition,
    statements: [definition],
    errors: [],
    manual: [],
    warnings: [
      "The database validates the edited definition at execution time",
    ],
  };
}

export function buildDropViewPlan(
  schemaInput: string,
  nameInput: string,
  existingViews: Pick<ViewMetadata, "schema" | "name">[],
  dependentObjects: string[],
  driver: DriverKind,
): DropViewPlan {
  const schema = normalizeIdentifier(schemaInput);
  const name = normalizeIdentifier(nameInput);
  const errors = [
    identifierError("Schema", schema),
    identifierError("View name", name),
  ].filter((error): error is string => Boolean(error));
  const existing = existingViews.some(
    (view) =>
      view.schema.toLocaleLowerCase() === schema.toLocaleLowerCase() &&
      view.name.toLocaleLowerCase() === name.toLocaleLowerCase(),
  );
  if (!existing && schema && name) {
    errors.push(`View does not exist: ${schema}.${name}`);
  }
  if (errors.length > 0) {
    return { sql: "", statements: [], errors, warnings: [] };
  }
  const statement = `DROP VIEW ${qualifiedName(schema, name, driver)};`;
  return {
    sql: statement,
    statements: [statement],
    errors: [],
    warnings:
      dependentObjects.length > 0
        ? [
            `View is referenced by ${dependentObjects.join(", ")}; the database may reject this drop`,
          ]
        : [],
  };
}
