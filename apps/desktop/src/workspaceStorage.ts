import { invoke, isTauri } from "@tauri-apps/api/core";
import type {
  MigrationHistoryEntry,
  QueryFavorite,
  QueryHistoryEntry,
  QueryTab,
} from "./store";
import type { SessionAuditEntry } from "@queryx/shared";

export interface WorkspaceSnapshot {
  version: 1;
  tabs: QueryTab[];
  activeTabId: string;
  history: QueryHistoryEntry[];
  favorites: QueryFavorite[];
  migrationHistory: MigrationHistoryEntry[];
  sessionAudit: SessionAuditEntry[];
  sessionAuditRetentionDays: number;
}

export interface WorkspaceLoadResult {
  snapshot: WorkspaceSnapshot;
  restored: boolean;
  migratedFromBrowser: boolean;
}

const workspaceTabsStorageKey = "queryx:workspace-tabs";
const historyStorageKey = "queryx:query-history";
const favoritesStorageKey = "queryx:query-favorites";
const migrationHistoryStorageKey = "queryx:migration-history";
const sessionAuditStorageKey = "queryx:session-audit";
const sessionAuditRetentionStorageKey = "queryx:session-audit-retention-days";
const nativeWorkspacePath = "queryx/workspace.json";
const supportedRetentionDays = [0, 1, 7, 30];

function normalizeTabs(value: unknown, fallback: QueryTab[]): QueryTab[] {
  if (!Array.isArray(value)) return fallback;
  const tabs = value.filter(
    (tab): tab is QueryTab =>
      Boolean(tab) &&
      typeof tab === "object" &&
      typeof tab.id === "string" &&
      typeof tab.title === "string" &&
      typeof tab.sql === "string" &&
      typeof tab.isDirty === "boolean",
  );
  return tabs.slice(0, 20).length > 0 ? tabs.slice(0, 20) : fallback;
}

function normalizeHistory(value: unknown): QueryHistoryEntry[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(
      (entry): entry is QueryHistoryEntry =>
        Boolean(entry) &&
        typeof entry === "object" &&
        typeof entry.id === "string" &&
        typeof entry.label === "string" &&
        typeof entry.sql === "string" &&
        typeof entry.executedAt === "string" &&
        (entry.status === "success" ||
          entry.status === "error" ||
          entry.status === "cancelled"),
    )
    .slice(0, 20);
}

function normalizeFavorites(value: unknown): QueryFavorite[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(
      (favorite): favorite is QueryFavorite =>
        Boolean(favorite) &&
        typeof favorite === "object" &&
        typeof favorite.id === "string" &&
        typeof favorite.label === "string" &&
        typeof favorite.sql === "string" &&
        typeof favorite.createdAt === "string",
    )
    .slice(0, 50);
}

function normalizeMigrationHistory(value: unknown): MigrationHistoryEntry[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(
      (entry): entry is MigrationHistoryEntry =>
        Boolean(entry) &&
        typeof entry === "object" &&
        typeof entry.id === "string" &&
        typeof entry.baselineLabel === "string" &&
        typeof entry.targetLabel === "string" &&
        (entry.driver === "sqlite" ||
          entry.driver === "postgres" ||
          entry.driver === "mysql") &&
        typeof entry.createdAt === "string" &&
        typeof entry.changeCount === "number" &&
        typeof entry.added === "number" &&
        typeof entry.removed === "number" &&
        typeof entry.manual === "number" &&
        typeof entry.migrationSql === "string" &&
        typeof entry.rollbackSql === "string" &&
        typeof entry.privilegePreflightSql === "string",
    )
    .map((entry) => ({
      ...entry,
      status:
        entry.status === "applied"
          ? ("applied" as const)
          : ("preview" as const),
      ...(typeof entry.appliedAt === "string"
        ? { appliedAt: entry.appliedAt }
        : {}),
    }))
    .slice(0, 30);
}

function normalizeSessionAudit(value: unknown): SessionAuditEntry[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(
      (entry): entry is SessionAuditEntry =>
        Boolean(entry) &&
        typeof entry === "object" &&
        typeof entry.id === "string" &&
        (entry.driver === "sqlite" ||
          entry.driver === "postgres" ||
          entry.driver === "mysql") &&
        typeof entry.connectionName === "string" &&
        typeof entry.sessionId === "string" &&
        (typeof entry.database === "string" || entry.database === null) &&
        typeof entry.observedAt === "string" &&
        (entry.state === "active" ||
          entry.state === "idle" ||
          entry.state === "idleInTransaction" ||
          entry.state === "waiting" ||
          entry.state === "unknown") &&
        (typeof entry.durationMs === "number" || entry.durationMs === null) &&
        (typeof entry.waitEvent === "string" || entry.waitEvent === null) &&
        (typeof entry.queryPreview === "string" ||
          entry.queryPreview === null) &&
        (typeof entry.queryFingerprint === "string" ||
          entry.queryFingerprint === null),
    )
    .slice(0, 500);
}

function normalizeRetentionDays(value: unknown): number {
  return typeof value === "number" && supportedRetentionDays.includes(value)
    ? value
    : 7;
}

function fallbackSnapshot(fallbackTabs: QueryTab[]): WorkspaceSnapshot {
  return {
    version: 1,
    tabs: fallbackTabs,
    activeTabId: fallbackTabs[0]?.id ?? "query-1",
    history: [],
    favorites: [],
    migrationHistory: [],
    sessionAudit: [],
    sessionAuditRetentionDays: 7,
  };
}

function normalizeSnapshot(
  value: unknown,
  fallback: WorkspaceSnapshot,
): WorkspaceSnapshot | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<WorkspaceSnapshot>;
  if (candidate.version !== 1) return null;
  const tabs = normalizeTabs(candidate.tabs, fallback.tabs);
  const activeTabId = tabs.some((tab) => tab.id === candidate.activeTabId)
    ? (candidate.activeTabId as string)
    : tabs[0].id;
  return {
    version: 1,
    tabs,
    activeTabId,
    history: normalizeHistory(candidate.history),
    favorites: normalizeFavorites(candidate.favorites),
    migrationHistory: normalizeMigrationHistory(candidate.migrationHistory),
    sessionAudit: normalizeSessionAudit(candidate.sessionAudit),
    sessionAuditRetentionDays: normalizeRetentionDays(
      candidate.sessionAuditRetentionDays,
    ),
  };
}

function readBrowserSnapshot(
  fallback: WorkspaceSnapshot,
): WorkspaceSnapshot | null {
  if (typeof window === "undefined") return null;
  try {
    const tabsValue = window.localStorage.getItem(workspaceTabsStorageKey);
    const tabsSnapshot = tabsValue
      ? (JSON.parse(tabsValue) as Partial<WorkspaceSnapshot>)
      : null;
    const history = JSON.parse(
      window.localStorage.getItem(historyStorageKey) ?? "[]",
    );
    const favorites = JSON.parse(
      window.localStorage.getItem(favoritesStorageKey) ?? "[]",
    );
    const migrationHistory = JSON.parse(
      window.localStorage.getItem(migrationHistoryStorageKey) ?? "[]",
    );
    const sessionAudit = JSON.parse(
      window.localStorage.getItem(sessionAuditStorageKey) ?? "[]",
    );
    const storedRetentionDays = window.localStorage.getItem(
      sessionAuditRetentionStorageKey,
    );
    const sessionAuditRetentionDays =
      storedRetentionDays === null ? undefined : Number(storedRetentionDays);
    if (
      (!tabsSnapshot || tabsSnapshot.version !== 1) &&
      (!Array.isArray(history) || history.length === 0) &&
      (!Array.isArray(favorites) || favorites.length === 0) &&
      (!Array.isArray(migrationHistory) || migrationHistory.length === 0) &&
      (!Array.isArray(sessionAudit) || sessionAudit.length === 0)
    ) {
      return null;
    }
    return normalizeSnapshot(
      {
        ...(tabsSnapshot?.version === 1
          ? tabsSnapshot
          : {
              version: 1,
              tabs: fallback.tabs,
              activeTabId: fallback.activeTabId,
            }),
        history,
        favorites,
        migrationHistory,
        sessionAudit,
        sessionAuditRetentionDays,
      },
      fallback,
    );
  } catch {
    return null;
  }
}

export async function loadWorkspaceSnapshot(
  fallbackTabs: QueryTab[],
): Promise<WorkspaceLoadResult> {
  const fallback = fallbackSnapshot(fallbackTabs);
  if (!isTauri()) {
    const browser = readBrowserSnapshot(fallback);
    return {
      snapshot: browser ?? fallback,
      restored: Boolean(browser),
      migratedFromBrowser: false,
    };
  }

  try {
    const stored = await invoke<unknown | null>("load_workspace_snapshot");
    const snapshot = normalizeSnapshot(stored, fallback);
    if (snapshot) {
      return { snapshot, restored: true, migratedFromBrowser: false };
    }
  } catch {
    // Fall through to the legacy JSON and browser migration paths.
  }

  try {
    const { BaseDirectory, readTextFile } = await import(
      "@tauri-apps/plugin-fs"
    );
    const stored = await readTextFile(nativeWorkspacePath, {
      baseDir: BaseDirectory.AppLocalData,
    });
    const snapshot = normalizeSnapshot(JSON.parse(stored), fallback);
    if (snapshot) {
      await invoke("save_workspace_snapshot", { snapshot });
      return { snapshot, restored: true, migratedFromBrowser: false };
    }
  } catch {
    // A missing or corrupt legacy snapshot falls through to browser migration.
  }

  const browser = readBrowserSnapshot(fallback);
  if (browser) {
    try {
      await invoke("save_workspace_snapshot", { snapshot: browser });
    } catch {
      // The UI remains usable if the native store is unavailable.
    }
  }
  return {
    snapshot: browser ?? fallback,
    restored: Boolean(browser),
    migratedFromBrowser: Boolean(browser),
  };
}

export async function persistWorkspaceSnapshot(
  snapshot: WorkspaceSnapshot,
): Promise<void> {
  const normalized = normalizeSnapshot(snapshot, snapshot);
  if (!normalized) return;

  if (!isTauri()) {
    try {
      window.localStorage.setItem(
        workspaceTabsStorageKey,
        JSON.stringify({
          version: 1,
          tabs: normalized.tabs,
          activeTabId: normalized.activeTabId,
        }),
      );
      if (normalized.history.length === 0) {
        window.localStorage.removeItem(historyStorageKey);
      } else {
        window.localStorage.setItem(
          historyStorageKey,
          JSON.stringify(normalized.history),
        );
      }
      window.localStorage.setItem(
        favoritesStorageKey,
        JSON.stringify(normalized.favorites),
      );
      if (normalized.migrationHistory.length === 0) {
        window.localStorage.removeItem(migrationHistoryStorageKey);
      } else {
        window.localStorage.setItem(
          migrationHistoryStorageKey,
          JSON.stringify(normalized.migrationHistory),
        );
      }
      if (normalized.sessionAudit.length === 0) {
        window.localStorage.removeItem(sessionAuditStorageKey);
      } else {
        window.localStorage.setItem(
          sessionAuditStorageKey,
          JSON.stringify(normalized.sessionAudit),
        );
      }
      window.localStorage.setItem(
        sessionAuditRetentionStorageKey,
        String(normalized.sessionAuditRetentionDays),
      );
    } catch {
      // Local persistence is best-effort and never contains connection secrets.
    }
    return;
  }

  await invoke("save_workspace_snapshot", { snapshot: normalized });
}
