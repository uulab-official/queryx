import { describe, expect, it } from "vitest";
import { buildCreateTableConstraintPlan } from "./ddlForms";

const table = {
  schema: "public",
  name: "users",
  columns: [
    { name: "id", type: "integer", nullable: false, primaryKey: true },
    { name: "email", type: "text", nullable: false, primaryKey: false },
    { name: "status", type: "text", nullable: true, primaryKey: false },
  ],
  indexes: [],
};

describe("buildCreateTableConstraintPlan", () => {
  it("builds a composite PostgreSQL UNIQUE constraint", () => {
    const plan = buildCreateTableConstraintPlan(
      table,
      {
        kind: "unique",
        name: "users_email_status_key",
        columns: ["email", "status"],
        expression: "",
      },
      "postgres",
    );

    expect(plan.errors).toEqual([]);
    expect(plan.manual).toEqual([]);
    expect(plan.statements).toEqual([
      'ALTER TABLE "public"."users" ADD CONSTRAINT "users_email_status_key" UNIQUE ("email", "status");',
    ]);
  });

  it("builds dialect-quoted CHECK constraints", () => {
    const plan = buildCreateTableConstraintPlan(
      { ...table, schema: "dbo" },
      {
        kind: "check",
        name: "users_status_check",
        columns: [],
        expression: "status IS NULL OR status <> 'deleted'",
      },
      "sqlserver",
    );

    expect(plan.errors).toEqual([]);
    expect(plan.sql).toBe(
      "ALTER TABLE [dbo].[users] ADD CONSTRAINT [users_status_check] CHECK (status IS NULL OR status <> 'deleted');",
    );
  });

  it("blocks unsafe expressions and SQLite automatic application", () => {
    const unsafe = buildCreateTableConstraintPlan(
      table,
      {
        kind: "check",
        name: "unsafe",
        columns: [],
        expression: "status = 'ok'; DROP TABLE users",
      },
      "postgres",
    );
    expect(unsafe.errors).toContain(
      "CHECK expression cannot contain comments or statement delimiters",
    );

    const sqlite = buildCreateTableConstraintPlan(
      table,
      {
        kind: "unique",
        name: "users_email_key",
        columns: ["email"],
        expression: "",
      },
      "sqlite",
    );
    expect(sqlite.statements).toEqual([]);
    expect(sqlite.manual).toEqual([
      "SQLite table constraints require a manual table rebuild: UNIQUE users_email_key",
    ]);
  });

  it("rejects missing or duplicate columns", () => {
    const plan = buildCreateTableConstraintPlan(
      {
        ...table,
        indexes: [
          {
            name: "users_email_unique",
            columns: ["email"],
            unique: true,
            primary: false,
            type: "btree",
          },
        ],
      },
      {
        kind: "unique",
        name: "users_email_key",
        columns: ["email", "email", "missing"],
        expression: "",
      },
      "oracle",
    );

    expect(plan.errors).toEqual(
      expect.arrayContaining([
        "Duplicate constraint column: email",
        "Column does not exist: missing",
      ]),
    );
    expect(plan.warnings).toEqual([]);
  });

  it("warns when an equivalent unique index already exists", () => {
    const plan = buildCreateTableConstraintPlan(
      {
        ...table,
        indexes: [
          {
            name: "users_email_unique",
            columns: ["email"],
            unique: true,
            primary: false,
            type: "btree",
          },
        ],
      },
      {
        kind: "unique",
        name: "users_email_key",
        columns: ["email"],
        expression: "",
      },
      "oracle",
    );

    expect(plan.errors).toEqual([]);
    expect(plan.warnings).toEqual([
      "A unique index already covers the same column order",
    ]);
  });
});
