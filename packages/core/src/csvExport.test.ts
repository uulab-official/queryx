import { describe, expect, it } from "vitest";
import {
  serializeRowsToCsv,
  serializeRowsToJson,
  serializeRowsToSqlInsert,
  serializeRowsToSqlUpdate,
} from "./csvExport";

const columns = [
  { name: "id" },
  { name: "name" },
  { name: "notes" },
  { name: "metadata" },
];

describe("serializeRowsToCsv", () => {
  it("preserves column order and escapes CSV control characters", () => {
    const csv = serializeRowsToCsv(
      columns,
      [
        {
          id: 7,
          name: 'Ada, "Admin"',
          notes: "line one\nline two",
          metadata: { active: true },
        },
      ],
      { includeBom: false },
    );

    expect(csv).toBe(
      'id,name,notes,metadata\r\n7,"Ada, ""Admin""","line one\nline two","{""active"":true}"\r\n',
    );
  });

  it("writes nullish values as empty cells and includes an Excel BOM", () => {
    const csv = serializeRowsToCsv(
      [{ name: "nullable" }, { name: "missing" }],
      [{ nullable: null }],
    );

    expect(csv).toBe("\uFEFFnullable,missing\r\n,\r\n");
  });

  it("protects spreadsheet formula prefixes by default", () => {
    const csv = serializeRowsToCsv(
      [{ name: "payload" }],
      [{ payload: '=HYPERLINK("https://example.invalid")' }],
      { includeBom: false },
    );

    expect(csv).toContain("'=");
    expect(csv).not.toContain("\r\n=HYPERLINK");
  });

  it("can disable formula protection for explicit raw exports", () => {
    const csv = serializeRowsToCsv([{ name: "value" }], [{ value: "+1" }], {
      includeBom: false,
      protectFormulas: false,
    });

    expect(csv).toBe("value\r\n+1\r\n");
  });
});

describe("serializeRowsToJson", () => {
  it("preserves column order and makes non-JSON primitives portable", () => {
    const json = serializeRowsToJson(
      [{ name: "id" }, { name: "created_at" }, { name: "payload" }],
      [
        {
          id: 9n,
          created_at: new Date("2026-08-04T00:00:00.000Z"),
          payload: { ok: true },
        },
      ],
    );

    expect(json).toBe(
      '[\n  {\n    "id": "9",\n    "created_at": "2026-08-04T00:00:00.000Z",\n    "payload": {\n      "ok": true\n    }\n  }\n]\n',
    );
  });
});

describe("serializeRowsToSqlInsert", () => {
  it("quotes qualified identifiers and values for safe replay", () => {
    const sql = serializeRowsToSqlInsert(
      [{ name: "id" }, { name: "display name" }, { name: "active" }],
      [{ id: 1, "display name": "O'Brien", active: true }],
      { tableName: "public.users", dialect: "postgres" },
    );

    expect(sql).toBe(
      'BEGIN;\nINSERT INTO "public"."users" ("id", "display name", "active") VALUES (1, \'O\'\'Brien\', TRUE);\nCOMMIT;\n',
    );
  });

  it("supports MySQL identifier quoting and empty result sets", () => {
    const sql = serializeRowsToSqlInsert([{ name: "id" }], [], {
      tableName: "archive.events",
      dialect: "mysql",
      includeTransaction: false,
    });

    expect(sql).toBe("");
  });
});

describe("serializeRowsToSqlUpdate", () => {
  it("generates a keyed transaction with changed columns only", () => {
    const sql = serializeRowsToSqlUpdate(
      [{ name: "id" }, { name: "status" }, { name: "note" }],
      [
        {
          originalRow: { id: 7, status: "pending", note: null },
          changes: { status: "paid", note: "reviewer's note" },
        },
      ],
      { tableName: "public.orders", keyColumns: ["id"], dialect: "postgres" },
    );

    expect(sql).toBe(
      'BEGIN;\nUPDATE "public"."orders" SET "status" = \'paid\', "note" = \'reviewer\'\'s note\' WHERE "id" = 7 AND "status" = \'pending\' AND "note" IS NULL;\nCOMMIT;\n',
    );
  });

  it("rejects a row whose primary key is null", () => {
    expect(() =>
      serializeRowsToSqlUpdate(
        [{ name: "id" }, { name: "status" }],
        [
          {
            originalRow: { id: null, status: "pending" },
            changes: { status: "paid" },
          },
        ],
        { tableName: "orders", keyColumns: ["id"] },
      ),
    ).toThrow("NULL key value");
  });

  it("can disable original-value predicates for generated bulk SQL", () => {
    const sql = serializeRowsToSqlUpdate(
      [{ name: "id" }, { name: "status" }],
      [
        {
          originalRow: { id: 7, status: "pending" },
          changes: { status: "paid" },
        },
      ],
      { tableName: "orders", keyColumns: ["id"], includeOriginalValues: false },
    );

    expect(sql).toContain('WHERE "id" = 7;');
    expect(sql).not.toContain("\"status\" = 'pending'");
  });
});
