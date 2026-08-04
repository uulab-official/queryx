import { describe, expect, it } from "vitest";
import type { DatabaseMetadata, DependencyMetadata } from "@queryx/shared";
import {
  buildSchemaMigrationStatements,
  buildSchemaMigrationSql,
  buildSchemaPrivilegePreflightSql,
  buildSchemaRollbackSql,
  compareSchemaSnapshots,
} from "./schemaDiff";

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

  it("splits executable migration SQL without breaking quoted semicolons", () => {
    const current = snapshot({
      tables: [
        {
          ...snapshot().tables[0],
          columns: [
            { name: "id", type: "integer", nullable: false, primaryKey: true },
            { name: "email", type: "text", nullable: false },
            { name: "note", type: "text", nullable: true },
          ],
        },
      ],
    });
    const diff = compareSchemaSnapshots(snapshot(), current, "postgres");

    expect(buildSchemaMigrationStatements(diff)).toEqual([
      'ALTER TABLE "public"."users" ADD COLUMN "note" text',
    ]);

    const viewDiff = compareSchemaSnapshots(
      snapshot(),
      snapshot({
        views: [
          {
            schema: "public",
            name: "quoted_value",
            columns: [{ name: "value", type: "text", nullable: true }],
            definition: "SELECT 'a;b' AS value",
          },
        ],
      }),
      "postgres",
    );
    expect(buildSchemaMigrationStatements(viewDiff)).toEqual([
      `CREATE VIEW "public"."quoted_value" AS SELECT 'a;b' AS value`,
    ]);

    const twoViewDiff = compareSchemaSnapshots(
      snapshot(),
      snapshot({
        views: [
          {
            schema: "public",
            name: "quoted_value",
            columns: [{ name: "value", type: "text", nullable: true }],
            definition: "SELECT 'a;b' AS value",
          },
          {
            schema: "public",
            name: "second_view",
            columns: [{ name: "id", type: "integer", nullable: true }],
            definition: "SELECT id FROM users",
          },
        ],
      }),
      "postgres",
    );
    expect(buildSchemaMigrationStatements(twoViewDiff)).toHaveLength(2);
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

  it("topologically orders view additions and table removals", () => {
    const viewReference = (
      dependentName: string,
      referenced: { kind: "table" | "view"; name: string },
    ): DependencyMetadata => ({
      id: `view:${dependentName}:${referenced.name}`,
      kind: "viewReference",
      dependent: {
        kind: "view",
        id: null,
        schema: "public",
        name: dependentName,
        identityArguments: null,
      },
      referenced: {
        kind: referenced.kind,
        id: null,
        schema: "public",
        name: referenced.name,
        identityArguments: null,
      },
    });
    const current = snapshot({
      views: [
        {
          schema: "public",
          name: "report_view",
          columns: [],
          definition: "SELECT * FROM base_view",
        },
        {
          schema: "public",
          name: "base_view",
          columns: [],
          definition: "SELECT * FROM users",
        },
      ],
      dependencies: [
        viewReference("report_view", { kind: "view", name: "base_view" }),
        viewReference("base_view", { kind: "table", name: "users" }),
      ],
    });
    const addedViews = compareSchemaSnapshots(snapshot(), current, "postgres");
    expect(addedViews.changes.map((change) => change.label)).toEqual([
      "Add view public.base_view",
      "Add view public.report_view",
    ]);

    const removed = compareSchemaSnapshots(
      snapshot({
        tables: [
          {
            schema: "public",
            name: "orders",
            rowCount: 0,
            columns: [{ name: "id", type: "integer", nullable: false }],
            indexes: [],
            foreignKeys: [
              {
                id: "orders_user_id_fkey",
                name: "orders_user_id_fkey",
                columns: [
                  {
                    ordinal: 1,
                    sourceColumn: "user_id",
                    referencedColumn: "id",
                  },
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
          snapshot().tables[0],
        ],
      }),
      snapshot({ tables: [] }),
      "postgres",
    );
    expect(
      removed.changes
        .filter((change) => change.kind === "tableRemoved")
        .map((change) => change.label),
    ).toEqual(["Drop table public.orders", "Drop table public.users"]);
    const rollback = buildSchemaRollbackSql(addedViews);
    expect(rollback.indexOf("report_view")).toBeLessThan(
      rollback.indexOf("base_view"),
    );
  });

  it("builds read-only privilege preflight SQL per driver", () => {
    const diff = compareSchemaSnapshots(
      snapshot(),
      snapshot({
        tables: [
          {
            ...snapshot().tables[0],
            columns: [
              ...snapshot().tables[0].columns,
              { name: "display_name", type: "text", nullable: true },
            ],
          },
        ],
      }),
      "postgres",
    );

    const postgres = buildSchemaPrivilegePreflightSql(diff, "postgres");
    expect(postgres).toContain("has_schema_privilege");
    expect(postgres).toContain("has_table_privilege");
    expect(postgres).toContain("public.users");
    expect(buildSchemaPrivilegePreflightSql(diff, "mysql")).toContain(
      "SHOW GRANTS FOR CURRENT_USER()",
    );
    expect(buildSchemaPrivilegePreflightSql(diff, "sqlite")).toContain(
      "PRAGMA database_list",
    );
  });
});
