import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import { isTauri } from "@tauri-apps/api/core";
import { relaunch } from "@tauri-apps/plugin-process";
import { check } from "@tauri-apps/plugin-updater";
import {
  buildDependencyIndex,
  buildForeignKeyIndex,
  buildExplainQuery,
  formatSql,
  inspectQuerySafety,
  serializeRowsToCsv,
  serializeRowsToTsv,
} from "@queryx/core";
import type {
  ForeignKeyRelations,
  ObjectDependencies,
  QuerySafetyReport,
} from "@queryx/core";
import type {
  DatabaseObjectRef,
  DependencyKind,
  DriverConfig,
  DriverKind,
  EventTriggerMetadata,
  RelationRef,
  RoutineMetadata,
  TableMetadata,
  TriggerMetadata,
  ViewMetadata,
} from "@queryx/shared";
import type { SqlCompletion, SqlEditorHandle } from "./SqlEditor";
import { saveCsvFile } from "./exportCsv";
import { useQueryStore, type RunMode } from "./store";

const MonacoSqlEditor = lazy(async () => {
  const module = await import("./SqlEditor");
  return { default: module.SqlEditor };
});

const resultRowKeys = new WeakMap<Record<string, unknown>, string>();
let nextResultRowKey = 0;
const resultPageSize = 100;

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
    workspaceRestored,
    driverKind,
    connectionName,
    connectionStatus,
    connectionError,
    setSql,
    newQuery,
    selectQuery,
    closeQuery,
    setFilter,
    setResultView,
    setSelectedObject,
    runQuery,
    cancelQuery,
    loadMetadata,
    connectDatabase,
    notify,
    clearHistory,
    toggleFavorite,
  } = useQueryStore();
  const [collapsed, setCollapsed] = useState<string[]>([]);
  const [sortBy, setSortBy] = useState<string | null>(null);
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");
  const [resultPage, setResultPage] = useState(0);
  const [nullDisplay, setNullDisplay] = useState<"literal" | "empty">(
    "literal",
  );
  const [gridSelection, setGridSelection] = useState<GridSelection | null>(
    null,
  );
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
  const [connectionOpen, setConnectionOpen] = useState(false);
  const [cursor, setCursor] = useState({ line: 1, column: 1, selected: 0 });
  const initialized = useRef(false);
  const editorRef = useRef<SqlEditorHandle>(null);
  const activeFavorite = favorites.find(
    (favorite) => favorite.sql === sql.trim(),
  );
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
    void loadMetadata();
    if (!workspaceRestored) void runQuery();
  }, [loadMetadata, runQuery, workspaceRestored]);
  const handleRun = (mode: RunMode = "normal", sqlOverride?: string) => {
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
    void runQuery(mode, executableSql);
  };
  const handleExplain = () => {
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
  useEffect(() => {
    setResultPage((page) => Math.min(page, resultPageCount - 1));
  }, [resultPageCount]);
  useEffect(() => {
    if (executionStatus !== "idle") {
      setResultPage(0);
      setGridSelection(null);
    }
  }, [executionStatus]);
  const updateFilter = (value: string) => {
    setGridSelection(null);
    setResultPage(0);
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

  const exportResults = async () => {
    if (!result || result.columns.length === 0) {
      notify("Run a query with tabular results before exporting");
      return;
    }
    const timestamp = new Date()
      .toISOString()
      .replaceAll(":", "-")
      .slice(0, 19);
    try {
      const outcome = await saveCsvFile(
        serializeRowsToCsv(result.columns, filteredRows),
        `queryx-results-${timestamp}.csv`,
      );
      if (outcome === "saved")
        notify(`Exported ${filteredRows.length.toLocaleString()} rows locally`);
    } catch (error) {
      notify(
        `CSV export failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  };

  const buildGridClipboard = (
    selection: GridSelection | null,
    includeHeaders: boolean,
  ): string | null => {
    if (!result || result.columns.length === 0) return null;
    if (!selection) {
      return serializeRowsToTsv(result.columns, visibleRows, {
        includeHeaders,
        nullValue: nullDisplay === "literal" ? "NULL" : "",
      });
    }
    if (selection.kind === "rows") {
      const [startRow, endRow] = rangeBounds(selection.anchor, selection.focus);
      return serializeRowsToTsv(
        result.columns,
        visibleRows.slice(startRow, endRow + 1),
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
      visibleRows.slice(startRow, endRow + 1),
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
      id: "transaction",
      label: "Run in transaction",
      hint: "rollback on error",
      disabled: isRunning,
      execute: () => handleRun("transaction"),
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
            <span className="driver-tag">
              {driverKind === "sqlite" ? "SQLite" : "PG"}
            </span>
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
              <span>{driverKind === "sqlite" ? "SQLite" : "PostgreSQL"}</span>
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
                  onClick={() => void exportResults()}
                  disabled={!result || result.columns.length === 0}
                  title="Export all filtered and sorted rows"
                >
                  ⇩ Export
                </button>
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
              </span>
              <label className="filter-box">
                ⌕
                <input
                  id="result-filter"
                  value={filter}
                  onChange={(event) => updateFilter(event.target.value)}
                  placeholder="Filter results..."
                />
                <kbd>⌘F</kbd>
              </label>
            </div>
            {resultView === "table" ? (
              <div
                className="grid-wrap"
                aria-label="Query result grid. Click cells or row numbers, then use Shift-click or Command/Ctrl+C to copy a range."
              >
                <table onCopy={handleGridCopy}>
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
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {visibleRows.map((row, rowIndex) => (
                      <tr key={resultRowKey(row)}>
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
                            className={`${row[column.name] === null ? "null-value" : ""} ${isCellInSelection(gridSelection, rowIndex, columnIndex) ? "selected" : ""}`}
                          >
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
                              onKeyDown={handleGridKeyDown}
                              title="Select cell; Shift-click to extend"
                            >
                              {formatCellValue(
                                row[column.name],
                                nullDisplay === "literal",
                              )}
                            </button>
                          </td>
                        ))}
                      </tr>
                    ))}
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
                    {resultPage * resultPageSize + 1}–
                    {resultPage * resultPageSize + visibleRows.length}
                  </strong>{" "}
                  of <strong>{filteredRows.length}</strong> rows
                </>
              )}
              {filter && <span> matching “{filter}”</span>}
              <span className="footer-spacer" />
              {resultPageCount > 1 && (
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
              Result data stays on this device
            </div>
          </section>
          <div className="statusbar">
            <span>
              <span
                className={`status-dot ${connectionStatus === "connected" ? "green" : "orange"}`}
              />{" "}
              {connectionName}
            </span>
            <span>
              {driverKind === "sqlite"
                ? "SQLite · Rust native"
                : "PostgreSQL · Rust native"}
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
      {connectionOpen && (
        <ConnectionDialog
          error={connectionError}
          isConnecting={connectionStatus === "connecting"}
          onClose={() => setConnectionOpen(false)}
          onConnect={connectDatabase}
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
  onClose,
  onConnect,
}: {
  error: string | null;
  isConnecting: boolean;
  onClose: () => void;
  onConnect: (config: DriverConfig) => Promise<boolean>;
}) {
  const [kind, setKind] = useState<DriverKind>("postgres");
  const [name, setName] = useState("Local PostgreSQL");
  const [host, setHost] = useState("localhost");
  const [port, setPort] = useState("5432");
  const [database, setDatabase] = useState("postgres");
  const [username, setUsername] = useState("postgres");
  const [password, setPassword] = useState("");
  const [sslMode, setSslMode] = useState<"disable" | "prefer" | "require">(
    "prefer",
  );

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const config: DriverConfig =
      kind === "sqlite"
        ? { kind, name, database: database || ":memory:" }
        : {
            kind,
            name,
            database,
            host,
            port: Number(port),
            username,
            password: password || undefined,
            sslMode,
          };
    if (await onConnect(config)) onClose();
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
          <div className="connection-grid">
            <label>
              <span>Driver</span>
              <select
                value={kind}
                onChange={(event) => {
                  const nextKind = event.target.value as DriverKind;
                  setKind(nextKind);
                  setDatabase(nextKind === "sqlite" ? ":memory:" : "postgres");
                  setName(
                    nextKind === "sqlite" ? "Local SQLite" : "Local PostgreSQL",
                  );
                }}
              >
                <option value="postgres">PostgreSQL</option>
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
            {kind === "postgres" && (
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
              <span>{kind === "sqlite" ? "Database path" : "Database"}</span>
              <input
                value={database}
                onChange={(event) => setDatabase(event.target.value)}
                required
                placeholder={
                  kind === "sqlite" ? "/path/to/database.sqlite" : "postgres"
                }
              />
            </label>
            {kind === "postgres" && (
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
                  />
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
                    <option value="disable">Disable</option>
                  </select>
                </label>
              </>
            )}
          </div>
          {error && <p className="connection-error">{error}</p>}
          <div className="credential-note">
            <span>⌑</span>
            <p>
              <strong>Credentials stay local</strong>
              <small>
                The password is held in memory for this session and is never
                written to QueryX storage.
              </small>
            </p>
          </div>
          <div className="modal-actions">
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
