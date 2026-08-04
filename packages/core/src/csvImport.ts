import type { ColumnMetadata, DriverKind, TableMetadata } from "@queryx/shared";

export type ImportValueType =
  | "text"
  | "integer"
  | "numeric"
  | "boolean"
  | "date"
  | "json";

export interface CsvImportParseResult {
  headers: string[];
  rows: Array<{ line: number; values: string[] }>;
  errors: string[];
}

export interface CsvImportMapping {
  sourceName: string;
  targetName: string | null;
  type: ImportValueType;
  include: boolean;
}

export interface CsvImportPlan {
  mappings: CsvImportMapping[];
  statements: string[];
  errors: string[];
  rowCount: number;
}

export function parseCsv(text: string, delimiter = ","): CsvImportParseResult {
  const source = text.replace(/^\uFEFF/, "");
  const rows: Array<{ line: number; values: string[] }> = [];
  const errors: string[] = [];
  let values: string[] = [];
  let value = "";
  let quoted = false;
  let line = 1;
  let rowLine = 1;
  let atFieldStart = true;

  const finishValue = () => {
    values.push(value);
    value = "";
    atFieldStart = true;
  };
  const finishRow = () => {
    if (values.length > 0 || value.length > 0 || !atFieldStart) {
      finishValue();
      rows.push({ line: rowLine, values });
    }
    values = [];
    rowLine = line + 1;
  };

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    const next = source[index + 1];
    if (quoted) {
      if (character === '"' && next === '"') {
        value += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        value += character;
        if (character === "\n") line += 1;
      }
      continue;
    }
    if (character === '"' && atFieldStart) {
      quoted = true;
      atFieldStart = false;
    } else if (character === delimiter) {
      finishValue();
    } else if (character === "\n" || character === "\r") {
      if (character === "\r" && next === "\n") index += 1;
      finishRow();
      line += 1;
    } else {
      value += character;
      atFieldStart = false;
    }
  }
  if (quoted) errors.push(`Line ${line}: unterminated quoted field`);
  if (value.length > 0 || values.length > 0 || !atFieldStart) finishRow();

  const headerRow = rows.shift();
  if (!headerRow) {
    return { headers: [], rows: [], errors: ["CSV contains no header row"] };
  }
  const headers = headerRow.values.map((header) => header.trim());
  const seen = new Set<string>();
  headers.forEach((header, index) => {
    if (!header) errors.push(`Header ${index + 1}: column name is empty`);
    if (seen.has(header))
      errors.push(`Header ${index + 1}: duplicate column ${header}`);
    seen.add(header);
  });
  for (const row of rows) {
    if (row.values.length !== headers.length) {
      errors.push(
        `Line ${row.line}: expected ${headers.length} columns, got ${row.values.length}`,
      );
    }
  }
  return { headers, rows, errors };
}

export function inferImportType(column: ColumnMetadata): ImportValueType {
  const type = column.type.toLowerCase();
  if (/(bool)/.test(type)) return "boolean";
  if (/(smallint|integer|bigint|serial|int\b)/.test(type)) return "integer";
  if (/(numeric|decimal|real|double|float|money)/.test(type)) return "numeric";
  if (/(json)/.test(type)) return "json";
  if (/(date|time|timestamp)/.test(type)) return "date";
  return "text";
}

export function defaultCsvImportMappings(
  headers: readonly string[],
  columns: readonly ColumnMetadata[],
): CsvImportMapping[] {
  const byName = new Map(columns.map((column) => [column.name, column]));
  return headers.map((sourceName) => {
    const target = byName.get(sourceName);
    return {
      sourceName,
      targetName: target?.name ?? null,
      type: target ? inferImportType(target) : "text",
      include: Boolean(target),
    };
  });
}

export function buildCsvImportPlan(
  table: Pick<TableMetadata, "schema" | "name">,
  parsed: CsvImportParseResult,
  mappings: readonly CsvImportMapping[],
  driver: DriverKind,
): CsvImportPlan {
  const errors = [...parsed.errors];
  const sourceIndexes = new Map(
    parsed.headers.map((header, index) => [header, index]),
  );
  const targets = new Set<string>();
  const activeMappings = mappings.filter((mapping) => mapping.include);
  for (const mapping of activeMappings) {
    if (!mapping.targetName) {
      errors.push(`Column ${mapping.sourceName}: choose a target column`);
    } else if (targets.has(mapping.targetName)) {
      errors.push(`Target column ${mapping.targetName}: mapped more than once`);
    } else {
      targets.add(mapping.targetName);
    }
    if (!sourceIndexes.has(mapping.sourceName)) {
      errors.push(`Source column ${mapping.sourceName}: not found in CSV`);
    }
  }
  if (activeMappings.length === 0)
    errors.push("Choose at least one column to import");

  const statements: string[] = [];
  for (const row of parsed.rows) {
    const columns: string[] = [];
    const values: string[] = [];
    for (const mapping of activeMappings) {
      if (!mapping.targetName) continue;
      const sourceIndex = sourceIndexes.get(mapping.sourceName);
      if (sourceIndex === undefined) continue;
      const raw = row.values[sourceIndex] ?? "";
      const converted = importValueSql(raw, mapping.type);
      if (converted.error) {
        errors.push(
          `Line ${row.line}, ${mapping.sourceName}: ${converted.error}`,
        );
        continue;
      }
      columns.push(quoteIdentifier(mapping.targetName, driver));
      values.push(converted.sql);
    }
    if (columns.length === activeMappings.length && columns.length > 0) {
      statements.push(
        `INSERT INTO ${quoteIdentifier(table.schema, driver)}.${quoteIdentifier(table.name, driver)} (${columns.join(", ")}) VALUES (${values.join(", ")});`,
      );
    }
  }
  return {
    mappings: [...mappings],
    statements,
    errors,
    rowCount: parsed.rows.length,
  };
}

function importValueSql(
  raw: string,
  type: ImportValueType,
): { sql: string; error?: string } {
  if (raw === "") return { sql: "NULL" };
  if (type === "boolean") {
    if (/^(true|t|1)$/i.test(raw)) return { sql: "TRUE" };
    if (/^(false|f|0)$/i.test(raw)) return { sql: "FALSE" };
    return { sql: "NULL", error: `invalid boolean value ${raw}` };
  }
  if (type === "integer" && !/^[+-]?\d+$/.test(raw)) {
    return { sql: "NULL", error: `invalid integer value ${raw}` };
  }
  if (
    type === "numeric" &&
    !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(raw)
  ) {
    return { sql: "NULL", error: `invalid numeric value ${raw}` };
  }
  if (type === "json") {
    try {
      JSON.parse(raw);
    } catch {
      return { sql: "NULL", error: "invalid JSON value" };
    }
  }
  if (type === "date" && Number.isNaN(Date.parse(raw))) {
    return { sql: "NULL", error: `invalid date value ${raw}` };
  }
  if (type === "integer" || type === "numeric") return { sql: raw };
  return { sql: `'${raw.replaceAll("'", "''")}'` };
}

function quoteIdentifier(value: string, driver: DriverKind): string {
  const quote = driver === "mysql" ? "`" : '"';
  return `${quote}${value.replaceAll(quote, `${quote}${quote}`)}${quote}`;
}
