import { describe, expect, it } from "vitest";
import { buildRenameIndexPlan } from "./ddlForms";

const table = {
  schema: "public",
  name: "users",
  indexes: [
    {
      name: "users_email_idx",
      columns: ["email"],
      unique: false,
      primary: false,
      type: "btree",
    },
    {
      name: "users_pkey",
      columns: ["id"],
      unique: true,
      primary: true,
      type: "btree",
    },
  ],
};

describe("buildRenameIndexPlan", () => {
  it("generates PostgreSQL and Oracle ALTER INDEX statements", () => {
    const postgres = buildRenameIndexPlan(
      table,
      "users_email_idx",
      "users_email_lookup_idx",
      "postgres",
    );
    expect(postgres).toEqual({
      sql: 'ALTER INDEX "public"."users_email_idx" RENAME TO "users_email_lookup_idx";',
      statements: [
        'ALTER INDEX "public"."users_email_idx" RENAME TO "users_email_lookup_idx";',
      ],
      errors: [],
      manual: [],
    });
    const oracle = buildRenameIndexPlan(
      table,
      "users_email_idx",
      "users_email_lookup_idx",
      "oracle",
    );
    expect(oracle.sql).toBe(
      'ALTER INDEX "public"."users_email_idx" RENAME TO "users_email_lookup_idx";',
    );
  });

  it("uses vendor-specific MySQL and SQL Server syntax", () => {
    expect(
      buildRenameIndexPlan(
        table,
        "users_email_idx",
        "users_email_lookup_idx",
        "mysql",
      ).sql,
    ).toBe(
      "ALTER TABLE `public`.`users` RENAME INDEX `users_email_idx` TO `users_email_lookup_idx`;",
    );
    expect(
      buildRenameIndexPlan(
        { ...table, schema: "dbo" },
        "users_email_idx",
        "users_email_lookup_idx",
        "sqlserver",
      ).sql,
    ).toBe(
      "EXEC sys.sp_rename '[dbo].[users].[users_email_idx]', 'users_email_lookup_idx', 'INDEX';",
    );
  });

  it("rejects missing, unchanged, and conflicting names", () => {
    const missing = buildRenameIndexPlan(table, "missing", "next", "postgres");
    expect(missing.errors).toContain("Index does not exist: missing");
    const unchanged = buildRenameIndexPlan(
      table,
      "users_email_idx",
      "USERS_EMAIL_IDX",
      "postgres",
    );
    expect(unchanged.errors).toContain(
      "New index name must differ from the current name",
    );
    const conflict = buildRenameIndexPlan(
      table,
      "users_email_idx",
      "users_pkey",
      "postgres",
    );
    expect(conflict.errors).toContain(
      "New index name conflicts with an existing index: users_pkey",
    );
  });

  it("protects primary and SQLite indexes with manual-review output", () => {
    const primary = buildRenameIndexPlan(
      table,
      "users_pkey",
      "users_primary_key",
      "postgres",
    );
    expect(primary.statements).toEqual([]);
    expect(primary.manual[0]).toContain("Primary index cannot be renamed");
    const sqlite = buildRenameIndexPlan(
      table,
      "users_email_idx",
      "users_email_lookup_idx",
      "sqlite",
    );
    expect(sqlite.statements).toEqual([]);
    expect(sqlite.manual[0]).toContain(
      "SQLite index rename requires manual review",
    );
  });
});
