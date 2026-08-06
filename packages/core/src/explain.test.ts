import { describe, expect, it } from "vitest";
import { buildExplainAnalyzeQuery, buildExplainQuery } from "./explain";

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

describe("buildExplainAnalyzeQuery", () => {
  it("builds explicit execution plans for PostgreSQL and MySQL", () => {
    expect(
      buildExplainAnalyzeQuery("SELECT * FROM orders", "postgres"),
    ).toEqual({
      ok: true,
      query: {
        sql: "EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT) SELECT * FROM orders",
        warning:
          "EXPLAIN ANALYZE executes the statement and may change database state",
      },
    });
    expect(buildExplainAnalyzeQuery("SELECT * FROM orders", "mysql")).toEqual({
      ok: true,
      query: {
        sql: "EXPLAIN ANALYZE SELECT * FROM orders",
        warning:
          "EXPLAIN ANALYZE executes the statement and may change database state",
      },
    });
  });

  it("rejects unsupported, pre-wrapped, and multi-statement input", () => {
    expect(buildExplainAnalyzeQuery("SELECT 1", "sqlite")).toMatchObject({
      ok: false,
      error: { message: "EXPLAIN ANALYZE is not supported for SQLite" },
    });
    expect(
      buildExplainAnalyzeQuery("EXPLAIN SELECT 1", "postgres"),
    ).toMatchObject({
      ok: false,
      error: {
        message: expect.stringContaining("Remove the existing EXPLAIN prefix"),
      },
    });
    expect(
      buildExplainAnalyzeQuery("SELECT 1; SELECT 2", "mysql"),
    ).toMatchObject({
      ok: false,
      error: { message: "Explain one SQL statement at a time" },
    });
  });
});
