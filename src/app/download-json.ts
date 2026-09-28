// src/app/download-json.ts
//
// Saves a JSON string as a file through a temporary object URL. Shared by the
// recovery panel's config export and the §632 notice for unload journals under
// other keys.

/** Starts a download of `json` named `filename`. Returns false when the browser
 *  refused (no Blob / object URL support, or an exception), so the caller can say so. */
export function downloadJson(filename: string, json: string): boolean {
  try {
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
    return true;
  } catch {
    return false;
  }
}
