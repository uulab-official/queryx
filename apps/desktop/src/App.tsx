import { useEffect, useMemo, useState } from 'react';
import type { TableMetadata } from '@queryx/shared';
import { initialSql, useQueryStore } from './store';

const sqlLines = initialSql.split('\n');

function Icon({ children }: { children: string }) {
  return <span className="icon" aria-hidden="true">{children}</span>;
}

function App() {
  const { sql, result, metadata, selectedTable, resultView, filter, isRunning, toast, setSql, setFilter, setResultView, setSelectedTable, runQuery, loadMetadata, notify } = useQueryStore();
  const [collapsed, setCollapsed] = useState<string[]>([]);
  const [sortBy, setSortBy] = useState<'day' | 'orders' | 'revenue'>('day');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');

  useEffect(() => { void loadMetadata(); void runQuery(); }, [loadMetadata, runQuery]);
  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') { event.preventDefault(); void runQuery(); }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'f') { event.preventDefault(); document.getElementById('result-filter')?.focus(); }
    };
    window.addEventListener('keydown', listener);
    return () => window.removeEventListener('keydown', listener);
  }, [runQuery]);

  const tables = metadata?.tables ?? [];
  const currentTable = tables.find((table) => table.name === selectedTable) ?? tables[0];
  const visibleRows = useMemo(() => {
    if (!result) return [];
    const query = filter.trim().toLowerCase();
    const rows = result.rows.filter((row) => Object.values(row).join(' ').toLowerCase().includes(query));
    return rows.sort((a, b) => {
      const aValue = String(a[sortBy] ?? '');
      const bValue = String(b[sortBy] ?? '');
      const direction = sortDirection === 'asc' ? 1 : -1;
      return aValue.localeCompare(bValue, undefined, { numeric: true }) * direction;
    });
  }, [filter, result, sortBy, sortDirection]);

  const sort = (key: 'day' | 'orders' | 'revenue') => {
    if (key === sortBy) setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    else { setSortBy(key); setSortDirection('desc'); }
  };
  const toggle = (key: string) => setCollapsed((current) => current.includes(key) ? current.filter((item) => item !== key) : [...current, key]);

  return <div className="app-shell">
    <header className="topbar">
      <div className="brand"><span className="brand-mark">Q</span><strong>Query<span>X</span></strong><small>BETA</small></div>
      <button className="workspace-switcher"><span className="workspace-dot" /> Acme workspace <span className="chevron">⌄</span></button>
      <div className="topbar-actions"><button className="icon-button" onClick={() => notify('Command palette · type to search commands')}>⌘K</button><button className="icon-button" onClick={() => notify('Settings are stored locally')}>⚙</button><span className="avatar">JD</span></div>
    </header>
    <div className="workspace">
      <aside className="activitybar"><button className="activity-icon active"><Icon>◈</Icon></button><button className="activity-icon"><Icon>⌕</Icon></button><button className="activity-icon"><Icon>⌘</Icon></button><button className="activity-icon"><Icon>⊞</Icon></button><div className="activity-spacer" /><button className="activity-icon"><Icon>?</Icon></button></aside>
      <aside className="sidebar">
        <div className="panel-heading">EXPLORER <button className="mini-button" onClick={() => notify('New connection dialog is ready')}>＋</button></div>
        <div className="connection-select"><span className="status-dot green" /> <strong>production-db</strong><span className="driver-tag">PG</span><span className="chevron">⌄</span></div>
        <div className="tree">
          <TreeRow label="production-db" icon="◉" tone="db" onClick={() => toggle('root')} collapsed={collapsed.includes('root')} />
          {!collapsed.includes('root') && <div className="tree-children"><TreeRow label="Schemas" icon="▱" tone="folder" onClick={() => toggle('schemas')} collapsed={collapsed.includes('schemas')} />{!collapsed.includes('schemas') && <div className="tree-children"><TreeRow label="public" icon="◇" tone="schema" onClick={() => toggle('public')} collapsed={collapsed.includes('public')} />{!collapsed.includes('public') && <div className="tree-children"><TreeRow label="Tables" icon="▱" tone="folder" onClick={() => toggle('tables')} collapsed={collapsed.includes('tables')} count={tables.length} />{!collapsed.includes('tables') && <div className="tree-children">{tables.map((table) => <button className={`tree-row ${selectedTable === table.name ? 'selected' : ''}`} key={table.name} onClick={() => setSelectedTable(table.name)}><span className="tree-icon table">▤</span>{table.name}</button>)}<button className="tree-row muted">+ 5 more</button></div>}<TreeRow label="Views" icon="▱" tone="folder" count={3} /><TreeRow label="Functions" icon="▱" tone="folder" count={12} /></div>}</div>}</div>}
        </div>
        <div className="section-label">RECENT QUERIES <button className="mini-button">•••</button></div>
        <div className="recent-list"><Recent name="Daily revenue" time="2 minutes ago" /><Recent name="Active subscriptions" time="Yesterday" /><Recent name="Migration check" time="Yesterday" error /></div>
        <div className="storage-note"><span className="lock">⌑</span><span><strong>Local-first</strong><small>Data stays on your device</small></span><b>✓</b></div>
      </aside>
      <main className="main-area">
        <div className="editor-tabs"><div className="tab active"><span className="sql-badge">SQL</span>Daily revenue <span className="tab-close">×</span></div><div className="tab">＋ New query</div><div className="tab-spacer" /><span className="connected"><span className="status-dot green" /> Connected ⌄</span></div>
        <section className="editor-pane"><div className="editor-toolbar"><div><button className="run-button" onClick={() => void runQuery()} disabled={isRunning}><span>{isRunning ? '◌' : '▶'}</span> {isRunning ? 'Running…' : 'Run'} <kbd>⌘↵</kbd></button><button className="toolbar-button" onClick={() => setSql(sql.replace(/\s+/g, ' ').replaceAll(' SELECT', '\nSELECT'))}>Format <kbd>⌘L</kbd></button><button className="toolbar-button" onClick={() => notify('Explain plan is available for connected drivers')}>Explain</button></div><div className="toolbar-right"><button className="toolbar-button">◫</button><button className="toolbar-button" onClick={() => notify('Query saved to local favorites')}>♡</button><button className="toolbar-button">•••</button></div></div><div className="code-editor"><div className="line-numbers">{sqlLines.map((_, index) => <span key={index}>{index + 1}</span>)}</div><textarea aria-label="SQL editor" value={sql} onChange={(event) => setSql(event.target.value)} spellCheck={false} /> <div className="editor-minimap"><i /><i /><i /><i /><i /><i /></div></div><div className="editor-footer"><span>PostgreSQL</span><span>UTF-8</span><span>Ln {sqlLines.length}, Col 21</span><span className="footer-spacer" /><span>Spaces: 2</span><span>SQL</span></div></section>
        <section className="results-pane"><div className="results-heading"><div className="result-title"><span>⌄</span> Results <small>{result?.rows.length === 10 ? '30 rows' : `${visibleRows.length} rows`}</small><em>· {result?.executionTime ?? 0}ms</em></div><div className="result-actions"><button className={resultView === 'table' ? 'active' : ''} onClick={() => setResultView('table')}>▤ Table</button><button className={resultView === 'json' ? 'active' : ''} onClick={() => setResultView('json')}>{'{ }'} JSON</button><button onClick={() => notify('CSV export queued locally')}>⇩ Export</button></div></div><div className="results-toolbar"><span className="result-meta"><i /> Query completed successfully <b /> Today at 10:42 AM</span><label className="filter-box">⌕<input id="result-filter" value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Filter results..." /><kbd>⌘F</kbd></label></div>{resultView === 'table' ? <div className="grid-wrap"><table><thead><tr><th><input type="checkbox" /></th>{(['day', 'orders', 'revenue'] as const).map((key) => <th key={key} onClick={() => sort(key)}>{key} <span>↕</span></th>)}<th /></tr></thead><tbody>{visibleRows.map((row) => <tr key={String(row.day)}><td><input type="checkbox" /></td><td>{String(row.day)}</td><td>{String(row.orders)}</td><td>{String(row.revenue)}</td><td /></tr>)}</tbody></table></div> : <pre className="json-view">{JSON.stringify(visibleRows, null, 2)}</pre>}<div className="pagination">Showing <strong>1–{Math.min(10, visibleRows.length)}</strong> of <strong>{visibleRows.length}</strong><div><button disabled>‹</button><button className="active">1</button><button>2</button><button>›</button></div><span>10 / page⌄</span></div></section>
        <div className="statusbar"><span><span className="status-dot green" /> production-db</span><span>PostgreSQL 16.2</span><span className="footer-spacer" /><span>Safe mode <i className="toggle" /></span><span>⌘ Enter to run</span></div>
      </main>
      <Inspector table={currentTable} />
    </div>
    {toast && <div className="toast">{toast}</div>}
  </div>;
}

function TreeRow({ label, icon, tone, count, onClick, collapsed }: { label: string; icon: string; tone: string; count?: number; onClick?: () => void; collapsed?: boolean }) {
  return <button className="tree-row" onClick={onClick}><span className="tree-caret">{onClick ? (collapsed ? '›' : '⌄') : ''}</span><span className={`tree-icon ${tone}`}>{icon}</span>{label}{count !== undefined && <span className="count">{count}</span>}</button>;
}

function Recent({ name, time, error = false }: { name: string; time: string; error?: boolean }) {
  return <button className="recent-query"><span className={`query-status ${error ? 'error' : 'success'}`}>{error ? '×' : '✓'}</span><span><strong>{name}</strong><small>{time}</small></span></button>;
}

function Inspector({ table }: { table?: TableMetadata }) {
  return <aside className="inspector"><div className="panel-heading">INSPECTOR <button className="mini-button">×</button></div>{table && <><div className="inspector-title"><span className="table-symbol">▤</span><span><strong>{table.name}</strong><small>{table.schema} · table</small></span><button className="mini-button">•••</button></div><div className="inspector-tabs"><button className="active">Columns <span>{table.columns.length}</span></button><button>Indexes <span>3</span></button></div><div className="column-list">{table.columns.map((column) => <div className="column-row" key={column.name}><span className={column.primaryKey ? 'key-symbol' : 'key-symbol empty'}>{column.primaryKey ? '⌁' : '•'}</span><span><strong>{column.name}</strong><small>{column.type}</small></span>{column.primaryKey && <b className="pk">PK</b>}</div>)}</div><div className="inspector-section"><div className="section-title">TABLE DETAILS <span>⌃</span></div><dl><dt>Rows</dt><dd>{table.rowCount.toLocaleString()}</dd><dt>Size</dt><dd>284 MB</dd><dt>Created</dt><dd>Jan 12, 2024</dd><dt>Last vacuum</dt><dd>2 hours ago</dd></dl></div></>}</aside>;
}

export { App };
