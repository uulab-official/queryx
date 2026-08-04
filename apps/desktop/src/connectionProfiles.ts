import { isTauri } from "@tauri-apps/api/core";
import type { ConnectionProfile, DriverKind } from "@queryx/shared";

export const connectionProfilesStorageKey = "queryx:connection-profiles";
const nativeProfilesPath = "queryx/connection-profiles.json";
const maxProfiles = 50;

function isDriverKind(value: unknown): value is DriverKind {
  return value === "postgres" || value === "mysql" || value === "sqlite";
}

function isSslMode(
  value: unknown,
): value is NonNullable<ConnectionProfile["sslMode"]> {
  return value === "disable" || value === "prefer" || value === "require";
}

export function normalizeConnectionProfiles(
  value: unknown,
): ConnectionProfile[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((candidate): candidate is Record<string, unknown> => {
      if (!candidate || typeof candidate !== "object") return false;
      const item = candidate as Record<string, unknown>;
      return (
        typeof item.id === "string" &&
        typeof item.name === "string" &&
        item.name.trim().length > 0 &&
        isDriverKind(item.kind) &&
        typeof item.database === "string" &&
        item.database.trim().length > 0
      );
    })
    .map((item) => ({
      id: item.id as string,
      name: (item.name as string).trim().slice(0, 120),
      kind: item.kind as DriverKind,
      database: (item.database as string).trim(),
      readOnly: item.readOnly === true,
      ...(typeof item.host === "string" && item.host.trim()
        ? { host: item.host.trim() }
        : {}),
      ...(typeof item.port === "number" && Number.isInteger(item.port)
        ? { port: item.port }
        : {}),
      ...(typeof item.username === "string" && item.username.trim()
        ? { username: item.username.trim() }
        : {}),
      ...(isSslMode(item.sslMode) ? { sslMode: item.sslMode } : {}),
    }))
    .slice(0, maxProfiles);
}

function readBrowserProfiles(): ConnectionProfile[] {
  if (typeof window === "undefined") return [];
  try {
    const stored = window.localStorage.getItem(connectionProfilesStorageKey);
    return stored ? normalizeConnectionProfiles(JSON.parse(stored)) : [];
  } catch {
    return [];
  }
}

function writeBrowserProfiles(profiles: ConnectionProfile[]): void {
  try {
    window.localStorage.setItem(
      connectionProfilesStorageKey,
      JSON.stringify(profiles.slice(0, maxProfiles)),
    );
  } catch {
    // Persistence is best-effort; profile secrets are never written here.
  }
}

export async function loadConnectionProfiles(): Promise<ConnectionProfile[]> {
  if (!isTauri()) return readBrowserProfiles();
  try {
    const { BaseDirectory, readTextFile } = await import(
      "@tauri-apps/plugin-fs"
    );
    const stored = await readTextFile(nativeProfilesPath, {
      baseDir: BaseDirectory.AppLocalData,
    });
    return normalizeConnectionProfiles(JSON.parse(stored));
  } catch {
    return [];
  }
}

export async function persistConnectionProfiles(
  profiles: ConnectionProfile[],
): Promise<void> {
  const nextProfiles = normalizeConnectionProfiles(profiles);
  if (!isTauri()) {
    writeBrowserProfiles(nextProfiles);
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
    nativeProfilesPath,
    JSON.stringify(nextProfiles, null, 2),
    { baseDir: BaseDirectory.AppLocalData },
  );
}
