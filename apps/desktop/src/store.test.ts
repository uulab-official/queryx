import { beforeEach, describe, expect, it } from "vitest";
import { InMemoryDriver } from "@queryx/core";
import type { QueryResult } from "@queryx/shared";
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
      transactionActive: false,
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

  it("tracks explicit transaction session controls", async () => {
    const driver = new InMemoryDriver();
    await driver.connect({
      kind: "sqlite",
      name: "test",
      database: ":memory:",
    });
    useQueryStore.setState({ driver });

    await useQueryStore.getState().beginTransaction();
    expect(useQueryStore.getState().transactionActive).toBe(true);
    await useQueryStore.getState().commitTransaction();
    expect(useQueryStore.getState().transactionActive).toBe(false);

    await useQueryStore.getState().beginTransaction();
    await useQueryStore.getState().rollbackTransaction();
    expect(useQueryStore.getState().transactionActive).toBe(false);
  });

  it("keeps the original SQL in history when execution uses a page wrapper", async () => {
    const driver = new InMemoryDriver();
    await driver.connect({
      kind: "postgres",
      name: "test",
      database: "queryx_test",
    });
    useQueryStore.setState({ driver, sql: "SELECT * FROM orders" });

    await useQueryStore
      .getState()
      .runQuery(
        "normal",
        'SELECT * FROM (SELECT * FROM orders) AS "__queryx_page" LIMIT 100 OFFSET 0;',
        { historySql: "SELECT * FROM orders" },
      );

    expect(useQueryStore.getState().history[0]?.sql).toBe(
      "SELECT * FROM orders",
    );
  });

  it("merges streamed chunks into the active result before the stream summary returns", async () => {
    const driver = new InMemoryDriver();
    await driver.connect({
      kind: "postgres",
      name: "test",
      database: "queryx_test",
    });
    useQueryStore.setState({ driver, sql: "SELECT * FROM orders" });

    await useQueryStore
      .getState()
      .runQuery("normal", "SELECT * FROM orders", { stream: true });

    expect(useQueryStore.getState().result?.rows.length).toBeGreaterThan(1);
    expect(useQueryStore.getState().result?.columns[0]?.name).toBe("day");
    expect(useQueryStore.getState().executionStatus).toBe("success");
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

  it("stores migration preview history without replacing the active query", () => {
    const values = new Map<string, string>();
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
      const entry = {
        id: "migration-1",
        baselineLabel: "Baseline",
        targetLabel: "Current",
        driver: "postgres" as const,
        createdAt: new Date().toISOString(),
        changeCount: 1,
        added: 1,
        removed: 0,
        manual: 0,
        migrationSql: "CREATE TABLE public.audit (id integer);",
        rollbackSql: "DROP TABLE public.audit;",
        privilegePreflightSql: "SELECT current_user;",
        status: "preview" as const,
      };
      useQueryStore.setState({ migrationHistory: [] });
      useQueryStore.getState().addMigrationHistory(entry);
      useQueryStore.getState().addMigrationHistory({
        ...entry,
        id: "migration-2",
      });

      expect(useQueryStore.getState().migrationHistory).toHaveLength(1);
      expect(
        JSON.parse(values.get("queryx:migration-history") ?? "[]"),
      ).toHaveLength(1);
      useQueryStore.getState().markMigrationApplied("migration-2");
      expect(useQueryStore.getState().migrationHistory[0]?.status).toBe(
        "applied",
      );
      useQueryStore.getState().clearMigrationHistory();
      expect(useQueryStore.getState().migrationHistory).toEqual([]);
      expect(values.has("queryx:migration-history")).toBe(false);
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

  it("appends compatible table-browser pages without discarding loaded rows", () => {
    const page = (id: number): QueryResult => ({
      columns: [{ name: "id", type: "integer", nullable: false }],
      rows: [{ id }],
      executionTime: 2,
      affectedRows: 0,
      warnings: [],
    });
    useQueryStore.setState({ result: page(1) });

    useQueryStore.getState().appendResult(page(2));

    expect(useQueryStore.getState().result?.rows).toEqual([
      { id: 1 },
      { id: 2 },
    ]);
    expect(useQueryStore.getState().result?.executionTime).toBe(4);
  });

  it("saves, duplicates, and deletes non-secret connection profiles", async () => {
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
      useQueryStore.setState({ connectionProfiles: [] });
      const saved = await useQueryStore.getState().saveConnectionProfile({
        name: "Analytics",
        kind: "postgres",
        database: "analytics",
        readOnly: false,
        host: "localhost",
        port: 5432,
        username: "readonly",
        sslMode: "require",
      });
      const duplicate = await useQueryStore
        .getState()
        .duplicateConnectionProfile(saved.id);

      expect(duplicate?.name).toBe("Analytics copy");
      expect(useQueryStore.getState().connectionProfiles).toHaveLength(2);
      expect(values.get("queryx:connection-profiles")).not.toContain(
        "password",
      );

      await useQueryStore.getState().deleteConnectionProfile(saved.id);
      expect(useQueryStore.getState().connectionProfiles).toHaveLength(1);
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

  it("tests a connection without replacing the active driver", async () => {
    const previousDriver = useQueryStore.getState().driver;
    const result = await useQueryStore.getState().testDatabaseConnection({
      kind: "sqlite",
      name: "test connection",
      database: ":memory:",
    });

    expect(result).toEqual({ ok: true });
    expect(useQueryStore.getState().driver).toBe(previousDriver);
  });

  it("inspects a saved connection without replacing the active driver", async () => {
    const previousDriver = useQueryStore.getState().driver;
    const metadata = await useQueryStore.getState().inspectConnectionMetadata({
      kind: "postgres",
      name: "schema target",
      database: "target",
      readOnly: false,
    });

    expect(metadata.tables.length).toBeGreaterThan(0);
    expect(useQueryStore.getState().driver).toBe(previousDriver);
  });

  it("surfaces read-only policy after a successful connection", async () => {
    const fakeWindow = {
      setTimeout,
      localStorage: {
        getItem: () => null,
        setItem: () => undefined,
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
      await expect(
        useQueryStore.getState().connectDatabase({
          kind: "postgres",
          name: "Read-only preview",
          database: "preview",
          readOnly: true,
        }),
      ).resolves.toBe(true);
      expect(useQueryStore.getState().readOnlyConnection).toBe(true);
      expect(useQueryStore.getState().driver.isReadOnly()).toBe(true);
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
});
