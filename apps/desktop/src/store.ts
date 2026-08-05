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
import { appendQueryChunk } from "@queryx/core";
import {
  loadConnectionProfiles,
  persistConnectionProfiles,
} from "./connectionProfiles";
import {
  loadWorkspaceSnapshot,
  persistWorkspaceSnapshot,
} from "./workspaceStorage";

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

export interface MigrationHistoryEntry {
  id: string;
  baselineLabel: string;
  targetLabel: string;
  driver: DriverKind;
  createdAt: string;
  changeCount: number;
  added: number;
  removed: number;
  manual: number;
  migrationSql: string;
  rollbackSql: string;
  privilegePreflightSql: string;
  status: "preview" | "applied";
  appliedAt?: string;
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
  migrationHistory: MigrationHistoryEntry[];
  connectionProfiles: ConnectionProfile[];
  connectionProfilesLoaded: boolean;
  workspaceLoaded: boolean;
  workspaceRestored: boolean;
  driver: DatabaseDriver;
  driverKind: DriverKind;
  readOnlyConnection: boolean;
  connectionName: string;
  connectionStatus: "connecting" | "connected" | "error";
  connectionError: string | null;
  transactionActive: boolean;
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
      historySql?: string;
      stream?: boolean;
      batch?: { statements: readonly string[]; expectedRows: number };
    },
  ) => Promise<QueryResult | null>;
  appendResult: (result: QueryResult) => void;
  cancelQuery: () => void;
  loadMetadata: () => Promise<void>;
  loadWorkspace: () => Promise<boolean>;
  loadConnectionProfiles: () => Promise<void>;
  saveConnectionProfile: (
    draft: ConnectionProfileDraft,
  ) => Promise<ConnectionProfile>;
  deleteConnectionProfile: (id: string) => Promise<void>;
  duplicateConnectionProfile: (id: string) => Promise<ConnectionProfile | null>;
  testDatabaseConnection: (
    config: DriverConfig,
  ) => Promise<{ ok: boolean; error?: string }>;
  inspectConnectionMetadata: (
    config: DriverConfig,
  ) => Promise<DatabaseMetadata>;
  connectDatabase: (config: DriverConfig) => Promise<boolean>;
  beginTransaction: () => Promise<void>;
  commitTransaction: () => Promise<void>;
  rollbackTransaction: () => Promise<void>;
  notify: (message: string) => void;
  addHistory: (entry: QueryHistoryEntry) => void;
  clearHistory: () => void;
  addMigrationHistory: (entry: MigrationHistoryEntry) => void;
  clearMigrationHistory: () => void;
  markMigrationApplied: (id: string) => void;
  toggleFavorite: (sql: string) => boolean;
}

const historyStorageKey = "queryx:query-history";
const favoritesStorageKey = "queryx:query-favorites";
const migrationHistoryStorageKey = "queryx:migration-history";
const workspaceTabsStorageKey = "queryx:workspace-tabs";

interface QueryWorkspaceSnapshot {
  version: 1;
  tabs: QueryTab[];
  activeTabId: string;
}

function persistWorkspaceState(
  state: Pick<
    QueryState,
    "tabs" | "activeTabId" | "history" | "favorites" | "migrationHistory"
  >,
): void {
  void persistWorkspaceSnapshot({
    version: 1,
    tabs: state.tabs,
    activeTabId: state.activeTabId,
    history: state.history,
    favorites: state.favorites,
    migrationHistory: state.migrationHistory,
  }).catch(() => undefined);
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

function readMigrationHistory(): MigrationHistoryEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const stored = window.localStorage.getItem(migrationHistoryStorageKey);
    return stored
      ? (JSON.parse(stored) as MigrationHistoryEntry[]).slice(0, 30)
      : [];
  } catch {
    return [];
  }
}

function writeMigrationHistory(history: MigrationHistoryEntry[]): void {
  try {
    window.localStorage.setItem(
      migrationHistoryStorageKey,
      JSON.stringify(history.slice(0, 30)),
    );
  } catch {
    // Local persistence is best-effort until the Tauri SQLite store lands.
  }
}

function clearStoredMigrationHistory(): void {
  try {
    window.localStorage.removeItem(migrationHistoryStorageKey);
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

const mysqlInitialSql = `-- Revenue by day · last 30 days
SELECT
  DATE(created_at) AS day,
  COUNT(*) AS orders,
  SUM(total_amount) AS revenue
FROM orders
WHERE created_at >= CURRENT_DATE - INTERVAL 30 DAY
  AND status = 'paid'
GROUP BY DATE(created_at)
ORDER BY day DESC;`;

function initialSqlForDriver(kind: DriverKind): string {
  if (kind === "sqlite") return sqliteInitialSql;
  if (kind === "mysql") return mysqlInitialSql;
  return postgresInitialSql;
}

export const useQueryStore = create<QueryState>((set, get) => {
  const driver = createRuntimeDriver();
  let activeQueryController: AbortController | null = null;
  const initialSql = initialSqlForDriver(driver.kind);
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
    migrationHistory: readMigrationHistory(),
    connectionProfiles: [],
    connectionProfilesLoaded: false,
    workspaceLoaded: false,
    driver,
    driverKind: driver.kind,
    readOnlyConnection: driver.isReadOnly(),
    connectionName: driver.kind === "sqlite" ? "local-demo" : "production-db",
    connectionStatus: "connecting",
    connectionError: null,
    transactionActive: false,
    setSql: (sql) => {
      set((state) => {
        const tabs = state.tabs.map((tab) =>
          tab.id === state.activeTabId ? { ...tab, sql, isDirty: true } : tab,
        );
        writeWorkspaceTabs(tabs, state.activeTabId);
        return { sql, tabs };
      });
      persistWorkspaceState(get());
    },
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
      persistWorkspaceState(get());
      return id;
    },
    selectQuery: (id) => {
      const tab = get().tabs.find((candidate) => candidate.id === id);
      if (tab) {
        writeWorkspaceTabs(get().tabs, id);
        set({ activeTabId: id, sql: tab.sql });
        persistWorkspaceState(get());
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
        persistWorkspaceState(get());
        return;
      }
      if (state.activeTabId !== id) {
        writeWorkspaceTabs(remaining, state.activeTabId);
        set({ tabs: remaining });
        persistWorkspaceState(get());
        return;
      }
      const replacement = remaining[Math.min(index, remaining.length - 1)];
      writeWorkspaceTabs(remaining, replacement.id);
      set({
        tabs: remaining,
        activeTabId: replacement.id,
        sql: replacement.sql,
      });
      persistWorkspaceState(get());
    },
    setFilter: (filter) => set({ filter }),
    setResultView: (resultView) => set({ resultView }),
    setSelectedObject: (selectedObject) => set({ selectedObject }),
    runQuery: async (
      mode = "normal",
      sqlOverride?: string,
      options?: {
        preserveResult?: boolean;
        historySql?: string;
        stream?: boolean;
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
        const historySql = options?.historySql?.trim() || executedSql;
        if (options?.stream && !options.preserveResult) set({ result: null });
        const appendChunk = (chunk: Parameters<typeof appendQueryChunk>[1]) => {
          set((state) => {
            const current = state.result ?? {
              columns: [],
              rows: [],
              executionTime: 0,
              affectedRows: 0,
              warnings: [],
            };
            return { result: appendQueryChunk(current, chunk) };
          });
        };
        const execute = () =>
          options?.batch
            ? get().driver.executeBatch(
                options.batch.statements,
                options.batch.expectedRows,
                controller.signal,
              )
            : options?.stream
              ? get().driver.executeStream(
                  executedSql,
                  appendChunk,
                  controller.signal,
                )
              : get().driver.execute(executedSql, controller.signal);
        const result =
          options?.batch || mode !== "transaction"
            ? await execute()
            : await get().driver.transaction(execute);
        const completedResult = options?.stream
          ? {
              ...(get().result ?? result),
              columns:
                result.columns.length > 0
                  ? result.columns
                  : (get().result?.columns ?? []),
              executionTime: result.executionTime,
              affectedRows: result.affectedRows,
              warnings: [
                ...new Set([
                  ...(get().result?.warnings ?? []),
                  ...result.warnings,
                ]),
              ],
              error: result.error,
            }
          : result;
        const historyEntry: QueryHistoryEntry = {
          id: crypto.randomUUID(),
          label: mode === "explain" ? "Explain plan" : queryLabel(historySql),
          sql: historySql,
          executedAt: new Date().toISOString(),
          status: "success",
        };
        get().addHistory(historyEntry);
        set({
          ...(options?.preserveResult ? {} : { result: completedResult }),
          executionStatus: "success",
          connectionStatus: "connected",
          toast:
            mode === "explain"
              ? "Explain plan completed; the statement was not executed"
              : "Query completed successfully",
        });
        globalThis.setTimeout(() => set({ toast: null }), 2200);
        return completedResult;
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
          sql: options?.historySql?.trim() || sqlOverride?.trim() || get().sql,
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
    loadWorkspace: async () => {
      const result = await loadWorkspaceSnapshot(get().tabs);
      const activeTab =
        result.snapshot.tabs.find(
          (tab) => tab.id === result.snapshot.activeTabId,
        ) ?? result.snapshot.tabs[0];
      set({
        tabs: result.snapshot.tabs,
        activeTabId: result.snapshot.activeTabId,
        sql: activeTab.sql,
        history: result.snapshot.history,
        favorites: result.snapshot.favorites,
        migrationHistory: result.snapshot.migrationHistory,
        workspaceRestored: result.restored,
        workspaceLoaded: true,
      });
      if (result.migratedFromBrowser) persistWorkspaceState(get());
      return result.restored;
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
        passwordStored: false,
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
    inspectConnectionMetadata: async (config) => {
      const inspectDriver = createRuntimeDriver(config.kind);
      try {
        await inspectDriver.connect({ ...config, readOnly: true });
        return await inspectDriver.metadata();
      } finally {
        await inspectDriver.disconnect().catch(() => undefined);
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
        const nextSql = initialSqlForDriver(nextDriver.kind);
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
          readOnlyConnection: nextDriver.isReadOnly(),
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
          transactionActive: false,
          toast: `Connected to ${config.name}`,
        });
        persistWorkspaceState(get());
        window.setTimeout(() => set({ toast: null }), 2200);
        return true;
      } catch (error) {
        await nextDriver.disconnect().catch(() => undefined);
        const message = error instanceof Error ? error.message : String(error);
        set({
          connectionStatus: "error",
          connectionError: message,
          toast: message,
        });
        return false;
      }
    },
    beginTransaction: async () => {
      if (get().transactionActive) return;
      await driverReady;
      await get().driver.beginTransaction();
      set({ transactionActive: true, toast: "Transaction started" });
      globalThis.setTimeout(() => set({ toast: null }), 2200);
    },
    commitTransaction: async () => {
      if (!get().transactionActive) return;
      await driverReady;
      try {
        await get().driver.commitTransaction();
        set({ transactionActive: false, toast: "Transaction committed" });
        globalThis.setTimeout(() => set({ toast: null }), 2200);
      } catch (error) {
        set({ transactionActive: false });
        throw error;
      }
    },
    rollbackTransaction: async () => {
      if (!get().transactionActive) return;
      await driverReady;
      try {
        await get().driver.rollbackTransaction();
        set({ transactionActive: false, toast: "Transaction rolled back" });
        globalThis.setTimeout(() => set({ toast: null }), 2200);
      } catch (error) {
        set({ transactionActive: false });
        throw error;
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
      persistWorkspaceState(get());
    },
    clearHistory: () => {
      clearStoredHistory();
      set({ history: [] });
      persistWorkspaceState(get());
    },
    addMigrationHistory: (entry) => {
      const history = [
        entry,
        ...get().migrationHistory.filter(
          (item) =>
            item.migrationSql !== entry.migrationSql ||
            item.baselineLabel !== entry.baselineLabel ||
            item.targetLabel !== entry.targetLabel,
        ),
      ];
      writeMigrationHistory(history);
      const migrationHistory = history.slice(0, 30);
      set({ migrationHistory });
      persistWorkspaceState({ ...get(), migrationHistory });
    },
    clearMigrationHistory: () => {
      clearStoredMigrationHistory();
      set({ migrationHistory: [] });
      persistWorkspaceState({ ...get(), migrationHistory: [] });
    },
    markMigrationApplied: (id) => {
      const appliedAt = new Date().toISOString();
      const migrationHistory = get().migrationHistory.map((entry) =>
        entry.id === id
          ? { ...entry, status: "applied" as const, appliedAt }
          : entry,
      );
      writeMigrationHistory(migrationHistory);
      set({ migrationHistory });
      persistWorkspaceState({ ...get(), migrationHistory });
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
      persistWorkspaceState(get());
      return !existing;
    },
  };
});

export { mysqlInitialSql, postgresInitialSql, sqliteInitialSql };
