import { describe, expect, it } from "vitest";
import { buildExplainQuery } from "./explain";

describe("buildExplainQuery", () => {
  it("wraps one statement without enabling ANALYZE", () => {
    expect(buildExplainQuery("SELECT * FROM orders;")).toEqual({
      ok: true,
      query: { sql: "EXPLAIN SELECT * FROM orders;" },
    });
  });

  it("allows semicolons inside quoted values", () => {
    expect(buildExplainQuery("SELECT ';' AS delimiter").ok).toBe(true);
  });

  it("rejects multiple statements", () => {
    expect(buildExplainQuery("SELECT 1; SELECT 2")).toMatchObject({
      ok: false,
      error: { message: "Explain one SQL statement at a time" },
    });
  });

  it("rejects an existing EXPLAIN or empty input", () => {
    expect(buildExplainQuery("EXPLAIN ANALYZE SELECT 1").ok).toBe(false);
    expect(buildExplainQuery("-- review\nEXPLAIN SELECT 1").ok).toBe(false);
    expect(buildExplainQuery("   ")).toMatchObject({
      ok: false,
      error: { message: "Enter SQL before explaining it" },
    });
  });
});
