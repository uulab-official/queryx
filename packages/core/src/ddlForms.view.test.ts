import { describe, expect, it } from "vitest";
import { buildCreateViewPlan } from "./ddlForms";

describe("buildCreateViewPlan", () => {
  it("generates a quoted read-only view definition", () => {
    const plan = buildCreateViewPlan(
      {
        schema: "reporting",
        name: "paid_orders",
        definition:
          "SELECT id, total_amount FROM public.orders WHERE status = 'paid';",
      },
      [],
      "postgres",
    );
    expect(plan.errors).toEqual([]);
    expect(plan.sql).toBe(
      `CREATE VIEW "reporting"."paid_orders" AS SELECT id, total_amount FROM public.orders WHERE status = 'paid';`,
    );
  });

  it("rejects duplicate, mutating, and multi-statement definitions", () => {
    const plan = buildCreateViewPlan(
      {
        schema: "public",
        name: "users_view",
        definition: "SELECT id FROM users; DROP TABLE users",
      },
      [{ schema: "public", name: "users_view" }],
      "sqlite",
    );
    expect(plan.sql).toBe("");
    expect(plan.errors).toEqual(
      expect.arrayContaining([
        "View definition cannot contain SQL delimiters or comments",
        "View already exists: public.users_view",
      ]),
    );
  });

  it("allows mutating words and delimiters inside quoted values", () => {
    const plan = buildCreateViewPlan(
      {
        schema: "reporting",
        name: "status_labels",
        definition: "SELECT 'update; -- keep this text' AS label",
      },
      [],
      "mysql",
    );
    expect(plan.errors).toEqual([]);
    expect(plan.sql).toBe(
      "CREATE VIEW `reporting`.`status_labels` AS SELECT 'update; -- keep this text' AS label;",
    );
  });
});
