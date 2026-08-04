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

  it("writes tab text and active-tab changes to the local workspace snapshot", () => {
    const values = new Map<string, string>();
    const fakeWindow = {
      localStorage: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
      },
    } as unknown as Window & typeof globalThis;
    const previousWindow = (
      globalThis as typeof globalThis & { window?: Window }
    ).window;
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: fakeWindow,
    });

    try {
      const newTabId = useQueryStore.getState().newQuery();
      useQueryStore.getState().setSql("SELECT * FROM customers");
      useQueryStore.getState().selectQuery(initialTab.id);
      const snapshot = JSON.parse(
        values.get("queryx:workspace-tabs") ?? "{}",
      ) as { version?: number; activeTabId?: string; tabs?: QueryTab[] };

      expect(snapshot.version).toBe(1);
      expect(snapshot.activeTabId).toBe(initialTab.id);
      expect(snapshot.tabs?.find((tab) => tab.id === newTabId)?.sql).toBe(
        "SELECT * FROM customers",
      );
    } finally {
      if (previousWindow) {
        Object.defineProperty(globalThis, "window", {
          configurable: true,
          value: previousWindow,
        });
      } else {
        Reflect.deleteProperty(globalThis, "window");
      }
    }
  });

  it("clears recent query history from state and local storage", () => {
    const values = new Map<string, string>([
      ["queryx:query-history", JSON.stringify([{ id: "history-1" }])],
    ]);
    const fakeWindow = {
      localStorage: {
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => values.set(key, value),
        removeItem: (key: string) => values.delete(key),
      },
    } as unknown as Window & typeof globalThis;
    const previousWindow = (
      globalThis as typeof globalThis & { window?: Window }
    ).window;
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: fakeWindow,
    });

    try {
      useQueryStore.setState({
        history: [
          {
            id: "history-1",
            label: "Recent query",
            sql: "SELECT 1",
            executedAt: new Date().toISOString(),
            status: "success",
          },
        ],
      });
      useQueryStore.getState().clearHistory();

      expect(useQueryStore.getState().history).toEqual([]);
      expect(values.has("queryx:query-history")).toBe(false);
    } finally {
      if (previousWindow) {
        Object.defineProperty(globalThis, "window", {
          configurable: true,
          value: previousWindow,
        });
      } else {
        Reflect.deleteProperty(globalThis, "window");
      }
    }
  });

  it("returns the id of a new editable document", () => {
    const newTabId = useQueryStore.getState().newQuery();
    const state = useQueryStore.getState();

    expect(newTabId).toBe(state.activeTabId);
    expect(state.tabs.find((tab) => tab.id === newTabId)?.sql).toBe("");
  });

  it("keeps an existing Inspector selection when metadata refreshes", async () => {
    const driver = new InMemoryDriver();
    await driver.connect({
      kind: "postgres",
      name: "test",
      database: "queryx_test",
    });
    const metadata = await driver.metadata();
    const routine = metadata.routines[0];

    useQueryStore.setState({
      driver,
      selectedObject: routine
        ? {
            kind: "routine",
            id: routine.id,
            schema: routine.schema,
            name: routine.name,
            identityArguments: routine.identityArguments,
            routineKind: routine.kind,
          }
        : null,
    });
    await useQueryStore.getState().loadMetadata();

    const selected = useQueryStore.getState().selectedObject;
    expect(selected?.kind).toBe("routine");
    expect(selected && "id" in selected ? selected.id : undefined).toBe(
      routine?.id,
    );
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

  it("saves and removes normalized SQL favorites without duplicates", () => {
    useQueryStore.setState({ favorites: [] });
    const store = useQueryStore.getState();

    expect(store.toggleFavorite("  SELECT 1  ")).toBe(true);
    expect(useQueryStore.getState().favorites).toHaveLength(1);
    expect(useQueryStore.getState().favorites[0]?.sql).toBe("SELECT 1");
    expect(useQueryStore.getState().favorites[0]?.label).toBe("SELECT 1");

    expect(useQueryStore.getState().toggleFavorite("SELECT 1")).toBe(false);
    expect(useQueryStore.getState().favorites).toHaveLength(0);
  });

  it("does not save an empty favorite", () => {
    useQueryStore.setState({ favorites: [] });

    expect(useQueryStore.getState().toggleFavorite("  \n ")).toBe(false);
    expect(useQueryStore.getState().favorites).toHaveLength(0);
  });
});
