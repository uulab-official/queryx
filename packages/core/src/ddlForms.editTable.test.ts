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
});
