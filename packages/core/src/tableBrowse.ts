import type { DriverKind, TableMetadata } from "@queryx/shared";

export type TableBrowseSortDirection = "asc" | "desc";

export interface TableBrowsePlan {
  sql: string;
  limit: number;
  offset: number;
  filter: string;
  sortBy: string | null;
  sortDirection: TableBrowseSortDirection;
  errors: string[];
  warnings: string[];
}

function quoteIdentifier(value: string, driver: DriverKind): string {
  if (driver === "sqlserver") return `[${value.replaceAll("]", "]]")}]`;
  const quote = driver === "mysql" ? "`" : '"';
  return `${quote}${value.replaceAll(quote, `${quote}${quote}`)}${quote}`;
}

function quoteString(value: string, driver: DriverKind): string {
  const escapedQuotes = value.replaceAll("'", "''");
  if (driver === "mysql" && value.includes("\\")) {
    return `'${escapedQuotes.replaceAll("\\", "\\\\")}'`;
  }
  if (driver === "postgres" && value.includes("\\")) {
    return `E'${escapedQuotes.replaceAll("\\", "\\\\")}'`;
  }
  return `'${escapedQuotes}'`;
}

function escapeLikePattern(value: string): string {
  return value
    .replaceAll("!", "!!")
    .replaceAll("%", "!%")
    .replaceAll("_", "!_");
}

function castAsText(identifier: string, driver: DriverKind): string {
  return `CAST(${identifier} AS ${driver === "mysql" ? "CHAR" : driver === "sqlserver" ? "NVARCHAR(MAX)" : "TEXT"})`;
}

export function buildTableBrowsePlan(
  table: Pick<TableMetadata, "schema" | "name" | "columns">,
  driver: DriverKind,
  limit: number,
  offset: number,
  filter = "",
  sortBy: string | null = null,
  sortDirection: TableBrowseSortDirection = "asc",
): TableBrowsePlan {
  const errors: string[] = [];
  const warnings: string[] = [];
  const normalizedFilter = filter.trim();
  const normalizedSortBy = sortBy?.trim() || null;

  if (!Number.isInteger(limit) || limit < 1 || limit > 10_000) {
    errors.push("Table page size must be an integer between 1 and 10000");
  }
  if (!Number.isInteger(offset) || offset < 0) {
    errors.push("Table page offset must be a non-negative integer");
  }
  if (!table.schema.trim() || !table.name.trim()) {
    errors.push("Table schema and name are required");
  }
  if (sortDirection !== "asc" && sortDirection !== "desc") {
    errors.push("Table sort direction must be asc or desc");
  }

  const sortColumn = normalizedSortBy
    ? table.columns.find((column) => column.name === normalizedSortBy)
    : undefined;
  if (normalizedSortBy && !sortColumn) {
    errors.push(`Sort column does not exist: ${normalizedSortBy}`);
  }

  if (table.columns.length === 0) {
    errors.push("Table must expose at least one column");
  }

  const primaryKeyColumns = table.columns.filter((column) => column.primaryKey);
  if (primaryKeyColumns.length === 0) {
    warnings.push(
      "Table has no primary key; page order may change between loads",
    );
  }

  if (errors.length > 0) {
    return {
      sql: "",
      limit,
      offset,
      filter: normalizedFilter,
      sortBy: normalizedSortBy,
      sortDirection,
      errors,
      warnings,
    };
  }

  const tableName = `${quoteIdentifier(table.schema, driver)}.${quoteIdentifier(table.name, driver)}`;
  const qualifiedColumns = table.columns.map((column) =>
    quoteIdentifier(column.name, driver),
  );
  const where = normalizedFilter
    ? `WHERE (${qualifiedColumns
        .map(
          (column) =>
            `LOWER(${castAsText(column, driver)}) LIKE LOWER(${quoteString(`%${escapeLikePattern(normalizedFilter)}%`, driver)}) ESCAPE '!'`,
        )
        .join(" OR ")})`
    : "";

  const orderColumns: string[] = [];
  if (sortColumn) {
    orderColumns.push(
      `${quoteIdentifier(sortColumn.name, driver)} ${sortDirection.toUpperCase()}`,
    );
  }
  for (const primaryKeyColumn of primaryKeyColumns) {
    if (primaryKeyColumn.name !== normalizedSortBy) {
      orderColumns.push(
        `${quoteIdentifier(primaryKeyColumn.name, driver)} ASC`,
      );
    }
  }
  const orderBy =
    orderColumns.length > 0 ? `ORDER BY ${orderColumns.join(", ")}` : "";

  return {
    sql: [
      `SELECT * FROM ${tableName}`,
      where,
      orderBy || (driver === "sqlserver" ? "ORDER BY (SELECT 1)" : ""),
      driver === "sqlserver"
        ? `OFFSET ${offset} ROWS FETCH NEXT ${limit} ROWS ONLY;`
        : `LIMIT ${limit} OFFSET ${offset};`,
    ]
      .filter(Boolean)
      .join("\n"),
    limit,
    offset,
    filter: normalizedFilter,
    sortBy: normalizedSortBy,
    sortDirection,
    errors: [],
    warnings,
  };
}
