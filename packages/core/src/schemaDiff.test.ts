import { describe, expect, it } from "vitest";
import type { DatabaseMetadata } from "@queryx/shared";
import { buildSchemaMigrationSql, compareSchemaSnapshots } from "./schemaDiff";

const snapshot = (
  overrides: Partial<DatabaseMetadata> = {},
): DatabaseMetadata => ({
  databases: ["app"],
  schemas: ["public"],
  tables: [
    {
      schema: "public",
      name: "users",
      rowCount: 2,
      columns: [
        { name: "id", type: "integer", nullable: false, primaryKey: true },
        { name: "email", type: "text", nullable: false },
      ],
      indexes: [],
      foreignKeys: [],
    },
  ],
  views: [],
  routines: [],
  triggers: [],
  eventTriggers: [],
  dependencies: [],
  ...overrides,
});

describe("compareSchemaSnapshots", () => {
  it("detects tables, columns, indexes, and destructive changes", () => {
    const current = snapshot({
      tables: [
        {
          ...snapshot().tables[0],
          columns: [
            ...snapshot().tables[0].columns,
            { name: "name", type: "varchar(120)", nullable: true },
          ],
          indexes: [
            {
              name: "users_email_idx",
              columns: ["email"],
              unique: true,
              primary: false,
              type: "btree",
            },
          ],
        },
        {
          schema: "public",
          name: "audit_log",
          rowCount: 0,
          columns: [
            { name: "id", type: "bigint", nullable: false, primaryKey: true },
          ],
          indexes: [],
          foreignKeys: [],
        },
      ],
    });
    const diff = compareSchemaSnapshots(snapshot(), current, "postgres");

    expect(diff.changes.map((change) => change.kind)).toEqual([
      "tableAdded",
      "columnAdded",
      "indexAdded",
    ]);
    expect(diff.added).toBe(3);
    expect(diff.removed).toBe(0);
    expect(buildSchemaMigrationSql(diff)).toContain("CREATE TABLE");
    expect(buildSchemaMigrationSql(diff)).toContain("CREATE UNIQUE INDEX");
  });

  it("marks SQLite column alterations for manual review", () => {
    const current = snapshot({
      tables: [
        {
          ...snapshot().tables[0],
          columns: [
            { name: "id", type: "integer", nullable: false, primaryKey: true },
            { name: "email", type: "varchar(255)", nullable: true },
          ],
        },
      ],
    });
    const diff = compareSchemaSnapshots(snapshot(), current, "sqlite");

    expect(diff.changes[0]?.kind).toBe("columnChanged");
    expect(diff.manual).toBe(1);
    expect(buildSchemaMigrationSql(diff)).toContain("MANUAL REVIEW REQUIRED");
  });
});
