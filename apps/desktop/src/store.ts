import { create } from 'zustand';
import { InMemoryDriver } from '@queryx/core';
import type { DatabaseMetadata, QueryResult } from '@queryx/shared';

type ResultView = 'table' | 'json';

interface QueryState {
  sql: string;
  result: QueryResult | null;
  metadata: DatabaseMetadata | null;
  selectedTable: string;
  resultView: ResultView;
  filter: string;
  isRunning: boolean;
  toast: string | null;
  driver: InMemoryDriver;
  setSql: (sql: string) => void;
  setFilter: (filter: string) => void;
  setResultView: (view: ResultView) => void;
  setSelectedTable: (table: string) => void;
  runQuery: () => Promise<void>;
  loadMetadata: () => Promise<void>;
  notify: (message: string) => void;
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
    driver,
    setSql: (sql) => set({ sql }),
    setFilter: (filter) => set({ filter }),
    setResultView: (resultView) => set({ resultView }),
    setSelectedTable: (selectedTable) => set({ selectedTable }),
    runQuery: async () => {
      set({ isRunning: true });
      try {
        const result = await get().driver.execute(get().sql);
        set({ result, isRunning: false, toast: 'Query completed successfully' });
        window.setTimeout(() => set({ toast: null }), 2200);
      } catch (error) {
        set({ isRunning: false, toast: error instanceof Error ? error.message : 'Query failed' });
      }
    },
    loadMetadata: async () => set({ metadata: await get().driver.metadata() }),
    notify: (toast) => {
      set({ toast });
      window.setTimeout(() => set({ toast: null }), 2200);
    },
  };
});

export { initialSql };
