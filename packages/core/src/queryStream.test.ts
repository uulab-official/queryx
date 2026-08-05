import { describe, expect, it } from "vitest";
import { appendQueryChunk } from "./queryStream";

describe("appendQueryChunk", () => {
  it("appends rows while retaining columns and de-duplicating warnings", () => {
    const result = appendQueryChunk(
      {
        columns: [{ name: "id", type: "int4", nullable: false }],
        rows: [{ id: 1 }],
        executionTime: 0,
        affectedRows: 0,
        warnings: ["driver warning"],
      },
      {
        rowOffset: 1,
        columns: [{ name: "id", type: "int4", nullable: false }],
        rows: [{ id: 2 }, { id: 3 }],
        warnings: ["driver warning", "stream chunk"],
      },
    );

    expect(result.rows).toEqual([{ id: 1 }, { id: 2 }, { id: 3 }]);
    expect(result.columns).toEqual([
      { name: "id", type: "int4", nullable: false },
    ]);
    expect(result.warnings).toEqual(["driver warning", "stream chunk"]);
  });

  it("uses chunk columns when the initial result has no metadata", () => {
    const result = appendQueryChunk(
      {
        columns: [],
        rows: [],
        executionTime: 0,
        affectedRows: 0,
        warnings: [],
      },
      {
        rowOffset: 0,
        columns: [{ name: "name", type: "text", nullable: true }],
        rows: [{ name: "Ada" }],
        warnings: [],
      },
    );

    expect(result.columns[0]?.name).toBe("name");
    expect(result.rows).toEqual([{ name: "Ada" }]);
  });
});
