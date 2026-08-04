import { describe, expect, it } from "vitest";
import { buildCreateIndexPlan } from "./ddlForms";

const table = {
  schema: "public",
  name: "users",
  columns: [
    { name: "id", type: "integer", nullable: false, primaryKey: true },
    { name: "email", type: "text", nullable: false },
    { name: "created_at", type: "timestamp", nullable: false },
  ],
  indexes: [
    {
      name: "users_pkey",
      columns: ["id"],
      unique: true,
      primary: true,
      type: "btree",
    },
  ],
};

describe("buildCreateIndexPlan", () => {
  it("generates quoted unique multi-column index SQL", () => {
    const plan = buildCreateIndexPlan(
      table,
      {
        name: "users_email_created_idx",
        columns: ["email", "created_at"],
        unique: true,
      },
      "postgres",
    );
    expect(plan.errors).toEqual([]);
    expect(plan.sql).toBe(
      'CREATE UNIQUE INDEX "public"."users_email_created_idx" ON "public"."users" ("email", "created_at");',
    );
  });

  it("rejects missing/duplicate columns and reports redundant indexes", () => {
    const invalid = buildCreateIndexPlan(
      table,
      { name: "idx", columns: ["email", "EMAIL", "missing"], unique: false },
      "sqlite",
    );
    expect(invalid.sql).toBe("");
    expect(invalid.errors).toEqual(
      expect.arrayContaining([
        "Duplicate index column: EMAIL",
        "Column does not exist: missing",
      ]),
    );
    const warning = buildCreateIndexPlan(
      {
        ...table,
        indexes: [
          ...table.indexes,
          {
            name: "users_email_idx",
            columns: ["email"],
            unique: false,
            primary: false,
            type: "btree",
          },
        ],
      },
      { name: "users_email_idx_2", columns: ["email"], unique: false },
      "mysql",
    );
    expect(warning.warnings).toEqual([
      "An index with the same column order already exists",
    ]);
  });
});
