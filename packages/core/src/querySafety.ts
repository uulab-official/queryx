export interface QuerySafetyReport {
  isDangerous: boolean;
  operation?: "UPDATE" | "DELETE";
  reason: string;
}

function withoutComments(sql: string): string {
  return sql.replace(/--[^\n]*/g, " ").replace(/\/\*[\s\S]*?\*\//g, " ");
}

export function inspectQuerySafety(sql: string): QuerySafetyReport {
  const normalized = withoutComments(sql).trim();
  const operationMatch = normalized.match(/\b(UPDATE|DELETE)\b/i);
  if (!operationMatch)
    return { isDangerous: false, reason: "No destructive operation detected" };
  const operation = operationMatch[1].toUpperCase() as "UPDATE" | "DELETE";
  if (/\bWHERE\b/i.test(normalized))
    return { isDangerous: false, operation, reason: "WHERE clause detected" };
  return { isDangerous: true, operation, reason: "No WHERE clause detected" };
}
