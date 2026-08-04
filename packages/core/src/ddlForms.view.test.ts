import { describe, expect, it } from "vitest";
import {
  buildAlterViewPlan,
  buildCreateViewPlan,
  buildDropViewPlan,
} from "./ddlForms";

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

  it("replaces views without dropping them on PostgreSQL and MySQL", () => {
    const plan = buildAlterViewPlan(
      {
        schema: "reporting",
        name: "paid_orders",
        definition: "SELECT id FROM public.orders WHERE status = 'settled'",
      },
      [{ schema: "reporting", name: "paid_orders" }],
      "postgres",
    );
    expect(plan.errors).toEqual([]);
    expect(plan.warnings).toEqual([]);
    expect(plan.statements).toEqual([
      'CREATE OR REPLACE VIEW "reporting"."paid_orders" AS SELECT id FROM public.orders WHERE status = \'settled\';',
    ]);
  });

  it("marks SQLite view replacement as a drop/create review", () => {
    const plan = buildAlterViewPlan(
      {
        schema: "main",
        name: "paid_orders",
        definition: "SELECT id FROM orders",
      },
      [{ schema: "main", name: "paid_orders" }],
      "sqlite",
    );
    expect(plan.statements).toEqual([
      'DROP VIEW "main"."paid_orders";',
      'CREATE VIEW "main"."paid_orders" AS SELECT id FROM orders;',
    ]);
    expect(plan.warnings[0]).toContain("SQLite replaces a view");
  });

  it("warns before dropping a view with known dependents", () => {
    const plan = buildDropViewPlan(
      "public",
      "paid_orders",
      [{ schema: "public", name: "paid_orders" }],
      ["public.monthly_revenue"],
      "postgres",
    );
    expect(plan.errors).toEqual([]);
    expect(plan.sql).toBe('DROP VIEW "public"."paid_orders";');
    expect(plan.warnings[0]).toContain("public.monthly_revenue");
  });
});
