import { create } from 'zustand';
import { InMemoryDriver } from '@queryx/core';
import type { DatabaseMetadata, QueryResult } from '@queryx/shared';

type ResultView = 'table' | 'json';
export type RunMode = 'normal' | 'transaction' | 'execute-anyway';

export interface QueryHistoryEntry {
  id: string;
  label: string;
  sql: string;
  executedAt: string;
  status: 'success' | 'error';
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
  driver: InMemoryDriver;
  setSql: (sql: string) => void;
  setFilter: (filter: string) => void;
  setResultView: (view: ResultView) => void;
  setSelectedTable: (table: string) => void;
  runQuery: (mode?: RunMode) => Promise<void>;
  loadMetadata: () => Promise<void>;
  notify: (message: string) => void;
  addHistory: (entry: QueryHistoryEntry) => void;
}

const historyStorageKey = 'queryx:query-history';

function readHistory(): QueryHistoryEntry[] {
  if (typeof window === 'undefined') return [];
  try {
    const stored = window.localStorage.getItem(historyStorageKey);
    return stored ? (JSON.parse(stored) as QueryHistoryEntry[]).slice(0, 20) : [];
  } catch {
    return [];
  }
}

function writeHistory(history: QueryHistoryEntry[]): void {
  try {
    window.localStorage.setItem(historyStorageKey, JSON.stringify(history.slice(0, 20)));
  } catch {
    // Local persistence is best-effort until the Tauri SQLite store lands.
  }
}

const initialSql = `-- Revenue by day · last 30 days
SELECT
  DATE_TRUNC('day', created_at)::date AS day,
  COUNT(*) AS orders,
  SUM(total_amount) AS revenue
FROM orders
WHERE created_at >= CURRENT_DATE - INTERVAL '30 days'
  AND status = 'paid'
GROUP BY 1
ORDER BY day DESC;`;

export const useQueryStore = create<QueryState>((set, get) => {
  const driver = new InMemoryDriver();
  void driver.connect({ kind: 'postgres', name: 'production-db', database: 'production' });
  return {
    sql: initialSql,
    result: null,
    metadata: null,
    selectedTable: 'orders',
    resultView: 'table',
    filter: '',
    isRunning: false,
    toast: null,
    history: readHistory(),
    driver,
    setSql: (sql) => set({ sql }),
    setFilter: (filter) => set({ filter }),
    setResultView: (resultView) => set({ resultView }),
    setSelectedTable: (selectedTable) => set({ selectedTable }),
    runQuery: async (mode = 'normal') => {
      set({ isRunning: true });
      try {
        const execute = () => get().driver.execute(get().sql);
        const result = mode === 'transaction' ? await get().driver.transaction(execute) : await execute();
        const historyEntry: QueryHistoryEntry = {
          id: crypto.randomUUID(),
          label: get().sql.split('\n').find((line) => line.trim() && !line.trim().startsWith('--'))?.trim().slice(0, 32) ?? 'Untitled query',
          sql: get().sql,
          executedAt: new Date().toISOString(),
          status: 'success',
        };
        get().addHistory(historyEntry);
        set({ result, isRunning: false, toast: 'Query completed successfully' });
        window.setTimeout(() => set({ toast: null }), 2200);
      } catch (error) {
        get().addHistory({
          id: crypto.randomUUID(),
          label: 'Query failed',
          sql: get().sql,
          executedAt: new Date().toISOString(),
          status: 'error',
        });
        set({ isRunning: false, toast: error instanceof Error ? error.message : 'Query failed' });
      }
    },
    loadMetadata: async () => set({ metadata: await get().driver.metadata() }),
    notify: (toast) => {
      set({ toast });
      window.setTimeout(() => set({ toast: null }), 2200);
    },
    addHistory: (entry) => {
      const history = [entry, ...get().history.filter((item) => item.sql !== entry.sql)];
      writeHistory(history);
      set({ history });
    },
  };
});

export { initialSql };
