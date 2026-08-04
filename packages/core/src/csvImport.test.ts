import { describe, expect, it } from "vitest";
import {
  buildCsvImportPlan,
  defaultCsvImportMappings,
  parseCsv,
} from "./csvImport";

const table = {
  schema: "public",
  name: "users",
  columns: [
    { name: "id", type: "integer", nullable: false },
    { name: "email", type: "text", nullable: false },
    { name: "active", type: "boolean", nullable: false },
    { name: "profile", type: "jsonb", nullable: true },
  ],
};

describe("parseCsv", () => {
  it("handles BOM, quoted commas, escaped quotes, and multiline cells", () => {
    const parsed = parseCsv(
      '\uFEFFid,email,note\r\n1,"ada@example.com","hello, ""world""\nnext"\r\n',
    );

    expect(parsed.errors).toEqual([]);
    expect(parsed.headers).toEqual(["id", "email", "note"]);
    expect(parsed.rows).toEqual([
      {
        line: 2,
        values: ["1", "ada@example.com", 'hello, "world"\nnext'],
      },
    ]);
  });

  it("reports duplicate headers and inconsistent row widths", () => {
    const parsed = parseCsv("id,id\n1\n2,3,4\n");

    expect(parsed.errors).toEqual([
      "Header 2: duplicate column id",
      "Line 2: expected 2 columns, got 1",
      "Line 3: expected 2 columns, got 3",
    ]);
  });
});

describe("buildCsvImportPlan", () => {
  it("maps target columns and validates typed values before generating inserts", () => {
    const parsed = parseCsv(
      'id,email,active,profile\n1,ada@example.com,true,"{""role"":""admin""}"\n',
    );
    const plan = buildCsvImportPlan(
      table,
      parsed,
      defaultCsvImportMappings(parsed.headers, table.columns),
      "postgres",
    );

    expect(plan.errors).toEqual([]);
    expect(plan.rowCount).toBe(1);
    expect(plan.statements[0]).toBe(
      `INSERT INTO "public"."users" ("id", "email", "active", "profile") VALUES (1, 'ada@example.com', TRUE, '{"role":"admin"}');`,
    );
  });

  it("rejects invalid typed values without producing a partial statement", () => {
    const parsed = parseCsv(
      "id,email,active,profile\nnot-an-int,a@example.com,maybe,{}\n",
    );
    const plan = buildCsvImportPlan(
      table,
      parsed,
      defaultCsvImportMappings(parsed.headers, table.columns),
      "sqlite",
    );

    expect(plan.statements).toEqual([]);
    expect(plan.errors).toEqual([
      "Line 2, id: invalid integer value not-an-int",
      "Line 2, active: invalid boolean value maybe",
    ]);
  });
});
