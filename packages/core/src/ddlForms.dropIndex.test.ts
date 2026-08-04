import { describe, expect, it } from "vitest";
import { buildDropIndexPlan } from "./ddlForms";

const table = {
  schema: "public",
  name: "users",
  indexes: [
    {
      name: "users_pkey",
      columns: ["id"],
      unique: true,
      primary: true,
      type: "btree",
    },
    {
      name: "users_email_idx",
      columns: ["email"],
      unique: false,
      primary: false,
      type: "btree",
    },
  ],
};

describe("buildDropIndexPlan", () => {
  it("generates driver-aware drop SQL for regular indexes", () => {
    expect(buildDropIndexPlan(table, "users_email_idx", "postgres").sql).toBe(
      'DROP INDEX "public"."users_email_idx";',
    );
    expect(buildDropIndexPlan(table, "users_email_idx", "mysql").sql).toBe(
      "DROP INDEX `users_email_idx` ON `public`.`users`;",
    );
  });

  it("blocks primary and unknown indexes", () => {
    const primary = buildDropIndexPlan(table, "users_pkey", "sqlite");
    expect(primary.manual).toEqual([
      "Primary index cannot be removed from the index form: users_pkey",
    ]);
    expect(primary.sql).toContain("MANUAL REVIEW REQUIRED");
    expect(buildDropIndexPlan(table, "missing", "postgres").errors).toEqual([
      "Index does not exist: missing",
    ]);
  });
});
