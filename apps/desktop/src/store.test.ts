import { beforeEach, describe, expect, it } from "vitest";
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
    });
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
