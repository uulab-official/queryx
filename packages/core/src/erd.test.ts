import { describe, expect, it } from "vitest";
import type { DatabaseMetadata } from "@queryx/shared";
import { buildErdDiagram, erdObjectId } from "./erd";

const metadata = (): DatabaseMetadata => ({
  databases: ["app"],
  schemas: ["public"],
  tables: [
    {
      schema: "public",
      name: "orders",
      rowCount: 2,
      columns: [
        { name: "id", type: "integer", nullable: false, primaryKey: true },
        { name: "user_id", type: "integer", nullable: false },
      ],
      indexes: [],
      foreignKeys: [
        {
          id: "orders_user_id_fkey",
          name: "orders_user_id_fkey",
          columns: [
            { ordinal: 1, sourceColumn: "user_id", referencedColumn: "id" },
          ],
          referencedRelation: { schema: "public", name: "users" },
          onUpdate: "NO ACTION",
          onDelete: "CASCADE",
          match: null,
          deferrable: false,
          initiallyDeferred: false,
        },
      ],
    },
    {
      schema: "public",
      name: "users",
      rowCount: 1,
      columns: [
        { name: "id", type: "integer", nullable: false, primaryKey: true },
      ],
      indexes: [],
      foreignKeys: [],
    },
  ],
  views: [
    {
      schema: "public",
      name: "user_orders",
      columns: [{ name: "id", type: "integer", nullable: false }],
      definition: "SELECT id FROM orders",
    },
  ],
  routines: [],
  triggers: [],
  eventTriggers: [],
  dependencies: [
    {
      id: "view:user_orders:orders",
      kind: "viewReference",
      dependent: {
        kind: "view",
        id: null,
        schema: "public",
        name: "user_orders",
        identityArguments: null,
      },
      referenced: {
        kind: "table",
        id: null,
        schema: "public",
        name: "orders",
        identityArguments: null,
      },
    },
  ],
});

describe("buildErdDiagram", () => {
  it("lays out relations deterministically and preserves FK/view edges", () => {
    const diagram = buildErdDiagram(metadata(), { columns: 2 });

    expect(diagram.nodes.map((node) => node.id)).toEqual([
      erdObjectId("table", "public", "orders"),
      erdObjectId("table", "public", "users"),
      erdObjectId("view", "public", "user_orders"),
    ]);
    expect(diagram.edges.map((edge) => edge.kind)).toEqual([
      "foreignKey",
      "viewReference",
    ]);
    expect(diagram.nodes[0]?.totalColumns).toBe(2);
    expect(diagram.nodes[0]?.x).toBe(diagram.nodes[2]?.x);
    expect(diagram.nodes[0]?.y).toBeLessThan(diagram.nodes[2]?.y ?? 0);
  });

  it("caps large schemas without creating dangling edges", () => {
    const diagram = buildErdDiagram(metadata(), { maxNodes: 2 });

    expect(diagram.nodes).toHaveLength(2);
    expect(
      diagram.edges.every(
        (edge) =>
          diagram.nodes.some((node) => node.id === edge.source) &&
          diagram.nodes.some((node) => node.id === edge.target),
      ),
    ).toBe(true);
  });
});
