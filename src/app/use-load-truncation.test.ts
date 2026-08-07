// src/app/use-load-truncation.test.ts
//
// The §102 truncated-load guard, tested at the unit it actually is: a
// small state machine plus the TWO choke points (`reportFor` / `flushCurrent`)
// that every storage load and every best-effort flush routes through.
//
// The end-to-end wiring — that each of the six load paths and seven write paths
// really calls them — is pinned in `use-storage-backend.test.tsx`
// ("§102 truncation reaches every load/flush path") and
// `use-storage-turso-ops.test.ts`. Those are the tests that fail if a call site
// is missed; these are the ones that fail if the machine itself is wrong.
import { readFileSync } from "node:fs";
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useLoadTruncation } from "./use-load-truncation";
import type { Lang } from "./i18n";

const langRef = { current: "en-US" as Lang };

function render(saveCurrentWorkspace: () => Promise<void> = async () => {}) {
  const showToast = vi.fn();
  const view = renderHook(() => useLoadTruncation(langRef, showToast, saveCurrentWorkspace));
  return { ...view, showToast };
}

/** A backend stand-in: only the published truncation matters here. */
const backendReporting = (truncation?: { entries: number; blocks: number }) => ({ lastLoadTruncation: truncation });

describe("useLoadTruncation — reportFor", () => {
  it("raises the flag and toasts on truncated ENTRIES", () => {
    const { result, showToast } = render();
    act(() => { result.current.truncationOps.reportFor(backendReporting({ entries: 5, blocks: 0 })); });
    expect(result.current.loadWasTruncated).toBe(true);
    expect(showToast).toHaveBeenCalledWith("error", expect.stringContaining("5"));
  });

  it("LOWERS the flag on a clean load", () => {
    // ★★★ The invariant every backend already holds for `lastLoadTruncation`
    // (reset before any early return, because a stale value is worse than zero)
    // and the consumer used to break: without this, one over-cap project blocks
    // saving for the whole session while the banner asserts a HEALTHY project's
    // documents could not be opened.
    const { result, showToast } = render();
    act(() => { result.current.truncationOps.reportFor(backendReporting({ entries: 5, blocks: 0 })); });
    expect(result.current.loadWasTruncated).toBe(true); // control: really raised

    showToast.mockClear();
    act(() => { result.current.truncationOps.reportFor(backendReporting({ entries: 0, blocks: 0 })); });

    expect(result.current.loadWasTruncated).toBe(false);
    expect(showToast).not.toHaveBeenCalled(); // a clean load is silent, not reassuring
  });

  it("also lowers it for a backend that publishes NO truncation field at all", () => {
    // `lastLoadTruncation` is optional on `StorageBackend`; an undefined read
    // means "this load was fine", not "unknown".
    const { result } = render();
    act(() => { result.current.truncationOps.reportFor(backendReporting({ entries: 5, blocks: 0 })); });
    act(() => { result.current.truncationOps.reportFor(backendReporting(undefined)); });
    expect(result.current.loadWasTruncated).toBe(false);
  });
});

describe("useLoadTruncation — flushCurrent", () => {
  it("writes when nothing is unresolved", async () => {
    const save = vi.fn(async () => {});
    const { result } = render(save);
    await act(async () => { await result.current.truncationOps.flushCurrent(); });
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("SKIPS the write while a truncated load is unresolved, without throwing", async () => {
    const save = vi.fn(async () => {});
    const { result } = render(save);
    act(() => { result.current.truncationOps.reportFor(backendReporting({ entries: 5, blocks: 0 })); });

    // Not throwing is load-bearing: every caller treats a rejection as a real
    // save FAILURE (Turso raises a toast for it), and a deliberate skip is not.
    await act(async () => { await expect(result.current.truncationOps.flushCurrent()).resolves.toBeUndefined(); });

    expect(save).not.toHaveBeenCalled();
  });

  it("propagates a REAL save error — a skip is silent, a failure is not", async () => {
    const { result } = render(async () => { throw new Error("network down"); });
    await act(async () => {
      await expect(result.current.truncationOps.flushCurrent()).rejects.toThrow("network down");
    });
  });

  it("allowTruncatedSave() re-opens the flush", async () => {
    // The mirror of the skip: a guard with no way out is a save LOCKOUT.
    const save = vi.fn(async () => {});
    const { result } = render(save);
    act(() => { result.current.truncationOps.reportFor(backendReporting({ entries: 5, blocks: 0 })); });
    await act(async () => { await result.current.truncationOps.flushCurrent(); });
    expect(save).not.toHaveBeenCalled(); // control

    act(() => { result.current.allowTruncatedSave(); });
    await act(async () => { await result.current.truncationOps.flushCurrent(); });

    expect(save).toHaveBeenCalledTimes(1);
  });
});

describe("useLoadTruncation — guardedWrite (explicit user actions)", () => {
  const target = () => ({ save: vi.fn(async () => {}) });

  it("writes and returns true when nothing is unresolved", async () => {
    const { result } = render();
    const b = target();
    let ok = false;
    await act(async () => { ok = await result.current.truncationOps.guardedWrite(b, {} as never); });
    expect(ok).toBe(true);
    expect(b.save).toHaveBeenCalledTimes(1);
  });

  it("REFUSES LOUDLY — no write, returns false, and re-states the counts", async () => {
    // ★★ The contrast with `flushCurrent`, which skips SILENTLY. These callers
    // are clicks; a silent no-op would read as a completed save.
    const { result, showToast } = render();
    act(() => { result.current.truncationOps.reportFor(backendReporting({ entries: 8, blocks: 0 })); });
    showToast.mockClear();

    const b = target();
    let ok = true;
    await act(async () => { ok = await result.current.truncationOps.guardedWrite(b, {} as never); });

    expect(ok).toBe(false);
    expect(b.save).not.toHaveBeenCalled();
    expect(showToast).toHaveBeenCalledWith("error", expect.stringContaining("8"));
  });

  it("states the counts even when the write TARGET never served a load", async () => {
    // ★★★ Why the counts are held in a ref rather than re-read off the backend:
    // `onRequestStorageSwitch` converts INTO a freshly-built backend whose
    // `lastLoadTruncation` is empty. Deriving the message from that backend
    // would report "clean" — and, worse, LOWER the flag at the moment of
    // refusing. The target here has no such field at all.
    const { result, showToast } = render();
    act(() => { result.current.truncationOps.reportFor(backendReporting({ entries: 0, blocks: 9 })); });
    showToast.mockClear();

    await act(async () => { await result.current.truncationOps.guardedWrite(target(), {} as never); });

    expect(showToast).toHaveBeenCalledWith("error", expect.stringContaining("9"));
    expect(result.current.loadWasTruncated).toBe(true); // refusing must not clear the flag
  });

  it("propagates a REAL save error rather than reporting a refusal", async () => {
    const { result } = render();
    const b = { save: vi.fn(async () => { throw new Error("disk full"); }) };
    await act(async () => {
      await expect(result.current.truncationOps.guardedWrite(b, {} as never)).rejects.toThrow("disk full");
    });
  });
});

// ── completeness net ─────────────────────────────────────────────────────────
// ★★ WHAT THIS PROVES AND WHAT IT DOES NOT. It is a SOURCE SCAN. It proves only
// that certain TOKENS do (not) appear in two files:
//   • no `deps.backend.…` — the ops hooks hold no raw handle on the active
//     backend, so a future flush there CANNOT bypass `flushCurrent`; the deps
//     objects genuinely carry no such field (a tsc error, not just a scan
//     failure, if one came back);
//   • as many `reportFor(` calls as `.load()` calls.
// It does NOT prove the calls are REACHED, that they run on the right branch,
// or that `reportFor` was handed the backend that actually served the load —
// a `reportFor` inside a dead branch, or pointed at the wrong backend, passes
// this scan. The behavioural tests named at the top of this file are what pin
// those; this only catches a NEW path added without either.
describe("ops files — no unguarded backend access (source scan)", () => {
  const OPS_FILES = ["src/app/use-storage-file-ops.ts", "src/app/use-storage-turso-ops.ts"];

  it.each(OPS_FILES)("%s reaches the active backend only through the choke points", (file) => {
    const src = readFileSync(file, "utf8");
    // `deps.backendFor(` (a FACTORY for a target backend, not the active one) is
    // legitimate and must not match — hence the required `.` after `backend`.
    expect(src.match(/deps\.backend\s*\./g)).toBeNull();
  });

  it.each(OPS_FILES)("%s reports every load it performs", (file) => {
    const src = readFileSync(file, "utf8");
    const loads = src.match(/\.load\(\)/g)?.length ?? 0;
    const reports = src.match(/reportFor\(/g)?.length ?? 0;
    expect(loads).toBeGreaterThan(0); // control: the scan is looking at the right file
    expect(reports).toBe(loads);
  });

  // ★★★ THIS CENSUS EXISTS BECAUSE THE SCAN ABOVE MISSED A REAL DEFECT.
  // The reads were guarded and the WRITES were not counted at all, and
  // `use-storage-backend.ts` — which holds both `guardedWrite` call sites — was
  // outside OPS_FILES entirely. `migrateCurrentProjectToTurso` shipped writing
  // the LIVE (possibly truncated) workspace via `new TursoBackend(cfg, id).save(ws)`,
  // then repointed the app at that short copy and reloaded, after which the flag
  // never re-raised and nothing told the user. `deps.backend.` did not match it,
  // because the backend was constructed inline.
  //
  // So: every `.save(` in the three storage files is enumerated here and must be
  // either a choke point, behind one, or on this allowlist WITH a reason.
  const WRITE_FILES = [
    "src/app/use-storage-backend.ts",
    "src/app/use-storage-file-ops.ts",
    "src/app/use-storage-turso-ops.ts",
  ];
  /** Writes of a workspace that did NOT come from a load. A truncated CURRENT
   *  workspace is irrelevant to them, so they are correctly ungated. */
  const ALLOWED_UNGATED = 3; // createProject · createDemoProject · createTursoProject

  it("every whole-workspace write is a choke point, behind one, or allowlisted", () => {
    const src = WRITE_FILES.map((f) => readFileSync(f, "utf8")).join("\n");
    const saves = src.match(/\.save\(/g)?.length ?? 0;
    const choked = src.match(/guardedWrite\(|saveCurrentWorkspace\(\)/g)?.length ?? 0;
    expect(saves).toBeGreaterThan(0); // control: the scan is looking at real files
    // Each guarded write still contains a `.save(` inside the choke point, so the
    // arithmetic is: total saves - the ones the choke points own - the allowlist.
    expect(saves - choked).toBeLessThanOrEqual(ALLOWED_UNGATED);
  });
});
