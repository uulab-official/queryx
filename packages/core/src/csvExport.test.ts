import { describe, expect, it } from "vitest";
import { serializeRowsToCsv } from "./csvExport";

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
