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

export interface QueryHistoryEntry {
  id: string;
  label: string;
  sql: string;
  executedAt: string;
  status: "success" | "error";
}

interface QueryState {
  sql: string;
  result: QueryResult | null;
  metadata: DatabaseMetadata | null;
  selectedTable: string;
  resultView: ResultView;
  filter: string;
  isRunning: boolean;
  toast: string | null;
  history: QueryHistoryEntry[];
  driver: DatabaseDriver;
  driverKind: DriverKind;
  connectionName: string;
  connectionStatus: "connecting" | "connected" | "error";
  connectionError: string | null;
  setSql: (sql: string) => void;
  setFilter: (filter: string) => void;
  setResultView: (view: ResultView) => void;
  setSelectedTable: (table: string) => void;
  runQuery: (mode?: RunMode) => Promise<void>;
  loadMetadata: () => Promise<void>;
  connectDatabase: (config: DriverConfig) => Promise<boolean>;
  notify: (message: string) => void;
  addHistory: (entry: QueryHistoryEntry) => void;
}

const historyStorageKey = "queryx:query-history";

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
  const initialSql =
    driver.kind === "sqlite" ? sqliteInitialSql : postgresInitialSql;
  let driverReady = driver.connect({
    kind: driver.kind,
    name: driver.kind === "sqlite" ? "local-demo" : "production-db",
    database: driver.kind === "sqlite" ? ":memory:" : "production",
  });
  return {
    sql: initialSql,
    result: null,
    metadata: null,
    selectedTable: "",
    resultView: "table",
    filter: "",
    isRunning: false,
    toast: null,
    history: readHistory(),
    driver,
    driverKind: driver.kind,
    connectionName: driver.kind === "sqlite" ? "local-demo" : "production-db",
    connectionStatus: "connecting",
    connectionError: null,
    setSql: (sql) => set({ sql }),
    setFilter: (filter) => set({ filter }),
    setResultView: (resultView) => set({ resultView }),
    setSelectedTable: (selectedTable) => set({ selectedTable }),
    runQuery: async (mode = "normal") => {
      set({ isRunning: true });
      try {
        await driverReady;
        const execute = () => get().driver.execute(get().sql);
        const result =
          mode === "transaction"
            ? await get().driver.transaction(execute)
            : await execute();
        const historyEntry: QueryHistoryEntry = {
          id: crypto.randomUUID(),
          label:
            get()
              .sql.split("\n")
              .find((line) => line.trim() && !line.trim().startsWith("--"))
              ?.trim()
              .slice(0, 32) ?? "Untitled query",
          sql: get().sql,
          executedAt: new Date().toISOString(),
          status: "success",
        };
        get().addHistory(historyEntry);
        set({
          result,
          isRunning: false,
          connectionStatus: "connected",
          toast: "Query completed successfully",
        });
        window.setTimeout(() => set({ toast: null }), 2200);
      } catch (error) {
        get().addHistory({
          id: crypto.randomUUID(),
          label: "Query failed",
          sql: get().sql,
          executedAt: new Date().toISOString(),
          status: "error",
        });
        set({
          isRunning: false,
          toast: error instanceof Error ? error.message : "Query failed",
        });
      }
    },
    loadMetadata: async () => {
      try {
        await driverReady;
        const metadata = await get().driver.metadata();
        set({
          metadata,
          selectedTable: metadata.tables[0]
            ? `${metadata.tables[0].schema}.${metadata.tables[0].name}`
            : "",
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
        set({
          driver: nextDriver,
          driverKind: nextDriver.kind,
          connectionName: config.name,
          connectionStatus: "connected",
          connectionError: null,
          metadata,
          selectedTable: metadata.tables[0]
            ? `${metadata.tables[0].schema}.${metadata.tables[0].name}`
            : "",
          sql: nextSql,
          result: null,
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
