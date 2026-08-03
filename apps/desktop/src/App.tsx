import {
  lazy,
  Suspense,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import {
  buildForeignKeyIndex,
  inspectQuerySafety,
  serializeRowsToCsv,
} from "@queryx/core";
import type { ForeignKeyRelations, QuerySafetyReport } from "@queryx/core";
import type {
  DriverConfig,
  DriverKind,
  RelationRef,
  TableMetadata,
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

function resultRowKey(row: Record<string, unknown>): string {
  const existing = resultRowKeys.get(row);
  if (existing) return existing;
  const key = `query-result-row-${nextResultRowKey++}`;
  resultRowKeys.set(row, key);
  return key;
}

function Icon({ children }: { children: string }) {
  return (
    <span className="icon" aria-hidden="true">
      {children}
    </span>
  );
}

function App() {
  const {
    sql,
    tabs,
    activeTabId,
    result,
    metadata,
    selectedRelation,
    resultView,
    filter,
    isRunning,
    executionStatus,
    canCancel,
    toast,
    history,
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
    setSelectedRelation,
    runQuery,
    cancelQuery,
    loadMetadata,
    connectDatabase,
    notify,
  } = useQueryStore();
  const [collapsed, setCollapsed] = useState<string[]>([]);
  const [sortBy, setSortBy] = useState<string | null>(null);
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");
  const [pendingSafety, setPendingSafety] = useState<{
    report: QuerySafetyReport;
    sql: string;
  } | null>(null);
  const [connectionOpen, setConnectionOpen] = useState(false);
  const [cursor, setCursor] = useState({ line: 1, column: 1, selected: 0 });
  const initialized = useRef(false);
  const editorRef = useRef<SqlEditorHandle>(null);

  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;
    void loadMetadata();
    void runQuery();
  }, [loadMetadata, runQuery]);
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
    void runQuery(mode, executableSql);
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
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "t") {
        event.preventDefault();
        newQuery();
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "w") {
        event.preventDefault();
        requestCloseQuery(activeTabId);
      }
      if (event.key === "Escape" && isRunning && canCancel) {
        event.preventDefault();
        cancelQuery();
      }
    };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  });

  const tables = metadata?.tables ?? [];
  const views = metadata?.views ?? [];
  const schemas = metadata?.schemas ?? [];
  const currentTable =
    selectedRelation?.kind === "table"
      ? tables.find(
          (table) =>
            table.schema === selectedRelation.schema &&
            table.name === selectedRelation.name,
        )
      : selectedRelation
        ? undefined
        : tables[0];
  const currentView =
    selectedRelation?.kind === "view"
      ? views.find(
          (view) =>
            view.schema === selectedRelation.schema &&
            view.name === selectedRelation.name,
        )
      : undefined;
  const foreignKeyIndex = useMemo(() => buildForeignKeyIndex(tables), [tables]);
  const currentForeignKeys = currentTable
    ? foreignKeyIndex.get(currentTable)
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
    ];
  }, [metadata]);
  const visibleRows = useMemo(() => {
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
    setSelectedRelation({ kind: "table", ...relation });
  };

  const sort = (key: string) => {
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
        serializeRowsToCsv(result.columns, visibleRows),
        `queryx-results-${timestamp}.csv`,
      );
      if (outcome === "saved")
        notify(`Exported ${visibleRows.length.toLocaleString()} rows locally`);
    } catch (error) {
      notify(
        `CSV export failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  };

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">Q</span>
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
            onClick={() => notify("Command palette · type to search commands")}
          >
            ⌘K
          </button>
          <button
            type="button"
            className="icon-button"
            onClick={() => notify("Settings are stored locally")}
          >
            ⚙
          </button>
          <span className="avatar">JD</span>
        </div>
      </header>
      <div className="workspace">
        <aside className="activitybar">
          <button type="button" className="activity-icon active">
            <Icon>◈</Icon>
          </button>
          <button type="button" className="activity-icon">
            <Icon>⌕</Icon>
          </button>
          <button type="button" className="activity-icon">
            <Icon>⌘</Icon>
          </button>
          <button type="button" className="activity-icon">
            <Icon>⊞</Icon>
          </button>
          <div className="activity-spacer" />
          <button type="button" className="activity-icon">
            <Icon>?</Icon>
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
                                        className={`tree-row ${selectedRelation?.kind === "table" && selectedRelation.schema === table.schema && selectedRelation.name === table.name ? "selected" : ""}`}
                                        key={tableKey}
                                        onClick={() =>
                                          setSelectedRelation({
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
                                        className={`tree-row ${selectedRelation?.kind === "view" && selectedRelation.schema === view.schema && selectedRelation.name === view.name ? "selected" : ""}`}
                                        key={viewKey}
                                        onClick={() =>
                                          setSelectedRelation({
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
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
          <div className="section-label">
            RECENT QUERIES{" "}
            <button type="button" className="mini-button">
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
              <>
                <Recent name="Daily revenue" time="2 minutes ago" />
                <Recent name="Active subscriptions" time="Yesterday" />
                <Recent
                  name="Migration check"
                  time="Yesterday"
                  status="error"
                />
              </>
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
                  onClick={() =>
                    setSql(
                      sql
                        .replace(/\s+/g, " ")
                        .replaceAll(" SELECT", "\nSELECT"),
                    )
                  }
                >
                  Format <kbd>⌘L</kbd>
                </button>
                <button
                  type="button"
                  className="toolbar-button"
                  onClick={() =>
                    notify("Explain plan is available for connected drivers")
                  }
                >
                  Explain
                </button>
              </div>
              <div className="toolbar-right">
                <button type="button" className="toolbar-button">
                  ◫
                </button>
                <button
                  type="button"
                  className="toolbar-button"
                  onClick={() => notify("Query saved to local favorites")}
                >
                  ♡
                </button>
                <button type="button" className="toolbar-button">
                  •••
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
                <span>⌄</span> Results <small>{visibleRows.length} rows</small>
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
                  onClick={() => void exportResults()}
                  disabled={!result || result.columns.length === 0}
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
                  onChange={(event) => setFilter(event.target.value)}
                  placeholder="Filter results..."
                />
                <kbd>⌘F</kbd>
              </label>
            </div>
            {resultView === "table" ? (
              <div className="grid-wrap">
                <table>
                  <thead>
                    <tr>
                      <th className="row-number">#</th>
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
                        <td className="row-number">{rowIndex + 1}</td>
                        {result?.columns.map((column) => (
                          <td
                            key={column.name}
                            className={
                              row[column.name] === null ? "null-value" : ""
                            }
                          >
                            {formatCellValue(row[column.name])}
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
              Showing <strong>{visibleRows.length}</strong> rows
              {filter && <span> matching “{filter}”</span>}
              <span className="footer-spacer" />
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
            selectedRelation
              ? `${selectedRelation.kind}:${selectedRelation.schema}.${selectedRelation.name}`
              : "no-relation"
          }
          table={currentTable}
          view={currentView}
          foreignKeys={currentForeignKeys}
          onSelectTable={selectRelatedTable}
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

function relativeTime(value: string): string {
  const minutes = Math.max(
    1,
    Math.round((Date.now() - new Date(value).getTime()) / 60_000),
  );
  return minutes < 60
    ? `${minutes} minute${minutes === 1 ? "" : "s"} ago`
    : "Earlier today";
}

function formatCellValue(value: unknown): string {
  if (value === null || value === undefined) return "NULL";
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
            {report.operation} has no WHERE clause. This could affect every
            matching row in the table.
          </p>
          <div className="affected-rows">
            <span>Estimated affected rows</span>
            <strong>1,248,521</strong>
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
  foreignKeys,
  onSelectTable,
}: {
  table?: TableMetadata;
  view?: ViewMetadata;
  foreignKeys?: ForeignKeyRelations;
  onSelectTable: (relation: RelationRef) => void;
}) {
  const relation = table ?? view;
  const [activeTab, setActiveTab] = useState<
    "columns" | "indexes" | "relations"
  >("columns");
  const relationCount =
    (foreignKeys?.outgoing.length ?? 0) + (foreignKeys?.incoming.length ?? 0);

  return (
    <aside className="inspector">
      <div className="panel-heading">
        INSPECTOR{" "}
        <button type="button" className="mini-button">
          ×
        </button>
      </div>
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
            <button type="button" className="mini-button">
              •••
            </button>
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

export { App };
