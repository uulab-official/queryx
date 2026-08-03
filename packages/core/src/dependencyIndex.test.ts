import { describe, expect, it } from "vitest";
import type { DatabaseObjectRef, DependencyMetadata } from "@queryx/shared";
import { buildDependencyIndex } from "./dependencyIndex";

const relation = (kind: "table" | "view", name: string): DatabaseObjectRef => ({
  kind,
  id: null,
  schema: "public",
  name,
  identityArguments: null,
});

const overloadedRoutine = (id: string): DatabaseObjectRef => ({
  kind: "routine",
  id,
  schema: "public",
  name: "calculate_total",
  identityArguments: id.endsWith("int") ? "amount integer" : "amount numeric",
});

describe("buildDependencyIndex", () => {
  it("indexes both dependency directions", () => {
    const orders = relation("table", "orders");
    const paidOrders = relation("view", "paid_orders");
    const edge: DependencyMetadata = {
      id: "view:paid_orders:orders",
      kind: "viewReference",
      dependent: paidOrders,
      referenced: orders,
    };

    const index = buildDependencyIndex([edge]);

    expect(index.get(paidOrders).dependsOn).toEqual([edge]);
    expect(index.get(orders).usedBy).toEqual([edge]);
    expect(index.get(orders).dependsOn).toEqual([]);
  });

  it("keeps overloaded routines separate by opaque snapshot id", () => {
    const integerOverload = overloadedRoutine("routine:int");
    const numericOverload = overloadedRoutine("routine:numeric");
    const trigger = {
      kind: "trigger",
      id: "trigger:audit",
      schema: "public",
      name: "audit",
      identityArguments: null,
    } satisfies DatabaseObjectRef;
    const edge: DependencyMetadata = {
      id: "trigger:function",
      kind: "triggerFunction",
      dependent: trigger,
      referenced: integerOverload,
    };

    const index = buildDependencyIndex([edge]);

    expect(index.get(integerOverload).usedBy).toHaveLength(1);
    expect(index.get(numericOverload).usedBy).toHaveLength(0);
  });
});
