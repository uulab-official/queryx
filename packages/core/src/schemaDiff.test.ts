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

  it("orders new tables, indexes, foreign keys, and views for migration preview", () => {
    const current = snapshot({
      tables: [
        snapshot().tables[0],
        {
          schema: "public",
          name: "orders",
          rowCount: 0,
          columns: [
            { name: "id", type: "bigint", nullable: false, primaryKey: true },
            { name: "user_id", type: "integer", nullable: false },
          ],
          indexes: [
            {
              name: "orders_user_id_idx",
              columns: ["user_id"],
              unique: false,
              primary: false,
              type: "btree",
            },
          ],
          foreignKeys: [
            {
              id: "orders_user_id_fkey",
              name: "orders_user_id_fkey",
              columns: [
                { ordinal: 1, sourceColumn: "user_id", referencedColumn: "id" },
              ],
              referencedRelation: { schema: "public", name: "users" },
              onUpdate: "NO ACTION",
              onDelete: "CASCADE",
              match: null,
              deferrable: false,
              initiallyDeferred: false,
            },
          ],
        },
      ],
      views: [
        {
          schema: "public",
          name: "active_users",
          columns: [{ name: "id", type: "integer", nullable: false }],
          definition: "SELECT id FROM users WHERE active = true",
        },
      ],
    });
    const diff = compareSchemaSnapshots(snapshot(), current, "postgres");

    expect(diff.changes.map((change) => change.kind)).toEqual([
      "tableAdded",
      "indexAdded",
      "foreignKeyAdded",
      "viewAdded",
    ]);
    const sql = buildSchemaMigrationSql(diff);
    expect(sql).toContain("CREATE TABLE");
    expect(sql).toContain("CREATE INDEX");
    expect(sql).toContain("ADD CONSTRAINT");
    expect(sql).toContain("CREATE VIEW");
  });

  it("detects foreign-key removals and view changes with SQLite safeguards", () => {
    const foreignKey = {
      id: "users_org_id_fkey",
      name: "users_org_id_fkey",
      columns: [{ ordinal: 1, sourceColumn: "org_id", referencedColumn: "id" }],
      referencedRelation: { schema: "public", name: "organizations" },
      onUpdate: "NO ACTION",
      onDelete: "CASCADE",
      match: null,
      deferrable: false,
      initiallyDeferred: false,
    };
    const baseline = snapshot({
      tables: [{ ...snapshot().tables[0], foreignKeys: [foreignKey] }],
      views: [
        {
          schema: "public",
          name: "user_summary",
          columns: [{ name: "id", type: "integer", nullable: false }],
          definition: "SELECT id FROM users",
        },
        {
          schema: "public",
          name: "obsolete_users",
          columns: [],
          definition: "SELECT id FROM users",
        },
      ],
    });
    const current = snapshot({
      views: [
        {
          schema: "public",
          name: "user_summary",
          columns: [{ name: "id", type: "integer", nullable: false }],
          definition: "SELECT id, email FROM users",
        },
      ],
    });

    const diff = compareSchemaSnapshots(baseline, current, "sqlite");

    expect(diff.changes.map((change) => change.kind)).toEqual([
      "foreignKeyRemoved",
      "viewChanged",
      "viewRemoved",
    ]);
    expect(diff.changed).toBe(1);
    expect(diff.manual).toBe(2);
    expect(buildSchemaMigrationSql(diff)).toContain("DROP VIEW");
    expect(buildSchemaMigrationSql(diff)).toContain("MANUAL REVIEW REQUIRED");
  });
});
