import { describe, expect, it } from "vitest";
import { buildAlterIndexPlan } from "./ddlForms";

const table = {
  schema: "public",
  name: "orders",
  columns: [
    { name: "customer_id", type: "integer", nullable: false },
    { name: "created_at", type: "timestamp", nullable: false },
    { name: "status", type: "text", nullable: false },
  ],
  indexes: [
    {
      name: "orders_customer_idx",
      columns: ["customer_id"],
      unique: false,
      primary: false,
      type: "btree",
    },
    {
      name: "orders_pkey",
      columns: ["customer_id"],
      unique: true,
      primary: true,
      type: "btree",
    },
  ],
};

describe("buildAlterIndexPlan", () => {
  it("generates a PostgreSQL drop/create plan for changed columns", () => {
    const plan = buildAlterIndexPlan(
      table,
      "orders_customer_idx",
      { columns: ["status", "created_at"], unique: true },
      "postgres",
    );
    expect(plan.errors).toEqual([]);
    expect(plan.warnings).toEqual([
      "This operation drops and recreates the selected index",
    ]);
    expect(plan.statements).toEqual([
      'DROP INDEX "public"."orders_customer_idx";',
      'CREATE UNIQUE INDEX "public"."orders_customer_idx" ON "public"."orders" ("status", "created_at");',
    ]);
    expect(plan.sql).toBe(plan.statements.join("\n"));
  });

  it("uses one ALTER TABLE statement for MySQL", () => {
    const plan = buildAlterIndexPlan(
      table,
      "orders_customer_idx",
      { columns: ["customer_id", "status"], unique: false },
      "mysql",
    );
    expect(plan.statements).toEqual([
      "ALTER TABLE `public`.`orders` DROP INDEX `orders_customer_idx`, ADD INDEX `orders_customer_idx` (`customer_id`, `status`);",
    ]);
  });

  it("rejects invalid changes and protects primary or SQLite indexes", () => {
    const invalid = buildAlterIndexPlan(
      table,
      "orders_customer_idx",
      { columns: ["status", "STATUS"], unique: true },
      "postgres",
    );
    expect(invalid.errors).toEqual(
      expect.arrayContaining([
        "Duplicate index column: STATUS",
        "Column does not exist: STATUS",
      ]),
    );
    const primary = buildAlterIndexPlan(
      table,
      "orders_pkey",
      { columns: ["status"], unique: false },
      "postgres",
    );
    expect(primary.manual[0]).toContain("Primary index cannot be altered");
    const sqlite = buildAlterIndexPlan(
      table,
      "orders_customer_idx",
      { columns: ["status"], unique: false },
      "sqlite",
    );
    expect(sqlite.manual[0]).toContain(
      "SQLite index alteration requires manual review",
    );
  });

  it("rejects a no-op change and missing indexes", () => {
    const noOp = buildAlterIndexPlan(
      table,
      "orders_customer_idx",
      { columns: ["customer_id"], unique: false },
      "oracle",
    );
    expect(noOp.errors).toContain(
      "Change at least one index property before continuing",
    );
    const missing = buildAlterIndexPlan(
      table,
      "missing",
      { columns: ["status"], unique: false },
      "sqlserver",
    );
    expect(missing.errors).toContain("Index does not exist: missing");
  });
});
