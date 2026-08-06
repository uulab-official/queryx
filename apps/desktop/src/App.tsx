import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent,
  type ChangeEvent,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { isTauri } from "@tauri-apps/api/core";
import { relaunch } from "@tauri-apps/plugin-process";
import { check } from "@tauri-apps/plugin-updater";
import {
  buildAddColumnPlan,
  buildAddForeignKeyPlan,
  buildAlterViewPlan,
  buildCsvImportPlan,
  buildCreateTablePlan,
  buildCreateIndexPlan,
  buildCreateViewPlan,
  buildDataCountSql,
  buildDataSelectSql,
  buildDataSyncSql,
  buildDataSyncStatements,
  buildEditTableColumnsPlan,
  buildDropIndexPlan,
  buildDropForeignKeyPlan,
  buildDropViewPlan,
  buildErdDiagram,
  buildSchemaMigrationStatements,
  buildRowsToSqlDeleteStatements,
  buildRowsToSqlUpdateStatements,
  buildDependencyIndex,
  buildForeignKeyIndex,
  buildExplainQuery,
  buildQueryPagePlan,
  buildSchemaMigrationSql,
  buildSchemaPrivilegePreflightSql,
  buildSchemaRollbackSql,
  buildTableBrowsePlan,
  buildTableRowInsertPlan,
  compareSchemaSnapshots,
  compareTableData,
  dataCompareMaxRows,
  defaultCsvImportMappings,
  findTable,
  formatSql,
  findLongRunningSessions,
  inferImportType,
  inspectQuerySafety,
  parseCsv,
  parseJsonRows,
  serializeRowsToCsv,
  serializeRowsToExcelXml,
  serializeRowsToJson,
  serializeRowsToMarkdown,
  serializeRowsToSqlDelete,
  serializeRowsToSqlInsert,
  serializeRowsToSqlUpdate,
  serializeRowsToTsv,
} from "@queryx/core";
import type {
  AddColumnInput,
  AddColumnPlan,
  AddForeignKeyInput,
  AddForeignKeyPlan,
  AlterViewPlan,
  CsvImportMapping,
  CsvImportPlan,
  DataCompareResult,
  CreateTableColumnInput,
  CreateTablePlan,
  CreateIndexInput,
  CreateIndexPlan,
  CreateViewPlan,
  DropIndexPlan,
  DropForeignKeyPlan,
  DropViewPlan,
  EditTableColumnInput,
  EditTableColumnsPlan,
  ErdNode,
  ForeignKeyRelations,
  ImportConflictPolicy,
  ImportValueType,
  ObjectDependencies,
  QuerySafetyReport,
  SqlRowDelete,
  SqlRowUpdate,
  SchemaDiff,
  TableRowInsertPlan,
  TableRowInsertValue,
  TableBrowseSortDirection,
} from "@queryx/core";
import type {
  DatabaseLock,
  ConnectionProfile,
  DatabaseSession,
  DatabaseObjectRef,
  DependencyKind,
  DriverConfig,
  DriverKind,
  EventTriggerMetadata,
  DatabaseMetadata,
  RelationRef,
  QueryResult,
  RoutineMetadata,
  SessionAuditEntry,
  TableMetadata,
  TriggerMetadata,
  ViewMetadata,
} from "@queryx/shared";
import type { SqlCompletion, SqlEditorHandle } from "./SqlEditor";
import { saveTextFile } from "./exportCsv";
import {
  deleteConnectionPassword,
  loadConnectionPassword,
  saveConnectionPassword,
} from "./connectionSecrets";
import { getVirtualRowWindow } from "./resultGrid";
import { createRuntimeDriver } from "./nativeDriver";
import {
  useQueryStore,
  sessionAuditRetentionOptions,
  type ConnectionProfileDraft,
  type MigrationHistoryEntry,
  type RunMode,
} from "./store";

const MonacoSqlEditor = lazy(async () => {
  const module = await import("./SqlEditor");
  return { default: module.SqlEditor };
});

const resultRowKeys = new WeakMap<Record<string, unknown>, string>();
const longQueryThresholdStorageKey = "queryx:long-query-threshold-ms";
const longQueryThresholdOptions = [5_000, 30_000, 60_000, 300_000];

function readLongQueryThresholdMs(): number {
  if (typeof window === "undefined") return longQueryThresholdOptions[0];
  try {
    const stored = Number(
      window.localStorage.getItem(longQueryThresholdStorageKey),
    );
    return longQueryThresholdOptions.includes(stored)
      ? stored
      : longQueryThresholdOptions[0];
  } catch {
    return longQueryThresholdOptions[0];
  }
}
let nextResultRowKey = 0;
const resultPageSize = 100;
const minColumnWidth = 88;
const maxColumnWidth = 520;
const tableBrowsePageSize = 100;
type ExportFormat = "csv" | "json" | "sql" | "markdown" | "excel";

function driverDisplayName(kind: DriverKind): string {
  if (kind === "sqlite") return "SQLite";
  if (kind === "mysql") return "MySQL / MariaDB";
  if (kind === "sqlserver") return "SQL Server";
  if (kind === "oracle") return "Oracle";
  return "PostgreSQL";
}

function driverShortName(kind: DriverKind): string {
  if (kind === "sqlite") return "SQ";
  if (kind === "mysql") return "MY";
  if (kind === "sqlserver") return "MS";
  if (kind === "oracle") return "OR";
  return "PG";
}

function scalarCount(result: QueryResult): number {
  const value = Object.values(result.rows[0] ?? {})[0];
  const count = typeof value === "number" ? value : Number(value);
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new Error("Database returned an invalid row count");
  }
  return count;
}

function resultRowKey(row: Record<string, unknown>): string {
  const existing = resultRowKeys.get(row);
  if (existing) return existing;
  const key = `query-result-row-${nextResultRowKey++}`;
  resultRowKeys.set(row, key);
  return key;
}

type GridPoint = { row: number; column: number };
type GridSelection =
  | { kind: "cells"; anchor: GridPoint; focus: GridPoint }
  | { kind: "rows"; anchor: number; focus: number };

type EditingCell = {
  rowKey: string;
  columnName: string;
  row: Record<string, unknown>;
};

type StagedRowEdit = SqlRowUpdate & { rowKey: string };

interface TableBrowseState {
  schema: string;
  name: string;
  offset: number;
  hasMore: boolean;
  filter: string;
  sortBy: string | null;
  sortDirection: TableBrowseSortDirection;
  warnings: string[];
}

interface ServerQueryPageState {
  sql: string;
  offset: number;
  hasMore: boolean;
}

interface PaletteCommand {
  id: string;
  label: string;
  hint: string;
  disabled?: boolean;
  execute: () => void;
}

interface QuickOpenItem {
  id: string;
  label: string;
  sql: string;
  detail: string;
  kind: "favorite" | "history";
}

function rangeBounds(first: number, second: number): [number, number] {
  return first <= second ? [first, second] : [second, first];
}

function pageWindow(page: number, pageCount: number): number[] {
  const visiblePageCount = Math.min(5, pageCount);
  const start = Math.min(
    Math.max(0, page - 2),
    Math.max(0, pageCount - visiblePageCount),
  );
  return Array.from({ length: visiblePageCount }, (_, index) => start + index);
}

function defaultColumnWidth(type: string): number {
  const normalizedType = type.toLowerCase();
  if (
    normalizedType.includes("bool") ||
    normalizedType.includes("int") ||
    normalizedType.includes("numeric") ||
    normalizedType.includes("decimal")
  ) {
    return 118;
  }
  if (
    normalizedType.includes("date") ||
    normalizedType.includes("time") ||
    normalizedType.includes("timestamp")
  ) {
    return 168;
  }
  return 184;
}

function isCellInSelection(
  selection: GridSelection | null,
  row: number,
  column: number,
): boolean {
  if (!selection) return false;
  if (selection.kind === "rows") {
    const [start, end] = rangeBounds(selection.anchor, selection.focus);
    return row >= start && row <= end;
  }
  const [startRow, endRow] = rangeBounds(
    selection.anchor.row,
    selection.focus.row,
  );
  const [startColumn, endColumn] = rangeBounds(
    selection.anchor.column,
    selection.focus.column,
  );
  return (
    row >= startRow &&
    row <= endRow &&
    column >= startColumn &&
    column <= endColumn
  );
}

type UiIconName =
  | "explorer"
  | "search"
  | "commands"
  | "connections"
  | "sessions"
  | "locks"
  | "diagnostics"
  | "audit"
  | "help"
  | "refresh"
  | "settings"
  | "update";

function UiIcon({ name, size = 16 }: { name: UiIconName; size?: number }) {
  const paths: Record<UiIconName, ReactNode> = {
    explorer: (
      <>
        <rect x="3" y="3" width="18" height="18" rx="4" />
        <path d="M3 9h18M9 9v12M15 9v12" />
      </>
    ),
    search: (
      <>
        <circle cx="10.5" cy="10.5" r="6.5" />
        <path d="m16 16 5 5" />
      </>
    ),
    commands: (
      <>
        <path d="m8 7 5 5-5 5M15 17h4" />
        <path d="M4 4h16v16H4z" opacity="0.35" />
      </>
    ),
    connections: (
      <>
        <path d="M8 3v6M16 3v6M5 9h14v3a7 7 0 0 1-14 0V9Z" />
        <path d="M12 19v2M9 21h6" />
      </>
    ),
    sessions: (
      <>
        <circle cx="12" cy="7" r="3" />
        <path d="M6 21v-2a6 6 0 0 1 12 0v2M4 12h16" />
      </>
    ),
    locks: (
      <>
        <path d="M8 7h8M8 17h8" />
        <circle cx="5" cy="7" r="2" />
        <circle cx="19" cy="17" r="2" />
        <path d="M7 8.5 17 15.5" />
      </>
    ),
    diagnostics: (
      <>
        <path d="M3 17h3l2-7 4 11 2-7h7" />
        <path d="M3 5h18" />
      </>
    ),
    audit: (
      <>
        <circle cx="12" cy="12" r="8" />
        <path d="M12 8v4l3 2" />
      </>
    ),
    help: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M9.7 9a2.5 2.5 0 1 1 4 2c-1.2.8-1.7 1.3-1.7 2.5M12 17h.01" />
      </>
    ),
    refresh: (
      <>
        <path d="M20 11a8 8 0 0 0-14.7-3L4 10" />
        <path d="M4 5v5h5M4 13a8 8 0 0 0 14.7 3L20 14" />
        <path d="M20 19v-5h-5" />
      </>
    ),
    settings: (
      <>
        <path d="M4 7h10M18 7h2M4 17h2M10 17h10" />
        <circle cx="16" cy="7" r="2" />
        <circle cx="8" cy="17" r="2" />
      </>
    ),
    update: (
      <>
        <path d="M12 4v12M7 9l5-5 5 5M5 20h14" />
      </>
    ),
  };
  return (
    <svg
      className="ui-icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name]}
    </svg>
  );
}

function QueryXMark({ size = 26 }: { size?: number }) {
  return (
    <svg
      className="brand-svg"
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      aria-hidden="true"
    >
      <rect width="32" height="32" rx="9" fill="#E2FF67" />
      <circle cx="14" cy="14" r="7" stroke="#0B0D10" strokeWidth="3" />
      <path
        d="m19 19 6 6"
        stroke="#6EA8FF"
        strokeWidth="3"
        strokeLinecap="round"
      />
      <circle cx="14" cy="14" r="1.5" fill="#0B0D10" />
    </svg>
  );
}

type UpdateStatus =
  | "idle"
  | "checking"
  | "available"
  | "installing"
  | "up-to-date"
  | "error";

function UpdateButton({ onNotify }: { onNotify: (message: string) => void }) {
  const [update, setUpdate] = useState<Awaited<ReturnType<typeof check>>>(null);
  const [status, setStatus] = useState<UpdateStatus>("idle");
  const [progress, setProgress] = useState<number | null>(null);

  const checkForUpdates = useCallback(
    async (announce: boolean) => {
      if (!isTauri()) {
        if (announce)
          onNotify("Automatic updates are available in the desktop app");
        return;
      }
      try {
        setStatus("checking");
        const nextUpdate = await check();
        setUpdate(nextUpdate);
        if (nextUpdate) {
          setStatus("available");
          onNotify(`QueryX ${nextUpdate.version} is ready to install`);
        } else {
          setStatus("up-to-date");
          if (announce) onNotify("QueryX is up to date");
        }
      } catch (error) {
        setStatus("error");
        if (announce) {
          const detail =
            error instanceof Error ? error.message : "Unknown updater error";
          onNotify(`Update check failed: ${detail}`);
        }
      }
    },
    [onNotify],
  );

  const installUpdate = useCallback(async () => {
    if (!update) return;
    try {
      setStatus("installing");
      setProgress(0);
      let totalBytes = 0;
      let downloadedBytes = 0;
      await update.downloadAndInstall((event) => {
        if (event.event === "Started")
          totalBytes = event.data.contentLength ?? 0;
        if (event.event === "Progress") {
          downloadedBytes += event.data.chunkLength;
          if (totalBytes > 0) {
            setProgress(
              Math.min(100, Math.round((downloadedBytes / totalBytes) * 100)),
            );
          }
        }
        if (event.event === "Finished") setProgress(100);
      });
      await relaunch();
    } catch (error) {
      setStatus("error");
      const detail =
        error instanceof Error ? error.message : "Unknown updater error";
      onNotify(`Update installation failed: ${detail}`);
    }
  }, [onNotify, update]);

  useEffect(() => {
    if (!isTauri()) return;
    const timer = window.setTimeout(() => void checkForUpdates(false), 2_500);
    return () => window.clearTimeout(timer);
  }, [checkForUpdates]);

  const installing = status === "installing";
  const checking = status === "checking";
  const label = installing
    ? `Updating${progress === null ? "…" : ` ${progress}%`}`
    : update
      ? `Update ${update.version}`
      : "Check for updates";

  return (
    <button
      type="button"
      className={`icon-button update-button ${update ? "update-ready" : ""}`}
      aria-label={label}
      title={label}
      onClick={() =>
        update ? void installUpdate() : void checkForUpdates(true)
      }
      disabled={checking || installing}
    >
      <UiIcon name={update ? "update" : "refresh"} size={15} />
    </button>
  );
}

function App() {
  const {
    sql,
    tabs,
    activeTabId,
    result,
    metadata,
    selectedObject,
    resultView,
    filter,
    isRunning,
    executionStatus,
    canCancel,
    canExplain,
    toast,
    history,
    favorites,
    migrationHistory,
    sessionAudit,
    sessionAuditRetentionDays,
    connectionProfiles,
    connectionProfilesLoaded,
    driver,
    driverKind,
    readOnlyConnection,
    appendResult,
    connectionName,
    connectionStatus,
    connectionError,
    transactionActive,
    setSql,
    newQuery,
    selectQuery,
    closeQuery,
    setFilter,
    setResultView,
    setSelectedObject,
    runQuery,
    cancelQuery,
    loadWorkspace,
    loadMetadata,
    loadConnectionProfiles,
    saveConnectionProfile,
    deleteConnectionProfile,
    duplicateConnectionProfile,
    testDatabaseConnection,
    inspectConnectionMetadata,
    connectDatabase,
    beginTransaction,
    commitTransaction,
    rollbackTransaction,
    notify,
    clearHistory,
    addMigrationHistory,
    clearMigrationHistory,
    recordSessionAudit,
    clearSessionAudit,
    setSessionAuditRetentionDays,
    markMigrationApplied,
    toggleFavorite,
  } = useQueryStore();
  const [collapsed, setCollapsed] = useState<string[]>([]);
  const [sortBy, setSortBy] = useState<string | null>(null);
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");
  const [resultPage, setResultPage] = useState(0);
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>({});
  const [editingEnabled, setEditingEnabled] = useState(false);
  const [editingCell, setEditingCell] = useState<EditingCell | null>(null);
  const [editDraft, setEditDraft] = useState("");
  const [stagedEdits, setStagedEdits] = useState<Record<string, StagedRowEdit>>(
    {},
  );
  const [editPreviewOpen, setEditPreviewOpen] = useState(false);
  const [deletePreviewOpen, setDeletePreviewOpen] = useState(false);
  const [insertRowOpen, setInsertRowOpen] = useState(false);
  const [tableBrowse, setTableBrowse] = useState<TableBrowseState | null>(null);
  const [serverQueryPage, setServerQueryPage] =
    useState<ServerQueryPageState | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const [createTableOpen, setCreateTableOpen] = useState(false);
  const [addColumnOpen, setAddColumnOpen] = useState(false);
  const [editColumnsOpen, setEditColumnsOpen] = useState(false);
  const [createIndexOpen, setCreateIndexOpen] = useState(false);
  const [dropIndexOpen, setDropIndexOpen] = useState(false);
  const [addForeignKeyOpen, setAddForeignKeyOpen] = useState(false);
  const [dropForeignKeyOpen, setDropForeignKeyOpen] = useState(false);
  const [createViewOpen, setCreateViewOpen] = useState(false);
  const [alterViewOpen, setAlterViewOpen] = useState(false);
  const [dropViewOpen, setDropViewOpen] = useState(false);
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const [nullDisplay, setNullDisplay] = useState<"literal" | "empty">(
    "literal",
  );
  const [gridSelection, setGridSelection] = useState<GridSelection | null>(
    null,
  );
  const [gridScrollTop, setGridScrollTop] = useState(0);
  const [gridViewportHeight, setGridViewportHeight] = useState(480);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [commandQuery, setCommandQuery] = useState("");
  const [commandIndex, setCommandIndex] = useState(0);
  const [quickOpenOpen, setQuickOpenOpen] = useState(false);
  const [quickOpenQuery, setQuickOpenQuery] = useState("");
  const [quickOpenIndex, setQuickOpenIndex] = useState(0);
  const [pendingSafety, setPendingSafety] = useState<{
    report: QuerySafetyReport;
    sql: string;
  } | null>(null);
  const [schemaBaseline, setSchemaBaseline] = useState<DatabaseMetadata | null>(
    null,
  );
  const [schemaBaselineLabel, setSchemaBaselineLabel] =
    useState("Current connection");
  const [schemaDiffOpen, setSchemaDiffOpen] = useState(false);
  const [schemaTargetOpen, setSchemaTargetOpen] = useState(false);
  const [dataCompareOpen, setDataCompareOpen] = useState(false);
  const [dataCompareTargetOpen, setDataCompareTargetOpen] = useState(false);
  const [dataCompare, setDataCompare] = useState<DataCompareResult | null>(
    null,
  );
  const [dataCompareTarget, setDataCompareTarget] = useState<{
    config: DriverConfig;
    label: string;
  } | null>(null);
  const [migrationHistoryOpen, setMigrationHistoryOpen] = useState(false);
  const [erdOpen, setErdOpen] = useState(false);
  const [sessionsOpen, setSessionsOpen] = useState(false);
  const [sessions, setSessions] = useState<DatabaseSession[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [sessionsError, setSessionsError] = useState<string | null>(null);
  const [locksOpen, setLocksOpen] = useState(false);
  const [locks, setLocks] = useState<DatabaseLock[]>([]);
  const [locksLoading, setLocksLoading] = useState(false);
  const [locksError, setLocksError] = useState<string | null>(null);
  const [diagnosticsOpen, setDiagnosticsOpen] = useState(false);
  const [sessionHistoryOpen, setSessionHistoryOpen] = useState(false);
  const [longQueryThresholdMs, setLongQueryThresholdMs] = useState(
    readLongQueryThresholdMs,
  );
  const [connectionOpen, setConnectionOpen] = useState(false);
  const [cursor, setCursor] = useState({ line: 1, column: 1, selected: 0 });
  const initialized = useRef(false);
  const editorRef = useRef<SqlEditorHandle>(null);
  const editInputRef = useRef<HTMLInputElement>(null);
  const activeFavorite = favorites.find(
    (favorite) => favorite.sql === sql.trim(),
  );
  const pendingEditCount = Object.values(stagedEdits).reduce(
    (count, edit) => count + Object.keys(edit.changes).length,
    0,
  );
  const tableBrowseDirty = Boolean(
    tableBrowse &&
      (tableBrowse.filter !== filter ||
        tableBrowse.sortBy !== sortBy ||
        tableBrowse.sortDirection !== sortDirection),
  );
  const schemaDiff = useMemo<SchemaDiff | null>(
    () =>
      schemaBaseline && metadata
        ? compareSchemaSnapshots(schemaBaseline, metadata, driverKind)
        : null,
    [driverKind, metadata, schemaBaseline],
  );
  const connectionIdentity = `${connectionName}:${driverKind}`;
  const canInspectSessions = driver.capabilities().has("sessions");
  const canInspectLocks = driver.capabilities().has("locks");
  const longRunningSessions = findLongRunningSessions(
    sessions,
    longQueryThresholdMs,
  );
  const loadSessionsPanel = async () => {
    if (!canInspectSessions) {
      notify(
        "Session inspection is available in native PostgreSQL/MySQL/SQL Server connections",
      );
      return;
    }
    setSessionsLoading(true);
    setSessionsError(null);
    try {
      const nextSessions = await driver.sessions();
      setSessions(nextSessions);
      recordSessionAudit(nextSessions);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setSessionsError(message);
      notify(message);
    } finally {
      setSessionsLoading(false);
    }
  };
  const openSessions = () => {
    if (!canInspectSessions) {
      notify(
        "Session inspection is available in native PostgreSQL/MySQL/SQL Server connections",
      );
      return;
    }
    setSessionsOpen(true);
    void loadSessionsPanel();
  };
  const cancelDatabaseSession = async (session: DatabaseSession) => {
    if (!session.canCancel) return;
    if (
      !window.confirm(`Cancel the running query for session ${session.id}?`)
    ) {
      return;
    }
    try {
      await driver.cancelSession(session.id);
      notify(`Cancellation requested for session ${session.id}`);
      await loadSessionsPanel();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setSessionsError(message);
      notify(message);
    }
  };
  const loadLocksPanel = async () => {
    if (!canInspectLocks) {
      notify(
        "Lock graph inspection is available in native PostgreSQL/MySQL/SQL Server connections",
      );
      return;
    }
    setLocksLoading(true);
    setLocksError(null);
    try {
      setLocks(await driver.locks());
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setLocksError(message);
      notify(message);
    } finally {
      setLocksLoading(false);
    }
  };
  const openLocks = () => {
    if (!canInspectLocks) {
      notify(
        "Lock graph inspection is available in native PostgreSQL/MySQL/SQL Server connections",
      );
      return;
    }
    setLocksOpen(true);
    void loadLocksPanel();
  };
  const openDiagnostics = () => {
    if (!canInspectSessions) {
      notify(
        "Long-running query diagnostics are available in native PostgreSQL/MySQL/SQL Server connections",
      );
      return;
    }
    setDiagnosticsOpen(true);
    void loadSessionsPanel();
  };
  const openSessionHistory = () => {
    setSessionHistoryOpen(true);
  };
  const updateLongQueryThreshold = (thresholdMs: number) => {
    if (!longQueryThresholdOptions.includes(thresholdMs)) return;
    setLongQueryThresholdMs(thresholdMs);
    try {
      window.localStorage.setItem(
        longQueryThresholdStorageKey,
        String(thresholdMs),
      );
    } catch {
      // Local threshold persistence is best-effort.
    }
  };
  const cancelBlockingSession = async (lock: DatabaseLock) => {
    if (!lock.blockingCanCancel) return;
    if (
      !window.confirm(
        `Cancel the running query for blocking session ${lock.blockingSessionId}?`,
      )
    ) {
      return;
    }
    try {
      await driver.cancelSession(lock.blockingSessionId);
      notify(`Cancellation requested for session ${lock.blockingSessionId}`);
      await loadLocksPanel();
      if (sessionsOpen && canInspectSessions) await loadSessionsPanel();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setLocksError(message);
      notify(message);
    }
  };
  const captureSchemaBaseline = () => {
    if (!metadata) {
      notify("Connect to a database before capturing a schema baseline");
      return;
    }
    setSchemaBaseline(metadata);
    setSchemaBaselineLabel(`Current connection · ${connectionName}`);
    setSchemaDiffOpen(false);
    notify("Schema baseline captured; refresh metadata to compare changes");
  };
  const openSchemaDiff = () => {
    if (!schemaBaseline) {
      captureSchemaBaseline();
      return;
    }
    setSchemaDiffOpen(true);
  };
  const recordMigrationPreview = (): string | null => {
    if (!schemaDiff) return null;
    const id = crypto.randomUUID();
    addMigrationHistory({
      id,
      baselineLabel: schemaBaselineLabel,
      targetLabel: `Current connection · ${connectionName}`,
      driver: driverKind,
      createdAt: new Date().toISOString(),
      changeCount: schemaDiff.changes.length,
      added: schemaDiff.added,
      removed: schemaDiff.removed,
      manual: schemaDiff.manual,
      migrationSql: buildSchemaMigrationSql(schemaDiff),
      rollbackSql: buildSchemaRollbackSql(schemaDiff),
      privilegePreflightSql: buildSchemaPrivilegePreflightSql(
        schemaDiff,
        driverKind,
      ),
      status: "preview",
    });
    return id;
  };
  const applySchemaMigration = async () => {
    if (!schemaDiff || schemaDiff.changes.length === 0) return;
    if (readOnlyConnection) {
      notify("Schema migration is disabled for a read-only connection");
      return;
    }
    if (schemaDiff.manual > 0) {
      notify("Resolve manual-review changes before applying this migration");
      return;
    }
    const statements = buildSchemaMigrationStatements(schemaDiff);
    if (statements.length === 0) {
      notify("No executable migration statements are available");
      return;
    }
    if (
      !window.confirm(
        `Apply ${statements.length} schema statement${statements.length === 1 ? "" : "s"} in one transaction?`,
      )
    ) {
      return;
    }
    const historyId = recordMigrationPreview();
    const migrationSql = buildSchemaMigrationSql(schemaDiff);
    const result = await runQuery("transaction", migrationSql, {
      preserveResult: true,
      batch: { statements, expectedRows: 0 },
    });
    if (!result || !historyId) {
      notify("Schema migration failed; the transaction was rolled back");
      return;
    }
    markMigrationApplied(historyId);
    await loadMetadata();
    setSchemaDiffOpen(false);
    notify("Schema migration applied and recorded locally");
  };
  const openMigrationHistory = () => setMigrationHistoryOpen(true);
  const openErd = () => {
    if (!metadata) {
      notify("Connect to a database before opening the ERD");
      return;
    }
    setErdOpen(true);
  };
  const openCreateTable = () => {
    if (!metadata) {
      notify("Connect to a database before creating a table");
      return;
    }
    setCreateTableOpen(true);
  };
  const createTable = async (plan: CreateTablePlan) => {
    if (!plan.sql || plan.errors.length > 0) return;
    if (readOnlyConnection) {
      notify("Table creation is disabled for a read-only connection");
      return;
    }
    if (!window.confirm("Create this table in one transaction?")) return;
    const result = await runQuery("transaction", plan.sql, {
      preserveResult: true,
    });
    if (!result) {
      notify("Table creation failed; the transaction was rolled back");
      return;
    }
    await loadMetadata();
    setCreateTableOpen(false);
    notify("Table created and metadata refreshed");
  };
  const openAddColumn = () => {
    if (!currentTable) {
      notify("Select a table before adding a column");
      return;
    }
    setAddColumnOpen(true);
  };
  const addColumn = async (plan: AddColumnPlan) => {
    if (!plan.sql || plan.errors.length > 0) return;
    if (readOnlyConnection) {
      notify("Column changes are disabled for a read-only connection");
      return;
    }
    if (!window.confirm("Add this column in one transaction?")) return;
    const result = await runQuery("transaction", plan.sql, {
      preserveResult: true,
    });
    if (!result) {
      notify("Column creation failed; the transaction was rolled back");
      return;
    }
    await loadMetadata();
    setAddColumnOpen(false);
    notify("Column added and metadata refreshed");
  };
  const openEditColumns = () => {
    if (!currentTable) {
      notify("Select a table before editing columns");
      return;
    }
    setEditColumnsOpen(true);
  };
  const editTableColumns = async (plan: EditTableColumnsPlan) => {
    if (!plan.sql || plan.errors.length > 0 || plan.manual.length > 0) return;
    if (readOnlyConnection) {
      notify("Column changes are disabled for a read-only connection");
      return;
    }
    if (!window.confirm("Apply these column changes in one transaction?"))
      return;
    const result = await runQuery("transaction", plan.sql, {
      preserveResult: true,
      batch: { statements: plan.statements, expectedRows: 0 },
    });
    if (!result) {
      notify("Column changes failed; the transaction was rolled back");
      return;
    }
    await loadMetadata();
    setEditColumnsOpen(false);
    notify("Column changes applied and metadata refreshed");
  };
  const openCreateIndex = () => {
    if (!currentTable) {
      notify("Select a table before creating an index");
      return;
    }
    setCreateIndexOpen(true);
  };
  const createIndex = async (plan: CreateIndexPlan) => {
    if (!plan.sql || plan.errors.length > 0) return;
    if (readOnlyConnection) {
      notify("Index creation is disabled for a read-only connection");
      return;
    }
    if (!window.confirm("Create this index in one transaction?")) return;
    const result = await runQuery("transaction", plan.sql, {
      preserveResult: true,
    });
    if (!result) {
      notify("Index creation failed; the transaction was rolled back");
      return;
    }
    await loadMetadata();
    setCreateIndexOpen(false);
    notify("Index created and metadata refreshed");
  };
  const openDropIndex = () => {
    if (!currentTable) {
      notify("Select a table before dropping an index");
      return;
    }
    setDropIndexOpen(true);
  };
  const dropIndex = async (plan: DropIndexPlan) => {
    if (!plan.sql || plan.errors.length > 0 || plan.manual.length > 0) return;
    if (readOnlyConnection) {
      notify("Index deletion is disabled for a read-only connection");
      return;
    }
    if (!window.confirm("Drop this index in one transaction?")) return;
    const result = await runQuery("transaction", plan.sql, {
      preserveResult: true,
    });
    if (!result) {
      notify("Index deletion failed; the transaction was rolled back");
      return;
    }
    await loadMetadata();
    setDropIndexOpen(false);
    notify("Index dropped and metadata refreshed");
  };
  const openAddForeignKey = () => {
    if (!currentTable) {
      notify("Select a table before adding a foreign key");
      return;
    }
    setAddForeignKeyOpen(true);
  };
  const addForeignKey = async (plan: AddForeignKeyPlan) => {
    if (!plan.sql || plan.errors.length > 0 || plan.manual.length > 0) return;
    if (readOnlyConnection) {
      notify("Foreign-key changes are disabled for a read-only connection");
      return;
    }
    if (!window.confirm("Add this foreign key in one transaction?")) return;
    const result = await runQuery("transaction", plan.sql, {
      preserveResult: true,
      batch: { statements: plan.statements, expectedRows: 0 },
    });
    if (!result) {
      notify("Foreign-key creation failed; the transaction was rolled back");
      return;
    }
    await loadMetadata();
    setAddForeignKeyOpen(false);
    notify("Foreign key added and metadata refreshed");
  };
  const openDropForeignKey = () => {
    if (!currentTable) {
      notify("Select a table before dropping a foreign key");
      return;
    }
    setDropForeignKeyOpen(true);
  };
  const dropForeignKey = async (plan: DropForeignKeyPlan) => {
    if (!plan.sql || plan.errors.length > 0 || plan.manual.length > 0) return;
    if (readOnlyConnection) {
      notify("Foreign-key changes are disabled for a read-only connection");
      return;
    }
    if (!window.confirm("Drop this foreign key in one transaction?")) return;
    const result = await runQuery("transaction", plan.sql, {
      preserveResult: true,
      batch: { statements: plan.statements, expectedRows: 0 },
    });
    if (!result) {
      notify("Foreign-key deletion failed; the transaction was rolled back");
      return;
    }
    await loadMetadata();
    setDropForeignKeyOpen(false);
    notify("Foreign key dropped and metadata refreshed");
  };
  const openCreateView = () => {
    if (!metadata) {
      notify("Connect to a database before creating a view");
      return;
    }
    setCreateViewOpen(true);
  };
  const createView = async (plan: CreateViewPlan) => {
    if (!plan.sql || plan.errors.length > 0) return;
    if (readOnlyConnection) {
      notify("View creation is disabled for a read-only connection");
      return;
    }
    if (!window.confirm("Create this view in one transaction?")) return;
    const result = await runQuery("transaction", plan.sql, {
      preserveResult: true,
    });
    if (!result) {
      notify("View creation failed; the transaction was rolled back");
      return;
    }
    await loadMetadata();
    setCreateViewOpen(false);
    notify("View created and metadata refreshed");
  };
  const openAlterView = () => {
    if (!currentView) {
      notify("Select a view before editing its definition");
      return;
    }
    setAlterViewOpen(true);
  };
  const alterView = async (plan: AlterViewPlan) => {
    if (!plan.sql || plan.errors.length > 0) return;
    if (readOnlyConnection) {
      notify("View changes are disabled for a read-only connection");
      return;
    }
    const warningText = plan.warnings.length
      ? `\n\nWarnings:\n${plan.warnings.join("\n")}`
      : "";
    if (
      !window.confirm(
        `Apply this view definition in one transaction?${warningText}`,
      )
    ) {
      return;
    }
    const result = await runQuery("transaction", plan.sql, {
      preserveResult: true,
      batch: { statements: plan.statements, expectedRows: 0 },
    });
    if (!result) {
      notify("View changes failed; the transaction was rolled back");
      return;
    }
    await loadMetadata();
    setAlterViewOpen(false);
    notify("View definition updated and metadata refreshed");
  };
  const openDropView = () => {
    if (!currentView) {
      notify("Select a view before dropping it");
      return;
    }
    setDropViewOpen(true);
  };
  const dropView = async (plan: DropViewPlan) => {
    if (!plan.sql || plan.errors.length > 0) return;
    if (readOnlyConnection) {
      notify("View deletion is disabled for a read-only connection");
      return;
    }
    const warningText = plan.warnings.length
      ? `\n\nWarnings:\n${plan.warnings.join("\n")}`
      : "";
    if (!window.confirm(`Drop this view in one transaction?${warningText}`)) {
      return;
    }
    const result = await runQuery("transaction", plan.sql, {
      preserveResult: true,
      batch: { statements: plan.statements, expectedRows: 0 },
    });
    if (!result) {
      notify("View deletion failed; the transaction was rolled back");
      return;
    }
    await loadMetadata();
    setDropViewOpen(false);
    notify("View dropped and metadata refreshed");
  };
  const compareSavedConnection = async (
    config: DriverConfig,
    label: string,
  ): Promise<string | null> => {
    if (config.kind !== driverKind) {
      return `Compare connections with the same driver only (${driverDisplayName(driverKind)})`;
    }
    try {
      const targetMetadata = await inspectConnectionMetadata(config);
      setSchemaBaseline(targetMetadata);
      setSchemaBaselineLabel(`Saved connection · ${label}`);
      setSchemaTargetOpen(false);
      setSchemaDiffOpen(true);
      notify(`Loaded schema from ${label} for comparison`);
      return null;
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  };
  const openDataCompare = () => {
    if (!currentTable) {
      notify("Select a table before comparing table data");
      return;
    }
    setDataCompareTargetOpen(true);
  };
  const compareSavedDataConnection = async (
    config: DriverConfig,
    label: string,
  ): Promise<string | null> => {
    if (!currentTable) return "Select a table before comparing table data";
    if (config.kind !== driverKind) {
      return `Data Compare requires the same driver (${driverDisplayName(driverKind)})`;
    }
    const targetDriver = createRuntimeDriver(config.kind);
    try {
      const sourceCount = scalarCount(
        await driver.execute(buildDataCountSql(currentTable, driverKind)),
      );
      const targetConfig = { ...config, readOnly: true };
      await targetDriver.connect(targetConfig);
      const targetMetadata = await targetDriver.metadata();
      const targetTable = findTable(
        targetMetadata,
        currentTable.schema,
        currentTable.name,
      );
      if (!targetTable) {
        throw new Error(
          `Target connection does not contain ${currentTable.schema}.${currentTable.name}`,
        );
      }
      const sourcePrimaryKeys = currentTable.columns
        .filter((column) => column.primaryKey)
        .map((column) => column.name);
      const targetPrimaryKeys = targetTable.columns
        .filter((column) => column.primaryKey)
        .map((column) => column.name);
      if (
        JSON.stringify(sourcePrimaryKeys) !== JSON.stringify(targetPrimaryKeys)
      ) {
        throw new Error(
          "Source and target primary-key definitions do not match",
        );
      }
      const targetColumns = new Set(
        targetTable.columns.map((column) => column.name),
      );
      const missingColumns = currentTable.columns
        .map((column) => column.name)
        .filter((column) => !targetColumns.has(column));
      if (missingColumns.length > 0) {
        throw new Error(
          `Target is missing source columns: ${missingColumns.join(", ")}`,
        );
      }
      const targetCount = scalarCount(
        await targetDriver.execute(buildDataCountSql(currentTable, driverKind)),
      );
      if (
        sourceCount > dataCompareMaxRows ||
        targetCount > dataCompareMaxRows
      ) {
        throw new Error(
          `Data Compare is limited to ${dataCompareMaxRows.toLocaleString()} rows; narrow the table before comparing`,
        );
      }
      const [sourceResult, targetResult] = await Promise.all([
        driver.execute(buildDataSelectSql(currentTable, driverKind)),
        targetDriver.execute(buildDataSelectSql(currentTable, driverKind)),
      ]);
      if (
        sourceResult.rows.length !== sourceCount ||
        targetResult.rows.length !== targetCount
      ) {
        throw new Error(
          "The database returned an incomplete row set; synchronization is blocked",
        );
      }
      const comparison = compareTableData(
        currentTable,
        sourceResult.rows,
        targetResult.rows,
        driverKind,
      );
      setDataCompare(comparison);
      setDataCompareTarget({ config, label });
      setDataCompareTargetOpen(false);
      setDataCompareOpen(true);
      notify(
        `Compared ${currentTable.schema}.${currentTable.name} with ${label}`,
      );
      return null;
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    } finally {
      await targetDriver.disconnect().catch(() => undefined);
    }
  };
  const applyDataSynchronization = async (selectedChangeIds: string[]) => {
    if (!dataCompare || !dataCompareTarget) return;
    if (dataCompare.errors.length > 0) {
      notify("Resolve Data Compare errors before applying changes");
      return;
    }
    if (dataCompareTarget.config.readOnly) {
      notify("The selected target profile is read-only");
      return;
    }
    const statements = buildDataSyncStatements(dataCompare, selectedChangeIds);
    if (statements.length === 0) {
      notify("Select at least one data change");
      return;
    }
    const selectedChanges = dataCompare.changes.filter((change) =>
      selectedChangeIds.includes(change.id),
    );
    const destructiveCount = selectedChanges.filter(
      (change) => change.destructive,
    ).length;
    const warning = destructiveCount
      ? ` This includes ${destructiveCount} destructive delete${destructiveCount === 1 ? "" : "s"}.`
      : "";
    if (
      !window.confirm(
        `Apply ${statements.length} data change${statements.length === 1 ? "" : "s"} to ${dataCompareTarget.label} in one transaction?${warning}`,
      )
    ) {
      return;
    }
    const targetDriver = createRuntimeDriver(dataCompareTarget.config.kind);
    try {
      await targetDriver.connect({
        ...dataCompareTarget.config,
        readOnly: false,
      });
      const result = await targetDriver.executeBatch(
        statements,
        statements.length,
      );
      if (result.affectedRows !== statements.length) {
        throw new Error(
          `Data synchronization conflict: expected ${statements.length} affected rows, received ${result.affectedRows}`,
        );
      }
      setDataCompareOpen(false);
      setDataCompare(null);
      setDataCompareTarget(null);
      notify("Data synchronization applied and committed");
    } catch (error) {
      notify(
        `Data synchronization failed; the transaction was rolled back: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      await targetDriver.disconnect().catch(() => undefined);
    }
  };
  const handleToggleFavorite = () => {
    if (!sql.trim()) {
      notify("Enter SQL before saving a favorite");
      return;
    }
    const saved = toggleFavorite(sql);
    notify(
      saved ? "Saved query to local favorites" : "Removed query from favorites",
    );
  };
  const handleClearHistory = () => {
    if (history.length === 0) {
      notify("No recent queries to clear");
      return;
    }
    if (!window.confirm("Clear all locally stored recent queries?")) return;
    clearHistory();
    notify("Cleared local query history");
  };
  const quickOpenItems = useMemo<QuickOpenItem[]>(() => {
    const seen = new Set<string>();
    const items: QuickOpenItem[] = [];
    for (const favorite of favorites) {
      const sqlKey = favorite.sql.trim();
      if (seen.has(sqlKey)) continue;
      seen.add(sqlKey);
      items.push({
        id: `favorite:${favorite.id}`,
        label: favorite.label,
        sql: favorite.sql,
        detail: "Favorite · Saved locally",
        kind: "favorite",
      });
    }
    for (const entry of history) {
      const sqlKey = entry.sql.trim();
      if (seen.has(sqlKey)) continue;
      seen.add(sqlKey);
      items.push({
        id: `history:${entry.id}`,
        label: entry.label,
        sql: entry.sql,
        detail: `Recent · ${relativeTime(entry.executedAt)}`,
        kind: "history",
      });
    }
    return items;
  }, [favorites, history]);

  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;
    void (async () => {
      const restored = await loadWorkspace();
      await Promise.all([loadMetadata(), loadConnectionProfiles()]);
      if (!restored) await runQuery();
    })();
  }, [loadConnectionProfiles, loadMetadata, loadWorkspace, runQuery]);
  const handleRun = (mode: RunMode = "normal", sqlOverride?: string) => {
    if (pendingEditCount > 0) {
      notify("Review or discard staged row edits before running another query");
      return;
    }
    const executableSql = sqlOverride?.trim() || sql;
    if (!executableSql.trim()) {
      notify("Enter SQL before running the query");
      return;
    }
    if (mode === "normal") {
      const safety = inspectQuerySafety(executableSql);
      if (safety.isDangerous) {
        setPendingSafety({ report: safety, sql: executableSql });
        return;
      }
    }
    setPendingSafety(null);
    setGridSelection(null);
    setEditingCell(null);
    setStagedEdits({});
    setTableBrowse(null);
    const firstPage =
      mode === "normal"
        ? buildQueryPagePlan(executableSql, driverKind, resultPageSize, 0)
        : null;
    const paging =
      firstPage && firstPage.errors.length === 0 ? firstPage : null;
    setServerQueryPage(
      paging ? { sql: executableSql, offset: 0, hasMore: true } : null,
    );
    void runQuery(
      mode,
      paging?.sql || executableSql,
      paging ? { historySql: executableSql } : undefined,
    ).then((nextResult) => {
      if (!paging && mode === "normal") return;
      if (!nextResult && paging) {
        setServerQueryPage(null);
        return;
      }
      if (paging) {
        setServerQueryPage((current) =>
          current
            ? {
                ...current,
                hasMore: nextResult?.rows.length === resultPageSize,
              }
            : current,
        );
      }
    });
  };
  const handleStream = (sqlOverride?: string) => {
    if (pendingEditCount > 0) {
      notify(
        "Review or discard staged row edits before streaming another query",
      );
      return;
    }
    if (!driver.capabilities().has("streaming")) {
      notify(
        "Streaming is currently available for native PostgreSQL, MySQL/MariaDB, and SQLite connections",
      );
      return;
    }
    const executableSql = sqlOverride?.trim() || sql;
    if (!executableSql) {
      notify("Enter SQL before streaming the result");
      return;
    }
    const pagePlan = buildQueryPagePlan(
      executableSql,
      driverKind,
      resultPageSize,
      0,
    );
    if (pagePlan.errors.length > 0) {
      notify(
        pagePlan.errors[0] ?? "Streaming requires one SELECT or WITH query",
      );
      return;
    }
    const safety = inspectQuerySafety(executableSql);
    if (safety.isDangerous) {
      setPendingSafety({ report: safety, sql: executableSql });
      return;
    }
    setPendingSafety(null);
    setGridSelection(null);
    setEditingCell(null);
    setStagedEdits({});
    setTableBrowse(null);
    setServerQueryPage(null);
    setFilter("");
    setSortBy(null);
    setResultPage(0);
    setResultView("table");
    void runQuery("normal", executableSql, {
      historySql: executableSql,
      stream: true,
    });
  };
  const handleExplain = () => {
    if (pendingEditCount > 0) {
      notify(
        "Review or discard staged row edits before explaining another query",
      );
      return;
    }
    if (!canExplain) {
      notify("Explain plans are not supported by this connection");
      return;
    }
    const explain = buildExplainQuery(sql);
    if (!explain.ok) {
      notify(explain.error.message);
      return;
    }
    setPendingSafety(null);
    setGridSelection(null);
    setTableBrowse(null);
    setServerQueryPage(null);
    void runQuery("explain", explain.query.sql);
  };
  const openCommandPalette = () => {
    setQuickOpenOpen(false);
    setCommandQuery("");
    setCommandIndex(0);
    setCommandPaletteOpen(true);
  };
  const openQuickOpen = () => {
    setCommandPaletteOpen(false);
    setQuickOpenQuery("");
    setQuickOpenIndex(0);
    setQuickOpenOpen(true);
  };
  const filteredQuickOpenItems = quickOpenItems.filter((item) =>
    `${item.label} ${item.detail} ${item.sql}`
      .toLowerCase()
      .includes(quickOpenQuery.trim().toLowerCase()),
  );
  const executeQuickOpenItem = () => {
    const item = filteredQuickOpenItems[quickOpenIndex];
    if (!item) return;
    setQuickOpenOpen(false);
    setSql(item.sql);
    notify(
      item.kind === "favorite"
        ? "Opened favorite without executing"
        : "Opened recent query without executing",
    );
  };
  const requestCloseQuery = (id: string) => {
    const tab = tabs.find((candidate) => candidate.id === id);
    if (
      tab?.isDirty &&
      !window.confirm(`Close ${tab.title}? Unsaved SQL will be discarded.`)
    ) {
      return;
    }
    closeQuery(id);
  };
  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      const insideEditor =
        event.target instanceof HTMLElement &&
        event.target.closest(".monaco-editor") !== null;
      if (
        !insideEditor &&
        (event.metaKey || event.ctrlKey) &&
        event.key === "Enter"
      ) {
        event.preventDefault();
        handleRun();
      }
      if (
        !insideEditor &&
        (event.metaKey || event.ctrlKey) &&
        event.key.toLowerCase() === "f"
      ) {
        event.preventDefault();
        document.getElementById("result-filter")?.focus();
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        openCommandPalette();
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "p") {
        event.preventDefault();
        openQuickOpen();
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "t") {
        event.preventDefault();
        newQuery();
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "w") {
        event.preventDefault();
        requestCloseQuery(activeTabId);
      }
      if (event.key === "Escape" && pendingSafety) {
        event.preventDefault();
        setPendingSafety(null);
        return;
      }
      if (event.key === "Escape" && connectionOpen) {
        event.preventDefault();
        setConnectionOpen(false);
        return;
      }
      if (event.key === "Escape" && isRunning && canCancel) {
        event.preventDefault();
        cancelQuery();
      }
    };
    window.addEventListener("keydown", listener, true);
    return () => window.removeEventListener("keydown", listener, true);
  });

  const tables = metadata?.tables ?? [];
  const views = metadata?.views ?? [];
  const routines = metadata?.routines ?? [];
  const triggers = metadata?.triggers ?? [];
  const eventTriggers = metadata?.eventTriggers ?? [];
  const schemas = metadata?.schemas ?? [];
  const currentTable =
    selectedObject?.kind === "table"
      ? tables.find(
          (table) =>
            table.schema === selectedObject.schema &&
            table.name === selectedObject.name,
        )
      : undefined;
  const currentView =
    selectedObject?.kind === "view"
      ? views.find(
          (view) =>
            view.schema === selectedObject.schema &&
            view.name === selectedObject.name,
        )
      : undefined;
  const currentRoutine =
    selectedObject?.kind === "routine"
      ? routines.find((routine) => routine.id === selectedObject.id)
      : undefined;
  const currentTrigger =
    selectedObject?.kind === "trigger"
      ? triggers.find((trigger) => trigger.id === selectedObject.id)
      : undefined;
  const currentEventTrigger =
    selectedObject?.kind === "eventTrigger"
      ? eventTriggers.find(
          (eventTrigger) => eventTrigger.id === selectedObject.id,
        )
      : undefined;
  const selectedObjectIdentity = selectedObject
    ? selectedObject.kind === "routine" || selectedObject.kind === "trigger"
      ? `${selectedObject.kind}:${selectedObject.id}`
      : selectedObject.kind === "eventTrigger"
        ? `eventTrigger:${selectedObject.name}`
        : `${selectedObject.kind}:${selectedObject.schema}.${selectedObject.name}`
    : "none";
  const foreignKeyIndex = useMemo(() => buildForeignKeyIndex(tables), [tables]);
  const currentForeignKeys = currentTable
    ? foreignKeyIndex.get(currentTable)
    : undefined;
  const dependencyIndex = useMemo(
    () => buildDependencyIndex(metadata?.dependencies ?? []),
    [metadata?.dependencies],
  );
  const currentObjectRef: DatabaseObjectRef | undefined = currentTable
    ? {
        kind: "table",
        id: null,
        schema: currentTable.schema,
        name: currentTable.name,
        identityArguments: null,
      }
    : currentView
      ? {
          kind: "view",
          id: null,
          schema: currentView.schema,
          name: currentView.name,
          identityArguments: null,
        }
      : currentRoutine
        ? {
            kind: "routine",
            id: currentRoutine.id,
            schema: currentRoutine.schema,
            name: currentRoutine.name,
            identityArguments: currentRoutine.identityArguments,
          }
        : currentTrigger
          ? {
              kind: "trigger",
              id: currentTrigger.id,
              schema: currentTrigger.schema,
              name: currentTrigger.name,
              identityArguments: null,
            }
          : currentEventTrigger
            ? {
                kind: "eventTrigger",
                id: currentEventTrigger.id,
                schema: null,
                name: currentEventTrigger.name,
                identityArguments: null,
              }
            : undefined;
  const currentDependencies = currentObjectRef
    ? dependencyIndex.get(currentObjectRef)
    : undefined;
  const completions = useMemo<SqlCompletion[]>(() => {
    if (!metadata) return [];
    return [
      ...metadata.schemas.map((schema) => ({
        label: schema,
        detail: "Schema",
        kind: "schema" as const,
      })),
      ...metadata.tables.flatMap((table) => [
        {
          label: table.name,
          detail: `${table.schema} table`,
          kind: "table" as const,
        },
        ...table.columns.map((column) => ({
          label: column.name,
          detail: `${table.schema}.${table.name} · ${column.type}`,
          kind: "column" as const,
        })),
      ]),
      ...metadata.views.flatMap((view) => [
        {
          label: view.name,
          detail: `${view.schema} view`,
          kind: "table" as const,
        },
        ...view.columns.map((column) => ({
          label: column.name,
          detail: `${view.schema}.${view.name} view · ${column.type}`,
          kind: "column" as const,
        })),
      ]),
      ...metadata.routines.map((routine) => ({
        label: routine.name,
        detail: `${routine.schema} ${routineKindLabel(routine.kind)}(${routine.identityArguments})${routine.returnType ? ` → ${routine.returnType}` : ""}`,
        kind: "function" as const,
      })),
    ];
  }, [metadata]);
  const filteredRows = useMemo(() => {
    if (!result) return [];
    const query = filter.trim().toLowerCase();
    const rows = result.rows.filter((row) =>
      Object.values(row).join(" ").toLowerCase().includes(query),
    );
    if (!sortBy) return rows;
    return rows.sort((a, b) => {
      const aValue = String(a[sortBy] ?? "");
      const bValue = String(b[sortBy] ?? "");
      const direction = sortDirection === "asc" ? 1 : -1;
      return (
        aValue.localeCompare(bValue, undefined, { numeric: true }) * direction
      );
    });
  }, [filter, result, sortBy, sortDirection]);
  const resultPageCount = Math.max(
    1,
    Math.ceil(filteredRows.length / resultPageSize),
  );
  const visibleRows = useMemo(
    () =>
      filteredRows.slice(
        resultPage * resultPageSize,
        (resultPage + 1) * resultPageSize,
      ),
    [filteredRows, resultPage],
  );
  const virtualRowWindow = useMemo(
    () =>
      getVirtualRowWindow(
        filteredRows.length,
        gridScrollTop,
        gridViewportHeight,
      ),
    [filteredRows.length, gridScrollTop, gridViewportHeight],
  );
  const gridRows = virtualRowWindow.enabled ? filteredRows : visibleRows;
  const gridRowOffset = virtualRowWindow.enabled
    ? virtualRowWindow.start
    : resultPage * resultPageSize;
  const renderedRows = virtualRowWindow.enabled
    ? filteredRows.slice(virtualRowWindow.start, virtualRowWindow.end)
    : visibleRows;
  const selectedDeleteRows = useMemo<SqlRowDelete[]>(() => {
    if (!gridSelection || gridSelection.kind !== "rows") return [];
    const [startRow, endRow] = rangeBounds(
      gridSelection.anchor,
      gridSelection.focus,
    );
    return filteredRows
      .slice(startRow, endRow + 1)
      .map((originalRow) => ({ originalRow }));
  }, [filteredRows, gridSelection]);
  const primaryKeyColumns = useMemo(
    () => currentTable?.columns.filter((column) => column.primaryKey) ?? [],
    [currentTable],
  );
  const canEditResults = Boolean(
    !readOnlyConnection &&
      driver.capabilities().has("editing") &&
      currentTable &&
      result &&
      primaryKeyColumns.length > 0 &&
      primaryKeyColumns.every((key) =>
        result.columns.some((column) => column.name === key.name),
      ),
  );
  const canDeleteRows = Boolean(
    canEditResults &&
      tableBrowse &&
      currentTable &&
      tableBrowse.schema === currentTable.schema &&
      tableBrowse.name === currentTable.name &&
      gridSelection?.kind === "rows" &&
      selectedDeleteRows.length > 0 &&
      pendingEditCount === 0,
  );
  const canInsertRows = Boolean(
    !readOnlyConnection &&
      driver.capabilities().has("editing") &&
      tableBrowse &&
      currentTable &&
      tableBrowse.schema === currentTable.schema &&
      tableBrowse.name === currentTable.name &&
      pendingEditCount === 0,
  );
  const editPreview = useMemo(() => {
    if (!canEditResults || !currentTable || !result || pendingEditCount === 0) {
      return { sql: "", statements: [], error: null };
    }
    try {
      const options = {
        tableName: `${currentTable.schema}.${currentTable.name}`,
        keyColumns: primaryKeyColumns.map((column) => column.name),
        dialect: driverKind,
        includeTransaction: false as const,
        includeOriginalValues: true,
      };
      return {
        sql: serializeRowsToSqlUpdate(
          result.columns,
          Object.values(stagedEdits),
          options,
        ),
        statements: buildRowsToSqlUpdateStatements(
          result.columns,
          Object.values(stagedEdits),
          options,
        ),
        error: null,
      };
    } catch (error) {
      return {
        sql: "",
        statements: [],
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }, [
    canEditResults,
    currentTable,
    driverKind,
    pendingEditCount,
    primaryKeyColumns,
    result,
    stagedEdits,
  ]);
  const deletePreview = useMemo(() => {
    if (!canDeleteRows || !currentTable || !result) {
      return { sql: "", statements: [], error: null };
    }
    try {
      const options = {
        tableName: `${currentTable.schema}.${currentTable.name}`,
        keyColumns: primaryKeyColumns.map((column) => column.name),
        dialect: driverKind,
        includeTransaction: false as const,
        includeOriginalValues: true,
      };
      return {
        sql: serializeRowsToSqlDelete(
          result.columns,
          selectedDeleteRows,
          options,
        ),
        statements: buildRowsToSqlDeleteStatements(
          result.columns,
          selectedDeleteRows,
          options,
        ),
        error: null,
      };
    } catch (error) {
      return {
        sql: "",
        statements: [],
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }, [
    canDeleteRows,
    currentTable,
    driverKind,
    primaryKeyColumns,
    result,
    selectedDeleteRows,
  ]);
  const beginCellEdit = (
    row: Record<string, unknown>,
    column: { name: string; type: string; nullable: boolean },
  ) => {
    if (!editingEnabled || !canEditResults) return;
    if (primaryKeyColumns.some((key) => key.name === column.name)) {
      notify("Primary key cells are locked to protect the update target");
      return;
    }
    setEditingCell({ rowKey: resultRowKey(row), columnName: column.name, row });
    setEditDraft(editableCellValue(row[column.name]));
  };
  const cancelCellEdit = () => {
    setEditingCell(null);
    setEditDraft("");
  };
  const commitCellEdit = () => {
    if (!editingCell || !result) return;
    const column = result.columns.find(
      (candidate) => candidate.name === editingCell.columnName,
    );
    if (!column) return cancelCellEdit();
    try {
      const nextValue = parseEditedCellValue(editDraft, column);
      const previousValue = editingCell.row[column.name];
      const unchanged =
        Object.is(previousValue, nextValue) ||
        (typeof previousValue === "object" &&
          typeof nextValue === "object" &&
          JSON.stringify(previousValue) === JSON.stringify(nextValue));
      setStagedEdits((current) => {
        const existing = current[editingCell.rowKey];
        const changes = { ...(existing?.changes ?? {}) };
        if (unchanged) delete changes[column.name];
        else changes[column.name] = nextValue;
        const next = { ...current };
        if (Object.keys(changes).length === 0) delete next[editingCell.rowKey];
        else {
          next[editingCell.rowKey] = {
            rowKey: editingCell.rowKey,
            originalRow: existing?.originalRow ?? editingCell.row,
            changes,
          };
        }
        return next;
      });
      cancelCellEdit();
    } catch (error) {
      notify(error instanceof Error ? error.message : String(error));
    }
  };
  const applyStagedEdits = async () => {
    if (!editPreview.sql || editPreview.statements.length === 0) {
      notify(editPreview.error ?? "Stage at least one editable cell first");
      return;
    }
    const expectedRows = Object.values(stagedEdits).length;
    const updated = await runQuery("transaction", editPreview.sql, {
      preserveResult: true,
      batch: {
        statements: editPreview.statements,
        expectedRows,
      },
    });
    if (!updated) {
      setEditPreviewOpen(true);
      return;
    }
    if (updated.affectedRows !== expectedRows) {
      setEditPreviewOpen(true);
      notify(
        `Edit conflict detected: expected ${expectedRows} row${expectedRows === 1 ? "" : "s"}, updated ${updated.affectedRows}`,
      );
      return;
    }
    setEditPreviewOpen(false);
    setStagedEdits({});
    setEditingCell(null);
    setEditingEnabled(false);
    await runQuery("normal", sql);
    notify(
      `Applied ${pendingEditCount} staged cell edit${pendingEditCount === 1 ? "" : "s"}`,
    );
  };
  const applySelectedDeletes = async () => {
    if (!deletePreview.sql || deletePreview.statements.length === 0) {
      notify(deletePreview.error ?? "Select at least one table row first");
      return;
    }
    const expectedRows = selectedDeleteRows.length;
    const deleted = await runQuery("transaction", deletePreview.sql, {
      preserveResult: true,
      batch: {
        statements: deletePreview.statements,
        expectedRows,
      },
    });
    if (!deleted) {
      setDeletePreviewOpen(true);
      return;
    }
    if (deleted.affectedRows !== expectedRows) {
      setDeletePreviewOpen(true);
      notify(
        `Delete conflict detected: expected ${expectedRows} row${expectedRows === 1 ? "" : "s"}, deleted ${deleted.affectedRows}`,
      );
      return;
    }
    setDeletePreviewOpen(false);
    setGridSelection(null);
    setResultPage(0);
    const refreshed = await runQuery("normal", sql);
    if (refreshed && tableBrowse) {
      setTableBrowse((current) =>
        current
          ? {
              ...current,
              offset: 0,
              hasMore: refreshed.rows.length === tableBrowsePageSize,
            }
          : current,
      );
    }
    notify(
      `Deleted ${expectedRows.toLocaleString()} row${expectedRows === 1 ? "" : "s"}`,
    );
  };
  const applyInsertedRow = async (plan: TableRowInsertPlan) => {
    if (plan.errors.length > 0 || !plan.statement) {
      notify(plan.errors[0] ?? "Provide valid values before inserting a row");
      return;
    }
    const inserted = await runQuery("transaction", plan.sql, {
      preserveResult: true,
      batch: {
        statements: [plan.statement],
        expectedRows: 1,
      },
    });
    if (!inserted) return;
    if (inserted.affectedRows !== 1) {
      notify(
        `Insert conflict detected: expected 1 row, inserted ${inserted.affectedRows}`,
      );
      return;
    }
    setInsertRowOpen(false);
    setGridSelection(null);
    setResultPage(0);
    const refreshed = await runQuery("normal", sql);
    if (refreshed && tableBrowse) {
      setTableBrowse((current) =>
        current
          ? {
              ...current,
              offset: 0,
              hasMore: refreshed.rows.length === tableBrowsePageSize,
            }
          : current,
      );
    }
    notify("Inserted 1 row");
  };
  const getColumnWidth = (column: { name: string; type: string }) =>
    columnWidths[column.name] ?? defaultColumnWidth(column.type);
  const updateColumnWidth = (columnName: string, width: number) => {
    setColumnWidths((current) => ({
      ...current,
      [columnName]: Math.min(maxColumnWidth, Math.max(minColumnWidth, width)),
    }));
  };
  const startColumnResize = (
    event: ReactPointerEvent<HTMLButtonElement>,
    column: { name: string; type: string },
  ) => {
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const startWidth = getColumnWidth(column);
    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    const handleMove = (moveEvent: PointerEvent) => {
      updateColumnWidth(column.name, startWidth + moveEvent.clientX - startX);
    };
    const handleUp = () => {
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
    };
    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp, { once: true });
  };
  const handleColumnResizeKeyDown = (
    event: ReactKeyboardEvent<HTMLButtonElement>,
    column: { name: string; type: string },
  ) => {
    const currentWidth = getColumnWidth(column);
    const step = event.shiftKey ? 32 : 8;
    if (event.key === "ArrowLeft") {
      event.preventDefault();
      updateColumnWidth(column.name, currentWidth - step);
    } else if (event.key === "ArrowRight") {
      event.preventDefault();
      updateColumnWidth(column.name, currentWidth + step);
    } else if (event.key === "Home") {
      event.preventDefault();
      updateColumnWidth(column.name, minColumnWidth);
    } else if (event.key === "End") {
      event.preventDefault();
      updateColumnWidth(column.name, maxColumnWidth);
    }
  };
  useEffect(() => {
    setResultPage((page) => Math.min(page, resultPageCount - 1));
  }, [resultPageCount]);
  useEffect(() => {
    if (executionStatus !== "idle") {
      setResultPage(0);
      setGridSelection(null);
      setGridScrollTop(0);
    }
  }, [executionStatus]);
  useEffect(() => {
    if (!connectionIdentity) return;
    setSchemaBaseline(null);
    setSchemaBaselineLabel("Current connection");
    setSchemaDiffOpen(false);
    setSchemaTargetOpen(false);
  }, [connectionIdentity]);
  useEffect(() => {
    if (selectedObjectIdentity === "none") {
      setEditingEnabled(false);
      setEditingCell(null);
      setStagedEdits({});
      return;
    }
    setEditingEnabled(false);
    setEditingCell(null);
    setStagedEdits({});
    setTableBrowse(null);
  }, [selectedObjectIdentity]);
  useEffect(() => {
    if (editingCell) editInputRef.current?.focus();
  }, [editingCell]);
  useEffect(() => {
    if (!exportMenuOpen) return;
    const closeMenu = () => setExportMenuOpen(false);
    document.addEventListener("click", closeMenu);
    return () => document.removeEventListener("click", closeMenu);
  }, [exportMenuOpen]);
  const updateFilter = (value: string) => {
    setGridSelection(null);
    setResultPage(0);
    setGridScrollTop(0);
    setFilter(value);
  };
  const selectRelatedTable = (relation: RelationRef) => {
    const isVisible = tables.some(
      (table) =>
        table.schema === relation.schema && table.name === relation.name,
    );
    if (!isVisible) {
      notify(
        `Referenced table ${relation.schema}.${relation.name} is not visible`,
      );
      return;
    }
    setSelectedObject({ kind: "table", ...relation });
  };
  const selectTriggerRelation = (relation: TriggerMetadata["relation"]) => {
    const visible =
      relation.kind === "table"
        ? tables.some(
            (table) =>
              table.schema === relation.schema && table.name === relation.name,
          )
        : views.some(
            (view) =>
              view.schema === relation.schema && view.name === relation.name,
          );
    if (!visible) {
      notify(
        `Owning ${relation.kind} ${relation.schema}.${relation.name} is not visible`,
      );
      return;
    }
    setSelectedObject({
      kind: relation.kind,
      schema: relation.schema,
      name: relation.name,
    });
  };
  const selectDependencyObject = (object: DatabaseObjectRef) => {
    if (object.kind === "table" || object.kind === "view") {
      if (!object.schema) {
        notify(`Referenced ${object.kind} ${object.name} has no schema`);
        return;
      }
      const visible = (object.kind === "table" ? tables : views).some(
        (relation) =>
          relation.schema === object.schema && relation.name === object.name,
      );
      if (visible) {
        setSelectedObject({
          kind: object.kind,
          schema: object.schema,
          name: object.name,
        });
        return;
      }
    } else if (object.kind === "routine" && object.id) {
      const routine = routines.find((candidate) => candidate.id === object.id);
      if (routine) {
        setSelectedObject({
          kind: "routine",
          id: routine.id,
          schema: routine.schema,
          name: routine.name,
          identityArguments: routine.identityArguments,
          routineKind: routine.kind,
        });
        return;
      }
    } else if (object.kind === "trigger" && object.id) {
      const trigger = triggers.find((candidate) => candidate.id === object.id);
      if (trigger) {
        setSelectedObject({
          kind: "trigger",
          id: trigger.id,
          schema: trigger.schema,
          name: trigger.name,
        });
        return;
      }
    } else if (object.kind === "eventTrigger" && object.id) {
      const eventTrigger = eventTriggers.find(
        (candidate) => candidate.id === object.id,
      );
      if (eventTrigger) {
        setSelectedObject({
          kind: "eventTrigger",
          id: eventTrigger.id,
          name: eventTrigger.name,
        });
        return;
      }
    }
    notify(
      `Referenced ${object.kind} ${databaseObjectQualifiedName(object)} is not visible`,
    );
  };

  const sort = (key: string) => {
    setGridSelection(null);
    setResultPage(0);
    setGridScrollTop(0);
    if (key === sortBy)
      setSortDirection(sortDirection === "asc" ? "desc" : "asc");
    else {
      setSortBy(key);
      setSortDirection("desc");
    }
  };
  const toggle = (key: string) =>
    setCollapsed((current) =>
      current.includes(key)
        ? current.filter((item) => item !== key)
        : [...current, key],
    );
  const applyTableBrowse = async () => {
    if (!tableBrowse || !currentTable || isRunning) return;
    if (
      tableBrowse.schema !== currentTable.schema ||
      tableBrowse.name !== currentTable.name
    ) {
      return;
    }
    const plan = buildTableBrowsePlan(
      currentTable,
      driverKind,
      tableBrowsePageSize,
      0,
      filter,
      sortBy,
      sortDirection,
    );
    if (plan.errors.length > 0) {
      notify(plan.errors[0] ?? "Unable to build table browse query");
      return;
    }
    setGridSelection(null);
    setEditingCell(null);
    setResultPage(0);
    setGridScrollTop(0);
    setServerQueryPage(null);
    setFilter(plan.filter);
    setSortBy(plan.sortBy);
    setSql(plan.sql);
    setTableBrowse({
      schema: currentTable.schema,
      name: currentTable.name,
      offset: 0,
      hasMore: true,
      filter: plan.filter,
      sortBy: plan.sortBy,
      sortDirection: plan.sortDirection,
      warnings: plan.warnings,
    });
    const nextResult = await runQuery("normal", plan.sql);
    if (!nextResult) {
      setTableBrowse(null);
      return;
    }
    setTableBrowse((current) =>
      current
        ? {
            ...current,
            hasMore: nextResult.rows.length === tableBrowsePageSize,
          }
        : current,
    );
    notify("Applied server-side table filter and sort");
  };
  const browseCurrentTable = () => {
    if (!currentTable) return;
    if (pendingEditCount > 0) {
      notify("Review or discard staged row edits before opening another table");
      return;
    }
    const plan = buildTableBrowsePlan(
      currentTable,
      driverKind,
      tableBrowsePageSize,
      0,
    );
    if (plan.errors.length > 0) {
      notify(plan.errors[0] ?? "Unable to build table browse query");
      return;
    }
    const browseSql = plan.sql;
    newQuery();
    setSql(browseSql);
    setResultView("table");
    setFilter("");
    setSortBy(null);
    setSortDirection("asc");
    setResultPage(0);
    setTableBrowse({
      schema: currentTable.schema,
      name: currentTable.name,
      offset: 0,
      hasMore: true,
      filter: plan.filter,
      sortBy: plan.sortBy,
      sortDirection: plan.sortDirection,
      warnings: plan.warnings,
    });
    setServerQueryPage(null);
    void runQuery("normal", browseSql).then((nextResult) => {
      if (!nextResult) {
        setTableBrowse(null);
        return;
      }
      setTableBrowse((current) =>
        current
          ? {
              ...current,
              hasMore: nextResult.rows.length === tableBrowsePageSize,
            }
          : current,
      );
    });
    notify(`Opened ${currentTable.schema}.${currentTable.name} data`);
  };
  const loadNextTablePage = async () => {
    if (!tableBrowse || !currentTable || isRunning || tableBrowseDirty) return;
    if (
      tableBrowse.schema !== currentTable.schema ||
      tableBrowse.name !== currentTable.name ||
      !tableBrowse.hasMore
    ) {
      return;
    }
    const nextOffset = tableBrowse.offset + tableBrowsePageSize;
    const plan = buildTableBrowsePlan(
      currentTable,
      driverKind,
      tableBrowsePageSize,
      nextOffset,
      tableBrowse.filter,
      tableBrowse.sortBy,
      tableBrowse.sortDirection,
    );
    if (plan.errors.length > 0) {
      notify(plan.errors[0] ?? "Unable to build the next table page");
      return;
    }
    const nextResult = await runQuery("normal", plan.sql, {
      preserveResult: true,
    });
    if (!nextResult) return;
    appendResult(nextResult);
    setTableBrowse((current) =>
      current
        ? {
            ...current,
            offset: nextOffset,
            hasMore: nextResult.rows.length === tableBrowsePageSize,
          }
        : current,
    );
    setResultPage(0);
    notify(`Loaded ${nextResult.rows.length.toLocaleString()} more rows`);
  };

  const loadNextServerPage = async () => {
    if (!serverQueryPage || isRunning || !serverQueryPage.hasMore) return;
    const nextOffset = serverQueryPage.offset + resultPageSize;
    const nextPlan = buildQueryPagePlan(
      serverQueryPage.sql,
      driverKind,
      resultPageSize,
      nextOffset,
    );
    if (nextPlan.errors.length > 0) {
      notify(nextPlan.errors[0] ?? "Unable to load the next result page");
      setServerQueryPage(null);
      return;
    }
    const nextResult = await runQuery("normal", nextPlan.sql, {
      preserveResult: true,
      historySql: serverQueryPage.sql,
    });
    if (!nextResult) return;
    appendResult(nextResult);
    setServerQueryPage((current) =>
      current
        ? {
            ...current,
            offset: nextOffset,
            hasMore: nextResult.rows.length === resultPageSize,
          }
        : current,
    );
    setResultPage(0);
    notify(`Loaded ${nextResult.rows.length.toLocaleString()} more rows`);
  };

  const importCsv = async (plan: CsvImportPlan) => {
    if (!currentTable) return;
    if (readOnlyConnection) {
      notify("Read-only connection: imports are disabled");
      return;
    }
    if (pendingEditCount > 0) {
      notify("Review or discard staged row edits before importing data");
      return;
    }
    if (plan.errors.length > 0 || plan.statements.length === 0) {
      notify("Fix import mapping errors before importing data");
      return;
    }
    setImportOpen(false);
    const result =
      plan.conflictPolicy === "upsert"
        ? await runQuery("transaction", plan.statements[0] ?? "", {
            preserveResult: true,
          })
        : await runQuery("normal", plan.statements.join("\n"), {
            batch: {
              statements: plan.statements,
              expectedRows: plan.statements.length,
            },
          });
    if (!result) return;
    await loadMetadata();
    notify(
      plan.conflictPolicy === "upsert"
        ? `Upserted ${plan.rowCount.toLocaleString()} rows`
        : `Imported ${plan.statements.length.toLocaleString()} rows`,
    );
  };

  const exportResults = async (format: ExportFormat) => {
    if (!result || result.columns.length === 0) {
      notify("Run a query with tabular results before exporting");
      return;
    }
    setExportMenuOpen(false);
    const timestamp = new Date()
      .toISOString()
      .replaceAll(":", "-")
      .slice(0, 19);
    try {
      let contents: string;
      let extension: string;
      let filterName: string;
      let mimeType: string;
      let suggestedName: string;
      if (format === "csv") {
        contents = serializeRowsToCsv(result.columns, filteredRows);
        extension = "csv";
        filterName = "CSV";
        mimeType = "text/csv;charset=utf-8";
        suggestedName = `queryx-results-${timestamp}.csv`;
      } else if (format === "json") {
        contents = serializeRowsToJson(result.columns, filteredRows);
        extension = "json";
        filterName = "JSON";
        mimeType = "application/json;charset=utf-8";
        suggestedName = `queryx-results-${timestamp}.json`;
      } else if (format === "markdown") {
        contents = serializeRowsToMarkdown(result.columns, filteredRows);
        extension = "md";
        filterName = "Markdown";
        mimeType = "text/markdown;charset=utf-8";
        suggestedName = `queryx-results-${timestamp}.md`;
      } else if (format === "excel") {
        contents = serializeRowsToExcelXml(result.columns, filteredRows);
        extension = "xml";
        filterName = "Excel XML";
        mimeType = "application/xml;charset=utf-8";
        suggestedName = `queryx-results-${timestamp}.xml`;
      } else {
        const tableName = window.prompt(
          "Target table for generated SQL INSERT statements",
          "exported_results",
        );
        if (!tableName?.trim()) {
          notify("SQL INSERT export cancelled");
          return;
        }
        contents = serializeRowsToSqlInsert(result.columns, filteredRows, {
          tableName,
          dialect: driverKind,
        });
        extension = "sql";
        filterName = "SQL";
        mimeType = "application/sql;charset=utf-8";
        suggestedName = `queryx-results-${timestamp}.sql`;
      }
      const outcome = await saveTextFile(
        contents,
        suggestedName,
        filterName,
        extension,
        mimeType,
      );
      if (outcome === "saved")
        notify(
          `Exported ${filteredRows.length.toLocaleString()} rows as ${format.toUpperCase()} locally`,
        );
    } catch (error) {
      notify(
        `${format.toUpperCase()} export failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  };

  const buildGridClipboard = (
    selection: GridSelection | null,
    includeHeaders: boolean,
  ): string | null => {
    if (!result || result.columns.length === 0) return null;
    if (!selection) {
      return serializeRowsToTsv(result.columns, gridRows, {
        includeHeaders,
        nullValue: nullDisplay === "literal" ? "NULL" : "",
      });
    }
    if (selection.kind === "rows") {
      const [startRow, endRow] = rangeBounds(selection.anchor, selection.focus);
      return serializeRowsToTsv(
        result.columns,
        gridRows.slice(startRow - gridRowOffset, endRow - gridRowOffset + 1),
        { nullValue: nullDisplay === "literal" ? "NULL" : "" },
      );
    }
    const [startRow, endRow] = rangeBounds(
      selection.anchor.row,
      selection.focus.row,
    );
    const [startColumn, endColumn] = rangeBounds(
      selection.anchor.column,
      selection.focus.column,
    );
    return serializeRowsToTsv(
      result.columns.slice(startColumn, endColumn + 1),
      gridRows.slice(startRow - gridRowOffset, endRow - gridRowOffset + 1),
      { nullValue: nullDisplay === "literal" ? "NULL" : "" },
    );
  };

  const copyGridSelection = async () => {
    const hasSelection = gridSelection !== null;
    const text = buildGridClipboard(gridSelection, !hasSelection);
    if (text === null) {
      notify("Run a query with tabular results before copying");
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      notify(
        hasSelection
          ? "Copied selected result range"
          : virtualRowWindow.enabled
            ? "Copied loaded results"
            : "Copied visible results",
      );
    } catch {
      notify("Could not copy result data");
    }
  };

  const handleGridKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "c") {
      event.preventDefault();
      void copyGridSelection();
    }
  };

  const handleGridCopy = (event: ClipboardEvent<HTMLElement>) => {
    if (!gridSelection) return;
    const text = buildGridClipboard(gridSelection, false);
    if (text === null) return;
    event.preventDefault();
    event.clipboardData.setData("text/plain", text);
    notify("Copied selected result range");
  };

  const selectGridCell = (row: number, column: number, extend: boolean) => {
    setGridSelection((current) =>
      extend && current?.kind === "cells"
        ? { kind: "cells", anchor: current.anchor, focus: { row, column } }
        : { kind: "cells", anchor: { row, column }, focus: { row, column } },
    );
  };

  const selectGridRow = (row: number, extend: boolean) => {
    setGridSelection((current) =>
      extend && current?.kind === "rows"
        ? { kind: "rows", anchor: current.anchor, focus: row }
        : { kind: "rows", anchor: row, focus: row },
    );
  };

  const paletteCommands: PaletteCommand[] = [
    {
      id: "run",
      label: "Run query",
      hint: "⌘↵",
      disabled: isRunning,
      execute: () => editorRef.current?.runSelectionOrDocument(),
    },
    {
      id: "explain",
      label: "Explain query plan",
      hint: "non-executing",
      disabled: isRunning || !canExplain,
      execute: handleExplain,
    },
    {
      id: "stream",
      label: "Stream query results",
      hint: "Native drivers · chunked",
      disabled: isRunning || !driver.capabilities().has("streaming"),
      execute: () => handleStream(),
    },
    {
      id: "transaction",
      label: "Run in transaction",
      hint: "rollback on error",
      disabled: isRunning,
      execute: () => handleRun("transaction"),
    },
    {
      id: "begin-transaction",
      label: "Begin transaction session",
      hint: transactionActive ? "already active" : "native session",
      disabled: isRunning || transactionActive,
      execute: () =>
        void beginTransaction().catch((error) => notify(String(error))),
    },
    {
      id: "commit-transaction",
      label: "Commit transaction",
      hint: transactionActive ? "persist changes" : "no active session",
      disabled: isRunning || !transactionActive,
      execute: () =>
        void commitTransaction().catch((error) => notify(String(error))),
    },
    {
      id: "rollback-transaction",
      label: "Rollback transaction",
      hint: transactionActive ? "discard changes" : "no active session",
      disabled: isRunning || !transactionActive,
      execute: () =>
        void rollbackTransaction().catch((error) => notify(String(error))),
    },
    {
      id: "format",
      label: "Format SQL",
      hint: "⌘L",
      execute: () => setSql(formatSql(sql)),
    },
    {
      id: "favorite",
      label: activeFavorite ? "Remove favorite" : "Save favorite",
      hint: "local workspace",
      disabled: !sql.trim(),
      execute: handleToggleFavorite,
    },
    {
      id: "quick-open",
      label: "Quick Open query",
      hint: "⌘P",
      execute: openQuickOpen,
    },
    {
      id: "new-query",
      label: "New query tab",
      hint: "⌘T",
      execute: newQuery,
    },
    {
      id: "copy-results",
      label: "Copy visible results",
      hint: "TSV",
      disabled: !result || result.columns.length === 0,
      execute: () => void copyGridSelection(),
    },
    {
      id: "focus-filter",
      label: "Focus result filter",
      hint: "⌘F",
      execute: () => document.getElementById("result-filter")?.focus(),
    },
    {
      id: "refresh-metadata",
      label: "Refresh metadata",
      hint: "catalog snapshot",
      execute: () => {
        void loadMetadata();
        notify("Refreshing metadata…");
      },
    },
    {
      id: "capture-schema-baseline",
      label: "Capture schema baseline",
      hint: "compare after refresh",
      disabled: !metadata,
      execute: captureSchemaBaseline,
    },
    {
      id: "compare-schema",
      label: "Compare schema",
      hint: schemaDiff
        ? `${schemaDiff.changes.length} changes`
        : "baseline required",
      disabled: !schemaBaseline || !metadata,
      execute: openSchemaDiff,
    },
    {
      id: "compare-table-data",
      label: "Compare selected table data",
      hint: currentTable
        ? `${currentTable.schema}.${currentTable.name} · max ${dataCompareMaxRows.toLocaleString()} rows`
        : "table with primary key required",
      disabled: !currentTable,
      execute: openDataCompare,
    },
    {
      id: "migration-history",
      label: "Migration history",
      hint: `${migrationHistory.length} saved previews`,
      execute: openMigrationHistory,
    },
    {
      id: "import-csv",
      label: "Import CSV into selected table",
      hint: currentTable
        ? `${currentTable.schema}.${currentTable.name}`
        : "table required",
      disabled: !currentTable || readOnlyConnection,
      execute: () => setImportOpen(true),
    },
    {
      id: "open-erd",
      label: "Open ERD",
      hint: metadata
        ? `${metadata.tables.length + metadata.views.length} relations`
        : "metadata required",
      disabled: !metadata,
      execute: openErd,
    },
    {
      id: "open-sessions",
      label: "Open session explorer",
      hint: canInspectSessions
        ? `${sessions.length} sessions`
        : "native driver required",
      disabled: !canInspectSessions,
      execute: openSessions,
    },
    {
      id: "open-lock-graph",
      label: "Open lock graph",
      hint: canInspectLocks
        ? `${locks.length} lock waits`
        : "native driver required",
      disabled: !canInspectLocks,
      execute: openLocks,
    },
    {
      id: "open-long-running-queries",
      label: "Open long-running query diagnostics",
      hint: canInspectSessions
        ? `${longRunningSessions.length} above threshold`
        : "native driver required",
      disabled: !canInspectSessions,
      execute: openDiagnostics,
    },
    {
      id: "open-session-history",
      label: "Open session audit history",
      hint: `${sessionAudit.length} local observations`,
      execute: openSessionHistory,
    },
    {
      id: "create-table",
      label: "Create table from form",
      hint: metadata ? driverDisplayName(driverKind) : "metadata required",
      disabled: !metadata || readOnlyConnection,
      execute: openCreateTable,
    },
    {
      id: "add-column",
      label: "Add column to selected table",
      hint: currentTable
        ? `${currentTable.schema}.${currentTable.name}`
        : "table required",
      disabled: !currentTable || readOnlyConnection,
      execute: openAddColumn,
    },
    {
      id: "edit-columns",
      label: "Edit columns in selected table",
      hint: currentTable
        ? `${currentTable.schema}.${currentTable.name}`
        : "table required",
      disabled: !currentTable || readOnlyConnection,
      execute: openEditColumns,
    },
    {
      id: "create-index",
      label: "Create index on selected table",
      hint: currentTable
        ? `${currentTable.schema}.${currentTable.name}`
        : "table required",
      disabled: !currentTable || readOnlyConnection,
      execute: openCreateIndex,
    },
    {
      id: "drop-index",
      label: "Drop index on selected table",
      hint: currentTable
        ? `${currentTable.schema}.${currentTable.name}`
        : "table required",
      disabled: !currentTable || readOnlyConnection,
      execute: openDropIndex,
    },
    {
      id: "add-foreign-key",
      label: "Add foreign key to selected table",
      hint: currentTable
        ? `${currentTable.schema}.${currentTable.name}`
        : "table required",
      disabled: !currentTable || readOnlyConnection,
      execute: openAddForeignKey,
    },
    {
      id: "drop-foreign-key",
      label: "Drop foreign key from selected table",
      hint: currentTable
        ? `${currentTable.schema}.${currentTable.name}`
        : "table required",
      disabled: !currentTable || readOnlyConnection,
      execute: openDropForeignKey,
    },
    {
      id: "create-view",
      label: "Create view from form",
      hint: metadata ? driverDisplayName(driverKind) : "metadata required",
      disabled: !metadata || readOnlyConnection,
      execute: openCreateView,
    },
    {
      id: "alter-view",
      label: "Edit definition of selected view",
      hint: currentView
        ? `${currentView.schema}.${currentView.name}`
        : "view required",
      disabled: !currentView || readOnlyConnection,
      execute: openAlterView,
    },
    {
      id: "drop-view",
      label: "Drop selected view",
      hint: currentView
        ? `${currentView.schema}.${currentView.name}`
        : "view required",
      disabled: !currentView || readOnlyConnection,
      execute: openDropView,
    },
    {
      id: "connection",
      label: "Open connection dialog",
      hint: connectionName,
      execute: () => setConnectionOpen(true),
    },
  ];
  const filteredCommands = paletteCommands.filter((command) =>
    `${command.label} ${command.hint}`
      .toLowerCase()
      .includes(commandQuery.trim().toLowerCase()),
  );
  const executePaletteCommand = () => {
    const command = filteredCommands[commandIndex];
    if (!command || command.disabled) return;
    setCommandPaletteOpen(false);
    command.execute();
  };

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">
            <QueryXMark />
          </span>
          <strong>
            Query<span>X</span>
          </strong>
          <small>BETA</small>
        </div>
        <button
          type="button"
          className="workspace-switcher"
          onClick={() => setConnectionOpen(true)}
        >
          <span className="workspace-dot" /> {connectionName}{" "}
          <span className="chevron">⌄</span>
        </button>
        <div className="topbar-actions">
          <button
            type="button"
            className="icon-button"
            onClick={openCommandPalette}
            aria-label="Open command palette"
          >
            ⌘K
          </button>
          <UpdateButton onNotify={notify} />
          <button
            type="button"
            className="icon-button"
            aria-label="Open session explorer"
            title={
              canInspectSessions
                ? "Session explorer"
                : "Session explorer requires a native database connection"
            }
            onClick={openSessions}
            disabled={!canInspectSessions}
          >
            <UiIcon name="sessions" size={16} />
          </button>
          <button
            type="button"
            className="icon-button"
            aria-label="Open lock graph"
            title={
              canInspectLocks
                ? "Lock graph"
                : "Lock graph requires a native database connection"
            }
            onClick={openLocks}
            disabled={!canInspectLocks}
          >
            <UiIcon name="locks" size={16} />
          </button>
          <button
            type="button"
            className="icon-button"
            aria-label="Open long-running query diagnostics"
            title={
              canInspectSessions
                ? "Long-running query diagnostics"
                : "Diagnostics require a native database connection"
            }
            onClick={openDiagnostics}
            disabled={!canInspectSessions}
          >
            <UiIcon name="diagnostics" size={16} />
          </button>
          <button
            type="button"
            className="icon-button"
            aria-label="Open session audit history"
            title="Session audit history"
            onClick={openSessionHistory}
          >
            <UiIcon name="audit" size={16} />
          </button>
          <button
            type="button"
            className="icon-button"
            aria-label="Open settings"
            title="Open settings"
            onClick={() => notify("Settings are stored locally")}
          >
            <UiIcon name="settings" size={16} />
          </button>
          <span className="avatar">JD</span>
        </div>
      </header>
      <div className="workspace">
        <aside className="activitybar">
          <button
            type="button"
            className="activity-icon active"
            aria-label="Open Explorer"
            title="Explorer"
          >
            <UiIcon name="explorer" size={17} />
          </button>
          <button
            type="button"
            className="activity-icon"
            aria-label="Open Quick Open"
            onClick={openQuickOpen}
          >
            <UiIcon name="search" size={17} />
          </button>
          <button
            type="button"
            className="activity-icon"
            aria-label="Open command palette"
            title="Command palette"
            onClick={openCommandPalette}
          >
            <UiIcon name="commands" size={17} />
          </button>
          <button
            type="button"
            className="activity-icon"
            aria-label="Open connection manager"
            title="Connection manager"
            onClick={() => setConnectionOpen(true)}
          >
            <UiIcon name="connections" size={17} />
          </button>
          <div className="activity-spacer" />
          <button
            type="button"
            className="activity-icon"
            aria-label="Open help"
            title="Help"
            onClick={() => notify("See the QueryX documentation for help")}
          >
            <UiIcon name="help" size={17} />
          </button>
        </aside>
        <aside className="sidebar">
          <div className="panel-heading">
            EXPLORER{" "}
            <button
              type="button"
              className="mini-button"
              aria-label="New connection"
              onClick={() => setConnectionOpen(true)}
            >
              ＋
            </button>
            <button
              type="button"
              className="mini-button"
              aria-label="Refresh metadata"
              onClick={() => {
                void loadMetadata();
                notify("Refreshing metadata…");
              }}
            >
              ↻
            </button>
            <button
              type="button"
              className={`mini-button ${schemaBaseline ? "active" : ""}`}
              aria-label={
                schemaBaseline ? "Compare schema" : "Capture schema baseline"
              }
              title={
                schemaBaseline
                  ? "Compare current metadata with baseline"
                  : "Capture current metadata as schema baseline"
              }
              onClick={openSchemaDiff}
            >
              ⇄
            </button>
          </div>
          <button
            type="button"
            className="connection-select"
            onClick={() => setConnectionOpen(true)}
          >
            <span
              className={`status-dot ${connectionStatus === "connected" ? "green" : "orange"}`}
            />{" "}
            <strong>{connectionName}</strong>
            <span className="driver-tag">{driverDisplayName(driverKind)}</span>
            <span className="chevron">⌄</span>
          </button>
          <div className="tree">
            <TreeRow
              label={connectionName}
              icon="◉"
              tone="db"
              onClick={() => toggle("root")}
              collapsed={collapsed.includes("root")}
            />
            {!collapsed.includes("root") && (
              <div className="tree-children">
                <TreeRow
                  label="Schemas"
                  icon="▱"
                  tone="folder"
                  onClick={() => toggle("schemas")}
                  collapsed={collapsed.includes("schemas")}
                />
                {!collapsed.includes("schemas") && (
                  <div className="tree-children">
                    {schemas.map((schema) => {
                      const schemaKey = `schema:${schema}`;
                      const schemaTables = tables.filter(
                        (table) => table.schema === schema,
                      );
                      const schemaViews = views.filter(
                        (view) => view.schema === schema,
                      );
                      const schemaRoutines = routines.filter(
                        (routine) => routine.schema === schema,
                      );
                      const schemaTriggers = triggers.filter(
                        (trigger) => trigger.schema === schema,
                      );
                      return (
                        <div key={schema}>
                          <TreeRow
                            label={schema}
                            icon="◇"
                            tone="schema"
                            onClick={() => toggle(schemaKey)}
                            collapsed={collapsed.includes(schemaKey)}
                          />
                          {!collapsed.includes(schemaKey) && (
                            <div className="tree-children">
                              <TreeRow
                                label="Tables"
                                icon="▱"
                                tone="folder"
                                count={schemaTables.length}
                              />
                              {schemaTables.length > 0 && (
                                <div className="tree-children">
                                  {schemaTables.map((table) => {
                                    const tableKey = `${table.schema}.${table.name}`;
                                    return (
                                      <button
                                        type="button"
                                        className={`tree-row ${selectedObject?.kind === "table" && selectedObject.schema === table.schema && selectedObject.name === table.name ? "selected" : ""}`}
                                        key={tableKey}
                                        onClick={() =>
                                          setSelectedObject({
                                            kind: "table",
                                            schema: table.schema,
                                            name: table.name,
                                          })
                                        }
                                      >
                                        <span className="tree-icon table">
                                          ▤
                                        </span>
                                        {table.name}
                                      </button>
                                    );
                                  })}
                                </div>
                              )}
                              <TreeRow
                                label="Views"
                                icon="▱"
                                tone="folder"
                                count={schemaViews.length}
                              />
                              {schemaViews.length > 0 && (
                                <div className="tree-children">
                                  {schemaViews.map((view) => {
                                    const viewKey = `${view.schema}.${view.name}`;
                                    return (
                                      <button
                                        type="button"
                                        className={`tree-row ${selectedObject?.kind === "view" && selectedObject.schema === view.schema && selectedObject.name === view.name ? "selected" : ""}`}
                                        key={viewKey}
                                        onClick={() =>
                                          setSelectedObject({
                                            kind: "view",
                                            schema: view.schema,
                                            name: view.name,
                                          })
                                        }
                                      >
                                        <span className="tree-icon view">
                                          ◫
                                        </span>
                                        {view.name}
                                      </button>
                                    );
                                  })}
                                </div>
                              )}
                              <TreeRow
                                label="Routines"
                                icon="▱"
                                tone="folder"
                                count={schemaRoutines.length}
                              />
                              {schemaRoutines.length > 0 && (
                                <div className="tree-children">
                                  {schemaRoutines.map((routine) => (
                                    <button
                                      type="button"
                                      className={`tree-row routine-tree-row ${selectedObject?.kind === "routine" && selectedObject.id === routine.id ? "selected" : ""}`}
                                      key={routine.id}
                                      title={`${routine.schema}.${routine.name}(${routine.identityArguments})`}
                                      onClick={() =>
                                        setSelectedObject({
                                          kind: "routine",
                                          id: routine.id,
                                          schema: routine.schema,
                                          name: routine.name,
                                          identityArguments:
                                            routine.identityArguments,
                                          routineKind: routine.kind,
                                        })
                                      }
                                    >
                                      <span className="tree-icon routine">
                                        ƒ
                                      </span>
                                      <span className="routine-tree-label">
                                        {routine.name}(
                                        {routine.identityArguments})
                                      </span>
                                      <small>
                                        {routineKindShortLabel(routine.kind)}
                                      </small>
                                    </button>
                                  ))}
                                </div>
                              )}
                              <TreeRow
                                label="Triggers"
                                icon="▱"
                                tone="folder"
                                count={schemaTriggers.length}
                              />
                              {schemaTriggers.length > 0 && (
                                <div className="tree-children">
                                  {schemaTriggers.map((trigger) => (
                                    <button
                                      type="button"
                                      className={`tree-row trigger-tree-row ${selectedObject?.kind === "trigger" && selectedObject.id === trigger.id ? "selected" : ""}`}
                                      key={trigger.id}
                                      title={`${trigger.name} on ${trigger.relation.schema}.${trigger.relation.name}`}
                                      onClick={() =>
                                        setSelectedObject({
                                          kind: "trigger",
                                          id: trigger.id,
                                          schema: trigger.schema,
                                          name: trigger.name,
                                        })
                                      }
                                    >
                                      <span className="tree-icon trigger">
                                        ⚡
                                      </span>
                                      <span className="routine-tree-label">
                                        {trigger.name}
                                      </span>
                                      <small>{trigger.relation.name}</small>
                                    </button>
                                  ))}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
                <TreeRow
                  label="Event Triggers"
                  icon="✦"
                  tone="folder"
                  count={eventTriggers.length}
                  onClick={() => toggle("event-triggers")}
                  collapsed={collapsed.includes("event-triggers")}
                />
                {!collapsed.includes("event-triggers") &&
                  eventTriggers.length > 0 && (
                    <div className="tree-children">
                      {eventTriggers.map((eventTrigger) => (
                        <button
                          type="button"
                          className={`tree-row trigger-tree-row ${selectedObject?.kind === "eventTrigger" && selectedObject.id === eventTrigger.id ? "selected" : ""}`}
                          key={eventTrigger.id}
                          title={`${eventTrigger.name} · ${eventTrigger.event}`}
                          onClick={() =>
                            setSelectedObject({
                              kind: "eventTrigger",
                              id: eventTrigger.id,
                              name: eventTrigger.name,
                            })
                          }
                        >
                          <span className="tree-icon trigger">✦</span>
                          <span className="routine-tree-label">
                            {eventTrigger.name}
                          </span>
                          <small>{eventTrigger.event}</small>
                        </button>
                      ))}
                    </div>
                  )}
              </div>
            )}
          </div>
          <div className="section-label">
            FAVORITES <span className="count">{favorites.length}</span>
          </div>
          <div className="recent-list">
            {favorites.length > 0 ? (
              favorites
                .slice(0, 3)
                .map((favorite) => (
                  <FavoriteQuery
                    key={favorite.id}
                    name={favorite.label}
                    onClick={() => setSql(favorite.sql)}
                  />
                ))
            ) : (
              <div className="sidebar-empty">Save a query with ♡</div>
            )}
          </div>
          <div className="section-label">
            RECENT QUERIES{" "}
            <button
              type="button"
              className="mini-button"
              aria-label="Clear recent queries"
              title="Clear locally stored recent queries"
              onClick={handleClearHistory}
              disabled={history.length === 0}
            >
              •••
            </button>
          </div>
          <div className="recent-list">
            {history.length > 0 ? (
              history
                .slice(0, 3)
                .map((entry) => (
                  <Recent
                    key={entry.id}
                    name={entry.label}
                    time={relativeTime(entry.executedAt)}
                    status={entry.status}
                    onClick={() => setSql(entry.sql)}
                  />
                ))
            ) : (
              <div className="sidebar-empty">Run a query to see it here</div>
            )}
          </div>
          <div className="storage-note">
            <span className="lock">⌑</span>
            <span>
              <strong>Local-first</strong>
              <small>Data stays on your device</small>
            </span>
            <b>✓</b>
          </div>
        </aside>
        <main className="main-area">
          <div className="editor-tabs">
            {tabs.map((tab) => (
              <div
                className={`tab ${tab.id === activeTabId ? "active" : ""}`}
                key={tab.id}
              >
                <button
                  type="button"
                  className="tab-select"
                  onClick={() => selectQuery(tab.id)}
                >
                  <span className="sql-badge">SQL</span>
                  {tab.title}
                  {tab.isDirty && <span className="dirty-dot">●</span>}
                </button>
                <button
                  type="button"
                  className="tab-close"
                  aria-label={`Close ${tab.title}`}
                  onClick={() => requestCloseQuery(tab.id)}
                >
                  ×
                </button>
              </div>
            ))}
            <button type="button" className="new-query-tab" onClick={newQuery}>
              ＋ New query
            </button>
            <div className="tab-spacer" />
            <button
              type="button"
              className="connected"
              onClick={() => setConnectionOpen(true)}
            >
              <span
                className={`status-dot ${connectionStatus === "connected" ? "green" : "orange"}`}
              />{" "}
              {connectionStatus === "connected"
                ? "Connected"
                : connectionStatus === "connecting"
                  ? "Connecting…"
                  : "Connection error"}{" "}
              ⌄
            </button>
          </div>
          <section className="editor-pane">
            <div className="editor-toolbar">
              <div>
                <button
                  type="button"
                  className={
                    isRunning && canCancel ? "cancel-button" : "run-button"
                  }
                  onClick={() =>
                    isRunning
                      ? cancelQuery()
                      : editorRef.current?.runSelectionOrDocument()
                  }
                  disabled={isRunning && !canCancel}
                >
                  <span>{isRunning ? (canCancel ? "■" : "◌") : "▶"}</span>{" "}
                  {isRunning ? (canCancel ? "Cancel" : "Running…") : "Run"}{" "}
                  <kbd>{isRunning && canCancel ? "Esc" : "⌘↵"}</kbd>
                </button>
                <button
                  type="button"
                  className="toolbar-button stream-button"
                  onClick={() => handleStream()}
                  disabled={
                    isRunning || !driver.capabilities().has("streaming")
                  }
                  title={
                    driver.capabilities().has("streaming")
                      ? "Stream a single SELECT/WITH result in chunks"
                      : "Chunked streaming is currently available for native PostgreSQL, MySQL/MariaDB, and SQLite connections"
                  }
                >
                  Stream
                </button>
                <button
                  type="button"
                  className="toolbar-button"
                  onClick={() => setSql(formatSql(sql))}
                  title="Format the active SQL while preserving strings and comments"
                >
                  Format <kbd>⌘L</kbd>
                </button>
                <button
                  type="button"
                  className="toolbar-button"
                  onClick={handleExplain}
                  disabled={isRunning || !canExplain}
                  title={
                    canExplain
                      ? "Show a non-executing plan for the active SQL document"
                      : "Explain plans are not supported by this connection"
                  }
                >
                  Explain
                </button>
                <button
                  type="button"
                  className="toolbar-button transaction-button"
                  onClick={() => handleRun("transaction")}
                  disabled={isRunning}
                  title="Execute the full SQL document in one transaction"
                >
                  Run in Transaction
                </button>
                <button
                  type="button"
                  className={`toolbar-button ${transactionActive ? "active" : ""}`}
                  onClick={() =>
                    void beginTransaction().catch((error) =>
                      notify(String(error)),
                    )
                  }
                  disabled={isRunning || transactionActive}
                  title="Keep subsequent queries on one native database transaction session"
                >
                  Begin
                </button>
                <button
                  type="button"
                  className="toolbar-button"
                  onClick={() =>
                    void commitTransaction().catch((error) =>
                      notify(String(error)),
                    )
                  }
                  disabled={isRunning || !transactionActive}
                  title="Commit the active native transaction session"
                >
                  Commit
                </button>
                <button
                  type="button"
                  className="toolbar-button"
                  onClick={() =>
                    void rollbackTransaction().catch((error) =>
                      notify(String(error)),
                    )
                  }
                  disabled={isRunning || !transactionActive}
                  title="Roll back the active native transaction session"
                >
                  Rollback
                </button>
              </div>
              <div className="toolbar-right">
                <button
                  type="button"
                  className={`toolbar-button favorite-button ${activeFavorite ? "active" : ""}`}
                  onClick={handleToggleFavorite}
                  aria-label={
                    activeFavorite
                      ? "Remove query from favorites"
                      : "Save query to favorites"
                  }
                  title={
                    activeFavorite
                      ? "Remove query from local favorites"
                      : "Save query to local favorites"
                  }
                >
                  {activeFavorite ? "♥" : "♡"}
                </button>
              </div>
            </div>
            <div className="code-editor">
              <Suspense
                fallback={
                  <div className="editor-loading">Loading SQL editor…</div>
                }
              >
                <MonacoSqlEditor
                  ref={editorRef}
                  tabs={tabs}
                  activeTabId={activeTabId}
                  completions={completions}
                  onChange={setSql}
                  onRun={(selectedSql) => handleRun("normal", selectedSql)}
                  onCursorChange={(line, column, selected) =>
                    setCursor({ line, column, selected })
                  }
                />
              </Suspense>
            </div>
            <div className="editor-footer">
              <span>{driverDisplayName(driverKind)}</span>
              <span>UTF-8</span>
              <span>
                Ln {cursor.line}, Col {cursor.column}
                {cursor.selected > 0 && ` · ${cursor.selected} selected`}
              </span>
              <span className="footer-spacer" />
              <span>Spaces: 2</span>
              <span>SQL</span>
            </div>
          </section>
          <section className="results-pane">
            <div className="results-heading">
              <div className="result-title">
                <span>⌄</span> Results <small>{filteredRows.length} rows</small>
                <em>· {result?.executionTime ?? 0}ms</em>
              </div>
              <div className="result-actions">
                <button
                  type="button"
                  className={resultView === "table" ? "active" : ""}
                  onClick={() => setResultView("table")}
                >
                  ▤ Table
                </button>
                <button
                  type="button"
                  className={resultView === "json" ? "active" : ""}
                  onClick={() => setResultView("json")}
                >
                  {"{ }"} JSON
                </button>
                <button
                  type="button"
                  onClick={() => void copyGridSelection()}
                  disabled={!result || result.columns.length === 0}
                  title={
                    gridSelection
                      ? "Copy the selected cells or rows"
                      : "Copy visible results with column headers"
                  }
                >
                  ⇧ Copy
                </button>
                <button
                  type="button"
                  className={nullDisplay === "literal" ? "active" : ""}
                  onClick={() =>
                    setNullDisplay((current) =>
                      current === "literal" ? "empty" : "literal",
                    )
                  }
                  aria-pressed={nullDisplay === "literal"}
                  title="Toggle whether NULL cells display as NULL or blank"
                >
                  {nullDisplay === "literal" ? "NULL" : "∅"}
                </button>
                <button
                  type="button"
                  className={
                    editingEnabled
                      ? "active edit-results-button"
                      : "edit-results-button"
                  }
                  onClick={() => {
                    if (readOnlyConnection) {
                      notify("Read-only connection: data editing is disabled");
                      return;
                    }
                    if (!canEditResults) {
                      notify(
                        "Select a table and include its primary-key columns in the result before editing",
                      );
                      return;
                    }
                    setEditingEnabled((enabled) => !enabled);
                    cancelCellEdit();
                  }}
                  disabled={
                    readOnlyConnection || !result || result.columns.length === 0
                  }
                  aria-pressed={editingEnabled}
                  title={
                    canEditResults
                      ? "Double-click a non-primary-key cell to stage an edit"
                      : readOnlyConnection
                        ? "Read-only connection: writes are disabled by the database"
                        : "Requires a selected table, editing-capable driver, and primary-key columns in the result"
                  }
                >
                  ✎ {editingEnabled ? "Editing" : "Edit"}
                  {pendingEditCount > 0 && ` · ${pendingEditCount}`}
                </button>
                <button
                  type="button"
                  className="delete-rows-button"
                  onClick={() => {
                    if (readOnlyConnection) {
                      notify("Read-only connection: data deletion is disabled");
                      return;
                    }
                    if (!canDeleteRows) {
                      notify(
                        "Browse a table and select rows by their row numbers before deleting",
                      );
                      return;
                    }
                    setDeletePreviewOpen(true);
                  }}
                  disabled={readOnlyConnection || isRunning || !canDeleteRows}
                  title={
                    canDeleteRows
                      ? "Review and delete the selected table rows"
                      : readOnlyConnection
                        ? "Read-only connection: writes are disabled by the database"
                        : "Requires Table browser rows selected by row number"
                  }
                >
                  ⌫ Delete
                  {selectedDeleteRows.length > 0 &&
                    ` · ${selectedDeleteRows.length}`}
                </button>
                <button
                  type="button"
                  className="insert-row-button"
                  onClick={() => {
                    if (readOnlyConnection) {
                      notify("Read-only connection: row insertion is disabled");
                      return;
                    }
                    if (!canInsertRows || !currentTable) {
                      notify("Open a table browser before inserting a row");
                      return;
                    }
                    setInsertRowOpen(true);
                  }}
                  disabled={readOnlyConnection || isRunning || !canInsertRows}
                  title={
                    canInsertRows
                      ? "Open a form to insert a row using values or database defaults"
                      : readOnlyConnection
                        ? "Read-only connection: writes are disabled by the database"
                        : "Requires a selected table opened in the Table browser"
                  }
                >
                  ＋ New row
                </button>
                {pendingEditCount > 0 && (
                  <button
                    type="button"
                    className="apply-edits-button"
                    onClick={() => setEditPreviewOpen(true)}
                    disabled={readOnlyConnection || Boolean(editPreview.error)}
                    title="Review generated UPDATE statements before running them in a transaction"
                  >
                    Review & Apply
                  </button>
                )}
                {currentTable && (
                  <button
                    type="button"
                    className="import-data-button"
                    onClick={() => setImportOpen(true)}
                    disabled={readOnlyConnection || isRunning}
                    title={
                      readOnlyConnection
                        ? "Read-only connection: imports are disabled"
                        : `Import CSV into ${currentTable.schema}.${currentTable.name}`
                    }
                  >
                    ⇧ Import
                  </button>
                )}
                <div
                  className="export-menu-wrap"
                  onClick={(event) => event.stopPropagation()}
                  onKeyDown={(event) => event.stopPropagation()}
                >
                  <button
                    type="button"
                    onClick={() => setExportMenuOpen((open) => !open)}
                    disabled={!result || result.columns.length === 0}
                    aria-expanded={exportMenuOpen}
                    title="Export all filtered and sorted rows"
                  >
                    ⇩ Export <span className="export-chevron">⌄</span>
                  </button>
                  {exportMenuOpen && (
                    <div className="export-menu" role="menu">
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => void exportResults("csv")}
                      >
                        <strong>CSV</strong>
                        <small>Spreadsheet-safe</small>
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => void exportResults("json")}
                      >
                        <strong>JSON</strong>
                        <small>Structured rows</small>
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => void exportResults("sql")}
                      >
                        <strong>SQL INSERT</strong>
                        <small>Replayable transaction</small>
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => void exportResults("markdown")}
                      >
                        <strong>Markdown</strong>
                        <small>Portable table</small>
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => void exportResults("excel")}
                      >
                        <strong>Excel XML</strong>
                        <small>Open in Excel</small>
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </div>
            <div className="results-toolbar">
              <span className="result-meta">
                <i />{" "}
                {executionStatus === "running"
                  ? "Query running…"
                  : executionStatus === "cancelled"
                    ? "Query cancelled"
                    : executionStatus === "error"
                      ? "Query failed"
                      : result
                        ? "Query completed successfully"
                        : "Ready to run a query"}
                {result?.warnings.map((warning) => (
                  <span className="result-warning" key={warning}>
                    ⚠ {warning}
                  </span>
                ))}
                {tableBrowse?.warnings.map((warning) => (
                  <span className="result-warning" key={warning}>
                    ⚠ {warning}
                  </span>
                ))}
              </span>
              <label className="filter-box">
                ⌕
                <input
                  id="result-filter"
                  value={filter}
                  onChange={(event) => updateFilter(event.target.value)}
                  placeholder={
                    tableBrowse
                      ? "Filter loaded rows or apply to table..."
                      : "Filter results..."
                  }
                />
                <kbd>⌘F</kbd>
              </label>
              {tableBrowse && (
                <button
                  type="button"
                  className="table-filter-apply"
                  onClick={() => void applyTableBrowse()}
                  disabled={isRunning || !tableBrowseDirty}
                  title="Run the current filter and sort on the database"
                >
                  {isRunning ? "Applying…" : "Apply to table"}
                </button>
              )}
            </div>
            {resultView === "table" ? (
              <div
                className="grid-wrap"
                onScroll={(event) => {
                  setGridScrollTop(event.currentTarget.scrollTop);
                  setGridViewportHeight(event.currentTarget.clientHeight);
                }}
                aria-label="Query result grid. Click cells or row numbers, then use Shift-click or Command/Ctrl+C to copy a range."
              >
                <table onCopy={handleGridCopy}>
                  <colgroup>
                    <col style={{ width: 42 }} />
                    {result?.columns.map((column) => (
                      <col
                        key={column.name}
                        style={{ width: getColumnWidth(column) }}
                      />
                    ))}
                  </colgroup>
                  <thead>
                    <tr>
                      <th className="row-number" aria-label="Select row">
                        #
                      </th>
                      {result?.columns.map((column) => (
                        <th key={column.name}>
                          <button
                            type="button"
                            className="column-sort"
                            onClick={() => sort(column.name)}
                          >
                            {column.name} <small>{column.type}</small>
                            <span>
                              {sortBy === column.name
                                ? sortDirection === "asc"
                                  ? "↑"
                                  : "↓"
                                : "↕"}
                            </span>
                          </button>
                          <button
                            type="button"
                            className="column-resize-handle"
                            aria-label={`Resize ${column.name} column`}
                            title="Resize column · Arrow keys adjust · Home/End set limits"
                            onClick={(event) => event.stopPropagation()}
                            onPointerDown={(event) =>
                              startColumnResize(event, column)
                            }
                            onKeyDown={(event) =>
                              handleColumnResizeKeyDown(event, column)
                            }
                          />
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {virtualRowWindow.enabled && (
                      <tr className="virtual-spacer">
                        <td
                          colSpan={(result?.columns.length ?? 0) + 1}
                          style={{ height: virtualRowWindow.topSpacerHeight }}
                        />
                      </tr>
                    )}
                    {renderedRows.map((row, renderedRowIndex) => {
                      const rowIndex = gridRowOffset + renderedRowIndex;
                      const rowKey = resultRowKey(row);
                      return (
                        <tr key={rowKey}>
                          <td
                            className={`row-number selectable ${gridSelection?.kind === "rows" && isCellInSelection(gridSelection, rowIndex, 0) ? "selected" : ""}`}
                            title="Select row; Shift-click to extend"
                          >
                            <button
                              type="button"
                              className="grid-cell-button row-select-button"
                              onClick={(event) =>
                                selectGridRow(rowIndex, event.shiftKey)
                              }
                              onKeyDown={handleGridKeyDown}
                              title="Select row; Shift-click to extend"
                            >
                              {rowIndex + 1}
                            </button>
                          </td>
                          {result?.columns.map((column, columnIndex) => (
                            <td
                              key={column.name}
                              className={`${row[column.name] === null ? "null-value" : ""} ${isCellInSelection(gridSelection, rowIndex, columnIndex) ? "selected" : ""} ${stagedEdits[rowKey] && Object.hasOwn(stagedEdits[rowKey].changes, column.name) ? "staged-cell" : ""}`}
                            >
                              {editingCell?.rowKey === rowKey &&
                              editingCell.columnName === column.name ? (
                                <input
                                  ref={editInputRef}
                                  className="grid-edit-input"
                                  value={editDraft}
                                  onChange={(event) =>
                                    setEditDraft(event.target.value)
                                  }
                                  onBlur={commitCellEdit}
                                  onKeyDown={(event) => {
                                    if (event.key === "Enter") {
                                      event.preventDefault();
                                      commitCellEdit();
                                    } else if (event.key === "Escape") {
                                      event.preventDefault();
                                      cancelCellEdit();
                                    }
                                  }}
                                  aria-label={`Edit ${column.name}`}
                                />
                              ) : (
                                <button
                                  type="button"
                                  className="grid-cell-button"
                                  onClick={(event) =>
                                    selectGridCell(
                                      rowIndex,
                                      columnIndex,
                                      event.shiftKey,
                                    )
                                  }
                                  onDoubleClick={() =>
                                    beginCellEdit(row, column)
                                  }
                                  onKeyDown={handleGridKeyDown}
                                  title={
                                    editingEnabled
                                      ? "Double-click to stage an edit"
                                      : "Select cell; Shift-click to extend"
                                  }
                                >
                                  {formatCellValue(
                                    row[column.name],
                                    nullDisplay === "literal",
                                  )}
                                </button>
                              )}
                            </td>
                          ))}
                        </tr>
                      );
                    })}
                    {virtualRowWindow.enabled && (
                      <tr className="virtual-spacer">
                        <td
                          colSpan={(result?.columns.length ?? 0) + 1}
                          style={{
                            height: virtualRowWindow.bottomSpacerHeight,
                          }}
                        />
                      </tr>
                    )}
                  </tbody>
                </table>
                {result && result.columns.length === 0 && (
                  <div className="empty-result">
                    Statement completed · {result.affectedRows.toLocaleString()}{" "}
                    rows affected
                  </div>
                )}
              </div>
            ) : (
              <pre className="json-view">
                {JSON.stringify(visibleRows, null, 2)}
              </pre>
            )}
            <div className="pagination">
              {filteredRows.length === 0 ? (
                "No rows"
              ) : (
                <>
                  Showing{" "}
                  <strong>
                    {virtualRowWindow.enabled
                      ? `1–${filteredRows.length}`
                      : `${resultPage * resultPageSize + 1}–${resultPage * resultPageSize + visibleRows.length}`}
                  </strong>{" "}
                  of <strong>{filteredRows.length}</strong> rows
                </>
              )}
              {filter && <span> matching “{filter}”</span>}
              {virtualRowWindow.enabled && (
                <span className="virtualized-hint">virtualized</span>
              )}
              <span className="footer-spacer" />
              {!virtualRowWindow.enabled && resultPageCount > 1 && (
                <div aria-label="Result pages">
                  <button
                    type="button"
                    aria-label="Previous result page"
                    onClick={() => {
                      setResultPage((page) => Math.max(0, page - 1));
                      setGridSelection(null);
                    }}
                    disabled={resultPage === 0}
                  >
                    ‹
                  </button>
                  {pageWindow(resultPage, resultPageCount).map((page) => (
                    <button
                      type="button"
                      key={page}
                      className={page === resultPage ? "active" : ""}
                      aria-label={`Result page ${page + 1}`}
                      aria-current={page === resultPage ? "page" : undefined}
                      onClick={() => {
                        setResultPage(page);
                        setGridSelection(null);
                      }}
                    >
                      {page + 1}
                    </button>
                  ))}
                  <button
                    type="button"
                    aria-label="Next result page"
                    onClick={() => {
                      setResultPage((page) =>
                        Math.min(resultPageCount - 1, page + 1),
                      );
                      setGridSelection(null);
                    }}
                    disabled={resultPage === resultPageCount - 1}
                  >
                    ›
                  </button>
                </div>
              )}
              {tableBrowse && (
                <div className="table-browse-actions">
                  <span>
                    Table browser · {result?.rows.length.toLocaleString() ?? 0}{" "}
                    loaded{tableBrowseDirty ? " · unapplied filter/order" : ""}
                  </span>
                  <button
                    type="button"
                    onClick={() => void loadNextTablePage()}
                    disabled={
                      isRunning || !tableBrowse.hasMore || tableBrowseDirty
                    }
                    title={
                      tableBrowseDirty
                        ? "Apply the current filter and sort before loading another page"
                        : "Fetch the next 100 rows from the selected table"
                    }
                  >
                    {isRunning
                      ? "Loading…"
                      : tableBrowseDirty
                        ? "Apply filter/order"
                        : tableBrowse.hasMore
                          ? "Load next 100"
                          : "All loaded"}
                  </button>
                </div>
              )}
              {serverQueryPage && !tableBrowse && (
                <div className="table-browse-actions">
                  <span>
                    Server paging · {result?.rows.length.toLocaleString() ?? 0}{" "}
                    loaded
                  </span>
                  <button
                    type="button"
                    onClick={() => void loadNextServerPage()}
                    disabled={isRunning || !serverQueryPage.hasMore}
                    title="Fetch the next 100 rows from the current SELECT result"
                  >
                    {isRunning
                      ? "Loading…"
                      : serverQueryPage.hasMore
                        ? "Load next 100"
                        : "All loaded"}
                  </button>
                </div>
              )}
              Result data stays on this device
            </div>
          </section>
          <div className="statusbar">
            <span>
              <span
                className={`status-dot ${connectionStatus === "connected" ? "green" : "orange"}`}
              />{" "}
              {connectionName}
              {readOnlyConnection && (
                <span className="read-only-badge">READ ONLY</span>
              )}
            </span>
            <span>{driverDisplayName(driverKind)} · Rust native</span>
            <span
              className={
                transactionActive
                  ? "transaction-status active"
                  : "transaction-status"
              }
            >
              {transactionActive ? "Transaction active" : "Auto-commit"}
            </span>
            <span className="footer-spacer" />
            <span>
              Safe mode <i className="toggle" />
            </span>
            <span>⌘ Enter to run</span>
          </div>
        </main>
        <Inspector
          key={
            selectedObject
              ? selectedObject.kind === "routine"
                ? `routine:${selectedObject.id}`
                : selectedObject.kind === "trigger"
                  ? `trigger:${selectedObject.id}`
                  : selectedObject.kind === "eventTrigger"
                    ? `event-trigger:${selectedObject.id}`
                    : `${selectedObject.kind}:${selectedObject.schema}.${selectedObject.name}`
              : "no-object"
          }
          table={currentTable}
          view={currentView}
          routine={currentRoutine}
          trigger={currentTrigger}
          eventTrigger={currentEventTrigger}
          foreignKeys={currentForeignKeys}
          dependencies={currentDependencies}
          onClose={() => setSelectedObject(null)}
          onSelectTable={selectRelatedTable}
          onSelectTriggerRelation={selectTriggerRelation}
          onSelectDependency={selectDependencyObject}
          onBrowseTable={browseCurrentTable}
          onCopyDefinition={(definition) => {
            void navigator.clipboard
              .writeText(definition)
              .then(() => notify("DDL copied"))
              .catch(() => notify("Could not copy DDL"));
          }}
          onEditDefinition={(definition, label) => {
            newQuery();
            setSql(definition);
            notify(`Opened ${label} DDL in a new SQL tab`);
          }}
        />
      </div>
      {toast && <div className="toast">{toast}</div>}
      {pendingSafety && (
        <SafeModeDialog
          report={pendingSafety.report}
          onCancel={() => setPendingSafety(null)}
          onRunInTransaction={() => handleRun("transaction", pendingSafety.sql)}
          onExecuteAnyway={() => handleRun("execute-anyway", pendingSafety.sql)}
        />
      )}
      {schemaDiffOpen && schemaDiff && (
        <SchemaDiffDialog
          diff={schemaDiff}
          driverKind={driverKind}
          baselineLabel={schemaBaselineLabel}
          onClose={() => setSchemaDiffOpen(false)}
          onCompareConnection={() => {
            setSchemaDiffOpen(false);
            setSchemaTargetOpen(true);
          }}
          onOpenSql={() => {
            recordMigrationPreview();
            const migrationSql = buildSchemaMigrationSql(schemaDiff);
            newQuery();
            setSql(migrationSql);
            setSchemaDiffOpen(false);
            notify("Opened schema migration preview in a new SQL tab");
          }}
          onOpenRollback={() => {
            recordMigrationPreview();
            const rollbackSql = buildSchemaRollbackSql(schemaDiff);
            newQuery();
            setSql(rollbackSql);
            setSchemaDiffOpen(false);
            notify("Opened schema rollback preview in a new SQL tab");
          }}
          onOpenPrivilegePreflight={() => {
            const preflightSql = buildSchemaPrivilegePreflightSql(
              schemaDiff,
              driverKind,
            );
            newQuery();
            setSql(preflightSql);
            setSchemaDiffOpen(false);
            notify("Opened privilege preflight in a new SQL tab");
          }}
          onApplyMigration={applySchemaMigration}
          onOpenHistory={() => {
            setSchemaDiffOpen(false);
            openMigrationHistory();
          }}
        />
      )}
      {schemaTargetOpen && (
        <SchemaTargetDialog
          profiles={connectionProfiles}
          driverKind={driverKind}
          onClose={() => setSchemaTargetOpen(false)}
          onCompare={compareSavedConnection}
        />
      )}
      {dataCompareTargetOpen && (
        <DataCompareTargetDialog
          profiles={connectionProfiles}
          driverKind={driverKind}
          onClose={() => setDataCompareTargetOpen(false)}
          onCompare={compareSavedDataConnection}
          onLoadPassword={loadConnectionPassword}
        />
      )}
      {dataCompareOpen && dataCompare && dataCompareTarget && (
        <DataCompareDialog
          comparison={dataCompare}
          targetLabel={dataCompareTarget.label}
          targetReadOnly={dataCompareTarget.config.readOnly === true}
          onClose={() => setDataCompareOpen(false)}
          onChooseTarget={() => {
            setDataCompareOpen(false);
            setDataCompareTargetOpen(true);
          }}
          onOpenSql={(selectedIds) => {
            const syncSql = buildDataSyncSql(dataCompare, selectedIds);
            if (!syncSql) {
              notify("Select at least one data change");
              return;
            }
            newQuery();
            setSql(syncSql);
            setDataCompareOpen(false);
            notify("Opened data synchronization preview in a new SQL tab");
          }}
          onApply={(selectedIds) => void applyDataSynchronization(selectedIds)}
        />
      )}
      {migrationHistoryOpen && (
        <MigrationHistoryDialog
          entries={migrationHistory}
          onClose={() => setMigrationHistoryOpen(false)}
          onClear={() => {
            if (!window.confirm("Clear all saved migration previews?")) return;
            clearMigrationHistory();
            notify("Cleared migration preview history");
          }}
          onOpen={(entry, kind) => {
            newQuery();
            setSql(
              kind === "migration"
                ? entry.migrationSql
                : kind === "rollback"
                  ? entry.rollbackSql
                  : entry.privilegePreflightSql,
            );
            setMigrationHistoryOpen(false);
            notify(`Opened ${kind} preview in a new SQL tab`);
          }}
        />
      )}
      {importOpen && currentTable && (
        <CsvImportDialog
          table={currentTable}
          driverKind={driverKind}
          onClose={() => setImportOpen(false)}
          onImport={importCsv}
        />
      )}
      {erdOpen && metadata && (
        <ErdDialog
          metadata={metadata}
          onClose={() => setErdOpen(false)}
          onSelectRelation={(node) => {
            setSelectedObject({
              kind: node.kind,
              schema: node.schema,
              name: node.name,
            });
            setErdOpen(false);
          }}
        />
      )}
      {sessionsOpen && (
        <SessionExplorerDialog
          driverKind={driverKind}
          sessions={sessions}
          loading={sessionsLoading}
          error={sessionsError}
          onRefresh={() => void loadSessionsPanel()}
          onCancel={(session) => void cancelDatabaseSession(session)}
          onClose={() => setSessionsOpen(false)}
        />
      )}
      {locksOpen && (
        <LockGraphDialog
          driverKind={driverKind}
          locks={locks}
          loading={locksLoading}
          error={locksError}
          onRefresh={() => void loadLocksPanel()}
          onCancel={(lock) => void cancelBlockingSession(lock)}
          onClose={() => setLocksOpen(false)}
        />
      )}
      {diagnosticsOpen && (
        <LongRunningQueryDialog
          driverKind={driverKind}
          sessions={longRunningSessions}
          totalVisibleSessions={sessions.length}
          thresholdMs={longQueryThresholdMs}
          loading={sessionsLoading}
          error={sessionsError}
          onRefresh={() => void loadSessionsPanel()}
          onThresholdChange={updateLongQueryThreshold}
          onCancel={(session) => void cancelDatabaseSession(session)}
          onClose={() => setDiagnosticsOpen(false)}
        />
      )}
      {sessionHistoryOpen && (
        <SessionAuditDialog
          entries={sessionAudit}
          retentionDays={sessionAuditRetentionDays}
          onRetentionChange={setSessionAuditRetentionDays}
          onClear={() => {
            if (
              !window.confirm("Clear all saved session audit observations?")
            ) {
              return;
            }
            clearSessionAudit();
            notify("Cleared session audit history");
          }}
          onClose={() => setSessionHistoryOpen(false)}
        />
      )}
      {createTableOpen && metadata && (
        <CreateTableDialog
          driverKind={driverKind}
          schemas={metadata.schemas}
          onClose={() => setCreateTableOpen(false)}
          onCreate={createTable}
          onOpenSql={(plan) => {
            newQuery();
            setSql(plan.sql);
            setCreateTableOpen(false);
            notify("Opened CREATE TABLE preview in a new SQL tab");
          }}
        />
      )}
      {addColumnOpen && currentTable && (
        <AddColumnDialog
          driverKind={driverKind}
          table={currentTable}
          onClose={() => setAddColumnOpen(false)}
          onAdd={addColumn}
          onOpenSql={(plan) => {
            newQuery();
            setSql(plan.sql);
            setAddColumnOpen(false);
            notify("Opened ALTER TABLE preview in a new SQL tab");
          }}
        />
      )}
      {editColumnsOpen && currentTable && (
        <EditTableColumnsDialog
          driverKind={driverKind}
          table={currentTable}
          onClose={() => setEditColumnsOpen(false)}
          onApply={editTableColumns}
          onOpenSql={(plan) => {
            newQuery();
            setSql(plan.sql);
            setEditColumnsOpen(false);
            notify("Opened table column migration preview in a new SQL tab");
          }}
        />
      )}
      {createIndexOpen && currentTable && (
        <CreateIndexDialog
          driverKind={driverKind}
          table={currentTable}
          onClose={() => setCreateIndexOpen(false)}
          onCreate={createIndex}
          onOpenSql={(plan) => {
            newQuery();
            setSql(plan.sql);
            setCreateIndexOpen(false);
            notify("Opened CREATE INDEX preview in a new SQL tab");
          }}
        />
      )}
      {dropIndexOpen && currentTable && (
        <DropIndexDialog
          driverKind={driverKind}
          table={currentTable}
          onClose={() => setDropIndexOpen(false)}
          onDrop={dropIndex}
          onOpenSql={(plan) => {
            newQuery();
            setSql(plan.sql);
            setDropIndexOpen(false);
            notify("Opened DROP INDEX preview in a new SQL tab");
          }}
        />
      )}
      {addForeignKeyOpen && currentTable && (
        <AddForeignKeyDialog
          driverKind={driverKind}
          table={currentTable}
          tables={tables}
          onClose={() => setAddForeignKeyOpen(false)}
          onAdd={addForeignKey}
          onOpenSql={(plan) => {
            newQuery();
            setSql(plan.sql);
            setAddForeignKeyOpen(false);
            notify("Opened ADD FOREIGN KEY preview in a new SQL tab");
          }}
        />
      )}
      {dropForeignKeyOpen && currentTable && (
        <DropForeignKeyDialog
          driverKind={driverKind}
          table={currentTable}
          onClose={() => setDropForeignKeyOpen(false)}
          onDrop={dropForeignKey}
          onOpenSql={(plan) => {
            newQuery();
            setSql(plan.sql);
            setDropForeignKeyOpen(false);
            notify("Opened DROP FOREIGN KEY preview in a new SQL tab");
          }}
        />
      )}
      {createViewOpen && metadata && (
        <CreateViewDialog
          driverKind={driverKind}
          schemas={metadata.schemas}
          existingViews={metadata.views}
          onClose={() => setCreateViewOpen(false)}
          onCreate={createView}
          onOpenSql={(plan) => {
            newQuery();
            setSql(plan.sql);
            setCreateViewOpen(false);
            notify("Opened CREATE VIEW preview in a new SQL tab");
          }}
        />
      )}
      {alterViewOpen && currentView && metadata && (
        <AlterViewDialog
          driverKind={driverKind}
          view={currentView}
          existingViews={metadata.views}
          onClose={() => setAlterViewOpen(false)}
          onApply={alterView}
          onOpenSql={(plan) => {
            newQuery();
            setSql(plan.sql);
            setAlterViewOpen(false);
            notify("Opened ALTER VIEW preview in a new SQL tab");
          }}
        />
      )}
      {dropViewOpen && currentView && metadata && (
        <DropViewDialog
          driverKind={driverKind}
          view={currentView}
          existingViews={metadata.views}
          dependentObjects={
            currentDependencies?.usedBy.map((dependency) =>
              databaseObjectQualifiedName(dependency.dependent),
            ) ?? []
          }
          onClose={() => setDropViewOpen(false)}
          onDrop={dropView}
          onOpenSql={(plan) => {
            newQuery();
            setSql(plan.sql);
            setDropViewOpen(false);
            notify("Opened DROP VIEW preview in a new SQL tab");
          }}
        />
      )}
      {editPreviewOpen && (
        <EditPreviewDialog
          sql={editPreview.sql}
          error={editPreview.error}
          editCount={pendingEditCount}
          onCancel={() => setEditPreviewOpen(false)}
          onDiscard={() => {
            setEditPreviewOpen(false);
            setStagedEdits({});
            setEditingCell(null);
          }}
          onApply={() => void applyStagedEdits()}
        />
      )}
      {deletePreviewOpen && (
        <DeletePreviewDialog
          sql={deletePreview.sql}
          error={deletePreview.error}
          rowCount={selectedDeleteRows.length}
          onCancel={() => setDeletePreviewOpen(false)}
          onApply={() => void applySelectedDeletes()}
        />
      )}
      {insertRowOpen && currentTable && (
        <InsertRowDialog
          driverKind={driverKind}
          table={currentTable}
          onClose={() => setInsertRowOpen(false)}
          onApply={applyInsertedRow}
        />
      )}
      {connectionOpen && (
        <ConnectionDialog
          error={connectionError}
          isConnecting={connectionStatus === "connecting"}
          profiles={connectionProfiles}
          profilesLoaded={connectionProfilesLoaded}
          canUseKeychain={isTauri()}
          onClose={() => setConnectionOpen(false)}
          onConnect={connectDatabase}
          onDeleteProfile={async (id) => {
            await deleteConnectionPassword(id);
            await deleteConnectionProfile(id);
          }}
          onDuplicateProfile={duplicateConnectionProfile}
          onSaveProfile={saveConnectionProfile}
          onLoadPassword={loadConnectionPassword}
          onSavePassword={saveConnectionPassword}
          onDeletePassword={deleteConnectionPassword}
          onTestConnection={testDatabaseConnection}
        />
      )}
      {commandPaletteOpen && (
        <CommandPalette
          query={commandQuery}
          commands={filteredCommands}
          selectedIndex={commandIndex}
          onQueryChange={(value) => {
            setCommandQuery(value);
            setCommandIndex(0);
          }}
          onSelectedIndexChange={setCommandIndex}
          onExecute={executePaletteCommand}
          onClose={() => setCommandPaletteOpen(false)}
        />
      )}
      {quickOpenOpen && (
        <QuickOpenDialog
          query={quickOpenQuery}
          items={filteredQuickOpenItems}
          selectedIndex={quickOpenIndex}
          onQueryChange={(value) => {
            setQuickOpenQuery(value);
            setQuickOpenIndex(0);
          }}
          onSelectedIndexChange={setQuickOpenIndex}
          onExecute={executeQuickOpenItem}
          onClose={() => setQuickOpenOpen(false)}
        />
      )}
    </div>
  );
}

function SessionAuditDialog({
  entries,
  retentionDays,
  onRetentionChange,
  onClear,
  onClose,
}: {
  entries: SessionAuditEntry[];
  retentionDays: number;
  onRetentionChange: (days: number) => void;
  onClear: () => void;
  onClose: () => void;
}) {
  return (
    <div className="modal-backdrop" role="presentation">
      <dialog
        open
        className="audit-modal"
        aria-modal="true"
        aria-labelledby="session-audit-title"
      >
        <div className="session-modal-heading">
          <div>
            <p className="modal-kicker">LOCAL AUDIT</p>
            <h2 id="session-audit-title">Session audit history</h2>
            <p className="session-modal-subtitle">
              {entries.length} redacted observation
              {entries.length === 1 ? "" : "s"}
            </p>
          </div>
          <div className="session-modal-actions">
            <label className="diagnostic-threshold">
              <span>Keep for</span>
              <select
                value={retentionDays}
                onChange={(event) =>
                  onRetentionChange(Number(event.target.value))
                }
              >
                {sessionAuditRetentionOptions.map((days) => (
                  <option value={days} key={days}>
                    {days === 0 ? "Off" : `${days} day${days === 1 ? "" : "s"}`}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className="mini-button"
              onClick={onClear}
              disabled={entries.length === 0}
            >
              Clear
            </button>
            <button
              type="button"
              className="mini-button"
              aria-label="Close session audit history"
              onClick={onClose}
            >
              ×
            </button>
          </div>
        </div>
        {entries.length === 0 ? (
          <div className="session-empty">
            No session observations are stored locally.
          </div>
        ) : (
          <table
            className="session-table audit-table"
            aria-label="Session audit history"
          >
            <thead>
              <tr className="session-table-row session-table-header">
                <th scope="col">Observed</th>
                <th scope="col">Connection</th>
                <th scope="col">Session</th>
                <th scope="col">State / wait</th>
                <th scope="col">Query shape</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr className="session-table-row" key={entry.id}>
                  <td className="session-duration">
                    {formatSessionStartedAt(entry.observedAt)}
                    <small>{entry.observedAt}</small>
                  </td>
                  <td className="session-identity">
                    <strong>{entry.connectionName}</strong>
                    <small>{driverDisplayName(entry.driver)}</small>
                  </td>
                  <td className="session-identity">
                    <strong>{entry.sessionId}</strong>
                    <small>{entry.database ?? "—"}</small>
                  </td>
                  <td>
                    <strong className={`session-state ${entry.state}`}>
                      {entry.state === "idleInTransaction"
                        ? "idle in tx"
                        : entry.state}
                    </strong>
                    <small className="session-wait">
                      {entry.waitEvent ?? "—"}
                    </small>
                    <small className="session-duration">
                      {formatSessionDuration(entry.durationMs)}
                    </small>
                  </td>
                  <td className="session-query audit-query">
                    <code>{entry.queryPreview ?? "(query unavailable)"}</code>
                    <small>fingerprint {entry.queryFingerprint ?? "—"}</small>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="session-safety-note">
          Only redacted query shapes and metadata are stored. Literal values,
          comments, credentials, and raw SQL are never written to this audit
          trail.
        </p>
      </dialog>
    </div>
  );
}

function LongRunningQueryDialog({
  driverKind,
  sessions,
  totalVisibleSessions,
  thresholdMs,
  loading,
  error,
  onRefresh,
  onThresholdChange,
  onCancel,
  onClose,
}: {
  driverKind: DriverKind;
  sessions: DatabaseSession[];
  totalVisibleSessions: number;
  thresholdMs: number;
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
  onThresholdChange: (thresholdMs: number) => void;
  onCancel: (session: DatabaseSession) => void;
  onClose: () => void;
}) {
  return (
    <div className="modal-backdrop" role="presentation">
      <dialog
        open
        className="diagnostic-modal"
        aria-modal="true"
        aria-labelledby="long-running-query-title"
      >
        <div className="session-modal-heading">
          <div>
            <p className="modal-kicker">QUERY DIAGNOSTICS</p>
            <h2 id="long-running-query-title">
              {driverDisplayName(driverKind)} long-running queries
            </h2>
            <p className="session-modal-subtitle">
              {sessions.length} over threshold · {totalVisibleSessions} visible
              sessions
            </p>
          </div>
          <div className="session-modal-actions">
            <label className="diagnostic-threshold">
              <span>Alert after</span>
              <select
                value={thresholdMs}
                onChange={(event) =>
                  onThresholdChange(Number(event.target.value))
                }
              >
                {longQueryThresholdOptions.map((option) => (
                  <option value={option} key={option}>
                    {formatSessionDuration(option)}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className="mini-button"
              aria-label="Refresh long-running queries"
              onClick={onRefresh}
              disabled={loading}
            >
              ↻
            </button>
            <button
              type="button"
              className="mini-button"
              aria-label="Close query diagnostics"
              onClick={onClose}
            >
              ×
            </button>
          </div>
        </div>
        {error && <p className="connection-error">{error}</p>}
        {loading ? (
          <div className="session-empty">Loading query diagnostics…</div>
        ) : sessions.length === 0 ? (
          <div className="session-empty">
            No active or waiting query is above the configured threshold.
          </div>
        ) : (
          <table className="session-table" aria-label="Long-running queries">
            <thead>
              <tr className="session-table-row session-table-header">
                <th scope="col">Severity</th>
                <th scope="col">Session</th>
                <th scope="col">Query / wait event</th>
                <th scope="col">Age</th>
                <th scope="col" aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {sessions.map((session) => {
                const critical = (session.durationMs ?? 0) >= thresholdMs * 6;
                return (
                  <tr className="session-table-row" key={session.id}>
                    <td>
                      <strong
                        className={`diagnostic-severity ${
                          critical ? "critical" : "elevated"
                        }`}
                      >
                        {critical ? "critical" : "elevated"}
                      </strong>
                    </td>
                    <td className="session-identity">
                      <strong>{session.user ?? "unknown user"}</strong>
                      <small>
                        {session.id} · {session.database ?? "—"}
                      </small>
                    </td>
                    <td className="session-query">
                      <code>
                        {session.query?.trim() || "(query unavailable)"}
                      </code>
                      {session.waitEvent && (
                        <small className="session-wait">
                          {session.waitEvent}
                        </small>
                      )}
                    </td>
                    <td className="session-duration">
                      {formatSessionDuration(session.durationMs)}
                    </td>
                    <td>
                      <button
                        type="button"
                        className="mini-button session-cancel"
                        disabled={!session.canCancel}
                        onClick={() => onCancel(session)}
                        title={
                          session.canCancel
                            ? "Request cancellation of this running query"
                            : "The current QueryX session cannot cancel itself"
                        }
                      >
                        Cancel query
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        <p className="session-safety-note">
          This is a point-in-time diagnostic. Threshold changes are stored
          locally; QueryX never sends telemetry or terminates a database
          connection here.
        </p>
      </dialog>
    </div>
  );
}

function LockGraphDialog({
  driverKind,
  locks,
  loading,
  error,
  onRefresh,
  onCancel,
  onClose,
}: {
  driverKind: DriverKind;
  locks: DatabaseLock[];
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
  onCancel: (lock: DatabaseLock) => void;
  onClose: () => void;
}) {
  return (
    <div className="modal-backdrop" role="presentation">
      <dialog
        open
        className="lock-modal"
        aria-modal="true"
        aria-labelledby="lock-graph-title"
      >
        <div className="session-modal-heading">
          <div>
            <p className="modal-kicker">LOCK GRAPH</p>
            <h2 id="lock-graph-title">
              {driverDisplayName(driverKind)} lock waits
            </h2>
            <p className="session-modal-subtitle">
              {locks.length} blocking relationship
              {locks.length === 1 ? "" : "s"} visible
            </p>
          </div>
          <div className="session-modal-actions">
            <button
              type="button"
              className="mini-button"
              aria-label="Refresh lock graph"
              onClick={onRefresh}
              disabled={loading}
            >
              ↻
            </button>
            <button
              type="button"
              className="mini-button"
              aria-label="Close lock graph"
              onClick={onClose}
            >
              ×
            </button>
          </div>
        </div>
        {error && <p className="connection-error">{error}</p>}
        {loading ? (
          <div className="session-empty">Loading lock waits…</div>
        ) : locks.length === 0 ? (
          <div className="session-empty">
            No lock waits are visible for the connected database.
          </div>
        ) : (
          <ul className="lock-graph-list" aria-label="Database lock waits">
            {locks.map((lock) => (
              <li className="lock-card" key={lock.id}>
                <div className="lock-card-route">
                  <span className="lock-node blocked">
                    <small>BLOCKED</small>
                    <strong>{lock.blockedSessionId}</strong>
                  </span>
                  <span className="lock-arrow" aria-hidden="true">
                    →
                  </span>
                  <span className="lock-node blocking">
                    <small>BLOCKING</small>
                    <strong>{lock.blockingSessionId}</strong>
                  </span>
                </div>
                <div className="lock-card-details">
                  <strong>{lock.resource}</strong>
                  <span>
                    {lock.lockType}
                    {lock.blockedMode ? ` · wants ${lock.blockedMode}` : ""}
                    {lock.blockingMode ? ` · holds ${lock.blockingMode}` : ""}
                  </span>
                  <small>
                    blocked query age{" "}
                    {formatSessionDuration(lock.blockedDurationMs)}
                  </small>
                </div>
                <div className="lock-card-queries">
                  <code>
                    {lock.blockedQuery?.trim() || "(blocked query unavailable)"}
                  </code>
                  <code>
                    {lock.blockingQuery?.trim() ||
                      "(blocking query unavailable)"}
                  </code>
                </div>
                <button
                  type="button"
                  className="mini-button session-cancel"
                  disabled={!lock.blockingCanCancel}
                  onClick={() => onCancel(lock)}
                  title={
                    lock.blockingCanCancel
                      ? "Request cancellation of the blocking query"
                      : "The current QueryX session cannot cancel itself"
                  }
                >
                  Cancel blocker
                </button>
              </li>
            ))}
          </ul>
        )}
        <p className="session-safety-note">
          The graph is a point-in-time view. QueryX requests query cancellation
          only; it never terminates a database connection from this panel.
        </p>
      </dialog>
    </div>
  );
}

function SessionExplorerDialog({
  driverKind,
  sessions,
  loading,
  error,
  onRefresh,
  onCancel,
  onClose,
}: {
  driverKind: DriverKind;
  sessions: DatabaseSession[];
  loading: boolean;
  error: string | null;
  onRefresh: () => void;
  onCancel: (session: DatabaseSession) => void;
  onClose: () => void;
}) {
  const activeCount = sessions.filter(
    (session) => session.state === "active" || session.state === "waiting",
  ).length;
  return (
    <div className="modal-backdrop" role="presentation">
      <dialog
        open
        className="session-modal"
        aria-modal="true"
        aria-labelledby="session-explorer-title"
      >
        <div className="session-modal-heading">
          <div>
            <p className="modal-kicker">SESSION EXPLORER</p>
            <h2 id="session-explorer-title">
              {driverDisplayName(driverKind)} sessions
            </h2>
            <p className="session-modal-subtitle">
              {sessions.length} visible · {activeCount} active or waiting
            </p>
          </div>
          <div className="session-modal-actions">
            <button
              type="button"
              className="mini-button"
              aria-label="Refresh sessions"
              onClick={onRefresh}
              disabled={loading}
            >
              ↻
            </button>
            <button
              type="button"
              className="mini-button"
              aria-label="Close session explorer"
              onClick={onClose}
            >
              ×
            </button>
          </div>
        </div>
        {error && <p className="connection-error">{error}</p>}
        {loading ? (
          <div className="session-empty">Loading database sessions…</div>
        ) : sessions.length === 0 ? (
          <div className="session-empty">
            No visible sessions were returned by the database.
          </div>
        ) : (
          <table className="session-table" aria-label="Database sessions">
            <thead>
              <tr className="session-table-row session-table-header">
                <th scope="col">State</th>
                <th scope="col">Session</th>
                <th scope="col">Query / wait event</th>
                <th scope="col">Duration</th>
                <th scope="col" aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {sessions.map((session) => (
                <tr className="session-table-row" key={session.id}>
                  <td>
                    <strong className={`session-state ${session.state}`}>
                      {session.state === "idleInTransaction"
                        ? "idle in tx"
                        : session.state}
                    </strong>
                    {session.waitEvent && (
                      <small className="session-wait">
                        {session.waitEvent}
                      </small>
                    )}
                  </td>
                  <td className="session-identity">
                    <strong>{session.user ?? "unknown user"}</strong>
                    <small>
                      {session.database ?? "—"}
                      {session.clientAddress
                        ? ` · ${session.clientAddress}`
                        : ""}
                    </small>
                    <small>{session.applicationName ?? ""}</small>
                  </td>
                  <td className="session-query">
                    <code>{session.query?.trim() || "(idle)"}</code>
                  </td>
                  <td className="session-duration">
                    {formatSessionDuration(session.durationMs)}
                    {session.startedAt && (
                      <small>{formatSessionStartedAt(session.startedAt)}</small>
                    )}
                  </td>
                  <td>
                    <button
                      type="button"
                      className="mini-button session-cancel"
                      disabled={!session.canCancel}
                      onClick={() => onCancel(session)}
                      title={
                        session.canCancel
                          ? "Request cancellation of this session's running query"
                          : "The current QueryX session cannot cancel itself"
                      }
                    >
                      Cancel
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="session-safety-note">
          QueryX requests query cancellation only. It never terminates the
          database connection from this panel, and the current QueryX session is
          protected.
        </p>
      </dialog>
    </div>
  );
}

function formatSessionDuration(durationMs: number | null): string {
  if (durationMs === null) return "—";
  if (durationMs < 1000) return `${durationMs} ms`;
  const seconds = Math.floor(durationMs / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

function formatSessionStartedAt(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleTimeString();
}

function CommandPalette({
  query,
  commands,
  selectedIndex,
  onQueryChange,
  onSelectedIndexChange,
  onExecute,
  onClose,
}: {
  query: string;
  commands: PaletteCommand[];
  selectedIndex: number;
  onQueryChange: (value: string) => void;
  onSelectedIndexChange: (index: number) => void;
  onExecute: () => void;
  onClose: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    inputRef.current?.focus();
  }, []);
  const moveSelection = (direction: 1 | -1) => {
    if (commands.length === 0) return;
    onSelectedIndexChange(
      (selectedIndex + direction + commands.length) % commands.length,
    );
  };

  return (
    <div
      className="modal-backdrop command-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <dialog
        open
        className="command-palette"
        aria-labelledby="command-palette-title"
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            onClose();
          } else if (event.key === "ArrowDown") {
            event.preventDefault();
            moveSelection(1);
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            moveSelection(-1);
          } else if (event.key === "Enter") {
            event.preventDefault();
            onExecute();
          }
        }}
      >
        <div className="command-palette-search">
          <span aria-hidden="true">⌕</span>
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder="Search commands…"
            aria-label="Search commands"
          />
          <kbd>ESC</kbd>
        </div>
        <div className="command-palette-heading" id="command-palette-title">
          COMMAND PALETTE
        </div>
        <div className="command-list" aria-label="Commands">
          {commands.length === 0 ? (
            <div className="command-empty">No matching commands</div>
          ) : (
            commands.map((command, index) => (
              <button
                type="button"
                aria-current={index === selectedIndex ? "true" : undefined}
                className={`command-item ${index === selectedIndex ? "selected" : ""}`}
                key={command.id}
                disabled={command.disabled}
                onMouseEnter={() => onSelectedIndexChange(index)}
                onClick={onExecute}
              >
                <span>{command.label}</span>
                <small>{command.hint}</small>
              </button>
            ))
          )}
        </div>
        <div className="command-palette-footer">
          <span>↑↓ Navigate</span>
          <span>↵ Run</span>
          <span>ESC Close</span>
        </div>
      </dialog>
    </div>
  );
}

function QuickOpenDialog({
  query,
  items,
  selectedIndex,
  onQueryChange,
  onSelectedIndexChange,
  onExecute,
  onClose,
}: {
  query: string;
  items: QuickOpenItem[];
  selectedIndex: number;
  onQueryChange: (value: string) => void;
  onSelectedIndexChange: (index: number) => void;
  onExecute: () => void;
  onClose: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    inputRef.current?.focus();
  }, []);
  const moveSelection = (direction: 1 | -1) => {
    if (items.length === 0) return;
    onSelectedIndexChange(
      (selectedIndex + direction + items.length) % items.length,
    );
  };

  return (
    <div
      className="modal-backdrop quick-open-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <dialog
        open
        className="quick-open"
        aria-labelledby="quick-open-title"
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            onClose();
          } else if (event.key === "ArrowDown") {
            event.preventDefault();
            moveSelection(1);
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            moveSelection(-1);
          } else if (event.key === "Enter") {
            event.preventDefault();
            onExecute();
          }
        }}
      >
        <div className="command-palette-search">
          <span aria-hidden="true">⌕</span>
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder="Search queries, SQL, or favorites…"
            aria-label="Search queries"
          />
          <kbd>ESC</kbd>
        </div>
        <div className="command-palette-heading" id="quick-open-title">
          QUICK OPEN · {items.length} QUERIES
        </div>
        <div className="quick-open-list" aria-label="Saved and recent queries">
          {items.length === 0 ? (
            <div className="command-empty">
              No matching queries. Run or save a query to find it here.
            </div>
          ) : (
            items.map((item, index) => (
              <button
                type="button"
                className={`quick-open-item ${index === selectedIndex ? "selected" : ""}`}
                aria-current={index === selectedIndex ? "true" : undefined}
                key={item.id}
                onMouseEnter={() => onSelectedIndexChange(index)}
                onClick={onExecute}
              >
                <span className="quick-open-icon" aria-hidden="true">
                  {item.kind === "favorite" ? "♥" : "◷"}
                </span>
                <span className="quick-open-copy">
                  <strong>{item.label}</strong>
                  <small>{item.detail}</small>
                </span>
                <code>{item.sql.split("\n")[0].slice(0, 42)}</code>
              </button>
            ))
          )}
        </div>
        <div className="command-palette-footer">
          <span>↑↓ Navigate</span>
          <span>↵ Open</span>
          <span>ESC Close</span>
        </div>
      </dialog>
    </div>
  );
}

function TreeRow({
  label,
  icon,
  tone,
  count,
  onClick,
  collapsed,
}: {
  label: string;
  icon: string;
  tone: string;
  count?: number;
  onClick?: () => void;
  collapsed?: boolean;
}) {
  return (
    <button type="button" className="tree-row" onClick={onClick}>
      <span className="tree-caret">
        {onClick ? (collapsed ? "›" : "⌄") : ""}
      </span>
      <span className={`tree-icon ${tone}`}>{icon}</span>
      {label}
      {count !== undefined && <span className="count">{count}</span>}
    </button>
  );
}

function Recent({
  name,
  time,
  status = "success",
  onClick,
}: {
  name: string;
  time: string;
  status?: "success" | "error" | "cancelled";
  onClick?: () => void;
}) {
  const icon = status === "error" ? "×" : status === "cancelled" ? "■" : "✓";
  return (
    <button type="button" className="recent-query" onClick={onClick}>
      <span className={`query-status ${status}`}>{icon}</span>
      <span>
        <strong>{name}</strong>
        <small>{time}</small>
      </span>
    </button>
  );
}

function FavoriteQuery({
  name,
  onClick,
}: {
  name: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="recent-query favorite-query"
      onClick={onClick}
    >
      <span className="favorite-star" aria-hidden="true">
        ♥
      </span>
      <span>
        <strong>{name}</strong>
        <small>Saved locally</small>
      </span>
    </button>
  );
}

function relativeTime(value: string): string {
  const minutes = Math.max(
    1,
    Math.round((Date.now() - new Date(value).getTime()) / 60_000),
  );
  return minutes < 60
    ? `${minutes} minute${minutes === 1 ? "" : "s"} ago`
    : "Earlier today";
}

function formatCellValue(value: unknown, showNullLiteral = true): string {
  if (value === null || value === undefined)
    return showNullLiteral ? "NULL" : "";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function editableCellValue(value: unknown): string {
  if (value === null || value === undefined) return "NULL";
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

function parseEditedCellValue(
  rawValue: string,
  column: { type: string; nullable: boolean },
): unknown {
  const trimmed = rawValue.trim();
  const normalizedType = column.type.toLowerCase();
  if (trimmed.toUpperCase() === "NULL") return null;
  if (!trimmed && column.nullable) return null;
  if (
    normalizedType.includes("bool") &&
    (trimmed.toLowerCase() === "true" || trimmed.toLowerCase() === "false")
  ) {
    return trimmed.toLowerCase() === "true";
  }
  if (
    normalizedType.includes("int") ||
    normalizedType.includes("numeric") ||
    normalizedType.includes("decimal") ||
    normalizedType.includes("real") ||
    normalizedType.includes("double")
  ) {
    const numericValue = Number(trimmed);
    if (Number.isFinite(numericValue)) return numericValue;
  }
  if (normalizedType.includes("json")) {
    try {
      return JSON.parse(trimmed);
    } catch {
      throw new Error("JSON cells must contain valid JSON");
    }
  }
  return rawValue;
}

function EditPreviewDialog({
  sql,
  error,
  editCount,
  onCancel,
  onDiscard,
  onApply,
}: {
  sql: string;
  error: string | null;
  editCount: number;
  onCancel: () => void;
  onDiscard: () => void;
  onApply: () => void;
}) {
  return (
    <div className="modal-backdrop" role="presentation">
      <dialog
        open
        className="edit-preview-modal"
        aria-modal="true"
        aria-labelledby="edit-preview-title"
      >
        <div className="edit-preview-heading">
          <div>
            <p className="modal-kicker">STAGED DATA EDIT</p>
            <h2 id="edit-preview-title">
              Review {editCount} cell edit{editCount === 1 ? "" : "s"}
            </h2>
          </div>
          <button
            type="button"
            className="mini-button"
            aria-label="Close edit preview"
            onClick={onCancel}
          >
            ×
          </button>
        </div>
        {error ? (
          <div className="edit-preview-error">{error}</div>
        ) : (
          <>
            <p className="modal-copy">
              QueryX will run these generated UPDATE statements inside the
              native transaction boundary, then refresh the result. Nothing runs
              until you choose Apply changes.
            </p>
            <pre className="edit-preview-sql">{sql}</pre>
          </>
        )}
        <div className="modal-actions">
          <button type="button" className="modal-secondary" onClick={onCancel}>
            Keep editing
          </button>
          <button type="button" className="modal-danger" onClick={onDiscard}>
            Discard edits
          </button>
          <button
            type="button"
            className="modal-transaction"
            onClick={onApply}
            disabled={Boolean(error) || !sql}
          >
            Apply changes
          </button>
        </div>
      </dialog>
    </div>
  );
}

function DeletePreviewDialog({
  sql,
  error,
  rowCount,
  onCancel,
  onApply,
}: {
  sql: string;
  error: string | null;
  rowCount: number;
  onCancel: () => void;
  onApply: () => void;
}) {
  return (
    <div className="modal-backdrop" role="presentation">
      <dialog
        open
        className="edit-preview-modal delete-preview-modal"
        aria-modal="true"
        aria-labelledby="delete-preview-title"
      >
        <div className="edit-preview-heading">
          <div>
            <p className="modal-kicker">DESTRUCTIVE DATA EDIT</p>
            <h2 id="delete-preview-title">
              Review {rowCount} row deletion{rowCount === 1 ? "" : "s"}
            </h2>
          </div>
          <button
            type="button"
            className="mini-button"
            aria-label="Close delete preview"
            onClick={onCancel}
          >
            ×
          </button>
        </div>
        {error ? (
          <div className="edit-preview-error">{error}</div>
        ) : (
          <>
            <p className="modal-copy">
              QueryX will run these DELETE statements in one native transaction.
              Each statement includes the primary key and original values, so a
              concurrent change rolls back the entire operation. Nothing runs
              until you choose Delete rows.
            </p>
            <pre className="edit-preview-sql">{sql}</pre>
          </>
        )}
        <div className="modal-actions">
          <button type="button" className="modal-secondary" onClick={onCancel}>
            Keep rows
          </button>
          <button
            type="button"
            className="modal-danger"
            onClick={onApply}
            disabled={Boolean(error) || !sql}
          >
            Delete rows
          </button>
        </div>
      </dialog>
    </div>
  );
}

type InsertDraft = {
  mode: "default" | "value" | "null";
  rawValue: string;
};

function InsertRowDialog({
  driverKind,
  table,
  onClose,
  onApply,
}: {
  driverKind: DriverKind;
  table: TableMetadata;
  onClose: () => void;
  onApply: (plan: TableRowInsertPlan) => void;
}) {
  const [drafts, setDrafts] = useState<Record<string, InsertDraft>>(() =>
    Object.fromEntries(
      table.columns.map((column) => [
        column.name,
        { mode: "default", rawValue: "" },
      ]),
    ),
  );
  const plan = useMemo<TableRowInsertPlan>(() => {
    const values: TableRowInsertValue[] = [];
    const parseErrors: string[] = [];
    for (const column of table.columns) {
      const draft = drafts[column.name] ?? {
        mode: "default" as const,
        rawValue: "",
      };
      if (draft.mode === "default") continue;
      if (draft.mode === "null") {
        values.push({ columnName: column.name, value: null });
        continue;
      }
      try {
        values.push({
          columnName: column.name,
          value: parseEditedCellValue(draft.rawValue, column),
        });
      } catch (error) {
        parseErrors.push(
          `${column.name}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    const built = buildTableRowInsertPlan(table, values, driverKind);
    if (parseErrors.length === 0) return built;
    return {
      ...built,
      statement: "",
      sql: "",
      errors: [...parseErrors, ...built.errors],
    };
  }, [driverKind, drafts, table]);

  const updateDraft = (columnName: string, patch: Partial<InsertDraft>) => {
    setDrafts((current) => ({
      ...current,
      [columnName]: {
        ...(current[columnName] ?? { mode: "default", rawValue: "" }),
        ...patch,
      },
    }));
  };

  return (
    <div className="modal-backdrop" role="presentation">
      <dialog
        open
        className="insert-row-modal"
        aria-modal="true"
        aria-labelledby="insert-row-title"
      >
        <div className="edit-preview-heading">
          <div>
            <p className="modal-kicker">TABLE BROWSER · INSERT</p>
            <h2 id="insert-row-title">
              New row · {table.schema}.{table.name}
            </h2>
          </div>
          <button
            type="button"
            className="mini-button"
            aria-label="Close insert row form"
            onClick={onClose}
          >
            ×
          </button>
        </div>
        <p className="modal-copy">
          Leave columns on <strong>Default</strong> to let the database apply
          generated values, identity keys, timestamps, and defaults. Choose
          <strong> NULL</strong> only for nullable columns.
        </p>
        <div className="insert-row-list" aria-label="New row values">
          {table.columns.map((column) => {
            const draft = drafts[column.name] ?? {
              mode: "default" as const,
              rawValue: "",
            };
            return (
              <div className="insert-row-field" key={column.name}>
                <div className="insert-row-label">
                  <strong>{column.name}</strong>
                  <small>
                    {column.type} · {column.nullable ? "nullable" : "required"}
                    {column.primaryKey ? " · PK" : ""}
                  </small>
                </div>
                <select
                  value={draft.mode}
                  onChange={(event) =>
                    updateDraft(column.name, {
                      mode: event.target.value as InsertDraft["mode"],
                    })
                  }
                  aria-label={`${column.name} insert mode`}
                >
                  <option value="default">Default</option>
                  <option value="value">Value</option>
                  <option value="null" disabled={!column.nullable}>
                    NULL
                  </option>
                </select>
                <input
                  value={draft.rawValue}
                  disabled={draft.mode !== "value"}
                  onChange={(event) =>
                    updateDraft(column.name, { rawValue: event.target.value })
                  }
                  placeholder={
                    draft.mode === "value"
                      ? `Enter ${column.type}`
                      : "Database default"
                  }
                  aria-label={`${column.name} insert value`}
                />
              </div>
            );
          })}
        </div>
        {plan.errors.length > 0 && (
          <output className="insert-row-errors" aria-live="polite">
            {plan.errors.map((error) => (
              <span key={error}>✕ {error}</span>
            ))}
          </output>
        )}
        {plan.warnings.length > 0 && (
          <output className="insert-row-warnings">
            {plan.warnings.map((warning) => (
              <span key={warning}>⚠ {warning}</span>
            ))}
          </output>
        )}
        {plan.statement && <pre className="edit-preview-sql">{plan.sql}</pre>}
        <div className="modal-actions">
          <button type="button" className="modal-secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="modal-transaction"
            onClick={() => onApply(plan)}
            disabled={plan.errors.length > 0 || !plan.statement}
          >
            Insert row
          </button>
        </div>
      </dialog>
    </div>
  );
}

function CreateViewDialog({
  driverKind,
  schemas,
  existingViews,
  onClose,
  onCreate,
  onOpenSql,
}: {
  driverKind: DriverKind;
  schemas: string[];
  existingViews: ViewMetadata[];
  onClose: () => void;
  onCreate: (plan: CreateViewPlan) => Promise<void>;
  onOpenSql: (plan: CreateViewPlan) => void;
}) {
  const [schema, setSchema] = useState(schemas[0] ?? "public");
  const [name, setName] = useState("");
  const [definition, setDefinition] = useState(
    "SELECT\n  id\nFROM\n  public.users",
  );
  const plan = useMemo(
    () =>
      buildCreateViewPlan(
        { schema, name, definition },
        existingViews,
        driverKind,
      ),
    [definition, driverKind, existingViews, name, schema],
  );
  return (
    <div className="modal-backdrop" role="presentation">
      <dialog
        open
        className="create-view-modal"
        aria-modal="true"
        aria-labelledby="create-view-title"
      >
        <div className="edit-preview-heading">
          <div>
            <p className="modal-kicker">OBJECT FORM · VIEW</p>
            <h2 id="create-view-title">Create view</h2>
          </div>
          <button
            type="button"
            className="mini-button"
            aria-label="Close create view form"
            onClick={onClose}
          >
            ×
          </button>
        </div>
        <p className="modal-copy">
          Create a read-only view from a single SELECT/WITH definition. QueryX
          rejects DML, DDL, comments, and multiple statements before apply.
        </p>
        <div className="create-view-fields">
          <label htmlFor="create-view-schema">
            Schema
            {schemas.length > 0 ? (
              <select
                id="create-view-schema"
                value={schema}
                onChange={(event) => setSchema(event.target.value)}
              >
                {schemas.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            ) : (
              <input
                id="create-view-schema"
                value={schema}
                onChange={(event) => setSchema(event.target.value)}
                placeholder="public"
              />
            )}
          </label>
          <label htmlFor="create-view-name">
            View name
            <input
              id="create-view-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="paid_orders"
            />
          </label>
        </div>
        <label className="create-view-definition" htmlFor="create-view-sql">
          SELECT definition
          <textarea
            id="create-view-sql"
            value={definition}
            onChange={(event) => setDefinition(event.target.value)}
            spellCheck={false}
          />
        </label>
        {plan.errors.length > 0 ? (
          <div className="create-table-errors" role="alert">
            {plan.errors.map((error) => (
              <div key={error}>{error}</div>
            ))}
          </div>
        ) : (
          <pre className="create-table-preview">{plan.sql}</pre>
        )}
        <div className="modal-actions">
          <button type="button" className="modal-secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="modal-secondary"
            onClick={() => onOpenSql(plan)}
            disabled={plan.errors.length > 0}
          >
            Open SQL preview
          </button>
          <button
            type="button"
            className="modal-transaction"
            onClick={() => void onCreate(plan)}
            disabled={plan.errors.length > 0}
          >
            Create view
          </button>
        </div>
      </dialog>
    </div>
  );
}

function AlterViewDialog({
  driverKind,
  view,
  existingViews,
  onClose,
  onApply,
  onOpenSql,
}: {
  driverKind: DriverKind;
  view: ViewMetadata;
  existingViews: ViewMetadata[];
  onClose: () => void;
  onApply: (plan: AlterViewPlan) => Promise<void>;
  onOpenSql: (plan: AlterViewPlan) => void;
}) {
  const [definition, setDefinition] = useState(
    view.definition ?? "SELECT\n  *\nFROM\n  source_table",
  );
  const plan = useMemo(
    () =>
      buildAlterViewPlan(
        { schema: view.schema, name: view.name, definition },
        existingViews,
        driverKind,
      ),
    [definition, driverKind, existingViews, view.name, view.schema],
  );
  return (
    <div className="modal-backdrop" role="presentation">
      <dialog
        open
        className="create-view-modal"
        aria-modal="true"
        aria-labelledby="alter-view-title"
      >
        <div className="edit-preview-heading">
          <div>
            <p className="modal-kicker">OBJECT FORM · VIEW</p>
            <h2 id="alter-view-title">Edit view definition</h2>
          </div>
          <button
            type="button"
            className="mini-button"
            aria-label="Close edit view form"
            onClick={onClose}
          >
            ×
          </button>
        </div>
        <p className="modal-copy">
          Update{" "}
          <strong>
            {view.schema}.{view.name}
          </strong>{" "}
          with one read-only SELECT/WITH definition. QueryX validates the
          definition before generating the dialect-specific replacement.
        </p>
        <label className="create-view-definition" htmlFor="alter-view-sql">
          SELECT definition
          <textarea
            id="alter-view-sql"
            value={definition}
            onChange={(event) => setDefinition(event.target.value)}
            spellCheck={false}
          />
        </label>
        {plan.errors.length > 0 ? (
          <div className="create-table-errors" role="alert">
            {plan.errors.map((error) => (
              <div key={error}>{error}</div>
            ))}
          </div>
        ) : (
          <>
            {plan.warnings.map((warning) => (
              <div className="create-index-warning" key={warning}>
                ⚠ {warning}
              </div>
            ))}
            <pre className="create-table-preview">{plan.sql}</pre>
          </>
        )}
        <div className="modal-actions">
          <button type="button" className="modal-secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="modal-secondary"
            onClick={() => onOpenSql(plan)}
            disabled={plan.errors.length > 0}
          >
            Open SQL preview
          </button>
          <button
            type="button"
            className="modal-transaction"
            onClick={() => void onApply(plan)}
            disabled={plan.errors.length > 0}
          >
            Apply view
          </button>
        </div>
      </dialog>
    </div>
  );
}

function DropViewDialog({
  driverKind,
  view,
  existingViews,
  dependentObjects,
  onClose,
  onDrop,
  onOpenSql,
}: {
  driverKind: DriverKind;
  view: ViewMetadata;
  existingViews: ViewMetadata[];
  dependentObjects: string[];
  onClose: () => void;
  onDrop: (plan: DropViewPlan) => Promise<void>;
  onOpenSql: (plan: DropViewPlan) => void;
}) {
  const plan = useMemo(
    () =>
      buildDropViewPlan(
        view.schema,
        view.name,
        existingViews,
        dependentObjects,
        driverKind,
      ),
    [dependentObjects, driverKind, existingViews, view.name, view.schema],
  );
  return (
    <div className="modal-backdrop" role="presentation">
      <dialog
        open
        className="drop-index-modal"
        aria-modal="true"
        aria-labelledby="drop-view-title"
      >
        <div className="edit-preview-heading">
          <div>
            <p className="modal-kicker">OBJECT FORM · VIEW</p>
            <h2 id="drop-view-title">Drop view</h2>
          </div>
          <button
            type="button"
            className="mini-button"
            aria-label="Close drop view form"
            onClick={onClose}
          >
            ×
          </button>
        </div>
        <p className="modal-copy">
          Drop{" "}
          <strong>
            {view.schema}.{view.name}
          </strong>{" "}
          after reviewing the dependency warning and generated SQL.
        </p>
        {plan.errors.length > 0 ? (
          <div className="create-table-errors" role="alert">
            {plan.errors.map((error) => (
              <div key={error}>{error}</div>
            ))}
          </div>
        ) : (
          <>
            {plan.warnings.map((warning) => (
              <div className="create-index-warning" key={warning}>
                ⚠ {warning}
              </div>
            ))}
            <pre className="create-table-preview">{plan.sql}</pre>
          </>
        )}
        <div className="modal-actions">
          <button type="button" className="modal-secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="modal-secondary"
            onClick={() => onOpenSql(plan)}
            disabled={plan.errors.length > 0}
          >
            Open SQL preview
          </button>
          <button
            type="button"
            className="modal-danger"
            onClick={() => void onDrop(plan)}
            disabled={plan.errors.length > 0}
          >
            Drop view
          </button>
        </div>
      </dialog>
    </div>
  );
}

function DropIndexDialog({
  driverKind,
  table,
  onClose,
  onDrop,
  onOpenSql,
}: {
  driverKind: DriverKind;
  table: TableMetadata;
  onClose: () => void;
  onDrop: (plan: DropIndexPlan) => Promise<void>;
  onOpenSql: (plan: DropIndexPlan) => void;
}) {
  const [indexName, setIndexName] = useState(
    table.indexes.find((index) => !index.primary)?.name ??
      table.indexes[0]?.name ??
      "",
  );
  const plan = useMemo(
    () => buildDropIndexPlan(table, indexName, driverKind),
    [driverKind, indexName, table],
  );
  return (
    <div className="modal-backdrop" role="presentation">
      <dialog
        open
        className="drop-index-modal"
        aria-modal="true"
        aria-labelledby="drop-index-title"
      >
        <div className="edit-preview-heading">
          <div>
            <p className="modal-kicker">OBJECT FORM · INDEX</p>
            <h2 id="drop-index-title">Drop index</h2>
          </div>
          <button
            type="button"
            className="mini-button"
            aria-label="Close drop index form"
            onClick={onClose}
          >
            ×
          </button>
        </div>
        <p className="modal-copy">
          Remove a non-primary index from{" "}
          <strong>
            {table.schema}.{table.name}
          </strong>{" "}
          using an explicit transaction. Primary indexes are protected because
          they enforce the table key.
        </p>
        <label className="drop-index-select" htmlFor="drop-index-name">
          Index
          <select
            id="drop-index-name"
            value={indexName}
            onChange={(event) => setIndexName(event.target.value)}
          >
            {table.indexes.map((index) => (
              <option key={index.name} value={index.name}>
                {index.name} {index.primary ? "(primary)" : ""}
              </option>
            ))}
          </select>
        </label>
        {plan.errors.length > 0 && (
          <div className="create-table-errors" role="alert">
            {plan.errors.map((error) => (
              <div key={error}>{error}</div>
            ))}
          </div>
        )}
        {plan.manual.length > 0 && (
          <output className="create-index-warning">
            {plan.manual.map((message) => (
              <div key={message}>{message}</div>
            ))}
          </output>
        )}
        {plan.sql && <pre className="create-table-preview">{plan.sql}</pre>}
        <div className="modal-actions">
          <button type="button" className="modal-secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="modal-secondary"
            onClick={() => onOpenSql(plan)}
            disabled={plan.errors.length > 0 || !plan.sql}
          >
            Open SQL preview
          </button>
          <button
            type="button"
            className="modal-danger"
            onClick={() => void onDrop(plan)}
            disabled={
              plan.errors.length > 0 || plan.manual.length > 0 || !plan.sql
            }
          >
            Drop index
          </button>
        </div>
      </dialog>
    </div>
  );
}

function AddForeignKeyDialog({
  driverKind,
  table,
  tables,
  onClose,
  onAdd,
  onOpenSql,
}: {
  driverKind: DriverKind;
  table: TableMetadata;
  tables: TableMetadata[];
  onClose: () => void;
  onAdd: (plan: AddForeignKeyPlan) => Promise<void>;
  onOpenSql: (plan: AddForeignKeyPlan) => void;
}) {
  const targetTables = tables.filter(
    (candidate) =>
      candidate.schema !== table.schema || candidate.name !== table.name,
  );
  const [name, setName] = useState(`${table.name}_fk`);
  const [targetKey, setTargetKey] = useState(
    targetTables[0]
      ? `${targetTables[0].schema}\u0000${targetTables[0].name}`
      : "",
  );
  const targetTable = targetTables.find(
    (candidate) => `${candidate.schema}\u0000${candidate.name}` === targetKey,
  );
  const firstSourceColumn =
    table.columns.find((column) => !column.primaryKey)?.name ??
    table.columns[0]?.name ??
    "";
  const firstReferencedColumn =
    targetTable?.columns.find((column) => column.primaryKey)?.name ??
    targetTable?.columns[0]?.name ??
    "";
  const [pairs, setPairs] = useState<
    Array<{ id: string; sourceColumn: string; referencedColumn: string }>
  >([
    {
      id: crypto.randomUUID(),
      sourceColumn: firstSourceColumn,
      referencedColumn: firstReferencedColumn,
    },
  ]);
  const [onUpdate, setOnUpdate] = useState("NO ACTION");
  const [onDelete, setOnDelete] = useState("NO ACTION");
  useEffect(() => {
    setPairs([
      {
        id: crypto.randomUUID(),
        sourceColumn: firstSourceColumn,
        referencedColumn: firstReferencedColumn,
      },
    ]);
  }, [firstReferencedColumn, firstSourceColumn]);
  const plan = useMemo<AddForeignKeyPlan>(
    () =>
      targetTable
        ? buildAddForeignKeyPlan(
            table,
            targetTable,
            {
              name,
              columns: pairs.map((pair) => pair.sourceColumn),
              referencedColumns: pairs.map((pair) => pair.referencedColumn),
              referencedSchema: targetTable.schema,
              referencedTable: targetTable.name,
              onUpdate,
              onDelete,
            },
            driverKind,
          )
        : {
            sql: "",
            statements: [],
            errors: ["Choose a referenced table"],
            manual: [],
            warnings: [],
          },
    [driverKind, name, onDelete, onUpdate, pairs, table, targetTable],
  );
  const updatePair = (
    index: number,
    field: "sourceColumn" | "referencedColumn",
    value: string,
  ) => {
    setPairs((current) =>
      current.map((pair, pairIndex) =>
        pairIndex === index ? { ...pair, [field]: value } : pair,
      ),
    );
  };
  return (
    <div className="modal-backdrop" role="presentation">
      <dialog
        open
        className="create-index-modal foreign-key-modal"
        aria-modal="true"
        aria-labelledby="add-foreign-key-title"
      >
        <div className="edit-preview-heading">
          <div>
            <p className="modal-kicker">OBJECT FORM · CONSTRAINT</p>
            <h2 id="add-foreign-key-title">Add foreign key</h2>
          </div>
          <button
            type="button"
            className="mini-button"
            aria-label="Close add foreign key form"
            onClick={onClose}
          >
            ×
          </button>
        </div>
        <p className="modal-copy">
          Add a named foreign key from{" "}
          <strong>
            {table.schema}.{table.name}
          </strong>{" "}
          to a visible table. Column order is preserved for composite keys.
        </p>
        <div className="create-index-fields">
          <label htmlFor="add-foreign-key-name">
            Constraint name
            <input
              id="add-foreign-key-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={`${table.name}_fk`}
            />
          </label>
          <label htmlFor="add-foreign-key-target">
            Referenced table
            <select
              id="add-foreign-key-target"
              value={targetKey}
              onChange={(event) => setTargetKey(event.target.value)}
            >
              {targetTables.map((candidate) => (
                <option
                  key={`${candidate.schema}.${candidate.name}`}
                  value={`${candidate.schema}\u0000${candidate.name}`}
                >
                  {candidate.schema}.{candidate.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="create-table-columns-heading">
          <strong>Column pairs (order matters)</strong>
          <button
            type="button"
            className="mini-button"
            onClick={() =>
              setPairs((current) => [
                ...current,
                {
                  id: crypto.randomUUID(),
                  sourceColumn: "",
                  referencedColumn: "",
                },
              ])
            }
          >
            + Add pair
          </button>
        </div>
        <div
          className="foreign-key-pair-list"
          aria-label="Foreign-key column pairs"
        >
          {pairs.map((pair, index) => (
            <div className="foreign-key-pair-row" key={pair.id}>
              <select
                value={pair.sourceColumn}
                onChange={(event) =>
                  updatePair(index, "sourceColumn", event.target.value)
                }
                aria-label="Source column pair"
              >
                <option value="">Source column…</option>
                {table.columns.map((column) => (
                  <option key={column.name} value={column.name}>
                    {column.name}
                  </option>
                ))}
              </select>
              <span>→</span>
              <select
                value={pair.referencedColumn}
                onChange={(event) =>
                  updatePair(index, "referencedColumn", event.target.value)
                }
                aria-label="Referenced column pair"
              >
                <option value="">Referenced column…</option>
                {targetTable?.columns.map((column) => (
                  <option key={column.name} value={column.name}>
                    {column.name}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="mini-button"
                onClick={() =>
                  setPairs((current) =>
                    current.filter((_, pairIndex) => pairIndex !== index),
                  )
                }
                disabled={pairs.length === 1}
                aria-label="Remove foreign-key pair"
              >
                ×
              </button>
            </div>
          ))}
        </div>
        <div className="create-index-fields foreign-key-actions">
          <label htmlFor="add-foreign-key-update">
            ON UPDATE
            <select
              id="add-foreign-key-update"
              value={onUpdate}
              onChange={(event) => setOnUpdate(event.target.value)}
            >
              <option>NO ACTION</option>
              <option>RESTRICT</option>
              <option>CASCADE</option>
              <option>SET NULL</option>
              <option>SET DEFAULT</option>
            </select>
          </label>
          <label htmlFor="add-foreign-key-delete">
            ON DELETE
            <select
              id="add-foreign-key-delete"
              value={onDelete}
              onChange={(event) => setOnDelete(event.target.value)}
            >
              <option>NO ACTION</option>
              <option>RESTRICT</option>
              <option>CASCADE</option>
              <option>SET NULL</option>
              <option>SET DEFAULT</option>
            </select>
          </label>
        </div>
        {plan.errors.length > 0 && (
          <div className="create-table-errors" role="alert">
            {plan.errors.map((error) => (
              <div key={error}>{error}</div>
            ))}
          </div>
        )}
        {plan.manual.length > 0 && (
          <output className="create-index-warning">
            {plan.manual.map((message) => (
              <div key={message}>{message}</div>
            ))}
          </output>
        )}
        {plan.sql && <pre className="create-table-preview">{plan.sql}</pre>}
        <div className="modal-actions">
          <button type="button" className="modal-secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="modal-secondary"
            onClick={() => onOpenSql(plan)}
            disabled={
              plan.errors.length > 0 || plan.manual.length > 0 || !plan.sql
            }
          >
            Open SQL preview
          </button>
          <button
            type="button"
            className="modal-transaction"
            onClick={() => void onAdd(plan)}
            disabled={
              plan.errors.length > 0 || plan.manual.length > 0 || !plan.sql
            }
          >
            Add foreign key
          </button>
        </div>
      </dialog>
    </div>
  );
}

function DropForeignKeyDialog({
  driverKind,
  table,
  onClose,
  onDrop,
  onOpenSql,
}: {
  driverKind: DriverKind;
  table: TableMetadata;
  onClose: () => void;
  onDrop: (plan: DropForeignKeyPlan) => Promise<void>;
  onOpenSql: (plan: DropForeignKeyPlan) => void;
}) {
  const [foreignKeyId, setForeignKeyId] = useState(
    table.foreignKeys[0]?.id ?? "",
  );
  const plan = useMemo(
    () =>
      buildDropForeignKeyPlan(
        table,
        table.foreignKeys,
        foreignKeyId,
        driverKind,
      ),
    [driverKind, foreignKeyId, table],
  );
  return (
    <div className="modal-backdrop" role="presentation">
      <dialog
        open
        className="drop-index-modal"
        aria-modal="true"
        aria-labelledby="drop-foreign-key-title"
      >
        <div className="edit-preview-heading">
          <div>
            <p className="modal-kicker">OBJECT FORM · CONSTRAINT</p>
            <h2 id="drop-foreign-key-title">Drop foreign key</h2>
          </div>
          <button
            type="button"
            className="mini-button"
            aria-label="Close drop foreign key form"
            onClick={onClose}
          >
            ×
          </button>
        </div>
        <p className="modal-copy">
          Remove a named foreign key from{" "}
          <strong>
            {table.schema}.{table.name}
          </strong>
          . SQLite and unnamed constraints require a manual table rebuild.
        </p>
        <label className="drop-index-select" htmlFor="drop-foreign-key-name">
          Foreign key
          <select
            id="drop-foreign-key-name"
            value={foreignKeyId}
            onChange={(event) => setForeignKeyId(event.target.value)}
          >
            {table.foreignKeys.map((foreignKey) => (
              <option key={foreignKey.id} value={foreignKey.id}>
                {foreignKey.name ?? "Unnamed foreign key"} ·{" "}
                {foreignKey.referencedRelation.schema}.
                {foreignKey.referencedRelation.name}
              </option>
            ))}
          </select>
        </label>
        {plan.errors.length > 0 && (
          <div className="create-table-errors" role="alert">
            {plan.errors.map((error) => (
              <div key={error}>{error}</div>
            ))}
          </div>
        )}
        {plan.manual.length > 0 && (
          <output className="create-index-warning">
            {plan.manual.map((message) => (
              <div key={message}>{message}</div>
            ))}
          </output>
        )}
        {plan.sql && <pre className="create-table-preview">{plan.sql}</pre>}
        <div className="modal-actions">
          <button type="button" className="modal-secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="modal-secondary"
            onClick={() => onOpenSql(plan)}
            disabled={
              plan.errors.length > 0 || plan.manual.length > 0 || !plan.sql
            }
          >
            Open SQL preview
          </button>
          <button
            type="button"
            className="modal-danger"
            onClick={() => void onDrop(plan)}
            disabled={
              plan.errors.length > 0 || plan.manual.length > 0 || !plan.sql
            }
          >
            Drop foreign key
          </button>
        </div>
      </dialog>
    </div>
  );
}

function CreateIndexDialog({
  driverKind,
  table,
  onClose,
  onCreate,
  onOpenSql,
}: {
  driverKind: DriverKind;
  table: TableMetadata;
  onClose: () => void;
  onCreate: (plan: CreateIndexPlan) => Promise<void>;
  onOpenSql: (plan: CreateIndexPlan) => void;
}) {
  const [input, setInput] = useState<CreateIndexInput>({
    name: "",
    columns: [table.columns[0]?.name ?? ""],
    unique: false,
  });
  const plan = useMemo(
    () => buildCreateIndexPlan(table, input, driverKind),
    [driverKind, input, table],
  );
  const updateColumn = (index: number, value: string) => {
    setInput((current) => ({
      ...current,
      columns: current.columns.map((column, columnIndex) =>
        columnIndex === index ? value : column,
      ),
    }));
  };
  const addIndexColumn = () => {
    setInput((current) => ({ ...current, columns: [...current.columns, ""] }));
  };
  const removeIndexColumn = (index: number) => {
    setInput((current) => ({
      ...current,
      columns: current.columns.filter(
        (_, columnIndex) => columnIndex !== index,
      ),
    }));
  };
  return (
    <div className="modal-backdrop" role="presentation">
      <dialog
        open
        className="create-index-modal"
        aria-modal="true"
        aria-labelledby="create-index-title"
      >
        <div className="edit-preview-heading">
          <div>
            <p className="modal-kicker">OBJECT FORM · INDEX</p>
            <h2 id="create-index-title">Create index</h2>
          </div>
          <button
            type="button"
            className="mini-button"
            aria-label="Close create index form"
            onClick={onClose}
          >
            ×
          </button>
        </div>
        <p className="modal-copy">
          Create an ordered index on{" "}
          <strong>
            {table.schema}.{table.name}
          </strong>{" "}
          using {driverDisplayName(driverKind)} identifier quoting. QueryX warns
          about redundant column orders but leaves final constraint behavior to
          the database.
        </p>
        <div className="create-index-fields">
          <label htmlFor="create-index-name">
            Index name
            <input
              id="create-index-name"
              value={input.name}
              onChange={(event) =>
                setInput((current) => ({
                  ...current,
                  name: event.target.value,
                }))
              }
              placeholder={`${table.name}_column_idx`}
            />
          </label>
          <label className="create-table-check create-index-unique">
            <input
              type="checkbox"
              checked={input.unique}
              onChange={(event) =>
                setInput((current) => ({
                  ...current,
                  unique: event.target.checked,
                }))
              }
            />
            UNIQUE
          </label>
        </div>
        <div className="create-table-columns-heading">
          <strong>Indexed columns (order matters)</strong>
          <button
            type="button"
            className="mini-button"
            onClick={addIndexColumn}
          >
            + Add column
          </button>
        </div>
        <div className="index-column-list" aria-label="Indexed columns">
          {input.columns.map((column, index) => (
            <div className="index-column-row" key={`${index}-${column}`}>
              <span>{index + 1}</span>
              <select
                value={column}
                onChange={(event) => updateColumn(index, event.target.value)}
                aria-label={`Index column ${index + 1}`}
              >
                <option value="">Select column…</option>
                {table.columns.map((candidate) => (
                  <option key={candidate.name} value={candidate.name}>
                    {candidate.name}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="mini-button"
                onClick={() => removeIndexColumn(index)}
                disabled={input.columns.length === 1}
                aria-label={`Remove index column ${index + 1}`}
              >
                ×
              </button>
            </div>
          ))}
        </div>
        {plan.errors.length > 0 && (
          <div className="create-table-errors" role="alert">
            {plan.errors.map((error) => (
              <div key={error}>{error}</div>
            ))}
          </div>
        )}
        {plan.warnings.length > 0 && (
          <output className="create-index-warning">
            {plan.warnings.map((warning) => (
              <div key={warning}>{warning}</div>
            ))}
          </output>
        )}
        {!plan.errors.length && (
          <pre className="create-table-preview">{plan.sql}</pre>
        )}
        <div className="modal-actions">
          <button type="button" className="modal-secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="modal-secondary"
            onClick={() => onOpenSql(plan)}
            disabled={plan.errors.length > 0}
          >
            Open SQL preview
          </button>
          <button
            type="button"
            className="modal-transaction"
            onClick={() => void onCreate(plan)}
            disabled={plan.errors.length > 0}
          >
            Create index
          </button>
        </div>
      </dialog>
    </div>
  );
}

function EditTableColumnsDialog({
  driverKind,
  table,
  onClose,
  onApply,
  onOpenSql,
}: {
  driverKind: DriverKind;
  table: TableMetadata;
  onClose: () => void;
  onApply: (plan: EditTableColumnsPlan) => Promise<void>;
  onOpenSql: (plan: EditTableColumnsPlan) => void;
}) {
  const [columns, setColumns] = useState<EditTableColumnInput[]>(
    table.columns.map((column) => ({
      name: column.name,
      type: column.type,
      nullable: column.nullable,
      primaryKey: Boolean(column.primaryKey),
      remove: false,
    })),
  );
  const plan = useMemo(
    () => buildEditTableColumnsPlan(table, columns, driverKind),
    [columns, driverKind, table],
  );
  const updateColumn = (
    index: number,
    patch: Partial<EditTableColumnInput>,
  ) => {
    setColumns((current) =>
      current.map((column, columnIndex) =>
        columnIndex === index ? { ...column, ...patch } : column,
      ),
    );
  };
  return (
    <div className="modal-backdrop" role="presentation">
      <dialog
        open
        className="edit-columns-modal"
        aria-modal="true"
        aria-labelledby="edit-columns-title"
      >
        <div className="edit-preview-heading">
          <div>
            <p className="modal-kicker">OBJECT FORM · COLUMNS</p>
            <h2 id="edit-columns-title">Edit table columns</h2>
          </div>
          <button
            type="button"
            className="mini-button"
            aria-label="Close edit columns form"
            onClick={onClose}
          >
            ×
          </button>
        </div>
        <p className="modal-copy">
          Edit type and nullability or mark a non-primary-key column for removal
          on{" "}
          <strong>
            {table.schema}.{table.name}
          </strong>
          . Primary-key changes and SQLite rebuilds require manual SQL review.
        </p>
        <div className="edit-columns-list" aria-label="Editable table columns">
          {columns.map((column, index) => (
            <div
              className={`edit-column-row ${column.remove ? "marked-remove" : ""}`}
              key={column.name}
            >
              <input
                value={column.name}
                readOnly
                aria-label={`Column ${index + 1} name`}
              />
              <input
                value={column.type}
                onChange={(event) =>
                  updateColumn(index, { type: event.target.value })
                }
                aria-label={`Column ${index + 1} type`}
                disabled={column.remove}
              />
              <label className="create-table-check">
                <input
                  type="checkbox"
                  checked={!column.nullable}
                  onChange={(event) =>
                    updateColumn(index, { nullable: !event.target.checked })
                  }
                  disabled={column.remove}
                />
                Required
              </label>
              <span className="edit-column-pk">
                {column.primaryKey ? "PK" : ""}
              </span>
              <label className="create-table-check">
                <input
                  type="checkbox"
                  checked={column.remove}
                  onChange={(event) =>
                    updateColumn(index, { remove: event.target.checked })
                  }
                  disabled={column.primaryKey}
                />
                Remove
              </label>
            </div>
          ))}
        </div>
        {plan.errors.length > 0 && (
          <div className="create-table-errors" role="alert">
            {plan.errors.map((error) => (
              <div key={error}>{error}</div>
            ))}
          </div>
        )}
        {plan.manual.length > 0 && (
          <output className="edit-columns-manual">
            {plan.manual.map((message) => (
              <div key={message}>{message}</div>
            ))}
          </output>
        )}
        <pre className="create-table-preview">
          {plan.sql || "No executable changes yet."}
        </pre>
        <div className="modal-actions">
          <button type="button" className="modal-secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="modal-secondary"
            onClick={() => onOpenSql(plan)}
            disabled={plan.errors.length > 0 || !plan.sql}
          >
            Open SQL preview
          </button>
          <button
            type="button"
            className="modal-transaction"
            onClick={() => void onApply(plan)}
            disabled={
              plan.errors.length > 0 ||
              plan.manual.length > 0 ||
              plan.statements.length === 0
            }
          >
            Apply changes
          </button>
        </div>
      </dialog>
    </div>
  );
}

function AddColumnDialog({
  driverKind,
  table,
  onClose,
  onAdd,
  onOpenSql,
}: {
  driverKind: DriverKind;
  table: TableMetadata;
  onClose: () => void;
  onAdd: (plan: AddColumnPlan) => Promise<void>;
  onOpenSql: (plan: AddColumnPlan) => void;
}) {
  const [column, setColumn] = useState<AddColumnInput>({
    name: "",
    type: "text",
    nullable: true,
  });
  const plan = useMemo(
    () => buildAddColumnPlan(table, column, driverKind),
    [column, driverKind, table],
  );
  return (
    <div className="modal-backdrop" role="presentation">
      <dialog
        open
        className="add-column-modal"
        aria-modal="true"
        aria-labelledby="add-column-title"
      >
        <div className="edit-preview-heading">
          <div>
            <p className="modal-kicker">OBJECT FORM · COLUMN</p>
            <h2 id="add-column-title">Add column</h2>
          </div>
          <button
            type="button"
            className="mini-button"
            aria-label="Close add column form"
            onClick={onClose}
          >
            ×
          </button>
        </div>
        <p className="modal-copy">
          Add a column to{" "}
          <strong>
            {table.schema}.{table.name}
          </strong>{" "}
          using {driverDisplayName(driverKind)} syntax. Defaults, generated
          values, and constraints remain available in the SQL preview.
        </p>
        <div className="add-column-fields">
          <label htmlFor="add-column-name">
            Column name
            <input
              id="add-column-name"
              value={column.name}
              onChange={(event) =>
                setColumn((current) => ({
                  ...current,
                  name: event.target.value,
                }))
              }
              placeholder="created_at"
            />
          </label>
          <label htmlFor="add-column-type">
            Database type
            <input
              id="add-column-type"
              value={column.type}
              onChange={(event) =>
                setColumn((current) => ({
                  ...current,
                  type: event.target.value,
                }))
              }
              placeholder="timestamp with time zone"
            />
          </label>
          <label className="create-table-check add-column-required">
            <input
              type="checkbox"
              checked={!column.nullable}
              onChange={(event) =>
                setColumn((current) => ({
                  ...current,
                  nullable: !event.target.checked,
                }))
              }
            />
            Required / NOT NULL
          </label>
        </div>
        {plan.errors.length > 0 ? (
          <div className="create-table-errors" role="alert">
            {plan.errors.map((error) => (
              <div key={error}>{error}</div>
            ))}
          </div>
        ) : (
          <pre className="create-table-preview">{plan.sql}</pre>
        )}
        <div className="modal-actions">
          <button type="button" className="modal-secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="modal-secondary"
            onClick={() => onOpenSql(plan)}
            disabled={plan.errors.length > 0}
          >
            Open SQL preview
          </button>
          <button
            type="button"
            className="modal-transaction"
            onClick={() => void onAdd(plan)}
            disabled={plan.errors.length > 0}
          >
            Add column
          </button>
        </div>
      </dialog>
    </div>
  );
}

function CreateTableDialog({
  driverKind,
  schemas,
  onClose,
  onCreate,
  onOpenSql,
}: {
  driverKind: DriverKind;
  schemas: string[];
  onClose: () => void;
  onCreate: (plan: CreateTablePlan) => Promise<void>;
  onOpenSql: (plan: CreateTablePlan) => void;
}) {
  const [schema, setSchema] = useState(schemas[0] ?? "public");
  const [name, setName] = useState("");
  const [columns, setColumns] = useState<CreateTableColumnInput[]>([
    { name: "id", type: "integer", nullable: false, primaryKey: true },
  ]);
  const plan = useMemo(
    () => buildCreateTablePlan({ schema, name, columns }, driverKind),
    [columns, driverKind, name, schema],
  );
  const updateColumn = (
    index: number,
    patch: Partial<CreateTableColumnInput>,
  ) => {
    setColumns((current) =>
      current.map((column, columnIndex) =>
        columnIndex === index ? { ...column, ...patch } : column,
      ),
    );
  };
  const addColumn = () => {
    setColumns((current) => [
      ...current,
      { name: "", type: "text", nullable: true, primaryKey: false },
    ]);
  };
  const removeColumn = (index: number) => {
    setColumns((current) =>
      current.filter((_, columnIndex) => columnIndex !== index),
    );
  };

  return (
    <div className="modal-backdrop" role="presentation">
      <dialog
        open
        className="create-table-modal"
        aria-modal="true"
        aria-labelledby="create-table-title"
      >
        <div className="edit-preview-heading">
          <div>
            <p className="modal-kicker">OBJECT FORM · TABLE</p>
            <h2 id="create-table-title">Create table</h2>
          </div>
          <button
            type="button"
            className="mini-button"
            aria-label="Close create table form"
            onClick={onClose}
          >
            ×
          </button>
        </div>
        <p className="modal-copy">
          Generate a reviewed CREATE TABLE statement for the active{" "}
          {driverDisplayName(driverKind)} connection. Defaults, foreign keys,
          indexes, and generated columns can be added from the SQL preview.
        </p>
        <div className="create-table-fields">
          <label htmlFor="create-table-schema">
            Schema
            {schemas.length > 0 ? (
              <select
                id="create-table-schema"
                value={schema}
                onChange={(event) => setSchema(event.target.value)}
              >
                {schemas.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            ) : (
              <input
                id="create-table-schema"
                value={schema}
                onChange={(event) => setSchema(event.target.value)}
                placeholder="public"
              />
            )}
          </label>
          <label htmlFor="create-table-name">
            Table name
            <input
              id="create-table-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="audit_events"
            />
          </label>
        </div>
        <div className="create-table-columns-heading">
          <strong>Columns</strong>
          <button type="button" className="mini-button" onClick={addColumn}>
            + Add column
          </button>
        </div>
        <div className="create-table-columns" aria-label="Table columns">
          {columns.map((column, index) => (
            <div
              className="create-table-column"
              key={`${index}-${column.name}`}
            >
              <input
                value={column.name}
                onChange={(event) =>
                  updateColumn(index, { name: event.target.value })
                }
                placeholder="column_name"
                aria-label={`Column ${index + 1} name`}
              />
              <input
                value={column.type}
                onChange={(event) =>
                  updateColumn(index, { type: event.target.value })
                }
                placeholder="text"
                aria-label={`Column ${index + 1} type`}
              />
              <label className="create-table-check">
                <input
                  type="checkbox"
                  checked={!column.nullable}
                  onChange={(event) =>
                    updateColumn(index, { nullable: !event.target.checked })
                  }
                />
                Required
              </label>
              <label className="create-table-check">
                <input
                  type="checkbox"
                  checked={column.primaryKey}
                  onChange={(event) =>
                    updateColumn(index, { primaryKey: event.target.checked })
                  }
                />
                PK
              </label>
              <button
                type="button"
                className="mini-button"
                onClick={() => removeColumn(index)}
                disabled={columns.length === 1}
                aria-label={`Remove column ${index + 1}`}
              >
                ×
              </button>
            </div>
          ))}
        </div>
        {plan.errors.length > 0 ? (
          <div className="create-table-errors" role="alert">
            {plan.errors.map((error) => (
              <div key={error}>{error}</div>
            ))}
          </div>
        ) : (
          <pre className="create-table-preview">{plan.sql}</pre>
        )}
        <div className="modal-actions">
          <button type="button" className="modal-secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="modal-secondary"
            onClick={() => onOpenSql(plan)}
            disabled={plan.errors.length > 0}
          >
            Open SQL preview
          </button>
          <button
            type="button"
            className="modal-transaction"
            onClick={() => void onCreate(plan)}
            disabled={plan.errors.length > 0}
          >
            Create table
          </button>
        </div>
      </dialog>
    </div>
  );
}

function ErdDialog({
  metadata,
  onClose,
  onSelectRelation,
}: {
  metadata: DatabaseMetadata;
  onClose: () => void;
  onSelectRelation: (node: ErdNode) => void;
}) {
  const [query, setQuery] = useState("");
  const [zoom, setZoom] = useState(1);
  const diagram = useMemo(() => buildErdDiagram(metadata), [metadata]);
  const filteredNodes = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return diagram.nodes;
    return diagram.nodes.filter((node) =>
      `${node.schema}.${node.name}`.toLowerCase().includes(normalized),
    );
  }, [diagram.nodes, query]);
  const visibleIds = useMemo(
    () => new Set(filteredNodes.map((node) => node.id)),
    [filteredNodes],
  );
  const nodesById = useMemo(
    () => new Map(filteredNodes.map((node) => [node.id, node])),
    [filteredNodes],
  );
  const edges = diagram.edges.filter(
    (edge) => visibleIds.has(edge.source) && visibleIds.has(edge.target),
  );
  const edgePath = (source: ErdNode, target: ErdNode) => {
    const sx = source.x + source.width / 2;
    const sy = source.y + source.height / 2;
    const tx = target.x + target.width / 2;
    const ty = target.y + target.height / 2;
    const bend = (sx + tx) / 2;
    return `M ${sx} ${sy} C ${bend} ${sy}, ${bend} ${ty}, ${tx} ${ty}`;
  };

  return (
    <div className="modal-backdrop" role="presentation">
      <dialog open className="erd-modal" aria-labelledby="erd-title">
        <div className="erd-heading">
          <div>
            <p className="modal-kicker">SCHEMA MAP · ERD</p>
            <h2 id="erd-title">Entity relationship diagram</h2>
          </div>
          <button type="button" className="icon-button" onClick={onClose}>
            ×
          </button>
        </div>
        <p className="modal-copy">
          Explore tables and views from the current metadata snapshot. Foreign
          keys and view dependencies are shown as directional relationships.
        </p>
        <div className="erd-toolbar">
          <input
            className="erd-search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Filter relations…"
            aria-label="Filter ERD relations"
          />
          <label className="erd-zoom">
            Zoom
            <input
              type="range"
              min="0.75"
              max="1.5"
              step="0.05"
              value={zoom}
              onChange={(event) => setZoom(Number(event.target.value))}
              aria-label="ERD zoom"
            />
            <button
              type="button"
              className="modal-secondary"
              onClick={() => setZoom(1)}
            >
              {Math.round(zoom * 100)}%
            </button>
          </label>
          <span className="erd-count">
            {filteredNodes.length}/{diagram.nodes.length} relations ·{" "}
            {edges.length} edges
          </span>
        </div>
        <div className="erd-viewport">
          {filteredNodes.length === 0 ? (
            <div className="empty-state">No relations match this filter.</div>
          ) : (
            <svg
              className="erd-canvas"
              viewBox={`0 0 ${diagram.width} ${diagram.height}`}
              style={{
                width: diagram.width,
                height: diagram.height,
                transform: `scale(${zoom})`,
              }}
              role="img"
              aria-label="Entity relationship diagram"
            >
              <defs>
                <marker
                  id="erd-arrow"
                  markerWidth="7"
                  markerHeight="7"
                  refX="6"
                  refY="3.5"
                  orient="auto"
                >
                  <path d="M 0 0 L 7 3.5 L 0 7 z" fill="#6b8c92" />
                </marker>
              </defs>
              {edges.map((edge) => {
                const source = nodesById.get(edge.source);
                const target = nodesById.get(edge.target);
                if (!source || !target) return null;
                return (
                  <g key={edge.id}>
                    <path
                      className="erd-edge"
                      d={edgePath(source, target)}
                      markerEnd="url(#erd-arrow)"
                    />
                    <title>{edge.label}</title>
                  </g>
                );
              })}
              {filteredNodes.map((node) => (
                <a
                  key={node.id}
                  href={`#erd-${node.kind}-${node.schema}-${node.name}`}
                  onClick={(event) => {
                    event.preventDefault();
                    onSelectRelation(node);
                  }}
                  aria-label={`Open ${node.kind} ${node.schema}.${node.name}`}
                >
                  <g
                    className={`erd-node ${node.kind}`}
                    transform={`translate(${node.x} ${node.y})`}
                  >
                    <rect width={node.width} height={node.height} rx="7" />
                    <text className="erd-node-title" x="12" y="19">
                      {node.name}
                    </text>
                    <text className="erd-node-meta" x="12" y="35">
                      {node.kind.toUpperCase()} · {node.schema}
                    </text>
                    {node.columns.map((column, index) => (
                      <g
                        key={column.name}
                        transform={`translate(12 ${58 + index * 18})`}
                      >
                        <text className="erd-column-name" x="0" y="0">
                          {column.primaryKey ? "◆" : "·"} {column.name}
                        </text>
                        <text
                          className="erd-column-type"
                          x={node.width - 24}
                          y="0"
                          textAnchor="end"
                        >
                          {column.type}
                        </text>
                      </g>
                    ))}
                    {node.totalColumns > node.columns.length && (
                      <text
                        className="erd-column-type"
                        x="12"
                        y={node.height - 8}
                      >
                        … more columns
                      </text>
                    )}
                  </g>
                </a>
              ))}
            </svg>
          )}
        </div>
        <div className="modal-actions">
          <span className="erd-help">
            Select a node to open it in Inspector.
          </span>
          <button type="button" className="modal-secondary" onClick={onClose}>
            Close
          </button>
        </div>
      </dialog>
    </div>
  );
}

function CsvImportDialog({
  table,
  driverKind,
  onClose,
  onImport,
}: {
  table: TableMetadata;
  driverKind: DriverKind;
  onClose: () => void;
  onImport: (plan: CsvImportPlan) => Promise<void>;
}) {
  const [fileName, setFileName] = useState("");
  const [sourceKind, setSourceKind] = useState<"csv" | "json">("csv");
  const [conflictPolicy, setConflictPolicy] =
    useState<ImportConflictPolicy>("error");
  const [conflictColumns, setConflictColumns] = useState<string[]>(
    table.columns
      .filter((column) => column.primaryKey)
      .map((column) => column.name),
  );
  const [parsed, setParsed] = useState<ReturnType<typeof parseCsv> | null>(
    null,
  );
  const [mappings, setMappings] = useState<CsvImportMapping[]>([]);
  const [loading, setLoading] = useState(false);
  const plan = useMemo(
    () =>
      parsed
        ? buildCsvImportPlan(
            table,
            parsed,
            mappings,
            driverKind,
            conflictPolicy,
            conflictColumns,
          )
        : null,
    [conflictColumns, conflictPolicy, driverKind, mappings, parsed, table],
  );
  const importTypes: ImportValueType[] = [
    "text",
    "integer",
    "numeric",
    "boolean",
    "date",
    "json",
  ];

  const handleFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setLoading(true);
    try {
      const text = await file.text();
      const nextKind = file.name.toLowerCase().endsWith(".json")
        ? "json"
        : "csv";
      const next = nextKind === "json" ? parseJsonRows(text) : parseCsv(text);
      setFileName(file.name);
      setSourceKind(nextKind);
      setParsed(next);
      setMappings(defaultCsvImportMappings(next.headers, table.columns));
    } finally {
      setLoading(false);
    }
  };

  const updateMapping = (index: number, next: Partial<CsvImportMapping>) => {
    setMappings((current) =>
      current.map((mapping, mappingIndex) =>
        mappingIndex === index ? { ...mapping, ...next } : mapping,
      ),
    );
  };

  return (
    <div className="modal-backdrop" role="presentation">
      <dialog
        open
        className="schema-diff-modal import-modal"
        aria-modal="true"
        aria-labelledby="csv-import-title"
      >
        <div className="edit-preview-heading">
          <div>
            <p className="modal-kicker">
              DATA IMPORT · {sourceKind.toUpperCase()} ·{" "}
              {driverDisplayName(driverKind)}
            </p>
            <h2 id="csv-import-title">
              Import data into {table.schema}.{table.name}
            </h2>
          </div>
          <button
            type="button"
            className="mini-button"
            aria-label="Close CSV import"
            onClick={onClose}
          >
            ×
          </button>
        </div>
        <p className="modal-copy">
          Select a CSV or JSON object collection, map source columns to the
          target table, then review the generated batch before importing.
        </p>
        <label className="import-file-picker">
          <span>{fileName || "Choose CSV or JSON file"}</span>
          <input
            type="file"
            accept=".csv,.json,text/csv,application/json"
            onChange={handleFile}
          />
        </label>
        {loading && <div className="import-status">Reading file…</div>}
        {parsed && (
          <>
            <div className="schema-diff-summary">
              <span>{parsed.rows.length} rows</span>
              <span>
                {mappings.filter((mapping) => mapping.include).length} mapped
              </span>
              {plan && plan.errors.length > 0 && (
                <span className="schema-diff-removed">
                  {plan.errors.length} errors
                </span>
              )}
            </div>
            <label className="import-conflict-policy">
              <span>On duplicate key</span>
              <select
                value={conflictPolicy}
                onChange={(event) =>
                  setConflictPolicy(event.target.value as ImportConflictPolicy)
                }
              >
                <option value="error">Stop and rollback</option>
                <option value="ignore">Ignore conflicting rows</option>
                <option value="upsert">Update existing rows (upsert)</option>
              </select>
            </label>
            {conflictPolicy === "upsert" && (
              <div className="import-upsert-keys">
                <div>
                  <strong>Conflict key columns</strong>
                  <small>
                    Select mapped primary/unique columns used to find existing
                    rows.
                  </small>
                </div>
                <div className="import-upsert-key-list">
                  {table.columns.map((column) => {
                    const mapped = mappings.some(
                      (mapping) =>
                        mapping.include && mapping.targetName === column.name,
                    );
                    const selected = conflictColumns.includes(column.name);
                    return (
                      <label key={column.name}>
                        <input
                          type="checkbox"
                          checked={selected}
                          disabled={!mapped}
                          onChange={(event) =>
                            setConflictColumns((current) =>
                              event.target.checked
                                ? [...current, column.name]
                                : current.filter(
                                    (name) => name !== column.name,
                                  ),
                            )
                          }
                        />
                        {column.name}
                        {column.primaryKey && <b>PK</b>}
                      </label>
                    );
                  })}
                </div>
              </div>
            )}
            <div className="import-mapping-list">
              {mappings.map((mapping, index) => (
                <div className="import-mapping-row" key={mapping.sourceName}>
                  <label>
                    <input
                      type="checkbox"
                      checked={mapping.include}
                      onChange={(event) =>
                        updateMapping(index, {
                          include: event.target.checked,
                        })
                      }
                    />
                    <strong>{mapping.sourceName}</strong>
                  </label>
                  <select
                    value={mapping.targetName ?? ""}
                    disabled={!mapping.include}
                    onChange={(event) => {
                      const targetName = event.target.value || null;
                      const target = table.columns.find(
                        (column) => column.name === targetName,
                      );
                      updateMapping(index, {
                        targetName,
                        include: Boolean(targetName),
                        type: target ? inferImportType(target) : mapping.type,
                      });
                    }}
                    aria-label={`Target for ${mapping.sourceName}`}
                  >
                    <option value="">Skip column</option>
                    {table.columns.map((column) => (
                      <option value={column.name} key={column.name}>
                        {column.name}
                      </option>
                    ))}
                  </select>
                  <select
                    value={mapping.type}
                    disabled={!mapping.include}
                    onChange={(event) =>
                      updateMapping(index, {
                        type: event.target.value as ImportValueType,
                      })
                    }
                    aria-label={`Type for ${mapping.sourceName}`}
                  >
                    {importTypes.map((type) => (
                      <option value={type} key={type}>
                        {type}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
            {parsed.rows.length > 0 && (
              <div className="import-preview-wrap">
                <strong>Preview · first 5 rows</strong>
                <pre className="import-preview">
                  {parsed.rows
                    .slice(0, 5)
                    .map((row) => row.values.join(" | "))
                    .join("\n")}
                </pre>
              </div>
            )}
            {plan && plan.errors.length > 0 && (
              <div className="import-errors" role="alert">
                {plan.errors.slice(0, 8).map((error) => (
                  <span key={error}>{error}</span>
                ))}
                {plan.errors.length > 8 && (
                  <span>…and {plan.errors.length - 8} more</span>
                )}
              </div>
            )}
            {plan && plan.warnings.length > 0 && (
              <output className="import-warnings">
                {plan.warnings.map((warning) => (
                  <span key={warning}>⚠ {warning}</span>
                ))}
              </output>
            )}
          </>
        )}
        <div className="modal-actions">
          <button type="button" className="modal-secondary" onClick={onClose}>
            Cancel
          </button>
          <button
            type="button"
            className="modal-transaction"
            disabled={
              !plan || plan.errors.length > 0 || plan.statements.length === 0
            }
            onClick={() => {
              if (!plan) return;
              void onImport(plan);
            }}
          >
            Import {plan?.statements.length ?? 0} rows
          </button>
        </div>
      </dialog>
    </div>
  );
}

function SchemaDiffDialog({
  diff,
  driverKind,
  baselineLabel,
  onClose,
  onCompareConnection,
  onOpenSql,
  onOpenRollback,
  onOpenPrivilegePreflight,
  onApplyMigration,
  onOpenHistory,
}: {
  diff: SchemaDiff;
  driverKind: DriverKind;
  baselineLabel: string;
  onClose: () => void;
  onCompareConnection: () => void;
  onOpenSql: () => void;
  onOpenRollback: () => void;
  onOpenPrivilegePreflight: () => void;
  onApplyMigration: () => Promise<void>;
  onOpenHistory: () => void;
}) {
  const migrationSql = buildSchemaMigrationSql(diff);
  return (
    <div className="modal-backdrop" role="presentation">
      <dialog
        open
        className="schema-diff-modal"
        aria-modal="true"
        aria-labelledby="schema-diff-title"
      >
        <div className="edit-preview-heading">
          <div>
            <p className="modal-kicker">
              SCHEMA COMPARE · {driverDisplayName(driverKind)}
            </p>
            <h2 id="schema-diff-title">Migration preview</h2>
          </div>
          <button
            type="button"
            className="mini-button"
            aria-label="Close schema comparison"
            onClick={onClose}
          >
            ×
          </button>
        </div>
        <p className="modal-copy">
          Comparing <strong>{baselineLabel}</strong> with the current metadata
          snapshot. Nothing runs automatically; review the generated SQL before
          opening it in a query tab.
        </p>
        <div className="schema-diff-summary" aria-label="Schema change summary">
          <span>{diff.changes.length} changes</span>
          <span className="schema-diff-added">{diff.added} additive</span>
          <span className="schema-diff-removed">
            {diff.removed} destructive
          </span>
          {diff.manual > 0 && <span>{diff.manual} manual</span>}
        </div>
        {diff.changes.length === 0 ? (
          <div className="schema-diff-empty">
            Baseline and current metadata match.
          </div>
        ) : (
          <>
            <div className="schema-diff-list" aria-label="Schema changes">
              {diff.changes.map((change) => (
                <div
                  className="schema-diff-row"
                  key={`${change.kind}:${change.label}`}
                >
                  <span
                    className={`schema-diff-kind ${change.destructive ? "destructive" : "additive"}`}
                  >
                    {change.destructive ? "DROP" : "ADD"}
                  </span>
                  <span>
                    <strong>{change.label}</strong>
                    <small>
                      {change.sql
                        ? change.detail
                        : `Manual review · ${change.detail}`}
                    </small>
                  </span>
                </div>
              ))}
            </div>
            <pre className="edit-preview-sql">{migrationSql}</pre>
          </>
        )}
        <div className="modal-actions">
          <button type="button" className="modal-secondary" onClick={onClose}>
            Close
          </button>
          <button
            type="button"
            className="modal-secondary"
            onClick={onCompareConnection}
          >
            Compare connection
          </button>
          <button
            type="button"
            className="modal-secondary"
            onClick={onOpenRollback}
            disabled={diff.changes.length === 0}
          >
            Open rollback
          </button>
          <button
            type="button"
            className="modal-secondary"
            onClick={onOpenPrivilegePreflight}
          >
            Privilege preflight
          </button>
          <button
            type="button"
            className="modal-transaction"
            onClick={() => void onApplyMigration()}
            disabled={diff.changes.length === 0 || diff.manual > 0}
          >
            Apply in transaction
          </button>
          <button
            type="button"
            className="modal-secondary"
            onClick={onOpenHistory}
          >
            History
          </button>
          <button
            type="button"
            className="modal-transaction"
            onClick={onOpenSql}
            disabled={diff.changes.length === 0}
          >
            Open SQL preview
          </button>
        </div>
      </dialog>
    </div>
  );
}

function MigrationHistoryDialog({
  entries,
  onClose,
  onClear,
  onOpen,
}: {
  entries: MigrationHistoryEntry[];
  onClose: () => void;
  onClear: () => void;
  onOpen: (
    entry: MigrationHistoryEntry,
    kind: "migration" | "rollback" | "privilege",
  ) => void;
}) {
  return (
    <div className="modal-backdrop" role="presentation">
      <dialog
        open
        className="schema-diff-modal migration-history-modal"
        aria-modal="true"
        aria-labelledby="migration-history-title"
      >
        <div className="edit-preview-heading">
          <div>
            <p className="modal-kicker">SCHEMA WORKFLOW · LOCAL LEDGER</p>
            <h2 id="migration-history-title">Migration history</h2>
          </div>
          <button
            type="button"
            className="mini-button"
            aria-label="Close migration history"
            onClick={onClose}
          >
            ×
          </button>
        </div>
        <p className="modal-copy">
          QueryX stores generated previews locally without passwords. A green
          Applied status means QueryX completed every executable statement in
          its transaction; Preview means the SQL still needs review or was not
          run by QueryX.
        </p>
        {entries.length === 0 ? (
          <div className="schema-diff-empty">
            No migration previews have been opened yet.
          </div>
        ) : (
          <div
            className="schema-diff-list"
            aria-label="Migration history entries"
          >
            {entries.map((entry) => (
              <div className="migration-history-row" key={entry.id}>
                <div className="migration-history-copy">
                  <strong>
                    {entry.baselineLabel} → {entry.targetLabel}
                  </strong>
                  <small>
                    <span className={`migration-status ${entry.status}`}>
                      {entry.status === "applied" ? "Applied" : "Preview"}
                    </span>{" "}
                    {driverDisplayName(entry.driver)} ·{" "}
                    {new Date(entry.createdAt).toLocaleString()} ·{" "}
                    {entry.changeCount} changes · {entry.manual} manual
                    {entry.appliedAt
                      ? ` · applied ${new Date(entry.appliedAt).toLocaleString()}`
                      : ""}
                  </small>
                </div>
                <div className="migration-history-actions">
                  <button
                    type="button"
                    className="mini-button"
                    onClick={() => onOpen(entry, "migration")}
                  >
                    Forward
                  </button>
                  <button
                    type="button"
                    className="mini-button"
                    onClick={() => onOpen(entry, "rollback")}
                  >
                    Rollback
                  </button>
                  <button
                    type="button"
                    className="mini-button"
                    onClick={() => onOpen(entry, "privilege")}
                  >
                    Privileges
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
        <div className="modal-actions">
          <button type="button" className="modal-secondary" onClick={onClear}>
            Clear history
          </button>
          <button type="button" className="modal-transaction" onClick={onClose}>
            Close
          </button>
        </div>
      </dialog>
    </div>
  );
}

function DataCompareDialog({
  comparison,
  targetLabel,
  targetReadOnly,
  onClose,
  onChooseTarget,
  onOpenSql,
  onApply,
}: {
  comparison: DataCompareResult;
  targetLabel: string;
  targetReadOnly: boolean;
  onClose: () => void;
  onChooseTarget: () => void;
  onOpenSql: (selectedIds: string[]) => void;
  onApply: (selectedIds: string[]) => void;
}) {
  const [selectedIds, setSelectedIds] = useState(() =>
    comparison.changes.map((change) => change.id),
  );
  useEffect(() => {
    setSelectedIds(comparison.changes.map((change) => change.id));
  }, [comparison]);
  const selectedCount = selectedIds.length;
  const allSelected = selectedCount === comparison.changes.length;
  const toggle = (id: string) => {
    setSelectedIds((current) =>
      current.includes(id)
        ? current.filter((item) => item !== id)
        : [...current, id],
    );
  };
  const selectAll = () => {
    setSelectedIds(
      allSelected ? [] : comparison.changes.map((change) => change.id),
    );
  };
  return (
    <div className="modal-backdrop" role="presentation">
      <dialog
        open
        className="schema-diff-modal"
        aria-modal="true"
        aria-labelledby="data-compare-title"
      >
        <div className="edit-preview-heading">
          <div>
            <p className="modal-kicker">DATA COMPARE · CONTROLLED SYNC</p>
            <h2 id="data-compare-title">
              {comparison.schema}.{comparison.table}
            </h2>
          </div>
          <button
            type="button"
            className="mini-button"
            aria-label="Close data comparison"
            onClick={onClose}
          >
            ×
          </button>
        </div>
        <p className="modal-copy">
          Source is the active connection. Target is{" "}
          <strong>{targetLabel}</strong>. Only primary-key matched rows are
          synchronized; updates and deletes include the captured target values
          to detect concurrent changes.
        </p>
        <div
          className="schema-diff-summary"
          aria-label="Data comparison summary"
        >
          <span>{comparison.sourceCount} source rows</span>
          <span>{comparison.targetCount} target rows</span>
          <span>{comparison.matchedCount} matched</span>
          <span>{comparison.changes.length} changes</span>
        </div>
        {comparison.errors.length > 0 && (
          <div className="connection-error" role="alert">
            {comparison.errors.map((error) => (
              <div key={error}>{error}</div>
            ))}
          </div>
        )}
        {comparison.changes.length === 0 ? (
          <div className="schema-diff-empty">Source and target data match.</div>
        ) : (
          <>
            <div className="modal-actions">
              <button type="button" className="mini-button" onClick={selectAll}>
                {allSelected ? "Clear selection" : "Select all"}
              </button>
              <span className="modal-copy">{selectedCount} selected</span>
            </div>
            <div className="schema-diff-list" aria-label="Data changes">
              {comparison.changes.map((change) => (
                <label className="schema-diff-row" key={change.id}>
                  <input
                    type="checkbox"
                    checked={selectedIds.includes(change.id)}
                    onChange={() => toggle(change.id)}
                  />
                  <span
                    className={`schema-diff-kind ${change.destructive ? "destructive" : "additive"}`}
                  >
                    {change.kind.toUpperCase()}
                  </span>
                  <span>
                    <strong>{change.label}</strong>
                    <small>
                      {change.changedColumns.length > 0
                        ? change.changedColumns.join(", ")
                        : "Primary key"}
                    </small>
                  </span>
                </label>
              ))}
            </div>
          </>
        )}
        {targetReadOnly && (
          <p className="connection-error">
            The selected target profile is read-only. SQL preview is available,
            but Apply is disabled.
          </p>
        )}
        <div className="modal-actions">
          <button type="button" className="modal-secondary" onClick={onClose}>
            Close
          </button>
          <button
            type="button"
            className="modal-secondary"
            onClick={onChooseTarget}
          >
            Choose target
          </button>
          <button
            type="button"
            className="modal-secondary"
            onClick={() => onOpenSql(selectedIds)}
            disabled={selectedCount === 0 || comparison.errors.length > 0}
          >
            Open SQL preview
          </button>
          <button
            type="button"
            className="modal-transaction"
            onClick={() => onApply(selectedIds)}
            disabled={
              selectedCount === 0 ||
              targetReadOnly ||
              comparison.errors.length > 0
            }
          >
            Apply selected
          </button>
        </div>
      </dialog>
    </div>
  );
}

function DataCompareTargetDialog({
  profiles,
  driverKind,
  onClose,
  onCompare,
  onLoadPassword,
}: {
  profiles: ConnectionProfile[];
  driverKind: DriverKind;
  onClose: () => void;
  onCompare: (config: DriverConfig, label: string) => Promise<string | null>;
  onLoadPassword: (profileId: string) => Promise<string | null>;
}) {
  const candidates = profiles.filter((profile) => profile.kind === driverKind);
  const [selectedId, setSelectedId] = useState(candidates[0]?.id ?? "");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const selected = candidates.find((profile) => profile.id === selectedId);

  const handleCompare = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selected) {
      setError("Save another connection profile for the same driver first");
      return;
    }
    let sessionPassword = password || undefined;
    if (!sessionPassword && selected.passwordStored) {
      sessionPassword = (await onLoadPassword(selected.id)) || undefined;
    }
    const config: DriverConfig = {
      kind: selected.kind,
      name: selected.name,
      database: selected.database,
      readOnly: selected.readOnly,
      host: selected.host,
      port: selected.port,
      username: selected.username,
      password: sessionPassword,
      sslMode: selected.sslMode,
      sslRootCert: selected.sslRootCert,
      sslClientCert: selected.sslClientCert,
      sslClientKey: selected.sslClientKey,
      sshTunnel: selected.sshTunnel,
    };
    setLoading(true);
    setError(null);
    const nextError = await onCompare(config, selected.name);
    setLoading(false);
    if (nextError) setError(nextError);
  };

  return (
    <div className="modal-backdrop" role="presentation">
      <dialog
        open
        className="schema-target-modal"
        aria-modal="true"
        aria-labelledby="data-compare-target-title"
      >
        <div className="edit-preview-heading">
          <div>
            <p className="modal-kicker">DATA COMPARE · TARGET</p>
            <h2 id="data-compare-target-title">
              Choose a {driverDisplayName(driverKind)} target
            </h2>
          </div>
          <button
            type="button"
            className="mini-button"
            aria-label="Close data compare target"
            onClick={onClose}
          >
            ×
          </button>
        </div>
        {candidates.length === 0 ? (
          <p className="schema-diff-empty">
            Save another {driverDisplayName(driverKind)} profile first.
          </p>
        ) : (
          <form onSubmit={handleCompare}>
            <label className="schema-target-field">
              <span>Saved target connection</span>
              <select
                value={selectedId}
                onChange={(event) => setSelectedId(event.target.value)}
              >
                {candidates.map((profile) => (
                  <option value={profile.id} key={profile.id}>
                    {profile.name} · {profile.database}
                    {profile.readOnly ? " · read-only" : ""}
                  </option>
                ))}
              </select>
            </label>
            {selected?.kind !== "sqlite" && (
              <label className="schema-target-field">
                <span>Password for this session</span>
                <input
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  autoComplete="current-password"
                  placeholder={
                    selected?.passwordStored ? "Keychain or enter" : "Optional"
                  }
                />
              </label>
            )}
            <p className="modal-copy">
              QueryX opens a temporary read-only connection and loads at most
              {` ${dataCompareMaxRows.toLocaleString()} `}rows. No target write
              happens during comparison.
            </p>
            {error && <p className="connection-error">{error}</p>}
            <div className="modal-actions">
              <button
                type="button"
                className="modal-secondary"
                onClick={onClose}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="modal-transaction"
                disabled={loading}
              >
                {loading ? "Comparing…" : "Compare data"}
              </button>
            </div>
          </form>
        )}
      </dialog>
    </div>
  );
}

function SchemaTargetDialog({
  profiles,
  driverKind,
  onClose,
  onCompare,
}: {
  profiles: ConnectionProfile[];
  driverKind: DriverKind;
  onClose: () => void;
  onCompare: (config: DriverConfig, label: string) => Promise<string | null>;
}) {
  const candidates = profiles.filter((profile) => profile.kind === driverKind);
  const [selectedId, setSelectedId] = useState(candidates[0]?.id ?? "");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const selected = candidates.find((profile) => profile.id === selectedId);

  const handleCompare = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selected) {
      setError(
        "Save a profile for the same driver before comparing connections",
      );
      return;
    }
    const config: DriverConfig =
      selected.kind === "sqlite"
        ? {
            kind: selected.kind,
            name: selected.name,
            database: selected.database,
            readOnly: true,
          }
        : {
            kind: selected.kind,
            name: selected.name,
            database: selected.database,
            readOnly: true,
            host: selected.host,
            port: selected.port,
            username: selected.username,
            password: password || undefined,
            sslMode: selected.sslMode,
            sslRootCert: selected.sslRootCert,
            sslClientCert: selected.sslClientCert,
            sslClientKey: selected.sslClientKey,
          };
    setLoading(true);
    setError(null);
    const nextError = await onCompare(config, selected.name);
    setLoading(false);
    if (nextError) setError(nextError);
  };

  return (
    <div className="modal-backdrop" role="presentation">
      <dialog
        open
        className="schema-target-modal"
        aria-modal="true"
        aria-labelledby="schema-target-title"
      >
        <div className="edit-preview-heading">
          <div>
            <p className="modal-kicker">CROSS-CONNECTION COMPARE</p>
            <h2 id="schema-target-title">
              Choose a {driverDisplayName(driverKind)} target
            </h2>
          </div>
          <button
            type="button"
            className="mini-button"
            aria-label="Close connection comparison"
            onClick={onClose}
          >
            ×
          </button>
        </div>
        {candidates.length === 0 ? (
          <p className="schema-diff-empty">
            Save another {driverDisplayName(driverKind)} profile first.
            Passwords are never stored in profiles.
          </p>
        ) : (
          <form onSubmit={handleCompare}>
            <label className="schema-target-field">
              <span>Saved connection</span>
              <select
                value={selectedId}
                onChange={(event) => setSelectedId(event.target.value)}
              >
                {candidates.map((profile) => (
                  <option value={profile.id} key={profile.id}>
                    {profile.name} · {profile.database}
                  </option>
                ))}
              </select>
            </label>
            {selected?.kind !== "sqlite" && (
              <label className="schema-target-field">
                <span>Password for this session</span>
                <input
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  autoComplete="current-password"
                  placeholder="Optional"
                />
              </label>
            )}
            <p className="modal-copy">
              QueryX opens a temporary read-only connection, reads metadata, and
              disconnects it. The active connection is not replaced.
            </p>
            {error && <p className="connection-error">{error}</p>}
            <div className="modal-actions">
              <button
                type="button"
                className="modal-secondary"
                onClick={onClose}
              >
                Cancel
              </button>
              <button
                type="submit"
                className="modal-transaction"
                disabled={loading}
              >
                {loading ? "Loading metadata…" : "Compare"}
              </button>
            </div>
          </form>
        )}
      </dialog>
    </div>
  );
}

function SafeModeDialog({
  report,
  onCancel,
  onRunInTransaction,
  onExecuteAnyway,
}: {
  report: QuerySafetyReport;
  onCancel: () => void;
  onRunInTransaction: () => void;
  onExecuteAnyway: () => void;
}) {
  return (
    <div className="modal-backdrop" role="presentation">
      <section
        className="safe-modal"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="safe-mode-title"
      >
        <div className="danger-icon">!</div>
        <div>
          <p className="modal-kicker">SAFE MODE</p>
          <h2 id="safe-mode-title">Dangerous query detected</h2>
          <p className="modal-copy">
            {report.operation} has no WHERE clause. {report.reason}. This could
            affect every matching row in the table.
          </p>
          <div className="safety-note">
            <strong>Impact estimate unavailable</strong>
            <span>
              QueryX does not execute a row count before this warning. Review
              the statement or run it inside a transaction.
            </span>
          </div>
          <div className="modal-actions">
            <button
              type="button"
              className="modal-secondary"
              onClick={onCancel}
            >
              Cancel
            </button>
            <button
              type="button"
              className="modal-transaction"
              onClick={onRunInTransaction}
            >
              Run in Transaction
            </button>
            <button
              type="button"
              className="modal-danger"
              onClick={onExecuteAnyway}
            >
              Execute Anyway
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}

function ConnectionDialog({
  error,
  isConnecting,
  profiles,
  profilesLoaded,
  canUseKeychain,
  onClose,
  onConnect,
  onDeleteProfile,
  onDuplicateProfile,
  onSaveProfile,
  onLoadPassword,
  onSavePassword,
  onDeletePassword,
  onTestConnection,
}: {
  error: string | null;
  isConnecting: boolean;
  profiles: ConnectionProfile[];
  profilesLoaded: boolean;
  canUseKeychain: boolean;
  onClose: () => void;
  onConnect: (config: DriverConfig) => Promise<boolean>;
  onDeleteProfile: (id: string) => Promise<void>;
  onDuplicateProfile: (id: string) => Promise<ConnectionProfile | null>;
  onSaveProfile: (draft: ConnectionProfileDraft) => Promise<ConnectionProfile>;
  onLoadPassword: (profileId: string) => Promise<string | null>;
  onSavePassword: (profileId: string, password: string) => Promise<boolean>;
  onDeletePassword: (profileId: string) => Promise<boolean>;
  onTestConnection: (
    config: DriverConfig,
  ) => Promise<{ ok: boolean; error?: string }>;
}) {
  const [kind, setKind] = useState<DriverKind>("postgres");
  const [name, setName] = useState("Local PostgreSQL");
  const [host, setHost] = useState("localhost");
  const [port, setPort] = useState("5432");
  const [database, setDatabase] = useState("postgres");
  const [username, setUsername] = useState("postgres");
  const [password, setPassword] = useState("");
  const [savePassword, setSavePassword] = useState(false);
  const [readOnly, setReadOnly] = useState(false);
  const [sslMode, setSslMode] = useState<
    "disable" | "prefer" | "require" | "verifyCa" | "verifyFull"
  >("prefer");
  const [sslRootCert, setSslRootCert] = useState("");
  const [sslClientCert, setSslClientCert] = useState("");
  const [sslClientKey, setSslClientKey] = useState("");
  const [sshTunnelEnabled, setSshTunnelEnabled] = useState(false);
  const [sshHost, setSshHost] = useState("");
  const [sshPort, setSshPort] = useState("22");
  const [sshUsername, setSshUsername] = useState("");
  const [sshLocalPort, setSshLocalPort] = useState("");
  const [sshPrivateKeyPath, setSshPrivateKeyPath] = useState("");
  const [sshKnownHostsPath, setSshKnownHostsPath] = useState("");
  const [activeProfileId, setActiveProfileId] = useState<string | null>(null);
  const [testStatus, setTestStatus] = useState<
    "idle" | "testing" | "success" | "error"
  >("idle");
  const [testError, setTestError] = useState<string | null>(null);

  const applyProfile = async (profile: ConnectionProfile) => {
    setActiveProfileId(profile.id);
    setKind(profile.kind);
    setName(profile.name);
    setHost(profile.host ?? "localhost");
    setPort(
      String(
        profile.port ??
          (profile.kind === "postgres"
            ? 5432
            : profile.kind === "mysql"
              ? 3306
              : profile.kind === "sqlserver"
                ? 1433
                : profile.kind === "oracle"
                  ? 1521
                  : ""),
      ),
    );
    setDatabase(profile.database);
    setReadOnly(profile.readOnly);
    setUsername(
      profile.username ??
        (profile.kind === "mysql"
          ? "root"
          : profile.kind === "sqlserver"
            ? "sa"
            : profile.kind === "oracle"
              ? "system"
              : "postgres"),
    );
    setSavePassword(canUseKeychain && profile.passwordStored === true);
    setPassword(
      canUseKeychain && profile.passwordStored
        ? ((await onLoadPassword(profile.id)) ?? "")
        : "",
    );
    setSslMode(profile.sslMode ?? "prefer");
    setSslRootCert(profile.sslRootCert ?? "");
    setSslClientCert(profile.sslClientCert ?? "");
    setSslClientKey(profile.sslClientKey ?? "");
    setSshTunnelEnabled(Boolean(profile.sshTunnel));
    setSshHost(profile.sshTunnel?.sshHost ?? "");
    setSshPort(String(profile.sshTunnel?.sshPort ?? 22));
    setSshUsername(profile.sshTunnel?.sshUsername ?? "");
    setSshLocalPort(
      profile.sshTunnel?.localPort ? String(profile.sshTunnel.localPort) : "",
    );
    setSshPrivateKeyPath(profile.sshTunnel?.privateKeyPath ?? "");
    setSshKnownHostsPath(profile.sshTunnel?.knownHostsPath ?? "");
    setTestStatus("idle");
    setTestError(null);
  };

  const startNewProfile = () => {
    setActiveProfileId(null);
    setKind("postgres");
    setName("New PostgreSQL");
    setHost("localhost");
    setPort("5432");
    setDatabase("postgres");
    setReadOnly(false);
    setUsername("postgres");
    setPassword("");
    setSavePassword(false);
    setSslMode("prefer");
    setSslRootCert("");
    setSslClientCert("");
    setSslClientKey("");
    setSshTunnelEnabled(false);
    setSshHost("");
    setSshPort("22");
    setSshUsername("");
    setSshLocalPort("");
    setSshPrivateKeyPath("");
    setSshKnownHostsPath("");
    setTestStatus("idle");
    setTestError(null);
  };

  const buildConfig = (): DriverConfig =>
    kind === "sqlite"
      ? { kind, name, database: database || ":memory:", readOnly }
      : {
          kind,
          name,
          database,
          readOnly,
          host,
          port: Number(port),
          username,
          password: password || undefined,
          sslMode,
          ...(sslRootCert.trim() ? { sslRootCert: sslRootCert.trim() } : {}),
          ...(sslClientCert.trim()
            ? { sslClientCert: sslClientCert.trim() }
            : {}),
          ...(sslClientKey.trim() ? { sslClientKey: sslClientKey.trim() } : {}),
          ...(sshTunnelEnabled
            ? {
                sshTunnel: {
                  sshHost: sshHost.trim(),
                  sshPort: Number(sshPort),
                  sshUsername: sshUsername.trim(),
                  ...(sshLocalPort.trim()
                    ? { localPort: Number(sshLocalPort) }
                    : {}),
                  ...(sshPrivateKeyPath.trim()
                    ? { privateKeyPath: sshPrivateKeyPath.trim() }
                    : {}),
                  ...(sshKnownHostsPath.trim()
                    ? { knownHostsPath: sshKnownHostsPath.trim() }
                    : {}),
                },
              }
            : {}),
        };

  const profileDraft = (): ConnectionProfileDraft => {
    const config = buildConfig();
    return {
      id: activeProfileId ?? undefined,
      kind: config.kind,
      name: config.name,
      database: config.database,
      readOnly: config.readOnly === true,
      ...(config.host ? { host: config.host } : {}),
      ...(config.port ? { port: config.port } : {}),
      ...(config.username ? { username: config.username } : {}),
      ...(config.sslMode ? { sslMode: config.sslMode } : {}),
      ...(config.sslRootCert ? { sslRootCert: config.sslRootCert } : {}),
      ...(config.sslClientCert ? { sslClientCert: config.sslClientCert } : {}),
      ...(config.sslClientKey ? { sslClientKey: config.sslClientKey } : {}),
      ...(config.sshTunnel ? { sshTunnel: config.sshTunnel } : {}),
    };
  };

  const handleSaveProfile = async () => {
    try {
      const saved = await onSaveProfile({
        ...profileDraft(),
        passwordStored: false,
      });
      if (canUseKeychain && savePassword && password) {
        await onSavePassword(saved.id, password);
        await onSaveProfile({
          ...saved,
          passwordStored: true,
        });
      } else if (canUseKeychain) {
        await onDeletePassword(saved.id);
      }
      setActiveProfileId(saved.id);
      setTestStatus("idle");
      setTestError(null);
    } catch (saveError) {
      setTestStatus("error");
      setTestError(
        saveError instanceof Error ? saveError.message : String(saveError),
      );
    }
  };

  const handleDeleteProfile = async (profile: ConnectionProfile) => {
    if (!window.confirm(`Delete saved profile “${profile.name}”?`)) return;
    await onDeleteProfile(profile.id);
    if (activeProfileId === profile.id) startNewProfile();
  };

  const handleDuplicateProfile = async (profile: ConnectionProfile) => {
    const duplicate = await onDuplicateProfile(profile.id);
    if (duplicate) await applyProfile(duplicate);
  };

  const handleTestConnection = async () => {
    setTestStatus("testing");
    setTestError(null);
    const result = await onTestConnection(buildConfig());
    setTestStatus(result.ok ? "success" : "error");
    setTestError(result.error ?? null);
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (await onConnect(buildConfig())) onClose();
  };

  return (
    <div className="modal-backdrop" role="presentation">
      <dialog
        open
        className="connection-modal"
        aria-modal="true"
        aria-labelledby="connection-title"
      >
        <div className="connection-modal-heading">
          <div>
            <p className="modal-kicker">LOCAL-FIRST CONNECTION</p>
            <h2 id="connection-title">Connect a database</h2>
          </div>
          <button
            type="button"
            className="mini-button"
            aria-label="Close connection dialog"
            onClick={onClose}
          >
            ×
          </button>
        </div>
        <form onSubmit={submit}>
          <div className="connection-manager">
            <aside
              className="profile-list"
              aria-label="Saved connection profiles"
            >
              <div className="profile-list-heading">
                <span>SAVED PROFILES</span>
                <button
                  type="button"
                  className="mini-button"
                  onClick={startNewProfile}
                >
                  ＋
                </button>
              </div>
              {!profilesLoaded ? (
                <p className="profile-empty">Loading profiles…</p>
              ) : profiles.length === 0 ? (
                <p className="profile-empty">No saved profiles yet.</p>
              ) : (
                profiles.map((profile) => (
                  <div className="profile-row" key={profile.id}>
                    <button
                      type="button"
                      className={`profile-select ${activeProfileId === profile.id ? "active" : ""}`}
                      onClick={() => void applyProfile(profile)}
                    >
                      <span className="profile-kind">
                        {driverShortName(profile.kind)}
                      </span>
                      <span>
                        <strong>{profile.name}</strong>
                        <small>{profile.database}</small>
                      </span>
                    </button>
                    <button
                      type="button"
                      className="profile-action"
                      aria-label={`Duplicate ${profile.name}`}
                      onClick={() => void handleDuplicateProfile(profile)}
                    >
                      ⧉
                    </button>
                    <button
                      type="button"
                      className="profile-action danger"
                      aria-label={`Delete ${profile.name}`}
                      onClick={() => void handleDeleteProfile(profile)}
                    >
                      ×
                    </button>
                  </div>
                ))
              )}
            </aside>
            <div className="connection-fields">
              <div className="connection-grid">
                <label>
                  <span>Driver</span>
                  <select
                    value={kind}
                    onChange={(event) => {
                      const nextKind = event.target.value as DriverKind;
                      setActiveProfileId(null);
                      setReadOnly(false);
                      setKind(nextKind);
                      setDatabase(
                        nextKind === "sqlite"
                          ? ":memory:"
                          : nextKind === "mysql"
                            ? "mysql"
                            : nextKind === "sqlserver"
                              ? "master"
                              : nextKind === "oracle"
                                ? "FREEPDB1"
                                : "postgres",
                      );
                      setPort(
                        nextKind === "sqlite"
                          ? ""
                          : nextKind === "mysql"
                            ? "3306"
                            : nextKind === "sqlserver"
                              ? "1433"
                              : nextKind === "oracle"
                                ? "1521"
                                : "5432",
                      );
                      setUsername(
                        nextKind === "mysql"
                          ? "root"
                          : nextKind === "sqlserver"
                            ? "sa"
                            : nextKind === "oracle"
                              ? "system"
                              : "postgres",
                      );
                      setSavePassword(false);
                      setSslMode("prefer");
                      setSslRootCert("");
                      setSslClientCert("");
                      setSslClientKey("");
                      setSshTunnelEnabled(false);
                      setSshHost("");
                      setSshPort("22");
                      setSshUsername("");
                      setSshLocalPort("");
                      setSshPrivateKeyPath("");
                      setSshKnownHostsPath("");
                      setName(
                        nextKind === "sqlite"
                          ? "Local SQLite"
                          : nextKind === "mysql"
                            ? "Local MySQL"
                            : nextKind === "sqlserver"
                              ? "Local SQL Server"
                              : nextKind === "oracle"
                                ? "Local Oracle"
                                : "Local PostgreSQL",
                      );
                    }}
                  >
                    <option value="postgres">PostgreSQL</option>
                    <option value="mysql">MySQL / MariaDB</option>
                    <option value="sqlserver">SQL Server</option>
                    <option value="oracle">Oracle</option>
                    <option value="sqlite">SQLite</option>
                  </select>
                </label>
                <label>
                  <span>Connection name</span>
                  <input
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    required
                  />
                </label>
                {kind !== "sqlite" && (
                  <>
                    <label>
                      <span>Host</span>
                      <input
                        value={host}
                        onChange={(event) => setHost(event.target.value)}
                        required
                      />
                    </label>
                    <label>
                      <span>Port</span>
                      <input
                        value={port}
                        onChange={(event) => setPort(event.target.value)}
                        inputMode="numeric"
                        required
                      />
                    </label>
                  </>
                )}
                <label className={kind === "sqlite" ? "full-field" : ""}>
                  <span>
                    {kind === "sqlite" ? "Database path" : "Database"}
                  </span>
                  <input
                    value={database}
                    onChange={(event) => setDatabase(event.target.value)}
                    required
                    placeholder={
                      kind === "sqlite"
                        ? "/path/to/database.sqlite"
                        : kind === "mysql"
                          ? "mysql"
                          : kind === "sqlserver"
                            ? "master"
                            : kind === "oracle"
                              ? "FREEPDB1"
                              : "postgres"
                    }
                  />
                </label>
                {kind !== "sqlite" && (
                  <>
                    <label>
                      <span>Username</span>
                      <input
                        value={username}
                        onChange={(event) => setUsername(event.target.value)}
                        autoComplete="username"
                        required
                      />
                    </label>
                    <label>
                      <span>Password</span>
                      <input
                        type="password"
                        value={password}
                        onChange={(event) => setPassword(event.target.value)}
                        autoComplete="current-password"
                        placeholder="Enter for this session"
                      />
                    </label>
                    <label className="connection-readonly">
                      <input
                        type="checkbox"
                        checked={savePassword}
                        disabled={!canUseKeychain}
                        onChange={(event) =>
                          setSavePassword(event.target.checked)
                        }
                      />
                      <span>
                        <strong>Store in OS keychain</strong>
                        <small>
                          {canUseKeychain
                            ? "Encrypted by the platform credential store; never written to profiles."
                            : "Available in the native desktop app only."}
                        </small>
                      </span>
                    </label>
                    <label>
                      <span>SSL mode</span>
                      <select
                        value={sslMode}
                        onChange={(event) =>
                          setSslMode(event.target.value as typeof sslMode)
                        }
                      >
                        <option value="prefer">Prefer</option>
                        <option value="require">Require</option>
                        <option value="verifyCa">Verify CA</option>
                        <option value="verifyFull">
                          Verify Full / Identity
                        </option>
                        <option value="disable">Disable</option>
                      </select>
                    </label>
                    <label>
                      <span>CA certificate path</span>
                      <input
                        value={sslRootCert}
                        onChange={(event) => setSslRootCert(event.target.value)}
                        placeholder="/path/to/ca.pem"
                        autoComplete="off"
                      />
                    </label>
                    <label>
                      <span>Client certificate path</span>
                      <input
                        value={sslClientCert}
                        onChange={(event) =>
                          setSslClientCert(event.target.value)
                        }
                        placeholder="/path/to/client.crt"
                        autoComplete="off"
                      />
                    </label>
                    <label>
                      <span>Client key path</span>
                      <input
                        value={sslClientKey}
                        onChange={(event) =>
                          setSslClientKey(event.target.value)
                        }
                        placeholder="/path/to/client.key"
                        autoComplete="off"
                      />
                    </label>
                    <label className="connection-readonly">
                      <input
                        type="checkbox"
                        checked={sshTunnelEnabled}
                        onChange={(event) =>
                          setSshTunnelEnabled(event.target.checked)
                        }
                      />
                      <span>
                        <strong>Connect through SSH tunnel</strong>
                        <small>
                          Uses the local OpenSSH client; passwords and
                          passphrases are never accepted or stored by QueryX.
                        </small>
                      </span>
                    </label>
                    {sshTunnelEnabled && (
                      <div className="connection-subgrid">
                        <label>
                          <span>SSH host</span>
                          <input
                            value={sshHost}
                            onChange={(event) => setSshHost(event.target.value)}
                            placeholder="bastion.example.com"
                            autoComplete="off"
                            required
                          />
                        </label>
                        <label>
                          <span>SSH port</span>
                          <input
                            type="number"
                            min="1"
                            max="65535"
                            value={sshPort}
                            onChange={(event) => setSshPort(event.target.value)}
                            required
                          />
                        </label>
                        <label>
                          <span>SSH username</span>
                          <input
                            value={sshUsername}
                            onChange={(event) =>
                              setSshUsername(event.target.value)
                            }
                            autoComplete="username"
                            required
                          />
                        </label>
                        <label>
                          <span>Local port (optional)</span>
                          <input
                            type="number"
                            min="1"
                            max="65535"
                            value={sshLocalPort}
                            onChange={(event) =>
                              setSshLocalPort(event.target.value)
                            }
                            placeholder="Auto-select"
                          />
                        </label>
                        <label>
                          <span>Private key path</span>
                          <input
                            value={sshPrivateKeyPath}
                            onChange={(event) =>
                              setSshPrivateKeyPath(event.target.value)
                            }
                            placeholder="~/.ssh/id_ed25519"
                            autoComplete="off"
                          />
                        </label>
                        <label>
                          <span>Known hosts path</span>
                          <input
                            value={sshKnownHostsPath}
                            onChange={(event) =>
                              setSshKnownHostsPath(event.target.value)
                            }
                            placeholder="~/.ssh/known_hosts"
                            autoComplete="off"
                          />
                        </label>
                      </div>
                    )}
                  </>
                )}
              </div>
              <label className="connection-readonly">
                <input
                  type="checkbox"
                  checked={readOnly}
                  onChange={(event) => setReadOnly(event.target.checked)}
                />
                <span>
                  <strong>Read-only session</strong>
                  <small>
                    Enforced by the database connection; writes are rejected
                    even if a query is sent outside this UI.
                  </small>
                </span>
              </label>
              {error && <p className="connection-error">{error}</p>}
              {testStatus === "success" && (
                <p className="connection-success">
                  Connection test passed. Metadata loaded successfully.
                </p>
              )}
              {testError && <p className="connection-error">{testError}</p>}
            </div>
          </div>
          <div className="credential-note">
            <span>⌑</span>
            <p>
              <strong>Credentials stay local</strong>
              <small>
                {savePassword && canUseKeychain
                  ? "The password is stored only in the OS keychain and is never written to QueryX storage."
                  : "The password is held in memory for this session and is never written to QueryX storage."}
              </small>
            </p>
          </div>
          <div className="modal-actions">
            <button
              type="button"
              className="modal-secondary"
              onClick={() => void handleTestConnection()}
              disabled={testStatus === "testing" || isConnecting}
            >
              {testStatus === "testing" ? "Testing…" : "Test connection"}
            </button>
            <button
              type="button"
              className="modal-secondary"
              onClick={() => void handleSaveProfile()}
              disabled={!profilesLoaded || isConnecting}
            >
              Save profile
            </button>
            <button type="button" className="modal-secondary" onClick={onClose}>
              Cancel
            </button>
            <button
              type="submit"
              className="connect-button"
              disabled={isConnecting}
            >
              {isConnecting ? "Connecting…" : "Connect"}
            </button>
          </div>
        </form>
      </dialog>
    </div>
  );
}

function Inspector({
  table,
  view,
  routine,
  trigger,
  eventTrigger,
  foreignKeys,
  dependencies,
  onClose,
  onSelectTable,
  onSelectTriggerRelation,
  onSelectDependency,
  onBrowseTable,
  onCopyDefinition,
  onEditDefinition,
}: {
  table?: TableMetadata;
  view?: ViewMetadata;
  routine?: RoutineMetadata;
  trigger?: TriggerMetadata;
  eventTrigger?: EventTriggerMetadata;
  foreignKeys?: ForeignKeyRelations;
  dependencies?: ObjectDependencies;
  onClose: () => void;
  onSelectTable: (relation: RelationRef) => void;
  onSelectTriggerRelation: (relation: TriggerMetadata["relation"]) => void;
  onSelectDependency: (object: DatabaseObjectRef) => void;
  onBrowseTable: () => void;
  onCopyDefinition: (definition: string) => void;
  onEditDefinition: (definition: string, label: string) => void;
}) {
  const relation = table ?? view;
  const [activeTab, setActiveTab] = useState<
    "columns" | "indexes" | "relations" | "dependencies"
  >("columns");
  const relationCount =
    (foreignKeys?.outgoing.length ?? 0) + (foreignKeys?.incoming.length ?? 0);
  const dependencyCount =
    (dependencies?.dependsOn.length ?? 0) + (dependencies?.usedBy.length ?? 0);

  if (eventTrigger) {
    const definition = eventTrigger.definition;
    return (
      <aside className="inspector">
        <InspectorPanelHeading readOnly onClose={onClose} />
        <div className="inspector-title trigger-title">
          <span className="table-symbol trigger-symbol">✦</span>
          <span>
            <strong title={eventTrigger.name}>{eventTrigger.name}</strong>
            <small>database scope · event trigger</small>
          </span>
        </div>
        <div className="inspector-section routine-details">
          <div className="section-title">EVENT TRIGGER DETAILS</div>
          <dl>
            <dt>Status</dt>
            <dd>
              <span className={`trigger-status ${eventTrigger.status}`}>
                {eventTrigger.status}
              </span>
            </dd>
            <dt>Event</dt>
            <dd>{eventTriggerEventLabel(eventTrigger.event)}</dd>
            <dt>Tags</dt>
            <dd title={eventTrigger.tags?.join(", ")}>
              {eventTrigger.tags?.join(", ") ?? "All supported commands"}
            </dd>
            <dt>Function</dt>
            <dd>
              <button
                type="button"
                className="relation-link"
                onClick={() => onSelectDependency(eventTrigger.function)}
              >
                {eventTrigger.function.schema}.
                {dependencyObjectLabel(eventTrigger.function)} ↗
              </button>
            </dd>
          </dl>
        </div>
        <DependencyPanel
          dependencies={dependencies}
          onSelectObject={onSelectDependency}
        />
        <div className="inspector-section routine-definition-section">
          <div className="section-title routine-definition-heading">
            CATALOG-RECONSTRUCTED DDL
            {definition && (
              <span className="ddl-actions">
                <button
                  type="button"
                  className="copy-ddl-button"
                  onClick={() => onCopyDefinition(definition)}
                >
                  Copy DDL
                </button>
                <button
                  type="button"
                  className="copy-ddl-button edit-ddl-button"
                  onClick={() =>
                    onEditDefinition(definition, eventTrigger.name)
                  }
                >
                  Edit in SQL
                </button>
              </span>
            )}
          </div>
          {definition ? (
            <code
              className="definition-preview routine-definition"
              aria-label={`${eventTrigger.name} read-only DDL`}
            >
              {definition}
            </code>
          ) : (
            <div className="inspector-empty">
              Definition is unavailable for this event trigger.
            </div>
          )}
          <p className="ddl-safety-note">
            Reconstructed from catalog values for inspection only. Edit in SQL
            opens a separate tab; QueryX never executes this text automatically.
          </p>
        </div>
      </aside>
    );
  }

  if (trigger) {
    const definition = trigger.definition;
    return (
      <aside className="inspector">
        <InspectorPanelHeading readOnly onClose={onClose} />
        <div className="inspector-title trigger-title">
          <span className="table-symbol trigger-symbol">⚡</span>
          <span>
            <strong title={trigger.name}>{trigger.name}</strong>
            <small>{trigger.schema} · trigger</small>
          </span>
        </div>
        <div className="inspector-section routine-details">
          <div className="section-title">TRIGGER DETAILS</div>
          <dl>
            <dt>Status</dt>
            <dd>
              <span className={`trigger-status ${trigger.status}`}>
                {trigger.status}
              </span>
            </dd>
            <dt>Timing</dt>
            <dd>{trigger.timing}</dd>
            <dt>Events</dt>
            <dd>{trigger.events.join(", ")}</dd>
            <dt>Orientation</dt>
            <dd>{trigger.orientation}</dd>
            <dt>Owner</dt>
            <dd>
              <button
                type="button"
                className="relation-link"
                onClick={() => onSelectTriggerRelation(trigger.relation)}
              >
                {trigger.relation.name} ↗
              </button>
            </dd>
            {trigger.updateColumns && (
              <>
                <dt>Update columns</dt>
                <dd title={trigger.updateColumns.join(", ")}>
                  {trigger.updateColumns.join(", ")}
                </dd>
              </>
            )}
          </dl>
        </div>
        <DependencyPanel
          dependencies={dependencies}
          onSelectObject={onSelectDependency}
        />
        {trigger.condition && (
          <div className="inspector-section">
            <div className="section-title">WHEN CONDITION</div>
            <code className="definition-preview trigger-condition">
              {trigger.condition}
            </code>
          </div>
        )}
        <div className="inspector-section routine-definition-section">
          <div className="section-title routine-definition-heading">
            DATABASE-RENDERED DDL
            {definition && (
              <span className="ddl-actions">
                <button
                  type="button"
                  className="copy-ddl-button"
                  onClick={() => onCopyDefinition(definition)}
                >
                  Copy DDL
                </button>
                <button
                  type="button"
                  className="copy-ddl-button edit-ddl-button"
                  onClick={() => onEditDefinition(definition, trigger.name)}
                >
                  Edit in SQL
                </button>
              </span>
            )}
          </div>
          {definition ? (
            <code
              className="definition-preview routine-definition"
              aria-label={`${trigger.name} read-only DDL`}
            >
              {definition}
            </code>
          ) : (
            <div className="inspector-empty">
              Definition is unavailable for this trigger.
            </div>
          )}
          <p className="ddl-safety-note">
            Displayed for inspection only. Edit in SQL opens a separate tab;
            QueryX never executes this text automatically.
          </p>
        </div>
      </aside>
    );
  }

  if (routine) {
    const signature = `${routine.name}(${routine.identityArguments})`;
    const definition = routine.definition;
    return (
      <aside className="inspector">
        <InspectorPanelHeading readOnly onClose={onClose} />
        <div className="inspector-title routine-title">
          <span className="table-symbol routine-symbol">ƒ</span>
          <span>
            <strong title={signature}>{signature}</strong>
            <small>
              {routine.schema} · {routineKindLabel(routine.kind)}
            </small>
          </span>
        </div>
        <div className="inspector-section routine-details">
          <div className="section-title">ROUTINE DETAILS</div>
          <dl>
            <dt>Schema</dt>
            <dd>{routine.schema}</dd>
            <dt>Kind</dt>
            <dd>{routineKindLabel(routine.kind)}</dd>
            <dt>Language</dt>
            <dd>{routine.language}</dd>
            <dt>Arguments</dt>
            <dd title={routine.identityArguments}>
              {routine.identityArguments || "None"}
            </dd>
            <dt>Returns</dt>
            <dd title={routine.returnType ?? undefined}>
              {routine.returnType ?? "None"}
            </dd>
            {routine.aggregate && (
              <>
                <dt>Aggregate mode</dt>
                <dd>{aggregateKindLabel(routine.aggregate.kind)}</dd>
                <dt>Direct arguments</dt>
                <dd>{routine.aggregate.directArgumentCount}</dd>
              </>
            )}
          </dl>
        </div>
        <DependencyPanel
          dependencies={dependencies}
          onSelectObject={onSelectDependency}
        />
        {definition ? (
          <div className="inspector-section routine-definition-section">
            <div className="section-title routine-definition-heading">
              DATABASE-RENDERED DDL
              <span className="ddl-actions">
                <button
                  type="button"
                  className="copy-ddl-button"
                  onClick={() => onCopyDefinition(definition)}
                >
                  Copy DDL
                </button>
                <button
                  type="button"
                  className="copy-ddl-button edit-ddl-button"
                  onClick={() => onEditDefinition(definition, signature)}
                >
                  Edit in SQL
                </button>
              </span>
            </div>
            <code
              className="definition-preview routine-definition"
              aria-label={`${signature} read-only DDL`}
            >
              {definition}
            </code>
            <p className="ddl-safety-note">
              Displayed for inspection only. Edit in SQL opens a separate tab;
              QueryX never executes this text automatically.
            </p>
          </div>
        ) : (
          <div className="inspector-section routine-definition-section">
            <div className="section-title">CATALOG METADATA</div>
            <div className="inspector-empty">
              PostgreSQL does not expose executable DDL for this catalog{" "}
              {routineKindLabel(routine.kind)}. QueryX keeps this object
              inspection-only.
            </div>
          </div>
        )}
      </aside>
    );
  }

  return (
    <aside className="inspector">
      <InspectorPanelHeading onClose={onClose} />
      {relation && (
        <>
          <div className="inspector-title">
            <span className="table-symbol">{table ? "▤" : "◫"}</span>
            <span>
              <strong>{relation.name}</strong>
              <small>
                {relation.schema} · {table ? "table" : "view"}
              </small>
            </span>
            {table && (
              <button
                type="button"
                className="inspector-action"
                onClick={onBrowseTable}
                title="Open the first 100 rows in a new query tab"
              >
                Browse data
              </button>
            )}
          </div>
          <div className="inspector-tabs">
            <button
              type="button"
              className={activeTab === "columns" ? "active" : ""}
              onClick={() => setActiveTab("columns")}
            >
              Columns <span>{relation.columns.length}</span>
            </button>
            {table && (
              <>
                <button
                  type="button"
                  className={activeTab === "indexes" ? "active" : ""}
                  onClick={() => setActiveTab("indexes")}
                >
                  Indexes <span>{table.indexes.length}</span>
                </button>
                <button
                  type="button"
                  className={activeTab === "relations" ? "active" : ""}
                  onClick={() => setActiveTab("relations")}
                >
                  Relations <span>{relationCount}</span>
                </button>
              </>
            )}
            <button
              type="button"
              className={activeTab === "dependencies" ? "active" : ""}
              onClick={() => setActiveTab("dependencies")}
            >
              Dependencies <span>{dependencyCount}</span>
            </button>
          </div>
          {activeTab === "columns" ? (
            <div className="column-list">
              {relation.columns.map((column) => (
                <div className="column-row" key={column.name}>
                  <span
                    className={
                      column.primaryKey ? "key-symbol" : "key-symbol empty"
                    }
                  >
                    {column.primaryKey ? "⌁" : "•"}
                  </span>
                  <span>
                    <strong>{column.name}</strong>
                    <small>{column.type}</small>
                  </span>
                  {column.primaryKey && <b className="pk">PK</b>}
                </div>
              ))}
            </div>
          ) : activeTab === "indexes" ? (
            <div className="column-list">
              {table?.indexes.map((index) => (
                <div className="column-row index-row" key={index.name}>
                  <span className="key-symbol">⌁</span>
                  <span>
                    <strong>{index.name}</strong>
                    <small>
                      {index.columns.join(", ")} · {index.type}
                    </small>
                  </span>
                  <span className="index-badges">
                    {index.primary && <b className="pk">PK</b>}
                    {index.unique && !index.primary && (
                      <b className="unique-badge">UQ</b>
                    )}
                  </span>
                </div>
              ))}
              {table?.indexes.length === 0 && (
                <div className="inspector-empty">No indexes reported</div>
              )}
            </div>
          ) : activeTab === "dependencies" ? (
            <DependencyPanel
              dependencies={dependencies}
              onSelectObject={onSelectDependency}
            />
          ) : (
            <div className="relation-list">
              <div className="relation-group-title">
                Outgoing <span>{foreignKeys?.outgoing.length ?? 0}</span>
              </div>
              {foreignKeys?.outgoing.map((foreignKey) => (
                <button
                  type="button"
                  className="relation-row"
                  key={foreignKey.id}
                  onClick={() => onSelectTable(foreignKey.referencedRelation)}
                >
                  <span className="relation-arrow">→</span>
                  <span>
                    <strong>{foreignKey.name ?? "Unnamed foreign key"}</strong>
                    <small>
                      {foreignKey.columns
                        .map((column) => column.sourceColumn)
                        .join(", ")}{" "}
                      → {foreignKey.referencedRelation.schema}.
                      {foreignKey.referencedRelation.name} (
                      {foreignKey.columns
                        .map(
                          (column) => column.referencedColumn ?? "primary key",
                        )
                        .join(", ")}
                      )
                    </small>
                    <em>
                      ON UPDATE {foreignKey.onUpdate} · ON DELETE{" "}
                      {foreignKey.onDelete}
                    </em>
                  </span>
                </button>
              ))}
              {foreignKeys?.outgoing.length === 0 && (
                <div className="inspector-empty">No outgoing foreign keys</div>
              )}
              <div className="relation-group-title">
                Incoming <span>{foreignKeys?.incoming.length ?? 0}</span>
              </div>
              {foreignKeys?.incoming.map(({ sourceRelation, foreignKey }) => (
                <button
                  type="button"
                  className="relation-row incoming"
                  key={`${sourceRelation.schema}.${sourceRelation.name}:${foreignKey.id}`}
                  onClick={() => onSelectTable(sourceRelation)}
                >
                  <span className="relation-arrow">←</span>
                  <span>
                    <strong>{foreignKey.name ?? "Unnamed foreign key"}</strong>
                    <small>
                      {sourceRelation.schema}.{sourceRelation.name} (
                      {foreignKey.columns
                        .map((column) => column.sourceColumn)
                        .join(", ")}
                      ) →{" "}
                      {foreignKey.columns
                        .map(
                          (column) => column.referencedColumn ?? "primary key",
                        )
                        .join(", ")}
                    </small>
                  </span>
                </button>
              ))}
              {foreignKeys?.incoming.length === 0 && (
                <div className="inspector-empty">No incoming foreign keys</div>
              )}
              {foreignKeys?.completeness === "partial" && (
                <div className="relation-notice">
                  Incoming relationships may be incomplete for unloaded tables.
                </div>
              )}
            </div>
          )}
          <div className="inspector-section">
            <div className="section-title">
              {table ? "TABLE" : "VIEW"} DETAILS <span>⌃</span>
            </div>
            <dl>
              {table && (
                <>
                  <dt>Estimated rows</dt>
                  <dd>{table.rowCount.toLocaleString()}</dd>
                </>
              )}
              <dt>Schema</dt>
              <dd>{relation.schema}</dd>
              <dt>Columns</dt>
              <dd>{relation.columns.length}</dd>
              {table && (
                <>
                  <dt>Indexes</dt>
                  <dd>{table.indexes.length}</dd>
                  <dt>Relations</dt>
                  <dd>{relationCount}</dd>
                  <dt>Primary key</dt>
                  <dd>
                    {table.columns.filter((column) => column.primaryKey).length}
                  </dd>
                </>
              )}
            </dl>
          </div>
          {view?.definition && (
            <div className="inspector-section">
              <div className="section-title">VIEW DEFINITION</div>
              <code className="definition-preview">{view.definition}</code>
            </div>
          )}
        </>
      )}
    </aside>
  );
}

function InspectorPanelHeading({
  readOnly = false,
  onClose,
}: {
  readOnly?: boolean;
  onClose: () => void;
}) {
  return (
    <div className="panel-heading">
      INSPECTOR
      {readOnly && <span className="read-only-badge">READ ONLY</span>}
      <button
        type="button"
        className="mini-button"
        aria-label="Close inspector"
        title="Close inspector"
        onClick={onClose}
      >
        ×
      </button>
    </div>
  );
}

const dependencyKindLabels: Record<DependencyKind, string> = {
  foreignKey: "Foreign key",
  viewReference: "View reference",
  triggerFunction: "Trigger function",
  triggerOwner: "Trigger owner",
  eventTriggerFunction: "Event trigger function",
};

function eventTriggerEventLabel(event: EventTriggerMetadata["event"]): string {
  const labels: Record<EventTriggerMetadata["event"], string> = {
    ddlCommandStart: "DDL command start",
    ddlCommandEnd: "DDL command end",
    sqlDrop: "SQL drop",
    tableRewrite: "Table rewrite",
    unknown: "Unknown",
  };
  return labels[event];
}

function routineKindLabel(kind: RoutineMetadata["kind"]): string {
  const labels: Record<RoutineMetadata["kind"], string> = {
    function: "function",
    procedure: "procedure",
    aggregate: "aggregate",
    window: "window function",
  };
  return labels[kind];
}

function routineKindShortLabel(kind: RoutineMetadata["kind"]): string {
  const labels: Record<RoutineMetadata["kind"], string> = {
    function: "fn",
    procedure: "proc",
    aggregate: "agg",
    window: "win",
  };
  return labels[kind];
}

function aggregateKindLabel(
  kind: NonNullable<RoutineMetadata["aggregate"]>["kind"],
): string {
  const labels: Record<
    NonNullable<RoutineMetadata["aggregate"]>["kind"],
    string
  > = {
    normal: "normal",
    orderedSet: "ordered-set",
    hypotheticalSet: "hypothetical-set",
    unknown: "unknown",
  };
  return labels[kind];
}

function databaseObjectQualifiedName(object: DatabaseObjectRef): string {
  return object.schema ? `${object.schema}.${object.name}` : object.name;
}

function dependencyObjectLabel(object: DatabaseObjectRef): string {
  if (object.kind === "routine") {
    return `${object.name}(${object.identityArguments ?? ""})`;
  }
  return object.name;
}

function dependencyObjectScope(object: DatabaseObjectRef): string {
  return object.schema ?? "database scope";
}

function dependencyObjectKindLabel(object: DatabaseObjectRef): string {
  return object.kind === "eventTrigger" ? "event trigger" : object.kind;
}

function DependencyPanel({
  dependencies,
  onSelectObject,
}: {
  dependencies?: ObjectDependencies;
  onSelectObject: (object: DatabaseObjectRef) => void;
}) {
  const dependsOn = dependencies?.dependsOn ?? [];
  const usedBy = dependencies?.usedBy ?? [];
  return (
    <div className="relation-list dependency-list">
      <div className="relation-group-title">
        Depends on <span>{dependsOn.length}</span>
      </div>
      {dependsOn.map((dependency) => (
        <button
          type="button"
          className="relation-row dependency-row"
          key={dependency.id}
          onClick={() => onSelectObject(dependency.referenced)}
          aria-label={`Open ${dependencyObjectKindLabel(dependency.referenced)} ${databaseObjectQualifiedName(dependency.referenced)}`}
        >
          <span className="relation-arrow">→</span>
          <span>
            <strong>{dependencyObjectLabel(dependency.referenced)}</strong>
            <small>
              {dependencyObjectScope(dependency.referenced)} ·{" "}
              {dependencyObjectKindLabel(dependency.referenced)}
            </small>
            <em>{dependencyKindLabels[dependency.kind]}</em>
          </span>
        </button>
      ))}
      {dependsOn.length === 0 && (
        <div className="inspector-empty">No dependencies reported</div>
      )}
      <div className="relation-group-title">
        Used by <span>{usedBy.length}</span>
      </div>
      {usedBy.map((dependency) => (
        <button
          type="button"
          className="relation-row dependency-row incoming"
          key={dependency.id}
          onClick={() => onSelectObject(dependency.dependent)}
          aria-label={`Open ${dependencyObjectKindLabel(dependency.dependent)} ${databaseObjectQualifiedName(dependency.dependent)}`}
        >
          <span className="relation-arrow">←</span>
          <span>
            <strong>{dependencyObjectLabel(dependency.dependent)}</strong>
            <small>
              {dependencyObjectScope(dependency.dependent)} ·{" "}
              {dependencyObjectKindLabel(dependency.dependent)}
            </small>
            <em>{dependencyKindLabels[dependency.kind]}</em>
          </span>
        </button>
      ))}
      {usedBy.length === 0 && (
        <div className="inspector-empty">No dependents reported</div>
      )}
    </div>
  );
}

export { App };
