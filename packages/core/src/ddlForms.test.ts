import { describe, expect, it } from "vitest";
import { buildCreateTablePlan } from "./ddlForms";

describe("buildCreateTablePlan", () => {
  it("builds a quoted single-primary-key table for each dialect", () => {
    const input = {
      schema: "public",
      name: "audit log",
      columns: [
        { name: "id", type: "integer", nullable: false, primaryKey: true },
        { name: "note", type: "text", nullable: true, primaryKey: false },
      ],
    };

    expect(buildCreateTablePlan(input, "postgres").sql).toContain(
      'CREATE TABLE "public"."audit log"',
    );
    expect(buildCreateTablePlan(input, "mysql").sql).toContain(
      "CREATE TABLE `public`.`audit log`",
    );
    expect(buildCreateTablePlan(input, "sqlite").sql).toContain(
      '"id" integer NOT NULL PRIMARY KEY',
    );
  });

  it("supports composite keys and rejects unsafe or duplicate input", () => {
    const plan = buildCreateTablePlan(
      {
        schema: "public",
        name: "events",
        columns: [
          {
            name: "tenant_id",
            type: "bigint",
            nullable: false,
            primaryKey: true,
          },
          {
            name: "event_id",
            type: "bigint",
            nullable: false,
            primaryKey: true,
          },
        ],
      },
      "postgres",
    );
    expect(plan.sql).toContain('PRIMARY KEY ("tenant_id", "event_id")');

    const invalid = buildCreateTablePlan(
      {
        schema: "public",
        name: "events",
        columns: [
          {
            name: "id",
            type: "text) DROP TABLE users (",
            nullable: true,
            primaryKey: false,
          },
          { name: "ID", type: "text", nullable: true, primaryKey: false },
        ],
      },
      "postgres",
    );
    expect(invalid.sql).toBe("");
    expect(invalid.errors).toEqual(
      expect.arrayContaining([
        "Column id type contains unsupported characters",
        "Duplicate column name: ID",
      ]),
    );
  });
});
