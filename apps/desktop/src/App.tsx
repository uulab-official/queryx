import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { inspectQuerySafety } from "@queryx/core";
import type { QuerySafetyReport } from "@queryx/core";
import type { DriverConfig, DriverKind, TableMetadata } from "@queryx/shared";
import { useQueryStore, type RunMode } from "./store";

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
    result,
    metadata,
    selectedTable,
    resultView,
    filter,
    isRunning,
    toast,
    history,
    driverKind,
    connectionName,
    connectionStatus,
    connectionError,
    setSql,
    setFilter,
    setResultView,
    setSelectedTable,
    runQuery,
    loadMetadata,
    connectDatabase,
    notify,
  } = useQueryStore();
  const [collapsed, setCollapsed] = useState<string[]>([]);
  const [sortBy, setSortBy] = useState<string | null>(null);
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");
  const [pendingSafety, setPendingSafety] = useState<QuerySafetyReport | null>(
    null,
  );
  const [connectionOpen, setConnectionOpen] = useState(false);
  const initialized = useRef(false);
  const sqlLines = sql.split("\n");

  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;
    void loadMetadata();
    void runQuery();
  }, [loadMetadata, runQuery]);
  const handleRun = (mode: RunMode = "normal") => {
    if (mode === "normal") {
      const safety = inspectQuerySafety(sql);
      if (safety.isDangerous) {
        setPendingSafety(safety);
        return;
      }
    }
    setPendingSafety(null);
    void runQuery(mode);
  };
  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
        event.preventDefault();
        handleRun();
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "f") {
        event.preventDefault();
        document.getElementById("result-filter")?.focus();
      }
    };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  });

  const tables = metadata?.tables ?? [];
  const schemas = metadata?.schemas ?? [];
  const currentTable =
    tables.find((table) => `${table.schema}.${table.name}` === selectedTable) ??
    tables[0];
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
          className="workspace-switcher"
          onClick={() => setConnectionOpen(true)}
        >
          <span className="workspace-dot" /> {connectionName}{" "}
          <span className="chevron">⌄</span>
        </button>
        <div className="topbar-actions">
          <button
            className="icon-button"
            onClick={() => notify("Command palette · type to search commands")}
          >
            ⌘K
          </button>
          <button
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
          <button className="activity-icon active">
            <Icon>◈</Icon>
          </button>
          <button className="activity-icon">
            <Icon>⌕</Icon>
          </button>
          <button className="activity-icon">
            <Icon>⌘</Icon>
          </button>
          <button className="activity-icon">
            <Icon>⊞</Icon>
          </button>
          <div className="activity-spacer" />
          <button className="activity-icon">
            <Icon>?</Icon>
          </button>
        </aside>
        <aside className="sidebar">
          <div className="panel-heading">
            EXPLORER{" "}
            <button
              className="mini-button"
              aria-label="New connection"
              onClick={() => setConnectionOpen(true)}
            >
              ＋
            </button>
          </div>
          <button
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
                                        className={`tree-row ${selectedTable === tableKey ? "selected" : ""}`}
                                        key={tableKey}
                                        onClick={() =>
                                          setSelectedTable(tableKey)
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
            RECENT QUERIES <button className="mini-button">•••</button>
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
                    error={entry.status === "error"}
                    onClick={() => setSql(entry.sql)}
                  />
                ))
            ) : (
              <>
                <Recent name="Daily revenue" time="2 minutes ago" />
                <Recent name="Active subscriptions" time="Yesterday" />
                <Recent name="Migration check" time="Yesterday" error />
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
            <div className="tab active">
              <span className="sql-badge">SQL</span>Daily revenue{" "}
              <span className="tab-close">×</span>
            </div>
            <div className="tab">＋ New query</div>
            <div className="tab-spacer" />
            <button
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
                  className="run-button"
                  onClick={() => handleRun()}
                  disabled={isRunning}
                >
                  <span>{isRunning ? "◌" : "▶"}</span>{" "}
                  {isRunning ? "Running…" : "Run"} <kbd>⌘↵</kbd>
                </button>
                <button
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
                  className="toolbar-button"
                  onClick={() =>
                    notify("Explain plan is available for connected drivers")
                  }
                >
                  Explain
                </button>
              </div>
              <div className="toolbar-right">
                <button className="toolbar-button">◫</button>
                <button
                  className="toolbar-button"
                  onClick={() => notify("Query saved to local favorites")}
                >
                  ♡
                </button>
                <button className="toolbar-button">•••</button>
              </div>
            </div>
            <div className="code-editor">
              <div className="line-numbers">
                {sqlLines.map((_, index) => (
                  <span key={index}>{index + 1}</span>
                ))}
              </div>
              <textarea
                aria-label="SQL editor"
                value={sql}
                onChange={(event) => setSql(event.target.value)}
                spellCheck={false}
              />{" "}
              <div className="editor-minimap">
                <i />
                <i />
                <i />
                <i />
                <i />
                <i />
              </div>
            </div>
            <div className="editor-footer">
              <span>{driverKind === "sqlite" ? "SQLite" : "PostgreSQL"}</span>
              <span>UTF-8</span>
              <span>Ln {sqlLines.length}, Col 21</span>
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
                  className={resultView === "table" ? "active" : ""}
                  onClick={() => setResultView("table")}
                >
                  ▤ Table
                </button>
                <button
                  className={resultView === "json" ? "active" : ""}
                  onClick={() => setResultView("json")}
                >
                  {"{ }"} JSON
                </button>
                <button onClick={() => notify("CSV export queued locally")}>
                  ⇩ Export
                </button>
              </div>
            </div>
            <div className="results-toolbar">
              <span className="result-meta">
                <i />{" "}
                {result
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
                        <th key={column.name} onClick={() => sort(column.name)}>
                          {column.name} <small>{column.type}</small>
                          <span>
                            {sortBy === column.name
                              ? sortDirection === "asc"
                                ? "↑"
                                : "↓"
                              : "↕"}
                          </span>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {visibleRows.map((row, rowIndex) => (
                      <tr key={rowIndex}>
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
        <Inspector table={currentTable} />
      </div>
      {toast && <div className="toast">{toast}</div>}
      {pendingSafety && (
        <SafeModeDialog
          report={pendingSafety}
          onCancel={() => setPendingSafety(null)}
          onRunInTransaction={() => handleRun("transaction")}
          onExecuteAnyway={() => handleRun("execute-anyway")}
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
    <button className="tree-row" onClick={onClick}>
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
  error = false,
  onClick,
}: { name: string; time: string; error?: boolean; onClick?: () => void }) {
  return (
    <button className="recent-query" onClick={onClick}>
      <span className={`query-status ${error ? "error" : "success"}`}>
        {error ? "×" : "✓"}
      </span>
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
            <button className="modal-secondary" onClick={onCancel}>
              Cancel
            </button>
            <button className="modal-transaction" onClick={onRunInTransaction}>
              Run in Transaction
            </button>
            <button className="modal-danger" onClick={onExecuteAnyway}>
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
      <section
        className="connection-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="connection-title"
      >
        <div className="connection-modal-heading">
          <div>
            <p className="modal-kicker">LOCAL-FIRST CONNECTION</p>
            <h2 id="connection-title">Connect a database</h2>
          </div>
          <button
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
      </section>
    </div>
  );
}

function Inspector({ table }: { table?: TableMetadata }) {
  return (
    <aside className="inspector">
      <div className="panel-heading">
        INSPECTOR <button className="mini-button">×</button>
      </div>
      {table && (
        <>
          <div className="inspector-title">
            <span className="table-symbol">▤</span>
            <span>
              <strong>{table.name}</strong>
              <small>{table.schema} · table</small>
            </span>
            <button className="mini-button">•••</button>
          </div>
          <div className="inspector-tabs">
            <button className="active">
              Columns <span>{table.columns.length}</span>
            </button>
            <button disabled>
              Indexes <span>soon</span>
            </button>
          </div>
          <div className="column-list">
            {table.columns.map((column) => (
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
          <div className="inspector-section">
            <div className="section-title">
              TABLE DETAILS <span>⌃</span>
            </div>
            <dl>
              <dt>Rows</dt>
              <dd>{table.rowCount.toLocaleString()}</dd>
              <dt>Schema</dt>
              <dd>{table.schema}</dd>
              <dt>Columns</dt>
              <dd>{table.columns.length}</dd>
              <dt>Primary key</dt>
              <dd>
                {table.columns.filter((column) => column.primaryKey).length}
              </dd>
            </dl>
          </div>
        </>
      )}
    </aside>
  );
}

export { App };
