import { describe, expect, it } from "vitest";
import { serializeRowsToXlsx } from "./xlsxExport";

describe("serializeRowsToXlsx", () => {
  it("creates a readable XLSX zip with typed cells and inline strings", () => {
    const bytes = serializeRowsToXlsx(
      [
        { name: "id", type: "integer", nullable: false },
        { name: "active", type: "boolean", nullable: false },
        { name: "note", type: "text", nullable: true },
      ],
      [
        { id: 7, active: true, note: "=SUM(A1:A2)" },
        { id: null, active: false, note: "<safe>" },
      ],
    );
    expect(Array.from(bytes.slice(0, 2))).toEqual([0x50, 0x4b]);
    const packageText = new TextDecoder().decode(bytes);
    expect(packageText).toContain("[Content_Types].xml");
    expect(packageText).toContain("xl/worksheets/sheet1.xml");
    expect(packageText).toContain("<v>7</v>");
    expect(packageText).toContain('t="b"><v>1</v>');
    expect(packageText).toContain("<is><t>=SUM(A1:A2)</t></is>");
    expect(packageText).toContain("&lt;safe&gt;");
    expect(packageText).not.toContain("<f>SUM(A1:A2)</f>");
  });

  it("writes column headers even when the result has no rows", () => {
    const bytes = serializeRowsToXlsx(
      [{ name: "created_at", type: "timestamp", nullable: true }],
      [],
    );
    const packageText = new TextDecoder().decode(bytes);
    expect(packageText).toContain(
      '<c r="A1" t="inlineStr"><is><t>created_at</t></is></c>',
    );
  });
});
