import { invoke, isTauri } from "@tauri-apps/api/core";

export async function loadConnectionPassword(
  profileId: string,
): Promise<string | null> {
  if (!isTauri()) return null;
  return invoke<string | null>("load_connection_password", { profileId });
}

export async function saveConnectionPassword(
  profileId: string,
  password: string,
): Promise<boolean> {
  if (!isTauri()) return false;
  await invoke("save_connection_password", { profileId, password });
  return true;
}

export async function deleteConnectionPassword(
  profileId: string,
): Promise<boolean> {
  if (!isTauri()) return false;
  await invoke("delete_connection_password", { profileId });
  return true;
}
