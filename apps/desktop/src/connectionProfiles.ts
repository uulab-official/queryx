import { invoke, isTauri } from "@tauri-apps/api/core";
import type { ConnectionProfile, DriverKind } from "@queryx/shared";

export const connectionProfilesStorageKey = "queryx:connection-profiles";
const nativeProfilesPath = "queryx/connection-profiles.json";
const maxProfiles = 50;

function isDriverKind(value: unknown): value is DriverKind {
  return (
    value === "postgres" ||
    value === "mysql" ||
    value === "sqlserver" ||
    value === "oracle" ||
    value === "sqlite"
  );
}

function isSslMode(
  value: unknown,
): value is NonNullable<ConnectionProfile["sslMode"]> {
  return (
    value === "disable" ||
    value === "prefer" ||
    value === "require" ||
    value === "verifyCa" ||
    value === "verifyFull"
  );
}

function isPort(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isInteger(value) &&
    value >= 1 &&
    value <= 65535
  );
}

function normalizeSshTunnel(value: unknown): ConnectionProfile["sshTunnel"] {
  if (!value || typeof value !== "object") return undefined;
  const item = value as Record<string, unknown>;
  if (
    typeof item.sshHost !== "string" ||
    !item.sshHost.trim() ||
    typeof item.sshUsername !== "string" ||
    !item.sshUsername.trim()
  ) {
    return undefined;
  }
  return {
    sshHost: item.sshHost.trim(),
    sshUsername: item.sshUsername.trim(),
    ...(isPort(item.sshPort) ? { sshPort: item.sshPort } : {}),
    ...(isPort(item.localPort) ? { localPort: item.localPort } : {}),
    ...(typeof item.privateKeyPath === "string" && item.privateKeyPath.trim()
      ? { privateKeyPath: item.privateKeyPath.trim() }
      : {}),
    ...(typeof item.knownHostsPath === "string" && item.knownHostsPath.trim()
      ? { knownHostsPath: item.knownHostsPath.trim() }
      : {}),
  };
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
    .map((item) => {
      const sshTunnel = normalizeSshTunnel(item.sshTunnel);
      return {
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
        ...(typeof item.sslRootCert === "string" && item.sslRootCert.trim()
          ? { sslRootCert: item.sslRootCert.trim() }
          : {}),
        ...(typeof item.sslClientCert === "string" && item.sslClientCert.trim()
          ? { sslClientCert: item.sslClientCert.trim() }
          : {}),
        ...(typeof item.sslClientKey === "string" && item.sslClientKey.trim()
          ? { sslClientKey: item.sslClientKey.trim() }
          : {}),
        ...(sshTunnel ? { sshTunnel } : {}),
        ...(item.passwordStored === true ? { passwordStored: true } : {}),
      };
    })
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
    const stored = await invoke<unknown | null>("load_connection_profiles");
    if (stored !== null) return normalizeConnectionProfiles(stored);
  } catch {
    // Fall through to the legacy JSON migration path.
  }
  try {
    const { BaseDirectory, readTextFile } = await import(
      "@tauri-apps/plugin-fs"
    );
    const stored = await readTextFile(nativeProfilesPath, {
      baseDir: BaseDirectory.AppLocalData,
    });
    const profiles = normalizeConnectionProfiles(JSON.parse(stored));
    await invoke("save_connection_profiles", { profiles });
    return profiles;
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
  await invoke("save_connection_profiles", { profiles: nextProfiles });
}
