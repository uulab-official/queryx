import { describe, expect, it } from "vitest";
import type { SessionAuditEntry } from "@queryx/shared";
import type {
  MigrationHistoryEntry,
  QueryFavorite,
  QueryHistoryEntry,
  QueryTab,
} from "./store";
import {
  loadWorkspaceSnapshot,
  persistWorkspaceSnapshot,
} from "./workspaceStorage";

async function withLocalStorage<T>(
  work: (values: Map<string, string>) => T | Promise<T>,
): Promise<T> {
  const values = new Map<string, string>();
  const fakeWindow = {
    localStorage: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    },
  } as unknown as Window & typeof globalThis;
  const previousWindow = (globalThis as typeof globalThis & { window?: Window })
    .window;
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: fakeWindow,
  });

  try {
    return await work(values);
  } finally {
    if (previousWindow) {
      Object.defineProperty(globalThis, "window", {
        configurable: true,
        value: previousWindow,
      });
    } else {
      Reflect.deleteProperty(globalThis, "window");
    }
  }
}

describe("versioned workspace storage", () => {
  it("round-trips tabs, history, favorites, and active selection", async () => {
    await withLocalStorage(async (values) => {
      const fallback: QueryTab = {
        id: "fallback",
        title: "Fallback",
        sql: "SELECT 0",
        isDirty: false,
      };
      const history: QueryHistoryEntry = {
        id: "history-1",
        label: "Orders",
        sql: "SELECT * FROM orders",
        executedAt: new Date().toISOString(),
        status: "success",
      };
      const favorite: QueryFavorite = {
        id: "favorite-1",
        label: "Orders",
        sql: "SELECT * FROM orders",
        createdAt: new Date().toISOString(),
      };
      const migration: MigrationHistoryEntry = {
        id: "migration-1",
        baselineLabel: "Baseline",
        targetLabel: "Current",
        driver: "sqlite",
        createdAt: new Date().toISOString(),
        changeCount: 1,
        added: 1,
        removed: 0,
        manual: 0,
        migrationSql: "CREATE TABLE audit (id integer);",
        rollbackSql: "DROP TABLE audit;",
        privilegePreflightSql: "SELECT 1;",
        status: "applied",
        appliedAt: new Date().toISOString(),
      };
      const sessionAudit: SessionAuditEntry = {
        id: "session-audit-1",
        driver: "postgres",
        connectionName: "production",
        sessionId: "42",
        database: "app",
        observedAt: new Date().toISOString(),
        state: "waiting",
        durationMs: 12_000,
        waitEvent: "Lock: relation",
        queryPreview: "SELECT * FROM users WHERE id = ?",
        queryFingerprint: "deadbeef",
      };

      await persistWorkspaceSnapshot({
        version: 1,
        tabs: [fallback, { ...fallback, id: "second", sql: "SELECT 2" }],
        activeTabId: "second",
        history: [history],
        favorites: [favorite],
        migrationHistory: [migration],
        sessionAudit: [sessionAudit],
        sessionAuditRetentionDays: 7,
      });
      const result = await loadWorkspaceSnapshot([fallback]);

      expect(result.restored).toBe(true);
      expect(result.migratedFromBrowser).toBe(false);
      expect(result.snapshot.activeTabId).toBe("second");
      expect(result.snapshot.tabs).toHaveLength(2);
      expect(result.snapshot.history).toEqual([history]);
      expect(result.snapshot.favorites).toEqual([favorite]);
      expect(result.snapshot.migrationHistory).toEqual([migration]);
      expect(result.snapshot.sessionAudit).toEqual([sessionAudit]);
      expect(result.snapshot.sessionAuditRetentionDays).toBe(7);
      expect(values.has("queryx:workspace-tabs")).toBe(true);
    });
  });

  it("removes an emptied history collection instead of recreating it", async () => {
    await withLocalStorage(async (values) => {
      values.set("queryx:query-history", JSON.stringify([{ stale: true }]));
      await persistWorkspaceSnapshot({
        version: 1,
        tabs: [
          {
            id: "query-1",
            title: "Query 1",
            sql: "SELECT 1",
            isDirty: false,
          },
        ],
        activeTabId: "query-1",
        history: [],
        favorites: [],
        migrationHistory: [],
        sessionAudit: [],
        sessionAuditRetentionDays: 7,
      });

      expect(values.has("queryx:query-history")).toBe(false);
    });
  });

  it("keeps the default audit retention when migrating an older workspace", async () => {
    await withLocalStorage(async (values) => {
      values.set(
        "queryx:workspace-tabs",
        JSON.stringify({
          version: 1,
          tabs: [
            {
              id: "query-1",
              title: "Query 1",
              sql: "SELECT 1",
              isDirty: false,
            },
          ],
          activeTabId: "query-1",
        }),
      );

      const result = await loadWorkspaceSnapshot([
        { id: "fallback", title: "Fallback", sql: "SELECT 0", isDirty: false },
      ]);

      expect(result.snapshot.sessionAuditRetentionDays).toBe(7);
    });
  });
});
