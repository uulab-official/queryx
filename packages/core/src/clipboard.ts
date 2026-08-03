import type { QueryColumn } from "@queryx/shared";

export interface ClipboardExportOptions {
  includeHeaders?: boolean;
  lineEnding?: "\n" | "\r\n";
  nullValue?: string;
}

/**
 * Serializes query rows for spreadsheet-friendly clipboard paste.
 * Cells containing tabs, line breaks, or quotes use CSV-style quoting so a
 * copied range remains rectangular when pasted into a grid application.
 */
export function serializeRowsToTsv(
  columns: readonly Pick<QueryColumn, "name">[],
  rows: readonly Record<string, unknown>[],
  options: ClipboardExportOptions = {},
): string {
  const {
    includeHeaders = false,
    lineEnding = "\r\n",
    nullValue = "",
  } = options;
  const records = [
    ...(includeHeaders ? [columns.map((column) => column.name)] : []),
    ...rows.map((row) =>
      columns.map((column) => normalizeCell(row[column.name], nullValue)),
    ),
  ];
  return records
    .map((record) => record.map(encodeTsvCell).join("\t"))
    .join(lineEnding);
}

function normalizeCell(value: unknown, nullValue: string): string {
  if (value === null || value === undefined) return nullValue;
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

function encodeTsvCell(value: string): string {
  return /[\t\r\n"]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}
