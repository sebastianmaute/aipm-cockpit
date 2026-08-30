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

  // ── naming the sections (§152, second half, surfaced) ───────────────────
  const sectionsMsg = (names: string) => t("en-US", "importDroppedRowsSections", names);

  it("NAMES the sections a report's dropped rows came from", () => {
    // ★★★ THE POINT OF THE WHOLE ATTRIBUTION SLICE. "5 invalid row(s)" leaves
    // the user unable to tell whether the loss hit the tasks they just imported
    // or a section the path discards — two losses, two remedies.
    const { result, showToast } = render();
    act(() => {
      result.current.truncationOps.reportFor({
        lastLoadTruncation: undefined,
        lastImportDroppedRows: 5,
        lastImportDroppedBySection: { raid: 2, tasks: 3 },
      });
    });
    expect(showToast).toHaveBeenCalledTimes(1);
    expect(showToast).toHaveBeenCalledWith(
      "error",
      `${droppedMsg(5)} ${sectionsMsg(`${t("en-US", "importSectionTasks")}, ${t("en-US", "importSectionRaid")}`)}`,
    );
  });

  it("orders the names by IMPORT_SECTION_KEYS, not by insertion", () => {
    // ★ The fixture above already lists raid BEFORE tasks and expects the
    //   reverse, so this pins the rule rather than re-testing the case: an
    //   `Object.keys` walk would echo whatever order the decoder happened to
    //   write, which differs between a CSV and a Markdown file of the same data.
    const { result, showToast } = render();
    act(() => {
      result.current.truncationOps.reportFor({
        lastLoadTruncation: undefined,
        lastImportDroppedRows: 3,
        lastImportDroppedBySection: { grades: 1, milestones: 1, tasks: 1 },
      });
    });
    const seen = String(showToast.mock.calls[0][1]);
    expect(seen.indexOf(t("en-US", "importSectionTasks"))).toBeLessThan(
      seen.indexOf(t("en-US", "importSectionMilestones")),
    );
    expect(seen.indexOf(t("en-US", "importSectionMilestones"))).toBeLessThan(
      seen.indexOf(t("en-US", "importSectionGrades")),
    );
  });

  it("omits the section sentence when the backend published none", () => {
    // ★ JSON and Turso backends never set the field. A bare "Affected sections:"
    //   with nothing after it is worse than saying nothing.
    const { result, showToast } = render();
    act(() => { result.current.truncationOps.reportFor(importing(2, false)); });
    expect(showToast).toHaveBeenCalledWith("error", droppedMsg(2));
  });

  it("omits the section sentence when every published count is zero", () => {
    // ★ A defensive shape, not one the writer can produce: `countDroppedRow`
    //   only ever writes a positive count. Pinned so a future writer that
    //   zero-fills cannot make the sentence name sections that lost nothing.
    const { result, showToast } = render();
    act(() => {
      result.current.truncationOps.reportFor({
        lastLoadTruncation: undefined,
        lastImportDroppedRows: 2,
        lastImportDroppedBySection: { tasks: 0 },
      });
    });
    expect(showToast).toHaveBeenCalledWith("error", droppedMsg(2));
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

// ★★★ A DECODE FAILURE IS AN INCOMPLETE LOAD, and it routes into THIS guard
// rather than a second mechanism. A malformed meta blob left its slice
// undefined and the load proceeded silently; the next save then ran
// `DELETE FROM meta` and re-inserted only the rows it had, destroying the blob.
// Same banner, same lockout, same escape — and the escape is load-bearing here
// in a way it is not for truncation: the user cannot repair a corrupt blob from
// inside the app at any cap, so without a reachable way out this is a permanent
// save lockout.
// ★★★ MALFORMED QUOTING IS THE THIRD HOLD CAUSE, AND IT IS NOT THE SAME AS THE
// TWO IMPORT DIAGNOSTICS ABOVE. Dropped rows and an unterminated quote are
// TOAST-ONLY: they describe rows that never made it in, and the file they came
// from is still on disk to re-import. A file carrying RFC 4180 violations is
// different — we REINTERPRETED it, applied our reading to render scope, and the
// next save writes that reading back OVER the source. So the hold exists to stop
// a silent overwrite of the only copy, which is the same reasoning truncation
// and undecodable slices already use.
// ★★ It reports MALFORMEDNESS, never "a section was swallowed" — that question
// is undecidable (§150) and no assertion here may imply otherwise.
describe("useLoadTruncation — malformed quoting", () => {
  const malformed = (count?: number) => ({
    lastLoadTruncation: undefined,
    lastImportMalformedQuotes: count,
  });

  it("raises the hold when the file violates RFC 4180", () => {
    const { result } = render();
    act(() => { result.current.truncationOps.reportFor(malformed(2)); });
    expect(result.current.loadWasIncomplete).toBe(true);
  });

  it("LOWERS the hold on a clean load", () => {
    // Same invariant as truncation: the flag is scoped to the workspace live
    // RIGHT NOW, so leaving it raised blocks saving on a healthy project.
    const { result } = render();
    act(() => { result.current.truncationOps.reportFor(malformed(2)); });
    expect(result.current.loadWasIncomplete).toBe(true); // control: really raised
    act(() => { result.current.truncationOps.reportFor(malformed(0)); });
    expect(result.current.loadWasIncomplete).toBe(false);
  });

  it("also lowers it for a backend publishing no such field at all", () => {
    // The field is optional and MD/JSON never set it; undefined means "fine",
    // not "unknown".
    const { result } = render();
    act(() => { result.current.truncationOps.reportFor(malformed(2)); });
    act(() => { result.current.truncationOps.reportFor(malformed(undefined)); });
    expect(result.current.loadWasIncomplete).toBe(false);
  });

  it("refuses a write while the hold is up, and allows one after acknowledgement", () => {
    const { result } = render();
    act(() => { result.current.truncationOps.reportFor(malformed(2)); });
    expect(result.current.truncationOps.wouldRefuseWrite()).toBe(true);

    act(() => { result.current.allowIncompleteSave(); });
    expect(result.current.loadWasIncomplete).toBe(false);
    expect(result.current.truncationOps.wouldRefuseWrite()).toBe(false);
  });

  it("is cleared for a brand-new workspace", () => {
    // A fresh project has no load to hang the flag on, so anything left raised
    // belongs to the PREVIOUS project and would refuse every edit to this one.
    const { result } = render();
    act(() => { result.current.truncationOps.reportFor(malformed(2)); });
    act(() => { result.current.truncationOps.clearForFreshWorkspace(); });
    expect(result.current.loadWasIncomplete).toBe(false);
  });

  it("holds independently of the other two causes", () => {
    // ★ A clean truncation report must not lower a hold raised by quoting, or
    // one cause silently cancels another — the failure the single derivation
    // over separate slots exists to prevent.
    const { result } = render();
    act(() => { result.current.truncationOps.reportFor(malformed(2)); });
    act(() => {
      result.current.truncationOps.reportFor({
        lastLoadTruncation: { entries: 0, blocks: 0 },
        lastImportMalformedQuotes: 2,
      });
    });
    expect(result.current.loadWasIncomplete).toBe(true);
  });
});

/** The decode-channel stand-in, at module scope so BOTH the import-only tests
 *  and the decode describe below raise a decode hold the same way. */
const decodingFor = (slices: readonly string[]) => ({
  lastLoadTruncation: undefined,
  lastImportDroppedRows: 0,
  lastImportUnterminatedQuote: false,
  lastDecodeFailures: slices,
});

// ── the import-only op (§152) ────────────────────────────────────────────────
// ★★★ IT EXISTS BECAUSE ONE LOAD PATH APPLIES ROWS WITHOUT REPLACING THE
// WORKSPACE. `onOpenStorageFile` (`use-storage-backend.ts`) applies `loaded.tasks`
// and `loaded.raid` into the LIVE workspace and discards every other slice, so
// `reportFor` is wrong for it in BOTH directions: raising the truncation flag
// would warn about documents the user still holds, and lowering it would clear a
// warning still true of those documents. That reasoning is truncation-specific
// and does NOT extend to the import channel — the rows this path drops may be
// the very tasks and RAID it is about to apply — which is the split §152 asks
// for and what this op is.
describe("useLoadTruncation — reportImportFor", () => {
  /** A backend stand-in for the import channel ALONE — it publishes no
   *  `lastLoadTruncation` and no `lastDecodeFailures` field at all.
   *  ★★ WHAT STOPS `reportImportFor` READING EITHER IS ITS OWN PARAMETER TYPE, a
   *  4-member `Pick<StorageBackend, …>`, NOT this fixture. An earlier revision of
   *  this docstring claimed the omission itself would make such a read "a tsc
   *  error rather than a silently-undefined read", and it cannot: every
   *  `lastImport*` field plus `lastLoadTruncation`/`lastDecodeFailures` is
   *  OPTIONAL on `StorageBackend`, and omitting an optional property from an
   *  argument is never an error. The guarantee is real and the stated mechanism
   *  was not — which matters, because a contributor who later widened the `Pick`
   *  would have read this fixture as still protecting them. */
  const opened = (opts: { dropped?: number; unterminated?: boolean; malformed?: number }) => ({
    lastImportDroppedRows: opts.dropped,
    lastImportUnterminatedQuote: opts.unterminated,
    lastImportMalformedQuotes: opts.malformed,
  });

  it("reports dropped rows without raising the hold", () => {
    const { result, showToast } = render();
    act(() => { result.current.truncationOps.reportImportFor(opened({ dropped: 4 }), true); });
    expect(showToast).toHaveBeenLastCalledWith("error", t("en-US", "importDroppedRowsWarning", 4));
    expect(result.current.loadWasIncomplete).toBe(false);
  });

  it("composes the same sentence join as the full report", () => {
    const { result, showToast } = render();
    act(() => { result.current.truncationOps.reportImportFor(opened({ dropped: 2, unterminated: true }), true); });
    expect(showToast).toHaveBeenLastCalledWith(
      "error",
      `${t("en-US", "importDroppedRowsWarning", 2)} ${t("en-US", "importUnbalancedQuotesWarning")}`,
    );
  });

  it("stays silent on a clean import", () => {
    const { result, showToast } = render();
    act(() => { result.current.truncationOps.reportImportFor(opened({ dropped: 0, unterminated: false, malformed: 0 }), true); });
    expect(showToast).not.toHaveBeenCalled();
  });

  // ★★★ THE REFUSAL MUST SPEAK ON THE MALFORMED CAUSE, and for a release it did
  // not. `loadWasIncomplete` is a THREE-cause derivation while `refuseWrite`
  // enumerated two, and malformed-only is the NORMAL shape here — a file backend
  // has no meta blob to fail decoding and typically no document truncation. So
  // `wouldRefuseWrite()` returned true, `refuseWrite()` built an EMPTY `parts`,
  // and the user's explicit "Pick storage file" click did nothing and said
  // nothing. Nothing tested `refuseWrite`'s BEHAVIOUR at all before this.
  it("speaks when the ONLY cause is malformed quoting", () => {
    const { result, showToast } = render();
    act(() => { result.current.truncationOps.reportImportFor(opened({ malformed: 3 }), true); });
    // The hold is genuinely raised off this cause alone — the precondition that
    // makes a silent refusal reachable. Without this the test below could pass
    // because the refusal never ran.
    expect(result.current.loadWasIncomplete).toBe(true);
    expect(result.current.truncationOps.wouldRefuseWrite()).toBe(true);

    showToast.mockClear();
    act(() => { result.current.truncationOps.refuseWrite(); });
    expect(showToast).toHaveBeenCalledTimes(1);
    expect(showToast).toHaveBeenLastCalledWith("error", t("en-US", "importMalformedQuotesWarning", 3));
  });

  // ★ The nonce is what lets the banner's re-show reconcile see this cause at
  // all; a COUNT cannot, since two projects violating the same NUMBER of rules
  // compare equal. Bumped on the raising branch ONLY.
  it("mints a fresh identity per raising load, and none on a clean one", () => {
    const { result } = render();
    const start = result.current.malformedQuotesNonce;

    act(() => { result.current.truncationOps.reportImportFor(opened({ malformed: 2 }), true); });
    const afterFirst = result.current.malformedQuotesNonce;
    expect(afterFirst).not.toBe(start);
    expect(result.current.malformedQuoteCount).toBe(2);

    // A SECOND load with the same COUNT must still move the nonce — this is the
    // whole reason it is not a count.
    act(() => { result.current.truncationOps.reportImportFor(opened({ malformed: 2 }), true); });
    expect(result.current.malformedQuotesNonce).not.toBe(afterFirst);

    // A clean load lowers the count and must NOT mint an identity, or the banner
    // re-shows for a load that found nothing wrong.
    const afterSecond = result.current.malformedQuotesNonce;
    act(() => { result.current.truncationOps.reportFor({ ...opened({ malformed: 0 }), lastLoadTruncation: undefined, lastDecodeFailures: [] }); });
    expect(result.current.malformedQuotesNonce).toBe(afterSecond);
    expect(result.current.malformedQuoteCount).toBe(0);
  });

  // ★★★ RAISE-ONLY, AND ONLY WHEN THE BACKEND IS ACTUALLY BOUND TO THE FILE JUST
  // READ. That condition used to be free: `LocalFileBackend.openFile()` ended
  // `await idbSet(this.idbKey, handle)`, re-pointing the ACTIVE backend at the picked
  // file on BOTH exits of the overwrite confirm, so the next debounced save wrote the
  // live workspace back OVER the file just read either way. §287 moved that commit
  // inside the ACCEPT branch, so the caller now has to SAY which case it is and these
  // two tests pin the two answers. Do not merge them: they assert opposite state.
  it("RAISES the hold for a malformed file the backend is now bound to", () => {
    const { result } = render();
    act(() => { result.current.truncationOps.reportImportFor(opened({ malformed: 2 }), true); });
    expect(result.current.loadWasIncomplete).toBe(true);
    expect(result.current.mayCommitAfterIncompleteLoad()).toBe(false);
  });

  it("does NOT raise the hold when the backend was never bound to the file read", () => {
    // ★★★ THE DECLINED-CONFIRM CASE, and a real regression this pins. With the
    // commit moved into the accept branch, declining leaves the active backend on the
    // user's PREVIOUS file — which the malformed one has nothing to do with. Raising
    // here refuses autosave of an untouched project over a file the user just refused
    // to open, and nothing lowers it again for the rest of the session.
    const { result } = render();
    act(() => { result.current.truncationOps.reportImportFor(opened({ malformed: 2 }), false); });
    expect(result.current.loadWasIncomplete).toBe(false);
    expect(result.current.mayCommitAfterIncompleteLoad()).toBe(true);
  });

  it("still reports the import diagnostics when it does not raise the hold", () => {
    // ★★ Separate it(), and the anti-vacuity control for the one above: a
    // `reportImportFor` that did NOTHING AT ALL on the unbound path would satisfy
    // those two assertions perfectly. §152 is the record of what skipping the report
    // costs, so only the STATE CHANGE is conditional — the diagnostics are not.
    const { result, showToast } = render();
    act(() => { result.current.truncationOps.reportImportFor(opened({ dropped: 4 }), false); });
    expect(showToast).toHaveBeenLastCalledWith("error", t("en-US", "importDroppedRowsWarning", 4));
  });

  it("does NOT lower a truncation hold a previous load raised", () => {
    // The whole reason this op exists: nothing here describes the documents the
    // §103 flag is about, so a clean import may not clear their warning.
    const { result } = render();
    act(() => { result.current.truncationOps.reportFor(backendReporting({ entries: 5, blocks: 0 })); });
    act(() => { result.current.truncationOps.reportImportFor(opened({ dropped: 0 }), true); });
    expect(result.current.loadWasIncomplete).toBe(true);
    expect(result.current.truncation).toEqual({ entries: 5, blocks: 0 });
  });

  it("does NOT lower a malformed-quote hold a previous load raised", () => {
    // Same rule as `raiseDecodeFailuresFor`: the live workspace still carries
    // the earlier file's reading, so the warning is still true of it.
    const { result } = render();
    act(() => {
      result.current.truncationOps.reportFor({
        lastLoadTruncation: undefined,
        lastImportMalformedQuotes: 3,
      });
    });
    act(() => { result.current.truncationOps.reportImportFor(opened({ malformed: 0 }), true); });
    expect(result.current.loadWasIncomplete).toBe(true);
  });

  it("does NOT lower a decode hold a previous load raised", () => {
    const { result } = render();
    act(() => { result.current.truncationOps.reportFor(decodingFor(["documents"])); });
    act(() => { result.current.truncationOps.reportImportFor(opened({ dropped: 1 }), true); });
    expect(result.current.loadWasIncomplete).toBe(true);
    expect(result.current.decodeFailureCount).toBe(1);
  });
});

describe("useLoadTruncation — undecodable meta slices", () => {
  /** A backend stand-in for the decode channel. `lastLoadTruncation` is left
   *  undefined so nothing observed here comes from the §103 cap. */
  const decoding = decodingFor;

  it("pauses saving when a load could not decode a slice", () => {
    const { result } = render();
    act(() => { result.current.truncationOps.reportFor(decoding(["documents"])); });
    expect(result.current.loadWasIncomplete).toBe(true);
    expect(result.current.mayCommitAfterIncompleteLoad()).toBe(false);
  });

  it("a clean load lowers the flag again", () => {
    // The same invariant a clean load holds for truncation: the flag is scoped
    // to the workspace that is live RIGHT NOW, and this one decoded fine.
    const { result } = render();
    act(() => { result.current.truncationOps.reportFor(decoding(["documents"])); });
    expect(result.current.loadWasIncomplete).toBe(true); // control: really raised
    act(() => { result.current.truncationOps.reportFor(decoding([])); });
    expect(result.current.loadWasIncomplete).toBe(false);
  });

  it("the escape hatch releases a decode-failure lockout", () => {
    const { result } = render();
    act(() => {
      result.current.truncationOps.reportFor(decoding(["documents", "insights"]));
    });
    expect(result.current.mayCommitAfterIncompleteLoad()).toBe(false);
    act(() => { result.current.allowIncompleteSave(); });
    expect(result.current.loadWasIncomplete).toBe(false);
    expect(result.current.mayCommitAfterIncompleteLoad()).toBe(true);
  });

  it("names how many slices failed, for the banner — and drops it on a clean load", () => {
    // The count is what the "Save anyway" dialog shows. The KEYS stay internal:
    // `documentVersions` / `settings_overrides` are identifiers, not copy.
    const { result } = render();
    expect(result.current.decodeFailureCount).toBe(0);
    act(() => { result.current.truncationOps.reportFor(decoding(["documents", "insights"])); });
    expect(result.current.decodeFailureCount).toBe(2);
    act(() => { result.current.truncationOps.reportFor(decoding([])); });
    expect(result.current.decodeFailureCount).toBe(0);
  });

  it("tells the user, and stays quiet on a clean load", () => {
    const { result, showToast } = render();
    act(() => { result.current.truncationOps.reportFor(decoding(["documents"])); });
    expect(showToast).toHaveBeenCalledWith("error", expect.stringContaining("1"));
    showToast.mockClear();
    act(() => { result.current.truncationOps.reportFor(decoding([])); });
    expect(showToast).not.toHaveBeenCalled();
  });

  it("treats a backend that publishes NO decode field as a clean read", () => {
    // `lastDecodeFailures` is optional on `StorageBackend` — only Turso stores
    // meta blobs — so an undefined read means "nothing to report", not "unknown".
    const { result } = render();
    act(() => { result.current.truncationOps.reportFor(backendReporting(undefined)); });
    expect(result.current.loadWasIncomplete).toBe(false);
    expect(result.current.decodeFailureCount).toBe(0);
  });

  it("SKIPS a best-effort flush while a decode failure is unresolved", async () => {
    // The lockout has to reach the same choke point truncation does; a flag
    // nothing consults is the loss this guard exists to prevent.
    const save = vi.fn(async () => {});
    const { result } = render(save);
    act(() => { result.current.truncationOps.reportFor(decoding(["documents"])); });
    await act(async () => { await result.current.truncationOps.flushCurrent(); });
    expect(save).not.toHaveBeenCalled();
  });

  // ── raiseDecodeFailuresFor — the refused-load reporter ─────────────────────
  //
  // ★★ The two empty-load refusals apply nothing, so `reportFor` is wrong for
  // them in BOTH directions on truncation and in ONE direction on decode. These
  // pin the asymmetry, which is the whole content of the member.
  it("raises the decode flag for a load whose workspace was REFUSED", () => {
    const { result } = render();
    act(() => { result.current.truncationOps.raiseDecodeFailuresFor(decoding(["documents"])); });
    expect(result.current.loadWasIncomplete).toBe(true);
    expect(result.current.decodeFailureCount).toBe(1);
    expect(result.current.mayCommitAfterIncompleteLoad()).toBe(false);
  });

  it("NEVER lowers a flag raised over the workspace that is still live", () => {
    // A refusal applied nothing, so the raised flag still describes the LIVE
    // workspace — the previous load's. Lowering it on the strength of one
    // suspicious empty read resumes autosave over a database that failed to
    // decode minutes ago.
    const { result } = render();
    act(() => { result.current.truncationOps.reportFor(decoding(["documents"])); });
    expect(result.current.loadWasIncomplete).toBe(true); // control: really raised
    act(() => { result.current.truncationOps.raiseDecodeFailuresFor(decoding([])); });
    expect(result.current.loadWasIncomplete).toBe(true);
    expect(result.current.decodeFailureCount).toBe(1);
    // CONTRAST, in the same test so the two cannot drift: `reportFor` — which
    // runs only where a workspace WAS applied — does lower it.
    act(() => { result.current.truncationOps.reportFor(decoding([])); });
    expect(result.current.loadWasIncomplete).toBe(false);
  });

  it("leaves TRUNCATION alone — it is a property of documents never applied", () => {
    const { result } = render();
    act(() => { result.current.truncationOps.reportFor(backendReporting({ entries: 5, blocks: 0 })); });
    expect(result.current.truncation).toEqual({ entries: 5, blocks: 0 }); // control
    act(() => {
      result.current.truncationOps.raiseDecodeFailuresFor({
        ...decoding(["documents"]),
        // A backend still publishing DIFFERENT truncation counts: they must not
        // reach the guard through this member.
        lastLoadTruncation: { entries: 99, blocks: 99 },
      } as never);
    });
    expect(result.current.truncation).toEqual({ entries: 5, blocks: 0 });
    expect(result.current.decodeFailureCount).toBe(1); // the decode half DID land
  });

  it("tells the user on a refusal, and stays quiet when there is nothing to say", () => {
    const { result, showToast } = render();
    act(() => { result.current.truncationOps.raiseDecodeFailuresFor(decoding(["documents", "insights"])); });
    expect(showToast).toHaveBeenCalledWith("error", expect.stringContaining("2"));
    showToast.mockClear();
    act(() => { result.current.truncationOps.raiseDecodeFailuresFor(decoding([])); });
    expect(showToast).not.toHaveBeenCalled();
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

  // ★★★ THERE ARE NOW TWO REPORTING OPS AND THE CENSUS MUST COUNT BOTH, or
  // closing §152 would have turned this file RED at the very site it fixed.
  // `reportImportFor` is the import-only op for a load that applies SOME rows
  // into the live workspace instead of replacing it — it reports the import
  // loss and raises the quoting hold, and touches truncation in neither
  // direction. See its doc on `TruncationOps`.
  //
  // ★★ `/reportFor\(/` DOES NOT MATCH `reportImportFor(` — "report" is not
  // followed by "For(" there — so the two regexes are disjoint and the sum is a
  // real census rather than a double count. Verify before changing either:
  //   node -e 'console.log(/reportFor\(/.test("truncationOps.reportImportFor("))'
  // → false. If a future rename made them overlap, every import-only site would
  // count TWICE and the file would fail on correct code.
  //
  // ★★★ AND THE NEW OP IS DELIBERATELY NOT EXPRESSIBLE THROUGH THE EXEMPT
  // MARKER. A site carrying BOTH the marker and a `reportImportFor` call sums
  // to 2 against 1 load and fails — which is the point: the marker means "this
  // load reports NOTHING", and a path that reports the import half is not that.
  // Without the collision a site could keep the exemption it no longer needs,
  // and the census would go on accepting it forever if the call were later
  // deleted. That is why `onOpenStorageFile` LOST its marker when it gained the
  // call rather than keeping both.
  // ★ Consequence: `exempt` is 0 across all three files today, so that term is
  // dormant. It is kept because the next path that genuinely must stay silent
  // needs somewhere to say so — a bare lower count would be satisfied by a file
  // that simply forgot.
  it.each(CENSUS_FILES)("%s reports for every load it does not explicitly exempt", (file) => {
    const src = readFileSync(file, "utf8");
    // ★★★ A LOAD IS COUNTED BY ITS SPELLING, AND A NEW SPELLING IS INVISIBLE
    // UNTIL ADDED HERE. onOpenStorageFile used to call `await backend.load()`; closing
    // open-followups §287 replaced it with `loadFromHandleForBackend(backend, handle)`
    // — a facade helper that loads from a handle the backend has NOT yet been
    // committed to — so the load site vanished from this scan while all three of
    // that file's reports remained. The census went 3 loads/3 reports to 2/3 and FAILED,
    // which is this guard working: it noticed that reports outnumbered the loads it
    // could still see. Had the ratio happened to stay balanced it would have gone GREEN
    // over a load path it can no longer see at all.
    //
    // ★★ DO NOT silence a case like that with a 'NO reportFor:' marker. The marker
    // means the load reports NOTHING, and it deliberately COLLIDES with a real reporting
    // call (see the note above) so a path that reports cannot also claim exemption. The
    // fix for a renamed or re-spelled load is to teach this list, which is what
    // `loadFromHandleForBackend` is doing here.
    //
    // ★ This stays the guard's standing weakness and NO gate covers it: a third
    // spelling added tomorrow counts as zero loads, and a file that also adds no report
    // stays green. Re-derive today's facade load helpers with:
    //   grep -n 'export function load' src/app/storage.ts
    const LOAD_SPELLINGS = [/\.load\(\)/g, /loadFromHandleForBackend\(/g];
    const loads = LOAD_SPELLINGS.reduce((acc, re) => acc + (src.match(re)?.length ?? 0), 0);
    const reports = src.match(/reportFor\(/g)?.length ?? 0;
    const importReports = src.match(/reportImportFor\(/g)?.length ?? 0;
    const exemptRe = new RegExp(REPORT_EXEMPT_MARKER, "g");
    const exempt = src.match(exemptRe)?.length ?? 0;
    expect(loads, `${file}: no load sites found — the census would be vacuous`).toBeGreaterThan(0);
    expect(
      reports + importReports + exempt,
      `${file}: ${loads} load(s), ${reports} full report(s), ${importReports} import-only ` +
        `report(s), ${exempt} marked exemption(s). Every load must call ` +
        `truncationOps.reportFor, or truncationOps.reportImportFor if it applies rows into ` +
        `the live workspace instead of replacing it, or carry a "${REPORT_EXEMPT_MARKER}" ` +
        `comment at the site saying why it must do neither.`,
    ).toBe(loads);
  });

  // ★★★ THE CENSUS ABOVE CANNOT SEE A REPORT THAT IS NEVER REACHED, and that
  // is the hole this one covers. Both empty-load data-loss guards
  // (`use-storage-backend.ts`) `return` BEFORE their path's `reportFor`, so the
  // token counts balanced while the DECODE signal — a fact about the stored
  // bytes autosave is about to overwrite, not about the workspace that was
  // refused — reached nothing at all. A user whose meta blob was corrupt, who
  // reloaded and then picked the SAFE option at the confirm, left autosave
  // fully armed against that database.
  //
  // ★★ STILL A SOURCE SCAN, with the same limits as its neighbour: it proves a
  // reporter exists per refusal site, never that it runs on the right branch or
  // is handed the backend that served the load. The behavioural pins are in
  // `use-storage-backend.test.tsx` ("the decode signal survives the empty-load
  // refusal"); this only catches a NEW refusal path added without one.
  it("reports the decode cause at every empty-load refusal", () => {
    const src = readFileSync("src/app/use-storage-backend.ts", "utf8");
    // The refusal's own predicate — the one shape both guards share.
    const refusals = src.match(/isWorkspaceEmpty\(workspace\)\s*&&\s*!isWorkspaceEmpty\(/g)?.length ?? 0;
    const raises = src.match(/raiseDecodeFailuresFor\(/g)?.length ?? 0;
    expect(refusals, "no empty-load refusal found — the census would be vacuous").toBeGreaterThan(0);
    expect(
      raises,
      `${refusals} empty-load refusal(s), ${raises} decode report(s). A refusal keeps the ` +
        `PREVIOUS workspace live and leaves autosave armed against the backend that just ` +
        `served an unreadable blob — it must call truncationOps.raiseDecodeFailuresFor.`,
    ).toBe(refusals);
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
