import { create } from "zustand";
import type {
  ConnectionProfile,
  DatabaseDriver,
  DatabaseMetadata,
  DriverConfig,
  DriverKind,
  QueryResult,
} from "@queryx/shared";
import { createRuntimeDriver } from "./nativeDriver";
import {
  loadConnectionProfiles,
  persistConnectionProfiles,
} from "./connectionProfiles";

type ResultView = "table" | "json";
export type RunMode = "normal" | "transaction" | "execute-anyway" | "explain";
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

export interface QueryFavorite {
  id: string;
  label: string;
  sql: string;
  createdAt: string;
}

export type ConnectionProfileDraft = Omit<ConnectionProfile, "id"> & {
  id?: string;
};

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
      routineKind: "function" | "procedure" | "aggregate" | "window";
    }
  | { kind: "trigger"; id: string; schema: string; name: string }
  | { kind: "eventTrigger"; id: string; name: string };

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
  canExplain: boolean;
  toast: string | null;
  history: QueryHistoryEntry[];
  favorites: QueryFavorite[];
  connectionProfiles: ConnectionProfile[];
  connectionProfilesLoaded: boolean;
  workspaceRestored: boolean;
  driver: DatabaseDriver;
  driverKind: DriverKind;
  connectionName: string;
  connectionStatus: "connecting" | "connected" | "error";
  connectionError: string | null;
  setSql: (sql: string) => void;
  newQuery: () => string;
  selectQuery: (id: string) => void;
  closeQuery: (id: string) => void;
  setFilter: (filter: string) => void;
  setResultView: (view: ResultView) => void;
  setSelectedObject: (object: SelectedDatabaseObject | null) => void;
  runQuery: (
    mode?: RunMode,
    sqlOverride?: string,
    options?: {
      preserveResult?: boolean;
      batch?: { statements: readonly string[]; expectedRows: number };
    },
  ) => Promise<QueryResult | null>;
  appendResult: (result: QueryResult) => void;
  cancelQuery: () => void;
  loadMetadata: () => Promise<void>;
  loadConnectionProfiles: () => Promise<void>;
  saveConnectionProfile: (
    draft: ConnectionProfileDraft,
  ) => Promise<ConnectionProfile>;
  deleteConnectionProfile: (id: string) => Promise<void>;
  duplicateConnectionProfile: (id: string) => Promise<ConnectionProfile | null>;
  testDatabaseConnection: (
    config: DriverConfig,
  ) => Promise<{ ok: boolean; error?: string }>;
  connectDatabase: (config: DriverConfig) => Promise<boolean>;
  notify: (message: string) => void;
  addHistory: (entry: QueryHistoryEntry) => void;
  clearHistory: () => void;
  toggleFavorite: (sql: string) => boolean;
}

const historyStorageKey = "queryx:query-history";
const favoritesStorageKey = "queryx:query-favorites";
const workspaceTabsStorageKey = "queryx:workspace-tabs";

interface QueryWorkspaceSnapshot {
  version: 1;
  tabs: QueryTab[];
  activeTabId: string;
}

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
  if (trigger)
    return {
      kind: "trigger",
      id: trigger.id,
      schema: trigger.schema,
      name: trigger.name,
    };
  const eventTrigger = metadata.eventTriggers[0];
  return eventTrigger
    ? { kind: "eventTrigger", id: eventTrigger.id, name: eventTrigger.name }
    : null;
}

function objectStillExists(
  metadata: DatabaseMetadata,
  selected: SelectedDatabaseObject,
): boolean {
  if (selected.kind === "table" || selected.kind === "view") {
    const relations =
      selected.kind === "table" ? metadata.tables : metadata.views;
    return relations.some(
      (relation) =>
        relation.schema === selected.schema && relation.name === selected.name,
    );
  }
  if (selected.kind === "routine") {
    return metadata.routines.some((routine) => routine.id === selected.id);
  }
  if (selected.kind === "trigger") {
    return metadata.triggers.some((trigger) => trigger.id === selected.id);
  }
  if (selected.kind === "eventTrigger") {
    return metadata.eventTriggers.some(
      (eventTrigger) => eventTrigger.id === selected.id,
    );
  }
  return false;
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

function clearStoredHistory(): void {
  try {
    window.localStorage.removeItem(historyStorageKey);
  } catch {
    // Local persistence is best-effort until the Tauri SQLite store lands.
  }
}

function readFavorites(): QueryFavorite[] {
  if (typeof window === "undefined") return [];
  try {
    const stored = window.localStorage.getItem(favoritesStorageKey);
    return stored ? (JSON.parse(stored) as QueryFavorite[]).slice(0, 50) : [];
  } catch {
    return [];
  }
}

function writeFavorites(favorites: QueryFavorite[]): void {
  try {
    window.localStorage.setItem(
      favoritesStorageKey,
      JSON.stringify(favorites.slice(0, 50)),
    );
  } catch {
    // Local persistence is best-effort until the Tauri SQLite store lands.
  }
}

function readWorkspaceTabs(fallbackTabs: QueryTab[]): {
  tabs: QueryTab[];
  activeTabId: string;
  restored: boolean;
} {
  if (typeof window === "undefined") {
    return {
      tabs: fallbackTabs,
      activeTabId: fallbackTabs[0].id,
      restored: false,
    };
  }
  try {
    const stored = window.localStorage.getItem(workspaceTabsStorageKey);
    if (!stored) {
      return {
        tabs: fallbackTabs,
        activeTabId: fallbackTabs[0].id,
        restored: false,
      };
    }
    const parsed = JSON.parse(stored) as Partial<QueryWorkspaceSnapshot>;
    const validTabs = Array.isArray(parsed.tabs)
      ? parsed.tabs.filter(
          (tab): tab is QueryTab =>
            Boolean(tab) &&
            typeof tab.id === "string" &&
            typeof tab.title === "string" &&
            typeof tab.sql === "string" &&
            typeof tab.isDirty === "boolean",
        )
      : [];
    const tabs = validTabs.slice(0, 20);
    if (parsed.version !== 1 || tabs.length === 0) {
      return {
        tabs: fallbackTabs,
        activeTabId: fallbackTabs[0].id,
        restored: false,
      };
    }
    const activeTabId = tabs.some((tab) => tab.id === parsed.activeTabId)
      ? (parsed.activeTabId ?? tabs[0].id)
      : tabs[0].id;
    return { tabs, activeTabId, restored: true };
  } catch {
    return {
      tabs: fallbackTabs,
      activeTabId: fallbackTabs[0].id,
      restored: false,
    };
  }
}

function writeWorkspaceTabs(tabs: QueryTab[], activeTabId: string): void {
  try {
    const snapshot: QueryWorkspaceSnapshot = {
      version: 1,
      tabs: tabs.slice(0, 20),
      activeTabId,
    };
    window.localStorage.setItem(
      workspaceTabsStorageKey,
      JSON.stringify(snapshot),
    );
  } catch {
    // Local persistence is best-effort until the Tauri SQLite store lands.
  }
}

function queryLabel(sql: string): string {
  return (
    sql
      .split("\n")
      .find((line) => line.trim() && !line.trim().startsWith("--"))
      ?.trim()
      .slice(0, 32) ?? "Untitled query"
  );
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
  const defaultTabs: QueryTab[] = [
    {
      id: "query-1",
      title: "Daily revenue",
      sql: initialSql,
      isDirty: false,
    },
  ];
  const workspaceTabs = readWorkspaceTabs(defaultTabs);
  const activeWorkspaceTab =
    workspaceTabs.tabs.find((tab) => tab.id === workspaceTabs.activeTabId) ??
    workspaceTabs.tabs[0];
  let driverReady = driver.connect({
    kind: driver.kind,
    name: driver.kind === "sqlite" ? "local-demo" : "production-db",
    database: driver.kind === "sqlite" ? ":memory:" : "production",
  });
  return {
    sql: activeWorkspaceTab.sql,
    tabs: workspaceTabs.tabs,
    activeTabId: workspaceTabs.activeTabId,
    workspaceRestored: workspaceTabs.restored,
    result: null,
    metadata: null,
    selectedObject: null,
    resultView: "table",
    filter: "",
    isRunning: false,
    executionStatus: "idle",
    canCancel: driver.capabilities().has("cancel"),
    canExplain: driver.capabilities().has("explain"),
    toast: null,
    history: readHistory(),
    favorites: readFavorites(),
    connectionProfiles: [],
    connectionProfilesLoaded: false,
    driver,
    driverKind: driver.kind,
    connectionName: driver.kind === "sqlite" ? "local-demo" : "production-db",
    connectionStatus: "connecting",
    connectionError: null,
    setSql: (sql) =>
      set((state) => {
        const tabs = state.tabs.map((tab) =>
          tab.id === state.activeTabId ? { ...tab, sql, isDirty: true } : tab,
        );
        writeWorkspaceTabs(tabs, state.activeTabId);
        return { sql, tabs };
      }),
    newQuery: () => {
      const id = crypto.randomUUID();
      const nextNumber = get().tabs.length + 1;
      const tab: QueryTab = {
        id,
        title: `Query ${nextNumber}`,
        sql: "",
        isDirty: false,
      };
      set((state) => {
        const tabs = [...state.tabs, tab];
        writeWorkspaceTabs(tabs, id);
        return { tabs, activeTabId: id, sql: tab.sql };
      });
      return id;
    },
    selectQuery: (id) => {
      const tab = get().tabs.find((candidate) => candidate.id === id);
      if (tab) {
        writeWorkspaceTabs(get().tabs, id);
        set({ activeTabId: id, sql: tab.sql });
      }
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
        writeWorkspaceTabs([replacement], replacement.id);
        set({ tabs: [replacement], activeTabId: replacement.id, sql: "" });
        return;
      }
      if (state.activeTabId !== id) {
        writeWorkspaceTabs(remaining, state.activeTabId);
        set({ tabs: remaining });
        return;
      }
      const replacement = remaining[Math.min(index, remaining.length - 1)];
      writeWorkspaceTabs(remaining, replacement.id);
      set({
        tabs: remaining,
        activeTabId: replacement.id,
        sql: replacement.sql,
      });
    },
    setFilter: (filter) => set({ filter }),
    setResultView: (resultView) => set({ resultView }),
    setSelectedObject: (selectedObject) => set({ selectedObject }),
    runQuery: async (
      mode = "normal",
      sqlOverride?: string,
      options?: {
        preserveResult?: boolean;
        batch?: { statements: readonly string[]; expectedRows: number };
      },
    ) => {
      if (get().isRunning) return null;
      const controller = new AbortController();
      activeQueryController = controller;
      set({ isRunning: true, executionStatus: "running" });
      try {
        await driverReady;
        const executedSql = sqlOverride?.trim() || get().sql;
        const execute = () =>
          options?.batch
            ? get().driver.executeBatch(
                options.batch.statements,
                options.batch.expectedRows,
                controller.signal,
              )
            : get().driver.execute(executedSql, controller.signal);
        const result =
          options?.batch || mode !== "transaction"
            ? await execute()
            : await get().driver.transaction(execute);
        const historyEntry: QueryHistoryEntry = {
          id: crypto.randomUUID(),
          label: mode === "explain" ? "Explain plan" : queryLabel(executedSql),
          sql: executedSql,
          executedAt: new Date().toISOString(),
          status: "success",
        };
        get().addHistory(historyEntry);
        set({
          ...(options?.preserveResult ? {} : { result }),
          executionStatus: "success",
          connectionStatus: "connected",
          toast:
            mode === "explain"
              ? "Explain plan completed; the statement was not executed"
              : "Query completed successfully",
        });
        window.setTimeout(() => set({ toast: null }), 2200);
        return result;
      } catch (error) {
        const wasCancelled =
          error instanceof DOMException && error.name === "AbortError";
        get().addHistory({
          id: crypto.randomUUID(),
          label: wasCancelled
            ? "Query cancelled"
            : mode === "explain"
              ? "Explain failed"
              : "Query failed",
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
        return null;
      } finally {
        if (activeQueryController === controller) {
          activeQueryController = null;
          set({ isRunning: false });
        }
      }
    },
    appendResult: (nextResult) =>
      set((state) => {
        if (!state.result) return { result: nextResult };
        const columnsMatch =
          state.result.columns.map((column) => column.name).join("\u0000") ===
          nextResult.columns.map((column) => column.name).join("\u0000");
        if (!columnsMatch) return { result: nextResult };
        return {
          result: {
            ...state.result,
            rows: [...state.result.rows, ...nextResult.rows],
            executionTime:
              state.result.executionTime + nextResult.executionTime,
            warnings: [
              ...new Set([...state.result.warnings, ...nextResult.warnings]),
            ],
          },
        };
      }),
    cancelQuery: () => {
      if (!get().isRunning || !get().canCancel) return;
      activeQueryController?.abort();
      set({ toast: "Cancelling query…" });
    },
    loadMetadata: async () => {
      try {
        await driverReady;
        const metadata = await get().driver.metadata();
        const selected = get().selectedObject;
        set({
          metadata,
          canCancel: get().driver.capabilities().has("cancel"),
          canExplain: get().driver.capabilities().has("explain"),
          selectedObject:
            selected && objectStillExists(metadata, selected)
              ? selected
              : defaultObject(metadata),
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
    loadConnectionProfiles: async () => {
      const profiles = await loadConnectionProfiles();
      set({ connectionProfiles: profiles, connectionProfilesLoaded: true });
    },
    saveConnectionProfile: async (draft) => {
      const profile: ConnectionProfile = {
        ...draft,
        id: draft.id ?? crypto.randomUUID(),
      };
      const profiles = [
        profile,
        ...get().connectionProfiles.filter((item) => item.id !== profile.id),
      ];
      await persistConnectionProfiles(profiles);
      set({ connectionProfiles: profiles });
      return profile;
    },
    deleteConnectionProfile: async (id) => {
      const profiles = get().connectionProfiles.filter(
        (profile) => profile.id !== id,
      );
      await persistConnectionProfiles(profiles);
      set({ connectionProfiles: profiles });
    },
    duplicateConnectionProfile: async (id) => {
      const source = get().connectionProfiles.find(
        (profile) => profile.id === id,
      );
      if (!source) return null;
      return get().saveConnectionProfile({
        ...source,
        id: undefined,
        name: `${source.name} copy`,
      });
    },
    testDatabaseConnection: async (config) => {
      const testDriver = createRuntimeDriver(config.kind);
      try {
        await testDriver.connect(config);
        await testDriver.metadata();
        return { ok: true };
      } catch (error) {
        return {
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        };
      } finally {
        await testDriver.disconnect().catch(() => undefined);
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
        const currentTabs = get().tabs;
        const currentActiveTabId = get().activeTabId;
        const activeTab = currentTabs.find(
          (tab) => tab.id === currentActiveTabId,
        );
        const shouldReplaceSql = activeTab ? !activeTab.isDirty : false;
        const nextTabs = shouldReplaceSql
          ? currentTabs.map((tab) =>
              tab.id === currentActiveTabId
                ? { ...tab, sql: nextSql, isDirty: false }
                : tab,
            )
          : currentTabs;
        writeWorkspaceTabs(nextTabs, currentActiveTabId);
        set({
          driver: nextDriver,
          driverKind: nextDriver.kind,
          canCancel: nextDriver.capabilities().has("cancel"),
          canExplain: nextDriver.capabilities().has("explain"),
          connectionName: config.name,
          connectionStatus: "connected",
          connectionError: null,
          metadata,
          selectedObject: defaultObject(metadata),
          sql: shouldReplaceSql ? nextSql : get().sql,
          tabs: nextTabs,
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
    clearHistory: () => {
      clearStoredHistory();
      set({ history: [] });
    },
    toggleFavorite: (sql) => {
      const normalizedSql = sql.trim();
      if (!normalizedSql) return false;
      const existing = get().favorites.find(
        (favorite) => favorite.sql === normalizedSql,
      );
      const favorites = existing
        ? get().favorites.filter((favorite) => favorite.id !== existing.id)
        : [
            {
              id: crypto.randomUUID(),
              label: queryLabel(normalizedSql),
              sql: normalizedSql,
              createdAt: new Date().toISOString(),
            },
            ...get().favorites,
          ];
      writeFavorites(favorites);
      set({ favorites });
      return !existing;
    },
  };
});

export { postgresInitialSql, sqliteInitialSql };
