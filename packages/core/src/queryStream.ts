import type { QueryChunk, QueryResult } from "@queryx/shared";

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
