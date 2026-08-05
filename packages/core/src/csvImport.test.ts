import { describe, expect, it } from "vitest";
import {
  buildCsvImportPlan,
  defaultCsvImportMappings,
  parseCsv,
  parseJsonRows,
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
  indexes: [
    {
      name: "users_pkey",
      columns: ["id"],
      unique: true,
      primary: true,
      type: "btree",
    },
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

  it("accepts JSON arrays and newline-delimited JSON objects", () => {
    const array = parseJsonRows(
      '[{"id":1,"email":"a@example.com"},{"id":2,"active":true}]',
    );
    expect(array.errors).toEqual([]);
    expect(array.headers).toEqual(["id", "email", "active"]);
    expect(array.rows[1]?.values).toEqual(["2", "", "true"]);

    const ndjson = parseJsonRows('{"id":1}\n{"id":2}\n');
    expect(ndjson.errors).toEqual([]);
    expect(ndjson.rows).toHaveLength(2);
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

  it("generates dialect-specific ignore-conflict statements", () => {
    const parsed = parseCsv("id,email\n1,a@example.com\n");
    const mappings = defaultCsvImportMappings(parsed.headers, table.columns);

    expect(
      buildCsvImportPlan(table, parsed, mappings, "postgres", "ignore")
        .statements[0],
    ).toContain("ON CONFLICT DO NOTHING");
    expect(
      buildCsvImportPlan(table, parsed, mappings, "mysql", "ignore")
        .statements[0],
    ).toContain("INSERT IGNORE INTO");
    expect(
      buildCsvImportPlan(table, parsed, mappings, "sqlite", "ignore")
        .statements[0],
    ).toContain("INSERT OR IGNORE INTO");
  });

  it("generates one transactional multi-row upsert with dialect-specific conflict syntax", () => {
    const parsed = parseCsv("id,email\n1,new@example.com\n2,two@example.com\n");
    const mappings = defaultCsvImportMappings(parsed.headers, table.columns);
    const postgres = buildCsvImportPlan(
      table,
      parsed,
      mappings,
      "postgres",
      "upsert",
      ["id"],
    );
    expect(postgres.errors).toEqual([]);
    expect(postgres.warnings).toEqual([]);
    expect(postgres.statements).toHaveLength(1);
    expect(postgres.statements[0]).toContain(
      'VALUES (1, \'new@example.com\'), (2, \'two@example.com\') ON CONFLICT ("id") DO UPDATE SET "email" = excluded."email";',
    );

    const mysql = buildCsvImportPlan(
      table,
      parsed,
      mappings,
      "mysql",
      "upsert",
      ["id"],
    );
    expect(mysql.statements[0]).toContain(
      "ON DUPLICATE KEY UPDATE `email` = VALUES(`email`);",
    );
  });

  it("requires mapped conflict keys and warns when no unique index is known", () => {
    const parsed = parseCsv("id,email\n1,a@example.com\n");
    const mappings = defaultCsvImportMappings(parsed.headers, table.columns);
    const plan = buildCsvImportPlan(
      { ...table, indexes: [] },
      parsed,
      mappings,
      "sqlite",
      "upsert",
      ["missing"],
    );
    expect(plan.statements).toEqual([]);
    expect(plan.errors).toEqual(
      expect.arrayContaining([
        "Conflict key column does not exist: missing",
        "Conflict key column must be mapped and included: missing",
      ]),
    );
    const warningPlan = buildCsvImportPlan(
      { ...table, indexes: [] },
      parsed,
      mappings,
      "sqlite",
      "upsert",
      ["id"],
    );
    expect(warningPlan.warnings[0]).toContain("do not match");
  });
});
