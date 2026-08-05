import { describe, expect, it } from "vitest";
import { buildTableBrowsePlan } from "./tableBrowse";

const table = {
  schema: "public",
  name: "users",
  columns: [
    { name: "id", type: "integer", nullable: false, primaryKey: true },
    { name: "email", type: "text", nullable: false },
    { name: "display_name", type: "text", nullable: true },
    { name: "created_at", type: "timestamp", nullable: false },
  ],
};

describe("buildTableBrowsePlan", () => {
  it("builds a PostgreSQL filtered page with deterministic sort tie-breakers", () => {
    const plan = buildTableBrowsePlan(
      table,
      "postgres",
      100,
      200,
      "ada",
      "email",
      "desc",
    );

    expect(plan.errors).toEqual([]);
    expect(plan.warnings).toEqual([]);
    expect(plan.sql).toContain(
      `FROM "public"."users"\nWHERE (LOWER(CAST("id" AS TEXT)) LIKE LOWER('%ada%') ESCAPE '!' OR LOWER(CAST("email" AS TEXT)) LIKE LOWER('%ada%') ESCAPE '!' OR LOWER(CAST("display_name" AS TEXT)) LIKE LOWER('%ada%') ESCAPE '!' OR LOWER(CAST("created_at" AS TEXT)) LIKE LOWER('%ada%') ESCAPE '!')`,
    );
    expect(plan.sql).toContain('ORDER BY "email" DESC, "id" ASC');
    expect(plan.sql).toMatch(/LIMIT 100 OFFSET 200;$/);
  });

  it("quotes MySQL identifiers and treats filter wildcards as literal text", () => {
    const plan = buildTableBrowsePlan(
      table,
      "mysql",
      50,
      0,
      "50%_off!",
      null,
      "asc",
    );

    expect(plan.errors).toEqual([]);
    expect(plan.sql).toContain("CAST(`id` AS CHAR)");
    expect(plan.sql).toContain("LIKE LOWER('%50!%!_off!!%') ESCAPE '!'");
    expect(plan.sql).toContain("ORDER BY `id` ASC");
  });

  it("rejects unknown sort columns and warns when pagination has no primary key", () => {
    const plan = buildTableBrowsePlan(
      {
        ...table,
        columns: table.columns.map((column) => ({
          ...column,
          primaryKey: false,
        })),
      },
      "sqlite",
      100,
      0,
      "",
      "missing",
      "asc",
    );

    expect(plan.errors).toContain("Sort column does not exist: missing");
    expect(plan.warnings).toContain(
      "Table has no primary key; page order may change between loads",
    );
    expect(plan.sql).toBe("");
  });

  it("keeps quote-breaking filter text inside one SQL literal", () => {
    const plan = buildTableBrowsePlan(
      table,
      "sqlite",
      100,
      0,
      "x'); DROP TABLE users;--",
    );

    expect(plan.errors).toEqual([]);
    expect(plan.sql).toMatch(/WHERE \(.*x'\'\); DROP TABLE users;--.*\)/s);
    expect(plan.sql).toMatch(/LIMIT 100 OFFSET 0;$/);
  });

  it("escapes backslashes according to the active string-literal dialect", () => {
    const postgresPlan = buildTableBrowsePlan(
      table,
      "postgres",
      100,
      0,
      "C:\\temp\\users",
    );
    const mysqlPlan = buildTableBrowsePlan(
      table,
      "mysql",
      100,
      0,
      "C:\\temp\\users",
    );

    expect(postgresPlan.sql).toContain("LIKE LOWER(E'%C:\\\\temp\\\\users%')");
    expect(mysqlPlan.sql).toContain("LIKE LOWER('%C:\\\\temp\\\\users%')");
  });
});
