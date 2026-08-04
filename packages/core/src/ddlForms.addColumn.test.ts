import { describe, expect, it } from "vitest";
import { buildAddColumnPlan } from "./ddlForms";

const table = {
  schema: "public",
  name: "users",
  columns: [{ name: "id", type: "integer", nullable: false, primaryKey: true }],
};

describe("buildAddColumnPlan", () => {
  it("generates dialect-aware ALTER TABLE SQL", () => {
    expect(
      buildAddColumnPlan(
        table,
        {
          name: "created_at",
          type: "timestamp with time zone",
          nullable: false,
        },
        "postgres",
      ).sql,
    ).toBe(
      'ALTER TABLE "public"."users" ADD COLUMN "created_at" timestamp with time zone NOT NULL;',
    );
    expect(
      buildAddColumnPlan(
        table,
        { name: "display_name", type: "varchar(120)", nullable: true },
        "mysql",
      ).sql,
    ).toContain(
      "ALTER TABLE `public`.`users` ADD COLUMN `display_name` varchar(120);",
    );
  });

  it("rejects duplicate names and unsafe type fragments", () => {
    const plan = buildAddColumnPlan(
      table,
      { name: "ID", type: "text) DROP TABLE users (", nullable: true },
      "sqlite",
    );
    expect(plan.sql).toBe("");
    expect(plan.errors).toEqual(
      expect.arrayContaining([
        "Column already exists: ID",
        "Column ID type contains unsupported characters",
      ]),
    );
  });
});
