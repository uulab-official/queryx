import { beforeEach, describe, expect, it } from "vitest";
import { InMemoryDriver } from "@queryx/core";
import { useQueryStore, type QueryTab } from "./store";

const initialTab: QueryTab = {
  id: "query-1",
  title: "Query 1",
  sql: "SELECT 1",
  isDirty: false,
};

describe("query tabs", () => {
  beforeEach(() => {
    useQueryStore.setState({
      tabs: [initialTab],
      activeTabId: initialTab.id,
      sql: initialTab.sql,
      isRunning: false,
      executionStatus: "idle",
      toast: null,
    });
  });

  it("cancels an in-flight query through the store", async () => {
    const driver = new InMemoryDriver();
    await driver.connect({
      kind: "postgres",
      name: "test",
      database: "queryx_test",
    });
    useQueryStore.setState({ driver, canCancel: true, sql: "SELECT 1" });

    const execution = useQueryStore.getState().runQuery();
    await Promise.resolve();
    useQueryStore.getState().cancelQuery();
    await execution;

    expect(useQueryStore.getState().isRunning).toBe(false);
    expect(useQueryStore.getState().executionStatus).toBe("cancelled");
    expect(useQueryStore.getState().toast).toBe("Query cancelled");
    expect(useQueryStore.getState().history[0]?.status).toBe("cancelled");
  });

  it("preserves each document while switching tabs", () => {
    useQueryStore.getState().setSql("SELECT * FROM orders");
    useQueryStore.getState().newQuery();
    const secondTab = useQueryStore.getState().tabs[1];
    useQueryStore.getState().setSql("SELECT * FROM customers");
    useQueryStore.getState().selectQuery(initialTab.id);

    expect(useQueryStore.getState().sql).toBe("SELECT * FROM orders");
    expect(secondTab.title).toBe("Query 2");
  });

  it("selects a neighboring document when the active tab closes", () => {
    useQueryStore.getState().newQuery();
    const activeId = useQueryStore.getState().activeTabId;
    useQueryStore.getState().closeQuery(activeId);

    expect(useQueryStore.getState().tabs).toHaveLength(1);
    expect(useQueryStore.getState().activeTabId).toBe(initialTab.id);
    expect(useQueryStore.getState().sql).toBe(initialTab.sql);
  });

  it("always keeps one editable document", () => {
    useQueryStore.getState().closeQuery(initialTab.id);

    expect(useQueryStore.getState().tabs).toHaveLength(1);
    expect(useQueryStore.getState().sql).toBe("");
  });
});
