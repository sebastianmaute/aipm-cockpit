// src/app/use-load-truncation.test.ts
//
// The §103 truncated-load guard, tested at the unit it actually is: a
// small state machine plus the TWO choke points (`reportFor` / `flushCurrent`)
// that every storage load and every best-effort flush routes through.
//
// The end-to-end wiring — that each of the six load paths and seven write paths
// really calls them — is pinned in `use-storage-backend.test.tsx`
// ("§103 truncation reaches every load/flush path") and
// `use-storage-turso-ops.test.ts`. Those are the tests that fail if a call site
// is missed; these are the ones that fail if the machine itself is wrong.
import { readFileSync } from "node:fs";
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useLoadTruncation } from "./use-load-truncation";
import { type Lang, t } from "./i18n";

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
    expect(result.current.loadWasIncomplete).toBe(true);
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
    expect(result.current.loadWasIncomplete).toBe(true); // control: really raised

    showToast.mockClear();
    act(() => { result.current.truncationOps.reportFor(backendReporting({ entries: 0, blocks: 0 })); });

    expect(result.current.loadWasIncomplete).toBe(false);
    expect(showToast).not.toHaveBeenCalled(); // a clean load is silent, not reassuring
  });

  it("also lowers it for a backend that publishes NO truncation field at all", () => {
    // `lastLoadTruncation` is optional on `StorageBackend`; an undefined read
    // means "this load was fine", not "unknown".
    const { result } = render();
    act(() => { result.current.truncationOps.reportFor(backendReporting({ entries: 5, blocks: 0 })); });
    act(() => { result.current.truncationOps.reportFor(backendReporting(undefined)); });
    expect(result.current.loadWasIncomplete).toBe(false);
  });
});

// ★★★ WRITTEN AGAINST THE ONE SURVIVING TOAST, NOT A CALL COUNT OF TWO. The
// surface is SINGLE-SLOT: `use-toast.ts` holds a `useState<Toast | null>` and
// `showToast` is a bare `setToast(...)`, so a second call in the same tick
// REPLACES the first and nothing queues. The implementation used to fire these
// two diagnostics as separate toasts, and on a file that hit both, the
// dropped-rows count was overwritten before it could be read — with no banner
// to fall back on, unlike truncation. So "did `showToast` get called with it"
// is NOT the question; "is it in the toast the user is left holding" is.
describe("useLoadTruncation — import diagnostics", () => {
  /** A backend stand-in for the import channel. `lastLoadTruncation` is left
   *  undefined so `reportLoadTruncation` stays silent and every toast observed
   *  here is an import diagnostic. */
  const importing = (dropped?: number, unterminated?: boolean) => ({
    lastLoadTruncation: undefined,
    lastImportDroppedRows: dropped,
    lastImportUnterminatedQuote: unterminated,
  });

  // Built from the SAME keys the hook uses, so these assert composition and
  // reachability rather than re-pinning the copy (`i18n-encoding` and the DE
  // key-parity typecheck own the strings themselves).
  const droppedMsg = (n: number) => t("en-US", "importDroppedRowsWarning", n);
  const quoteMsg = t("en-US", "importUnbalancedQuotesWarning");

  it("surfaces the DROPPED-ROWS count when only rows were skipped", () => {
    const { result, showToast } = render();
    act(() => { result.current.truncationOps.reportFor(importing(4, false)); });
    expect(showToast).toHaveBeenCalledTimes(1);
    expect(showToast).toHaveBeenCalledWith("error", droppedMsg(4));
  });

  it("surfaces the UNTERMINATED-QUOTE warning when only the quote is unbalanced", () => {
    const { result, showToast } = render();
    act(() => { result.current.truncationOps.reportFor(importing(0, true)); });
    expect(showToast).toHaveBeenCalledTimes(1);
    expect(showToast).toHaveBeenCalledWith("error", quoteMsg);
  });

  it("surfaces BOTH losses when a file drops rows AND ends mid-quote", () => {
    // ★★★ THE CASE THE SEPARATE-TOAST IMPLEMENTATION LOST. They are different
    // losses with different remedies — skipped rows are gone from this import,
    // an unclosed quote means the tail may never have been parsed — so neither
    // may be dropped. One slot, so they compose.
    const { result, showToast } = render();
    act(() => { result.current.truncationOps.reportFor(importing(3, true)); });

    // Exactly one call: a second would overwrite the first, which is the defect.
    expect(showToast).toHaveBeenCalledTimes(1);
    expect(showToast).toHaveBeenCalledWith("error", expect.stringContaining(droppedMsg(3)));
    expect(showToast).toHaveBeenCalledWith("error", expect.stringContaining(quoteMsg));
    // ★ And they are separated — joined bare, two sentences run together.
    expect(showToast).toHaveBeenCalledWith("error", `${droppedMsg(3)} ${quoteMsg}`);
  });

  it("says NOTHING when the import was clean — and the fixture can still speak", () => {
    const { result, showToast } = render();
    // Absent fields, not zeroes: both are optional on `StorageBackend`, and an
    // undefined read means "nothing to report", not "unknown".
    act(() => { result.current.truncationOps.reportFor(importing(undefined, undefined)); });
    act(() => { result.current.truncationOps.reportFor(importing(0, false)); });
    expect(showToast).not.toHaveBeenCalled();

    // ★★ Non-vacuity control, in the same test so it cannot rot separately: the
    // SAME fixture shape with one condition flipped DOES reach the user, so the
    // silence above is the code's and not the setup's.
    act(() => { result.current.truncationOps.reportFor(importing(1, false)); });
    expect(showToast).toHaveBeenCalledTimes(1);
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

  it("allowIncompleteSave() re-opens the flush", async () => {
    // The mirror of the skip: a guard with no way out is a save LOCKOUT.
    const save = vi.fn(async () => {});
    const { result } = render(save);
    act(() => { result.current.truncationOps.reportFor(backendReporting({ entries: 5, blocks: 0 })); });
    await act(async () => { await result.current.truncationOps.flushCurrent(); });
    expect(save).not.toHaveBeenCalled(); // control

    act(() => { result.current.allowIncompleteSave(); });
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
    expect(result.current.loadWasIncomplete).toBe(true); // refusing must not clear the flag
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

  // ★★★ THIS CENSUS USED TO BE BLIND TO HALF THE LOAD SITES. It read OPS_FILES
  // — the two ops files only — while `use-storage-backend.ts` holds THREE of
  // the six `.load()` sites and was not in the list at all: loads=3 reports=2,
  // unseen.
  //
  // ★★ Widening it naively goes RED on correct code. `onOpenStorageFile`
  // (`use-storage-backend.ts`) deliberately does not report: that path applies
  // tasks and RAID only, never the loaded documents, so raising the flag would
  // warn about documents the user still has, and lowering it would clear a
  // warning still true of the live ones. So this census honours a MARKED
  // exemption at the site — the `ABSENCE_MARKERS` pattern from
  // `scripts/check-agents-symbols.mjs`, where a deliberate absence is declared
  // near the site and the scanner honours it — rather than a lower expected
  // count. A bare lower count would be satisfied by any file with the same
  // ratio, including one that simply forgot.
  const CENSUS_FILES = [
    "src/app/use-storage-backend.ts",
    "src/app/use-storage-file-ops.ts",
    "src/app/use-storage-turso-ops.ts",
  ];
  const REPORT_EXEMPT_MARKER = "NO reportFor:";

  it.each(CENSUS_FILES)("%s reports for every load it does not explicitly exempt", (file) => {
    const src = readFileSync(file, "utf8");
    const loads = src.match(/\.load\(\)/g)?.length ?? 0;
    const reports = src.match(/reportFor\(/g)?.length ?? 0;
    const exemptRe = new RegExp(REPORT_EXEMPT_MARKER, "g");
    const exempt = src.match(exemptRe)?.length ?? 0;
    expect(loads, `${file}: no load sites found — the census would be vacuous`).toBeGreaterThan(0);
    expect(
      reports + exempt,
      `${file}: ${loads} load(s), ${reports} report(s), ${exempt} marked exemption(s). ` +
        `Every load must call truncationOps.reportFor, or carry a "${REPORT_EXEMPT_MARKER}" ` +
        `comment at the site saying why it must not.`,
    ).toBe(loads);
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

  // ★★★ ENUMERATE, DO NOT COUNT. The first version of this scan compared two
  // regex COUNTS against an allowance of 3, and a cold review measured it: the
  // slack was 1, so one new unguarded `new X().save(liveWs)` would have landed
  // at the limit and stayed green. Worse, every added `guardedWrite(` increments
  // the subtrahend and BUYS BACK another ungated write, a `guardedWrite(` inside
  // a COMMENT counts the same, and the arithmetic the comment described was not
  // even the arithmetic being performed — `guardedWrite`'s own `backend.save(ws)`
  // lives in `use-load-truncation.ts`, which is not in this list, so the
  // subtraction was removing tokens that are not `.save(` occurrences at all.
  // It landed on the right answer by coincidence.
  //
  // A scalar cannot express a per-site property. This lists every write instead:
  // a new, moved or reworded one fails loudly and NAMES ITSELF in the diff, and
  // no offsetting change anywhere can hide it.
  /** `file:line — callee` for every `.save(` outside a comment. The CALLEE is the
   *  identity that matters (what is being written to); full-line matching broke on
   *  a 200-character destructure that merely happens to contain the binder. */
  const EXPECTED_WRITES = [
    // The choke point itself — the binder handed to useLoadTruncation, which
    // `flushCurrent` calls only after `mayCommitAfterIncompleteLoad()`.
    "use-storage-backend.ts useStorageBackend — backend",
    // The debounced save effect, gated at the top of the same effect.
    "use-storage-backend.ts emitStorageConfig — backend",
    // createProject — a workspace built from scratch, to a NEW backend.
    "use-storage-file-ops.ts createProject — targetBackend",
    // createDemoProject — the demo sample, likewise not the live workspace.
    // ★ NOT "a new backend" in the strict sense: BrowserBackend's stores are
    // module-level and unscoped, so this is a new INSTANCE over the SAME store.
    // Correctly ungated (the user asked for the demo), but do not reason about
    // it as isolated.
    "use-storage-file-ops.ts createDemoProject — targetBackend",
    // createTursoProject — a built workspace, to a brand-new project id.
    // ★ `migrateCurrentProjectToTurso` looks identical and is NOT here: it copies
    // the LIVE workspace, so it goes through `guardedWrite` and its `.save(` lives
    // in use-load-truncation.ts. That difference is the whole defect this catches.
    "use-storage-turso-ops.ts createTursoProject — new TursoBackend(cfg, id)",
  ];

  // ★★★ THE CALLEE ALONE IS NOT AN IDENTITY, and an earlier header here claimed
  // it was ("no offsetting change anywhere can hide it"). Two pairs COLLIDE on
  // callee — `use-storage-backend.ts — backend` twice and
  // `use-storage-file-ops.ts — targetBackend` twice — so a delete-plus-add
  // within one file at the same callee leaves the sorted multiset UNCHANGED.
  // Concretely: route `createDemoProject`'s write through `guardedWrite` while
  // adding `await targetBackend.save(liveWs)` to `loadProjectFromFile`, and a
  // new unguarded whole-workspace write ships on a green board.
  //
  // ★ Keyed on the ENCLOSING FUNCTION, not `file:line`. Line numbers are unique
  // but churn on every unrelated edit above them, and a test that goes red for
  // unrelated reasons gets its numbers bumped mechanically — which is how a real
  // move slips through. The function name is stable AND unique here.
  // ★ Function DECLARATIONS only. Including `const X =` picked up local
  // variables (`pick`, `ws`), which are unique but read as if they were the
  // handler — a key that misleads is worse than a coarse one. The two
  // `use-storage-backend.ts` entries are approximations (their writes sit inside
  // effects/closures, so the nearest declaration is whatever precedes); they are
  // stable and distinct, which is all the identity has to be.
  const enclosingFn = (lines: string[], i: number): string => {
    for (let j = i; j >= 0; j--) {
      const m = /^\s*(?:export\s+)?(?:async\s+)?function\s+([A-Za-z0-9_$]+)/.exec(lines[j]);
      if (m) return m[1];
    }
    return "(top level)";
  };

  it("every whole-workspace write is enumerated — no new one slips in unnoticed", () => {
    const found = WRITE_FILES.flatMap((f) => {
      const lines = readFileSync(f, "utf8").split("\n");
      return lines.flatMap((raw, i) => {
        const line = raw.trim();
        // ★ Skips `//` AND block-comment continuation lines (`*`). Without the
        // second, a `.save(` named inside a doc comment counts as a write, and
        // the tempting repair is to add it to the expected list — which then
        // permanently allows a REAL write at that spot.
        if (line.startsWith("//") || line.startsWith("*") || !/\.save\(/.test(line)) return [];
        const callee = /([A-Za-z0-9_$]+(?:\([^)]*\))?|new\s+[A-Za-z0-9_$]+\([^)]*\))\.save\(/.exec(line);
        return [`${f.split("/").pop()} ${enclosingFn(lines, i)} — ${callee?.[1] ?? "UNPARSED"}`];
      });
    });
    expect(found).toHaveLength(EXPECTED_WRITES.length); // control: the scan sees real writes
    // ★ `toContainEqual`, NOT `toContain`: only the former runs asymmetric
    // matchers. With `toContain` this compared a matcher OBJECT by strict
    // equality and was vacuously true, so its own comment described nothing.
    expect(found).not.toContainEqual(expect.stringContaining("UNPARSED"));
    expect([...found].sort()).toEqual([...EXPECTED_WRITES].sort());
  });
});
