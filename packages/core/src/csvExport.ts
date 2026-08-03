import type { QueryColumn } from "@queryx/shared";

export interface CsvExportOptions {
  includeBom?: boolean;
  lineEnding?: "\n" | "\r\n";
  protectFormulas?: boolean;
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

function encodeCell(value: string, protectFormulas: boolean): string {
  const safeValue =
    protectFormulas && FORMULA_PREFIX.test(value) ? `'${value}` : value;
  return /[",\r\n]/.test(safeValue)
    ? `"${safeValue.replaceAll('"', '""')}"`
    : safeValue;
}
