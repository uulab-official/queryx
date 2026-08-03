import { describe, expect, it } from "vitest";
import { serializeRowsToTsv } from "./clipboard";

const columns = [{ name: "id" }, { name: "name" }, { name: "notes" }];

describe("serializeRowsToTsv", () => {
  it("preserves a rectangular range for spreadsheet paste", () => {
    expect(
      serializeRowsToTsv(
        columns,
        [{ id: 1, name: "Ada", notes: 'line\none\t"quoted"' }],
        { includeHeaders: true, lineEnding: "\n" },
      ),
    ).toBe('id\tname\tnotes\n1\tAda\t"line\none\t""quoted"""');
  });

  it("uses the configured value for null cells", () => {
    expect(
      serializeRowsToTsv(
        [{ name: "value" }, { name: "missing" }],
        [{ value: null }],
        { nullValue: "NULL", lineEnding: "\n" },
      ),
    ).toBe("NULL\tNULL");
  });
});
