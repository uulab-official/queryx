import { describe, expect, it } from "vitest";
import type { TableMetadata } from "@queryx/shared";
import { buildForeignKeyIndex } from "./foreignKeyIndex";

const tables: TableMetadata[] = [
  {
    schema: "sales",
    name: "orders",
    rowCount: 0,
    columns: [],
    indexes: [],
    foreignKeys: [
      {
        id: "orders-account-fk",
        name: "orders_account_fkey",
        columns: [
          {
            ordinal: 1,
            sourceColumn: "tenant_id",
            referencedColumn: "tenant_id",
          },
          {
            ordinal: 2,
            sourceColumn: "account_id",
            referencedColumn: "id",
          },
        ],
        referencedRelation: { schema: "crm", name: "accounts" },
        onUpdate: "CASCADE",
        onDelete: "RESTRICT",
        match: "SIMPLE",
        deferrable: false,
        initiallyDeferred: false,
      },
    ],
  },
  {
    schema: "crm",
    name: "accounts",
    rowCount: 0,
    columns: [],
    indexes: [],
    foreignKeys: [],
  },
];

describe("buildForeignKeyIndex", () => {
  it("derives incoming relationships without duplicating snapshot metadata", () => {
    const index = buildForeignKeyIndex(tables);
    const outgoing = index.get({ schema: "sales", name: "orders" });
    const incoming = index.get({ schema: "crm", name: "accounts" });

    expect(outgoing.outgoing[0]?.columns).toEqual([
      {
        ordinal: 1,
        sourceColumn: "tenant_id",
        referencedColumn: "tenant_id",
      },
      {
        ordinal: 2,
        sourceColumn: "account_id",
        referencedColumn: "id",
      },
    ]);
    expect(incoming.incoming[0]?.sourceRelation).toEqual({
      schema: "sales",
      name: "orders",
    });
    expect(incoming.completeness).toBe("complete");
  });

  it("marks relations outside the eager snapshot as partial", () => {
    const relations = buildForeignKeyIndex(tables).get({
      schema: "private",
      name: "hidden_table",
    });

    expect(relations).toEqual({
      outgoing: [],
      incoming: [],
      completeness: "partial",
    });
  });
});
