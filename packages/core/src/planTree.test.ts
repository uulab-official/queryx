import { describe, expect, it } from "vitest";
import { parseExplainPlan } from "./index";

describe("parseExplainPlan", () => {
  it("builds a tree from PostgreSQL text plans and keeps operator details", () => {
    const plan = parseExplainPlan({
      columns: [{ name: "QUERY PLAN", type: "text", nullable: true }],
      rows: [
        {
          "QUERY PLAN":
            "Sort  (cost=10.00..20.00 rows=5 width=16) (actual time=0.10..0.20 rows=5 loops=1)\n  Sort Key: created_at DESC\n  ->  Seq Scan on orders  (cost=0.00..10.00 rows=5 width=16) (actual time=0.02..0.04 rows=5 loops=1)\n        Filter: (status = 'paid'::text)",
        },
      ],
    });

    expect(plan).not.toBeNull();
    expect(plan?.nodes).toHaveLength(2);
    expect(plan?.nodes[0]).toMatchObject({
      label: "Sort",
      parentId: null,
      estimatedRows: 5,
      estimatedCost: { startup: 10, total: 20 },
      actualRows: 5,
      actualTimeMs: { startup: 0.1, total: 0.2 },
      details: ["Sort Key: created_at DESC"],
    });
    expect(plan?.nodes[1]).toMatchObject({
      label: "Seq Scan on orders",
      parentId: plan?.nodes[0]?.id,
      details: ["Filter: (status = 'paid'::text)"],
    });
  });

  it("normalizes MySQL arrow rows and rejects ordinary result grids", () => {
    const plan = parseExplainPlan({
      columns: [{ name: "EXPLAIN", type: "text", nullable: true }],
      rows: [
        { EXPLAIN: "-> Limit: 10 row(s) (cost=1.2 rows=10)" },
        { EXPLAIN: "    -> Table scan on orders (cost=2.4 rows=100)" },
      ],
    });

    expect(plan?.nodes.map((node) => node.label)).toEqual([
      "Limit: 10 row(s)",
      "Table scan on orders",
    ]);
    expect(plan?.nodes[1]?.parentId).toBe(plan?.nodes[0]?.id);
    expect(
      parseExplainPlan({
        columns: [{ name: "name", type: "text", nullable: true }],
        rows: [{ name: "Seq Scan on orders" }],
      }),
    ).toBeNull();
  });
});
