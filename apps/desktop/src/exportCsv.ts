import { isTauri } from "@tauri-apps/api/core";

export async function saveCsvFile(
  contents: string,
  suggestedName: string,
): Promise<"saved" | "cancelled"> {
  return saveTextFile(
    contents,
    suggestedName,
    "CSV",
    "csv",
    "text/csv;charset=utf-8",
  );
}

export async function saveTextFile(
  contents: string,
  suggestedName: string,
  filterName: string,
  extension: string,
  mimeType: string,
): Promise<"saved" | "cancelled"> {
  if (isTauri()) {
    const [{ save }, { writeTextFile }] = await Promise.all([
      import("@tauri-apps/plugin-dialog"),
      import("@tauri-apps/plugin-fs"),
    ]);
    const path = await save({
      defaultPath: suggestedName,
      filters: [{ name: filterName, extensions: [extension] }],
    });
    if (!path) return "cancelled";
    await writeTextFile(path, contents);
    return "saved";
  }

  const url = URL.createObjectURL(new Blob([contents], { type: mimeType }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = suggestedName;
  anchor.click();
  URL.revokeObjectURL(url);
  return "saved";
}
