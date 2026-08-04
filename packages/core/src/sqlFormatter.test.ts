import { describe, expect, it } from "vitest";
import { formatSql } from "./sqlFormatter";

describe("formatSql", () => {
  it("lays out clauses and uppercases SQL keywords", () => {
    expect(
      formatSql("select id,name from orders where status='paid' order by id"),
    ).toBe("SELECT id, name\nFROM orders\nWHERE status='paid'\nORDER BY id");
  });

  it("preserves quoted values, identifiers, and comments", () => {
    const sql = `select "Select", '  keep   spaces  ' as note
      from "Orders" -- where this word stays a comment
      where note = 'FROM WHERE'`;

    expect(formatSql(sql)).toBe(
      `SELECT "Select", '  keep   spaces  ' AS note\nFROM "Orders" -- where this word stays a comment\nWHERE note = 'FROM WHERE'`,
    );
  });

  it("returns empty input unchanged", () => {
    expect(formatSql("  \n  ")).toBe("");
  });
});
