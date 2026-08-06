import type { QueryChunk, QueryResult } from "@queryx/shared";

export interface LimitedQueryChunk {
  chunk: QueryChunk;
  truncated: boolean;
}

export function limitQueryChunk(
  chunk: QueryChunk,
  loadedRows: number,
  maxRows: number,
): LimitedQueryChunk {
  const remaining = Math.max(0, maxRows - loadedRows);
  return {
    chunk: {
      ...chunk,
      rows: chunk.rows.slice(0, remaining),
    },
    truncated: chunk.rows.length > remaining,
  };
}

export function appendQueryChunk(
  result: QueryResult,
  chunk: QueryChunk,
): QueryResult {
  return {
    ...result,
    columns: result.columns.length > 0 ? result.columns : chunk.columns,
    rows: [...result.rows, ...chunk.rows],
    warnings: [...new Set([...result.warnings, ...chunk.warnings])],
  };
}
