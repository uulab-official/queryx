import { isTauri } from "@tauri-apps/api/core";
import type {
  MigrationHistoryEntry,
  QueryFavorite,
  QueryHistoryEntry,
  QueryTab,
} from "./store";

export interface WorkspaceSnapshot {
  version: 1;
  tabs: QueryTab[];
  activeTabId: string;
  history: QueryHistoryEntry[];
  favorites: QueryFavorite[];
  migrationHistory: MigrationHistoryEntry[];
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
const nativeWorkspacePath = "queryx/workspace.json";

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

function fallbackSnapshot(fallbackTabs: QueryTab[]): WorkspaceSnapshot {
  return {
    version: 1,
    tabs: fallbackTabs,
    activeTabId: fallbackTabs[0]?.id ?? "query-1",
    history: [],
    favorites: [],
    migrationHistory: [],
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
    if (
      (!tabsSnapshot || tabsSnapshot.version !== 1) &&
      (!Array.isArray(history) || history.length === 0) &&
      (!Array.isArray(favorites) || favorites.length === 0) &&
      (!Array.isArray(migrationHistory) || migrationHistory.length === 0)
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
    const { BaseDirectory, readTextFile } = await import(
      "@tauri-apps/plugin-fs"
    );
    const stored = await readTextFile(nativeWorkspacePath, {
      baseDir: BaseDirectory.AppLocalData,
    });
    const snapshot = normalizeSnapshot(JSON.parse(stored), fallback);
    if (snapshot) {
      return { snapshot, restored: true, migratedFromBrowser: false };
    }
  } catch {
    // A missing or corrupt native snapshot falls through to browser migration.
  }

  const browser = readBrowserSnapshot(fallback);
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
    } catch {
      // Local persistence is best-effort and never contains connection secrets.
    }
    return;
  }

  const { BaseDirectory, mkdir, writeTextFile } = await import(
    "@tauri-apps/plugin-fs"
  );
  await mkdir("queryx", {
    baseDir: BaseDirectory.AppLocalData,
    recursive: true,
  });
  await writeTextFile(
    nativeWorkspacePath,
    JSON.stringify(normalized, null, 2),
    { baseDir: BaseDirectory.AppLocalData },
  );
}
