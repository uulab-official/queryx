const PROTECTED_TOKEN = "\u0000QUERYX_SQL_TOKEN_";

const KEYWORDS = [
  "UNION ALL",
  "LEFT OUTER JOIN",
  "RIGHT OUTER JOIN",
  "FULL OUTER JOIN",
  "INNER JOIN",
  "CROSS JOIN",
  "GROUP BY",
  "ORDER BY",
  "LEFT JOIN",
  "RIGHT JOIN",
  "FULL JOIN",
  "ON CONFLICT",
  "SELECT",
  "FROM",
  "WHERE",
  "HAVING",
  "RETURNING",
  "LIMIT",
  "OFFSET",
  "UNION",
  "JOIN",
  "SET",
  "VALUES",
  "INSERT",
  "UPDATE",
  "DELETE",
  "CREATE",
  "ALTER",
  "DROP",
];

/**
 * Applies a conservative, dialect-neutral layout to SQL while preserving
 * quoted literals, identifiers, and comments byte-for-byte.
 */
export function formatSql(sql: string): string {
  const trimmed = sql.trim();
  if (!trimmed) return "";

  const protectedValues: string[] = [];
  const masked = maskProtectedSql(trimmed, protectedValues)
    .replace(/\s+/g, " ")
    .replace(/\s*,\s*/g, ", ")
    .trim();

  let formatted = uppercaseKeywords(masked);
  for (const keyword of KEYWORDS) {
    const pattern = keyword.replaceAll(" ", "\\s+");
    formatted = formatted.replace(
      new RegExp(`\\s*\\b${pattern}\\b\\s*`, "gi"),
      `\n${keyword} `,
    );
  }
  formatted = formatted
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n")
    .replace(/\s+;/g, ";");

  return restoreProtectedSql(formatted, protectedValues);
}

function uppercaseKeywords(sql: string): string {
  return sql.replace(
    /\b(SELECT|FROM|WHERE|HAVING|RETURNING|LIMIT|OFFSET|UNION|JOIN|SET|VALUES|INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|AS)\b/gi,
    (keyword) => keyword.toUpperCase(),
  );
}

function maskProtectedSql(sql: string, values: string[]): string {
  let output = "";
  for (let index = 0; index < sql.length; index += 1) {
    const character = sql[index];
    const next = sql[index + 1];
    if (character === "-" && next === "-") {
      const start = index;
      index += 2;
      while (index < sql.length && sql[index] !== "\n") index += 1;
      values.push(sql.slice(start, index));
      output += token(values.length - 1);
      index -= 1;
      continue;
    }
    if (character === "/" && next === "*") {
      const start = index;
      index += 2;
      while (
        index < sql.length - 1 &&
        !(sql[index] === "*" && sql[index + 1] === "/")
      ) {
        index += 1;
      }
      index = Math.min(index + 1, sql.length - 1);
      values.push(sql.slice(start, index + 1));
      output += token(values.length - 1);
      continue;
    }
    if (character === "'" || character === '"' || character === "`") {
      const quote = character;
      const start = index;
      index += 1;
      while (index < sql.length) {
        if (sql[index] === quote) {
          if (sql[index + 1] === quote) {
            index += 2;
            continue;
          }
          break;
        }
        if (sql[index] === "\\" && quote === "'") index += 1;
        index += 1;
      }
      values.push(sql.slice(start, Math.min(index + 1, sql.length)));
      output += token(values.length - 1);
      continue;
    }
    output += character;
  }
  return output;
}

function token(index: number): string {
  return `${PROTECTED_TOKEN}${index}\u0000`;
}

function restoreProtectedSql(sql: string, values: readonly string[]): string {
  return sql.replace(
    new RegExp(`${PROTECTED_TOKEN}(\\d+)\\u0000`, "g"),
    (_match, index: string) => values[Number(index)] ?? "",
  );
}
