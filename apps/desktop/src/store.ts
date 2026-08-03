import { create } from "zustand";
import type {
  DatabaseDriver,
  DatabaseMetadata,
  DriverConfig,
  DriverKind,
  QueryResult,
} from "@queryx/shared";
import { createRuntimeDriver } from "./nativeDriver";

type ResultView = "table" | "json";
export type RunMode = "normal" | "transaction" | "execute-anyway";
export type ExecutionStatus =
  | "idle"
  | "running"
  | "success"
  | "cancelled"
  | "error";

export interface QueryHistoryEntry {
  id: string;
  label: string;
  sql: string;
  executedAt: string;
  status: "success" | "error" | "cancelled";
}

export interface QueryTab {
  id: string;
  title: string;
  sql: string;
  isDirty: boolean;
}

export type SelectedDatabaseObject =
  | { kind: "table" | "view"; schema: string; name: string }
  | {
      kind: "routine";
      id: string;
      schema: string;
      name: string;
      identityArguments: string;
      routineKind: "function" | "procedure";
    }
  | { kind: "trigger"; id: string; schema: string; name: string };

interface QueryState {
  sql: string;
  tabs: QueryTab[];
  activeTabId: string;
  result: QueryResult | null;
  metadata: DatabaseMetadata | null;
  selectedObject: SelectedDatabaseObject | null;
  resultView: ResultView;
  filter: string;
  isRunning: boolean;
  executionStatus: ExecutionStatus;
  canCancel: boolean;
  toast: string | null;
  history: QueryHistoryEntry[];
  driver: DatabaseDriver;
  driverKind: DriverKind;
  connectionName: string;
  connectionStatus: "connecting" | "connected" | "error";
  connectionError: string | null;
  setSql: (sql: string) => void;
  newQuery: () => void;
  selectQuery: (id: string) => void;
  closeQuery: (id: string) => void;
  setFilter: (filter: string) => void;
  setResultView: (view: ResultView) => void;
  setSelectedObject: (object: SelectedDatabaseObject) => void;
  runQuery: (mode?: RunMode, sqlOverride?: string) => Promise<void>;
  cancelQuery: () => void;
  loadMetadata: () => Promise<void>;
  connectDatabase: (config: DriverConfig) => Promise<boolean>;
  notify: (message: string) => void;
  addHistory: (entry: QueryHistoryEntry) => void;
}

const historyStorageKey = "queryx:query-history";

function defaultObject(
  metadata: DatabaseMetadata,
): SelectedDatabaseObject | null {
  const table = metadata.tables[0];
  if (table) return { kind: "table", schema: table.schema, name: table.name };
  const view = metadata.views[0];
  if (view) return { kind: "view", schema: view.schema, name: view.name };
  const routine = metadata.routines[0];
  if (routine)
    return {
      kind: "routine",
      id: routine.id,
      schema: routine.schema,
      name: routine.name,
      identityArguments: routine.identityArguments,
      routineKind: routine.kind,
    };
  const trigger = metadata.triggers[0];
  return trigger
    ? {
        kind: "trigger",
        id: trigger.id,
        schema: trigger.schema,
        name: trigger.name,
      }
    : null;
}

function readHistory(): QueryHistoryEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const stored = window.localStorage.getItem(historyStorageKey);
    return stored
      ? (JSON.parse(stored) as QueryHistoryEntry[]).slice(0, 20)
      : [];
  } catch {
    return [];
  }
}

function writeHistory(history: QueryHistoryEntry[]): void {
  try {
    window.localStorage.setItem(
      historyStorageKey,
      JSON.stringify(history.slice(0, 20)),
    );
  } catch {
    // Local persistence is best-effort until the Tauri SQLite store lands.
  }
}

const postgresInitialSql = `-- Revenue by day · last 30 days
SELECT
  DATE_TRUNC('day', created_at)::date AS day,
  COUNT(*) AS orders,
  SUM(total_amount) AS revenue
FROM orders
WHERE created_at >= CURRENT_DATE - INTERVAL '30 days'
  AND status = 'paid'
GROUP BY 1
ORDER BY day DESC;`;

const sqliteInitialSql = `-- Revenue by day · last 30 days
SELECT
  date(created_at) AS day,
  COUNT(*) AS orders,
  printf('$%.2f', SUM(total_amount)) AS revenue
FROM orders
WHERE created_at >= date('now', '-30 days')
  AND status = 'paid'
GROUP BY 1
ORDER BY day DESC;`;

export const useQueryStore = create<QueryState>((set, get) => {
  const driver = createRuntimeDriver();
  let activeQueryController: AbortController | null = null;
  const initialSql =
    driver.kind === "sqlite" ? sqliteInitialSql : postgresInitialSql;
  let driverReady = driver.connect({
    kind: driver.kind,
    name: driver.kind === "sqlite" ? "local-demo" : "production-db",
    database: driver.kind === "sqlite" ? ":memory:" : "production",
  });
  return {
    sql: initialSql,
    tabs: [
      {
        id: "query-1",
        title: "Daily revenue",
        sql: initialSql,
        isDirty: false,
      },
    ],
    activeTabId: "query-1",
    result: null,
    metadata: null,
    selectedObject: null,
    resultView: "table",
    filter: "",
    isRunning: false,
    executionStatus: "idle",
    canCancel: driver.capabilities().has("cancel"),
    toast: null,
    history: readHistory(),
    driver,
    driverKind: driver.kind,
    connectionName: driver.kind === "sqlite" ? "local-demo" : "production-db",
    connectionStatus: "connecting",
    connectionError: null,
    setSql: (sql) =>
      set((state) => ({
        sql,
        tabs: state.tabs.map((tab) =>
          tab.id === state.activeTabId ? { ...tab, sql, isDirty: true } : tab,
        ),
      })),
    newQuery: () => {
      const id = crypto.randomUUID();
      const nextNumber = get().tabs.length + 1;
      const tab: QueryTab = {
        id,
        title: `Query ${nextNumber}`,
        sql: "",
        isDirty: false,
      };
      set((state) => ({
        tabs: [...state.tabs, tab],
        activeTabId: id,
        sql: tab.sql,
      }));
    },
    selectQuery: (id) => {
      const tab = get().tabs.find((candidate) => candidate.id === id);
      if (tab) set({ activeTabId: id, sql: tab.sql });
    },
    closeQuery: (id) => {
      const state = get();
      const index = state.tabs.findIndex((tab) => tab.id === id);
      if (index === -1) return;
      const remaining = state.tabs.filter((tab) => tab.id !== id);
      if (remaining.length === 0) {
        const replacement: QueryTab = {
          id: crypto.randomUUID(),
          title: "Query 1",
          sql: "",
          isDirty: false,
        };
        set({ tabs: [replacement], activeTabId: replacement.id, sql: "" });
        return;
      }
      if (state.activeTabId !== id) {
        set({ tabs: remaining });
        return;
      }
      const replacement = remaining[Math.min(index, remaining.length - 1)];
      set({
        tabs: remaining,
        activeTabId: replacement.id,
        sql: replacement.sql,
      });
    },
    setFilter: (filter) => set({ filter }),
    setResultView: (resultView) => set({ resultView }),
    setSelectedObject: (selectedObject) => set({ selectedObject }),
    runQuery: async (mode = "normal", sqlOverride?: string) => {
      if (get().isRunning) return;
      const controller = new AbortController();
      activeQueryController = controller;
      set({ isRunning: true, executionStatus: "running" });
      try {
        await driverReady;
        const executedSql = sqlOverride?.trim() || get().sql;
        const execute = () =>
          get().driver.execute(executedSql, controller.signal);
        const result =
          mode === "transaction"
            ? await get().driver.transaction(execute)
            : await execute();
        const historyEntry: QueryHistoryEntry = {
          id: crypto.randomUUID(),
          label:
            executedSql
              .split("\n")
              .find((line) => line.trim() && !line.trim().startsWith("--"))
              ?.trim()
              .slice(0, 32) ?? "Untitled query",
          sql: executedSql,
          executedAt: new Date().toISOString(),
          status: "success",
        };
        get().addHistory(historyEntry);
        set({
          result,
          executionStatus: "success",
          connectionStatus: "connected",
          toast: "Query completed successfully",
        });
        window.setTimeout(() => set({ toast: null }), 2200);
      } catch (error) {
        const wasCancelled =
          error instanceof DOMException && error.name === "AbortError";
        get().addHistory({
          id: crypto.randomUUID(),
          label: wasCancelled ? "Query cancelled" : "Query failed",
          sql: sqlOverride?.trim() || get().sql,
          executedAt: new Date().toISOString(),
          status: wasCancelled ? "cancelled" : "error",
        });
        set({
          executionStatus: wasCancelled ? "cancelled" : "error",
          toast: wasCancelled
            ? "Query cancelled"
            : error instanceof Error
              ? error.message
              : "Query failed",
        });
      } finally {
        if (activeQueryController === controller) {
          activeQueryController = null;
          set({ isRunning: false });
        }
      }
    },
    cancelQuery: () => {
      if (!get().isRunning || !get().canCancel) return;
      activeQueryController?.abort();
      set({ toast: "Cancelling query…" });
    },
    loadMetadata: async () => {
      try {
        await driverReady;
        const metadata = await get().driver.metadata();
        set({
          metadata,
          canCancel: get().driver.capabilities().has("cancel"),
          selectedObject: defaultObject(metadata),
          connectionStatus: "connected",
          connectionError: null,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        set({
          connectionStatus: "error",
          connectionError: message,
          toast: message,
        });
      }
    },
    connectDatabase: async (config) => {
      const nextDriver = createRuntimeDriver(config.kind);
      set({
        connectionStatus: "connecting",
        connectionError: null,
        toast: `Connecting to ${config.name}…`,
      });
      try {
        driverReady = nextDriver.connect(config);
        await driverReady;
        const metadata = await nextDriver.metadata();
        await get().driver.disconnect();
        const nextSql =
          nextDriver.kind === "sqlite" ? sqliteInitialSql : postgresInitialSql;
        const activeTab = get().tabs.find(
          (tab) => tab.id === get().activeTabId,
        );
        const shouldReplaceSql = activeTab ? !activeTab.isDirty : false;
        set({
          driver: nextDriver,
          driverKind: nextDriver.kind,
          canCancel: nextDriver.capabilities().has("cancel"),
          connectionName: config.name,
          connectionStatus: "connected",
          connectionError: null,
          metadata,
          selectedObject: defaultObject(metadata),
          sql: shouldReplaceSql ? nextSql : get().sql,
          tabs: shouldReplaceSql
            ? get().tabs.map((tab) =>
                tab.id === get().activeTabId
                  ? { ...tab, sql: nextSql, isDirty: false }
                  : tab,
              )
            : get().tabs,
          result: null,
          executionStatus: "idle",
          toast: `Connected to ${config.name}`,
        });
        window.setTimeout(() => set({ toast: null }), 2200);
        return true;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        set({
          connectionStatus: "error",
          connectionError: message,
          toast: message,
        });
        return false;
      }
    },
    notify: (toast) => {
      set({ toast });
      window.setTimeout(() => set({ toast: null }), 2200);
    },
    addHistory: (entry) => {
      const history = [
        entry,
        ...get().history.filter((item) => item.sql !== entry.sql),
      ];
      writeHistory(history);
      set({ history });
    },
  };
});

export { postgresInitialSql, sqliteInitialSql };
