import { describe, expect, it } from "vitest";
import { buildTableRowInsertPlan } from "./tableRowInsert";

const table = {
  schema: "public",
  name: "users",
  columns: [
    { name: "id", type: "integer", nullable: false, primaryKey: true },
    { name: "name", type: "text", nullable: false },
    { name: "active", type: "boolean", nullable: false },
    { name: "note", type: "text", nullable: true },
  ],
};

describe("buildTableRowInsertPlan", () => {
  it("orders supplied values by table metadata and preserves omitted defaults", () => {
    const plan = buildTableRowInsertPlan(
      table,
      [
        { columnName: "active", value: true },
        { columnName: "name", value: "Ada" },
      ],
      "postgres",
    );

    expect(plan.errors).toEqual([]);
    expect(plan.statement).toBe(
      'INSERT INTO "public"."users" ("name", "active") VALUES (\'Ada\', TRUE);',
    );
    expect(plan.sql).toBe(plan.statement);
    expect(plan.warnings).toEqual([
      "Omitted columns use database defaults: id, note",
    ]);
  });

  it("supports an explicit nullable NULL and dialect-specific DEFAULT VALUES", () => {
    const nullable = buildTableRowInsertPlan(
      table,
      [
        { columnName: "name", value: "Grace" },
        { columnName: "active", value: true },
        { columnName: "note", value: null },
      ],
      "sqlite",
    );
    expect(nullable.errors).toEqual([]);
    expect(nullable.statement).toContain(
      "\"note\") VALUES ('Grace', TRUE, NULL)",
    );

    const defaults = buildTableRowInsertPlan(table, [], "mysql");
    expect(defaults.errors).toEqual([]);
    expect(defaults.statement).toBe(
      "INSERT INTO `public`.`users` () VALUES ();",
    );
  });

  it("requires explicit Oracle values when no column is selected", () => {
    const plan = buildTableRowInsertPlan(table, [], "oracle");

    expect(plan.statement).toBe("");
    expect(plan.errors).toEqual([
      "Oracle default-only inserts require an explicit column default expression",
    ]);
  });

  it("rejects duplicate, unknown, and non-nullable NULL values", () => {
    const plan = buildTableRowInsertPlan(
      table,
      [
        { columnName: "name", value: null },
        { columnName: "name", value: "duplicate" },
        { columnName: "missing", value: "nope" },
      ],
      "postgres",
    );

    expect(plan.statement).toBe("");
    expect(plan.errors).toEqual([
      "Column cannot be NULL: name",
      "Column selected more than once: name",
      "Column does not exist: missing",
    ]);
  });
});
