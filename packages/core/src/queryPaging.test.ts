import { describe, expect, it } from "vitest";
import { buildQueryPagePlan } from "./queryPaging";

describe("buildQueryPagePlan", () => {
  it("wraps a single SELECT and quotes the derived-table alias per dialect", () => {
    expect(
      buildQueryPagePlan(
        "SELECT id, total FROM orders WHERE status = 'paid';",
        "postgres",
        100,
        200,
      ),
    ).toEqual({
      sql: `SELECT * FROM (\nSELECT id, total FROM orders WHERE status = 'paid'\n) AS "__queryx_page" LIMIT 100 OFFSET 200;`,
      limit: 100,
      offset: 200,
      errors: [],
    });
    expect(
      buildQueryPagePlan(
        "WITH recent AS (SELECT 1) SELECT * FROM recent",
        "mysql",
        25,
        0,
      ).sql,
    ).toContain("AS `__queryx_page` LIMIT 25 OFFSET 0;");
  });

  it("preserves semicolons in quoted values and ignores trailing comments", () => {
    const plan = buildQueryPagePlan(
      "SELECT 'a;b' AS value; -- reviewed",
      "sqlite",
      10,
      0,
    );
    expect(plan.errors).toEqual([]);
    expect(plan.sql).toContain("SELECT 'a;b' AS value");
  });

  it("does not page mutations, locks, or multiple statements", () => {
    const plan = buildQueryPagePlan(
      "SELECT id FROM users FOR UPDATE; DELETE FROM audit",
      "postgres",
      100,
      0,
    );
    expect(plan.sql).toBe("");
    expect(plan.errors).toEqual(
      expect.arrayContaining([
        "Server paging accepts one SQL statement at a time",
        "Server paging excludes mutating or locking query clauses",
      ]),
    );
  });
});
