import { describe, expect, it } from "vitest";
import { buildEditTableColumnsPlan } from "./ddlForms";

const table = {
  schema: "public",
  name: "users",
  columns: [
    { name: "id", type: "integer", nullable: false, primaryKey: true },
    { name: "email", type: "text", nullable: true, primaryKey: false },
    { name: "legacy", type: "text", nullable: true, primaryKey: false },
  ],
};

describe("buildEditTableColumnsPlan", () => {
  it("generates PostgreSQL type, nullability, and drop statements", () => {
    const plan = buildEditTableColumnsPlan(
      table,
      [
        {
          name: "id",
          type: "bigint",
          nullable: false,
          primaryKey: true,
          remove: false,
        },
        {
          name: "email",
          type: "varchar(255)",
          nullable: false,
          primaryKey: false,
          remove: false,
        },
        {
          name: "legacy",
          type: "text",
          nullable: true,
          primaryKey: false,
          remove: true,
        },
      ],
      "postgres",
    );
    expect(plan.errors).toEqual([]);
    expect(plan.manual).toEqual([]);
    expect(plan.statements).toEqual([
      'ALTER TABLE "public"."users" ALTER COLUMN "id" TYPE bigint;',
      'ALTER TABLE "public"."users" ALTER COLUMN "email" TYPE varchar(255);',
      'ALTER TABLE "public"."users" ALTER COLUMN "email" SET NOT NULL;',
      'ALTER TABLE "public"."users" DROP COLUMN "legacy";',
    ]);
  });

  it("marks SQLite changes that require a rebuild for manual review", () => {
    const plan = buildEditTableColumnsPlan(
      table,
      table.columns.map((column) => ({
        ...column,
        remove: column.name === "legacy",
      })),
      "sqlite",
    );
    expect(plan.statements).toEqual([]);
    expect(plan.manual).toEqual([
      "SQLite column drop requires manual table rebuild: legacy",
    ]);
    expect(plan.sql).toContain("MANUAL REVIEW REQUIRED");
  });

  it("generates a PostgreSQL rename before type and nullability changes", () => {
    const plan = buildEditTableColumnsPlan(
      table,
      [
        {
          originalName: "id",
          name: "user_id",
          type: "bigint",
          nullable: false,
          primaryKey: true,
          remove: false,
        },
        ...table.columns.slice(1).map((column) => ({
          originalName: column.name,
          ...column,
          remove: false,
        })),
      ],
      "postgres",
    );

    expect(plan.errors).toEqual([]);
    expect(plan.statements).toEqual([
      'ALTER TABLE "public"."users" RENAME COLUMN "id" TO "user_id";',
      'ALTER TABLE "public"."users" ALTER COLUMN "user_id" TYPE bigint;',
    ]);
  });

  it("uses vendor-safe rename statements and blocks SQLite rename", () => {
    const input = table.columns.map((column) => ({
      originalName: column.name,
      ...column,
      name: column.name === "email" ? "email_address" : column.name,
      remove: false,
    }));
    const mysql = buildEditTableColumnsPlan(table, input, "mysql");
    expect(mysql.errors).toEqual([]);
    expect(mysql.statements).toEqual([
      "ALTER TABLE `public`.`users` CHANGE COLUMN `email` `email_address` text;",
    ]);

    const sqlserver = buildEditTableColumnsPlan(table, input, "sqlserver");
    expect(sqlserver.errors).toEqual([]);
    expect(sqlserver.statements[0]).toContain("sys.sp_rename");
    expect(sqlserver.statements[0]).toContain("email_address");

    const sqlite = buildEditTableColumnsPlan(table, input, "sqlite");
    expect(sqlite.statements).toEqual([]);
    expect(sqlite.manual).toEqual([
      "SQLite column rename requires manual table rebuild: email → email_address",
    ]);
  });

  it("rejects renamed columns that collide or are also marked for removal", () => {
    const collision = buildEditTableColumnsPlan(
      table,
      table.columns.map((column) => ({
        originalName: column.name,
        ...column,
        name: column.name === "email" ? "id" : column.name,
        remove: false,
      })),
      "postgres",
    );
    expect(collision.errors).toContain("Duplicate column name: id");

    const removeRename = buildEditTableColumnsPlan(
      table,
      table.columns.map((column) => ({
        originalName: column.name,
        ...column,
        name: column.name === "legacy" ? "archived" : column.name,
        remove: column.name === "legacy",
      })),
      "postgres",
    );
    expect(removeRename.errors).toContain(
      "Cannot rename and remove the same column: legacy",
    );
  });
});
