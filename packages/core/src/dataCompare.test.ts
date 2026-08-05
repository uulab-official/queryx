import { describe, expect, it } from "vitest";
import type { TableMetadata } from "@queryx/shared";
import {
  buildDataCountSql,
  buildDataSelectSql,
  buildDataSyncStatements,
  compareTableData,
} from "./dataCompare";

const table: TableMetadata = {
  schema: "public",
  name: "users",
  rowCount: 3,
  columns: [
    { name: "id", type: "integer", nullable: false, primaryKey: true },
    { name: "email", type: "text", nullable: false },
    { name: "active", type: "boolean", nullable: false },
  ],
  indexes: [],
  foreignKeys: [],
};

describe("compareTableData", () => {
  it("creates deterministic insert/update/delete changes from primary keys", () => {
    const comparison = compareTableData(
      table,
      [
        { id: 1, email: "new@example.com", active: true },
        { id: 3, email: "added@example.com", active: true },
      ],
      [
        { id: 1, email: "old@example.com", active: true },
        { id: 2, email: "removed@example.com", active: false },
      ],
      "postgres",
    );

    expect(comparison.errors).toEqual([]);
    expect(comparison.matchedCount).toBe(1);
    expect(comparison.changes.map((change) => change.kind)).toEqual([
      "update",
      "delete",
      "insert",
    ]);
    expect(comparison.changes[0]?.sql).toContain(
      'WHERE "id" = 1 AND "email" = \'old@example.com\' AND "active" = TRUE;',
    );
    expect(comparison.changes[1]?.destructive).toBe(true);
    expect(comparison.changes[2]?.sql).toContain("INSERT INTO");
    expect(buildDataSyncStatements(comparison)).toHaveLength(3);
  });

  it("preserves composite keys and rejects duplicate or missing keys", () => {
    const composite: TableMetadata = {
      ...table,
      columns: table.columns.map((column) =>
        column.name === "id"
          ? { ...column, name: "tenant_id", primaryKey: true }
          : column,
      ),
    };
    composite.columns.splice(1, 0, {
      name: "user_id",
      type: "integer",
      nullable: false,
      primaryKey: true,
    });
    const comparison = compareTableData(
      composite,
      [
        { tenant_id: 1, user_id: 2, email: "a", active: true },
        { tenant_id: 1, user_id: 2, email: "duplicate", active: true },
      ],
      [{ tenant_id: 1, email: "missing-user-id", active: true }],
      "sqlite",
    );

    expect(comparison.primaryKeys).toEqual(["tenant_id", "user_id"]);
    expect(comparison.errors).toEqual([
      "source contains duplicate primary key tenant_id=1, user_id=2",
      "target row is missing a primary-key column",
    ]);
  });

  it("requires a primary key before generating synchronization changes", () => {
    const noKey = {
      ...table,
      columns: table.columns.map((column) => ({
        ...column,
        primaryKey: false,
      })),
    };
    const comparison = compareTableData(
      noKey,
      [{ id: 1, email: "a", active: true }],
      [],
      "mysql",
    );
    expect(comparison.errors).toEqual([
      "Data Compare requires at least one primary-key column",
    ]);
    expect(comparison.changes).toEqual([]);
  });

  it("builds bounded dialect-aware reads", () => {
    expect(buildDataSelectSql(table, "sqlserver", 100)).toContain(
      "SELECT TOP 100",
    );
    expect(buildDataSelectSql(table, "oracle", 100)).toContain(
      "FETCH FIRST 100 ROWS ONLY",
    );
    expect(buildDataSelectSql(table, "mysql", 100)).toContain("LIMIT 100");
    expect(buildDataCountSql(table, "postgres")).toContain("COUNT(*)");
  });
});
