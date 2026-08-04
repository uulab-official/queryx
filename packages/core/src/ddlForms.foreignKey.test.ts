import { describe, expect, it } from "vitest";
import { buildAddForeignKeyPlan, buildDropForeignKeyPlan } from "./ddlForms";

const orders = {
  schema: "public",
  name: "orders",
  columns: [
    { name: "id", type: "integer", nullable: false, primaryKey: true },
    { name: "customer_id", type: "integer", nullable: false },
  ],
  foreignKeys: [],
};

const customers = {
  schema: "public",
  name: "customers",
  columns: [{ name: "id", type: "integer", nullable: false, primaryKey: true }],
};

describe("foreign-key object forms", () => {
  it("generates a dialect-aware composite foreign-key addition", () => {
    const plan = buildAddForeignKeyPlan(
      orders,
      customers,
      {
        name: "orders_customer_fk",
        columns: ["customer_id"],
        referencedColumns: ["id"],
        referencedSchema: "public",
        referencedTable: "customers",
        onUpdate: "CASCADE",
        onDelete: "RESTRICT",
      },
      "postgres",
    );
    expect(plan.errors).toEqual([]);
    expect(plan.manual).toEqual([]);
    expect(plan.sql).toBe(
      'ALTER TABLE "public"."orders" ADD CONSTRAINT "orders_customer_fk" FOREIGN KEY ("customer_id") REFERENCES "public"."customers" ("id") ON UPDATE CASCADE ON DELETE RESTRICT;',
    );
  });

  it("rejects invalid actions and marks SQLite additions for rebuild review", () => {
    const invalid = buildAddForeignKeyPlan(
      orders,
      customers,
      {
        name: "orders_customer_fk",
        columns: ["customer_id"],
        referencedColumns: ["id"],
        referencedSchema: "public",
        referencedTable: "customers",
        onUpdate: "EXECUTE",
        onDelete: "CASCADE",
      },
      "postgres",
    );
    expect(invalid.errors[0]).toContain("ON UPDATE");

    const sqlite = buildAddForeignKeyPlan(
      orders,
      customers,
      {
        name: "orders_customer_fk",
        columns: ["customer_id"],
        referencedColumns: ["id"],
        referencedSchema: "public",
        referencedTable: "customers",
        onUpdate: "NO ACTION",
        onDelete: "NO ACTION",
      },
      "sqlite",
    );
    expect(sqlite.manual).toEqual([
      "SQLite foreign-key additions require a manual table rebuild",
    ]);
  });

  it("drops named foreign keys for PostgreSQL and protects unnamed SQLite keys", () => {
    const foreignKey = {
      id: "orders_customer_fk",
      name: "orders_customer_fk",
      columns: [
        { ordinal: 0, sourceColumn: "customer_id", referencedColumn: "id" },
      ],
      referencedRelation: { schema: "public", name: "customers" },
      onUpdate: "CASCADE",
      onDelete: "RESTRICT",
      match: null,
      deferrable: null,
      initiallyDeferred: null,
    };
    const plan = buildDropForeignKeyPlan(
      orders,
      [foreignKey],
      foreignKey.id,
      "postgres",
    );
    expect(plan.errors).toEqual([]);
    expect(plan.sql).toBe(
      'ALTER TABLE "public"."orders" DROP CONSTRAINT "orders_customer_fk";',
    );

    const unnamed = buildDropForeignKeyPlan(
      orders,
      [{ ...foreignKey, id: "unnamed", name: null }],
      "unnamed",
      "sqlite",
    );
    expect(unnamed.sql).toBe("");
    expect(unnamed.manual[0]).toContain("no physical name");
  });
});
