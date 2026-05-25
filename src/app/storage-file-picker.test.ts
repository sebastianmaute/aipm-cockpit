import { describe, it, expect, vi, afterEach } from "vitest";
import { createBackend, pickFileForBackend } from "./storage";

// Regression: each local format must pass a DISTINCT File System Access picker
// `id` so the browser remembers a separate location/filename per format.
// Without it, switching MD -> CSV reopened the picker on the last .md file.
describe("local file picker per-format id", () => {
  const w = window as unknown as { showSaveFilePicker?: unknown };
  const orig = w.showSaveFilePicker;
  afterEach(() => {
    w.showSaveFilePicker = orig;
  });

  it("passes a distinct picker id per format (csv vs md)", async () => {
    const calls: Array<{ id?: string; suggestedName?: string }> = [];
    w.showSaveFilePicker = vi.fn((opts: { id?: string; suggestedName?: string }) => {
      calls.push(opts);
      return Promise.resolve({ name: "f" });
    });

    // pickFile also persists the handle to IndexedDB (unavailable in this env);
    // swallow that — we only care about the picker options passed.
    await pickFileForBackend(createBackend({ kind: "local-csv" }))?.catch(() => {});
    await pickFileForBackend(createBackend({ kind: "local-md" }))?.catch(() => {});

    expect(calls).toHaveLength(2);
    expect(calls[0].id).toBeTruthy();
    expect(calls[1].id).toBeTruthy();
    expect(calls[0].id).not.toBe(calls[1].id);
    // The per-format suggested name should also differ (csv vs md).
    expect(calls[0].suggestedName).toMatch(/\.csv$/);
    expect(calls[1].suggestedName).toMatch(/\.md$/);
  });
});
