import { describe, expect, it } from "vitest";
import { buildEditDatabaseDefinitionPlan } from "./ddlForms";

describe("buildEditDatabaseDefinitionPlan", () => {
  it("accepts a routine definition with a procedural body", () => {
    const definition =
      "CREATE OR REPLACE FUNCTION public.audit_orders() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN INSERT INTO audit_log VALUES (NEW.id); RETURN NEW; END $$";
    const plan = buildEditDatabaseDefinitionPlan(
      { kind: "routine", definition },
      "postgres",
    );
    expect(plan.errors).toEqual([]);
    expect(plan.manual).toEqual([]);
    expect(plan.statements).toEqual([definition]);
    expect(plan.sql).toBe(definition);
  });

  it("rejects missing and non-DDL definitions", () => {
    expect(
      buildEditDatabaseDefinitionPlan(
        { kind: "trigger", definition: "" },
        "postgres",
      ).errors,
    ).toContain("Definition is required");
    expect(
      buildEditDatabaseDefinitionPlan(
        { kind: "trigger", definition: "DROP TRIGGER audit_orders" },
        "postgres",
      ).errors,
    ).toContain("Definition must start with CREATE or ALTER");
  });

  it("rejects a second top-level DDL statement", () => {
    const plan = buildEditDatabaseDefinitionPlan(
      {
        kind: "trigger",
        definition:
          "CREATE TRIGGER audit_orders AFTER INSERT ON orders BEGIN SELECT 1; END; DROP TABLE orders",
      },
      "mysql",
    );
    expect(plan.errors).toContain(
      "Definition cannot contain multiple top-level statements",
    );
  });

  it("requires manual review for SQLite definition replacement", () => {
    const plan = buildEditDatabaseDefinitionPlan(
      {
        kind: "trigger",
        definition:
          "CREATE TRIGGER audit_orders AFTER INSERT ON orders BEGIN SELECT 1; END",
      },
      "sqlite",
    );
    expect(plan.errors).toEqual([]);
    expect(plan.statements).toEqual([]);
    expect(plan.manual[0]).toContain(
      "SQLite definition replacement requires manual review",
    );
  });
});
