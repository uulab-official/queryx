import { describe, expect, it } from "vitest";
import { buildQueryPagePlan, buildQueryResultFilterPlan } from "./queryPaging";

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

  it("uses SQL Server OFFSET/FETCH pagination and bracketed aliases", () => {
    const plan = buildQueryPagePlan(
      "SELECT id FROM dbo.users",
      "sqlserver",
      25,
      50,
    );

    expect(plan.errors).toEqual([]);
    expect(plan.sql).toContain(") AS [__queryx_page] ORDER BY (SELECT 1)");
    expect(plan.sql).toMatch(/OFFSET 50 ROWS FETCH NEXT 25 ROWS ONLY;$/);
  });

  it("uses Oracle OFFSET/FETCH pagination without AS table aliases", () => {
    const plan = buildQueryPagePlan(
      "SELECT id FROM app.users",
      "oracle",
      25,
      50,
    );

    expect(plan.errors).toEqual([]);
    expect(plan.sql).toContain(") " + '"__queryx_page" ORDER BY 1');
    expect(plan.sql).not.toContain('AS "__queryx_page"');
    expect(plan.sql).toMatch(/OFFSET 50 ROWS FETCH NEXT 25 ROWS ONLY;$/);
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

describe("buildQueryResultFilterPlan", () => {
  const columns = [{ name: "id" }, { name: "display name" }, { name: "note" }];

  it("pushes literal filtering and selected ordering into the derived query", () => {
    const plan = buildQueryResultFilterPlan(
      'SELECT id, display_name AS "display name", note FROM users',
      columns,
      "postgres",
      100,
      0,
      "50%_ready",
      "display name",
      "desc",
    );

    expect(plan.errors).toEqual([]);
    expect(plan.sql).toContain('AS "__queryx_result"');
    expect(plan.sql).toContain(
      "LOWER(CAST(\"__queryx_result\".\"id\" AS TEXT)) LIKE LOWER('%50!%!_ready%') ESCAPE '!'",
    );
    expect(plan.sql).toContain(
      'ORDER BY "__queryx_result"."display name" DESC LIMIT 100 OFFSET 0;',
    );
  });

  it("uses vendor casts and OFFSET/FETCH for SQL Server", () => {
    const plan = buildQueryResultFilterPlan(
      "SELECT id, status FROM dbo.users",
      [{ name: "id" }, { name: "status" }],
      "sqlserver",
      25,
      50,
      "paid",
      "status",
      "asc",
    );

    expect(plan.errors).toEqual([]);
    expect(plan.sql).toContain(
      "LOWER(CAST([__queryx_result].[id] AS NVARCHAR(MAX))) LIKE LOWER('%paid%') ESCAPE '!'",
    );
    expect(plan.sql).toContain(
      "ORDER BY [__queryx_result].[status] ASC OFFSET 50 ROWS FETCH NEXT 25 ROWS ONLY;",
    );
  });

  it("rejects unknown sort columns and unsafe statements", () => {
    const plan = buildQueryResultFilterPlan(
      "SELECT id FROM users FOR UPDATE",
      [{ name: "id" }],
      "postgres",
      100,
      0,
      "",
      "missing",
    );

    expect(plan.sql).toBe("");
    expect(plan.errors).toEqual(
      expect.arrayContaining([
        "Sort column does not exist: missing",
        "Server paging excludes mutating or locking query clauses",
      ]),
    );
  });
});
