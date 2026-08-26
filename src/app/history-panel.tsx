// src/app/history-panel.tsx
// Version-history timeline + compare (Slice 2). Selective restore lands in a
// later slice. Turso-gated by the parent; this component is presentational.
// Compare modes: per-row "compare with current", or tick two versions and
// "compare selected" (the two are ordered oldest→newest before diffing).

import { useCallback, useMemo, useRef, useState } from "react";
import { t } from "./i18n";
import type { Lang } from "./i18n";
import { useDisplayTimezone } from "./display-timezone-context";
import { TextButton } from "./text-button";
import { formatDisplayTimestamp } from "./tz-display";
import type { ProjectVersionMeta } from "./version-history";
import type { VersionChange } from "./version-diff";
import { VersionDiffView } from "./version-diff-view";
import { changeKey, type RestoreSelection } from "./version-restore";
import { useToastContext } from "./toast-context";
import { useConfirm } from "./confirm-dialog";
import { Badge } from "./badge";
import { EmptyState } from "./empty-state";
import { PrintButton, ResetSizeButton } from "./task-manager-ui";
import { useResizable } from "./use-resizable";
import { VIEW_PANE_RESIZABLE_CLASS } from "./view-styles";
import { INTERACTIVE } from "./interaction-styles";
import { Button } from "./button";
import { Checkbox, Input } from "./form-controls";
import { buildRowTokens, rowLabel } from "./row-tokens";

/** Build an "everything" selection from a diff, EXCLUDING changes the restore
 *  will skip. ★★ Keeping a non-restorable key in the selection makes the restore
 *  claim it reverted a row it silently ignored — the two select-all paths and
 *  the diff view's checkboxes must agree on this or the UI over-promises. */
export function selectableSelection(changes: readonly VersionChange[]): RestoreSelection {
  const sel: RestoreSelection = {};
  for (const c of changes) {
    if (c.restorable === false) continue;
    sel[changeKey(c.collection, c.recordId)] = "all";
  }
  return sel;
}

/** The single-record counterpart of `selectableSelection`: the selection for ONE
 *  change key, or `null` when that key must not be restored.
 *  ★★ The handler and the two select-all paths must enforce ONE rule from ONE
 *  place. `version-diff-view.tsx` renders no restore control on a non-restorable
 *  row, so today nothing can hand this a refused key — but that invariant lives
 *  in the RENDER path alone, and a third caller, a keyboard shortcut or a layout
 *  that forgets one of its two `revertible` gates re-opens it. The symptom would
 *  be the one this whole slice exists to remove: a control that reports success
 *  and reverts nothing (`docs/open-followups.md` §256). */
export function recordSelection(key: string, changes: readonly VersionChange[]): RestoreSelection | null {
  const change = changes.find((c) => changeKey(c.collection, c.recordId) === key);
  if (!change || change.restorable === false) return null;
  return { [key]: "all" };
}

interface HistoryPanelProps {
  lang: Lang;
  versions: ProjectVersionMeta[];
  busy: boolean;
  onCaptureNow: (label: string) => void;
  loadDiff: (fromId: string, to: string | "now") => Promise<VersionChange[]>;
  restore: (versionId: string, selection: RestoreSelection, versionLabel: string) => Promise<boolean>;
  onDelete?: (versionId: string) => Promise<boolean>;
}

export function HistoryPanel({ lang, versions, busy, onCaptureNow, loadDiff, restore, onDelete }: HistoryPanelProps) {
  const { displayTz } = useDisplayTimezone();
  const showToast = useToastContext();
  const confirm = useConfirm();
  const { ref: paneRef, reset: resetSize } = useResizable("aipm-cockpit:history-size");
  const [diff, setDiff] = useState<VersionChange[] | null>(null);
  const [comparing, setComparing] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  // Restore is offered ONLY on a vs-now compare; `compareFrom` is the version
  // we're comparing the current workspace against (null = two-version, view-only).
  const [selection, setSelection] = useState<RestoreSelection>({});
  const [compareFrom, setCompareFrom] = useState<{ id: string; label: string } | null>(null);
  // The version a per-row "Restore this" reverts TO. For a vs-now compare it is
  // `compareFrom`; for a two-version compare it is the OLDER of the two picks.
  // Separate from `compareFrom` because two-version compares restore per-row but
  // do NOT offer the checkbox/"Restore selected" multi-select (compareFrom-gated).
  const [restoreFrom, setRestoreFrom] = useState<{ id: string; label: string } | null>(null);
  // Two-version compare can render unified (inline) or side-by-side; the labels
  // head the two columns in the side-by-side layout.
  const [sideBySide, setSideBySide] = useState(false);
  const [compareLabels, setCompareLabels] = useState<{ left: string; right: string } | null>(null);
  // Inline manual-checkpoint naming (replaces the old prompt dialog).
  const [naming, setNaming] = useState(false);
  const [draftLabel, setDraftLabel] = useState("");
  // Scrolls the compare output into view once a diff resolves (T7).
  const compareRef = useRef<HTMLDivElement>(null);
  // ★★★ SERIALISES EVERY RESTORE ENTRY POINT. The hook's `busy` does NOT close
  // this window: `restore()` reaches `capturePayload` (which sets it) only
  // after `await loadVersionPayload` — a whole network round-trip — and
  // `restoreWholeVersion` runs an entire `loadDiff` before `restore()` is even
  // called. Two restores of the same version are not a wipe (the second reverts
  // to the same state) but they append two auto-captures and two activity
  // entries for one user action, and the second runs a selection built against
  // a workspace that no longer matches it.
  // ★★ A ref AND a state flag, and READ WHICH ONE BUYS WHAT — an earlier
  // revision of this comment credited the ref with the real-browser case and
  // that is wrong. React flushes DISCRETE-event updates synchronously, and
  // `setRestoring(true)` runs in the click handler's synchronous prefix, before
  // `runExclusiveRestore`'s first await. Two PHYSICAL clicks are two separate
  // tasks with a commit between them, so `disabled` is already applied when the
  // second lands: the STATE is what stops the double-click a user performs. The
  // ref uniquely covers a same-task double dispatch — two `.click()` calls in
  // one tick, a synthetic double-fire — which is cheap to keep and is the only
  // thing standing between a programmatic caller and two restores.
  // ★ Both are pinned, and by tests of different shapes: the single-`act`
  // double-click test isolates the ref (two `fireEvent.click` calls would each
  // flush and be swallowed by `disabled`, staying green with the ref deleted),
  // while the disabled-while-running test pins the state.
  // ★★ KNOWN GAP (docs/open-followups.md §260): `finally` releases on resolve,
  // reject and sync throw — but not on a request that NEVER settles. There is
  // no timeout on the version-history fetch path, so a stalled Turso call
  // leaves every restore control dead for the life of the mounted panel.
  const restoreInFlight = useRef(false);
  const [restoring, setRestoring] = useState(false);
  const runExclusiveRestore = useCallback(async <T,>(fn: () => Promise<T>): Promise<T | undefined> => {
    if (restoreInFlight.current) return undefined;
    restoreInFlight.current = true;
    setRestoring(true);
    try { return await fn(); } finally { restoreInFlight.current = false; setRestoring(false); }
  }, []);
  // ★★ Remounts `VersionDiffView` on every compare, which is the ONLY way to
  // clear its per-row `open` set from here: that state lives inside the child,
  // and `react-hooks/set-state-in-effect` is banned. Replacing `diff` without a
  // remount left stale keys behind — `changeKey("tasks", 5)` is the same string
  // in every compare, so a row expanded in one comparison rendered
  // pre-expanded in the next. The × button already unmounts the whole block;
  // this covers compare→compare, which does not.
  const [compareNonce, setCompareNonce] = useState(0);

  // ★ `useCallback` so the memo below is a real cache. Declared inline, this
  // was a NEW function identity every render, so `rowTokens` rebuilt its whole
  // map on every keystroke of the checkpoint-name input (which re-renders this
  // panel through `draftLabel`) — a useMemo that never memoized anything.
  const labelOf = useCallback(
    (v: ProjectVersionMeta) => v.label ?? formatDisplayTimestamp(v.capturedAt, displayTz, lang),
    [displayTz, lang],
  );

  // Row-unique accessible-name tokens (§243) — derived from the SAME list the
  // rows below are mapped from, in render order, so the occurrence index
  // matches what a screen-reader user actually encounters.
  const rowTokens = useMemo(
    () => buildRowTokens(versions.map((v) => ({ id: v.id, name: labelOf(v) }))),
    [versions, labelOf],
  );

  const toggleRecord = (key: string) =>
    setSelection((s) => { const n = { ...s }; if (n[key] !== undefined) delete n[key]; else n[key] = "all"; return n; });
  const toggleField = (key: string, field: string) =>
    setSelection((s) => {
      const cur = s[key];
      const fields = cur === "all" ? [] : Array.isArray(cur) ? [...cur] : [];
      const next = fields.includes(field) ? fields.filter((f) => f !== field) : [...fields, field];
      const n = { ...s };
      if (next.length === 0) delete n[key]; else n[key] = next;
      return n;
    });

  const confirmSave = () => {
    const label = draftLabel.trim();
    if (label) onCaptureNow(label);
    setNaming(false);
    setDraftLabel("");
  };

  const cancelSave = () => {
    setNaming(false);
    setDraftLabel("");
  };

  const runDiff = async (fromId: string, to: string | "now") => {
    setComparing(true);
    try {
      setDiff(await loadDiff(fromId, to));
      setCompareNonce((n) => n + 1);
      // Bring the freshly-mounted compare output into view (covers both the
      // vs-now compare and compareSelected, which delegates here). rAF waits for
      // the diff container to commit before scrolling.
      requestAnimationFrame(() => compareRef.current?.scrollIntoView({ block: "start" }));
    } finally { setComparing(false); }
  };

  // Tick up to two versions; a third selection drops the oldest pick.
  const toggleSelect = (id: string) =>
    setSelected((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id].slice(-2),
    );

  const compareSelected = (layout: "inline" | "sideBySide" = "inline") => {
    if (selected.length !== 2) return;
    // Order the two picks oldest→newest so the diff reads "from older → newer".
    const [a, b] = selected
      .map((id) => versions.find((v) => v.id === id))
      .filter((v): v is ProjectVersionMeta => !!v)
      .sort((x, y) => x.capturedAt.localeCompare(y.capturedAt));
    if (a && b) {
      setCompareFrom(null);
      // Per-row restore reverts to the OLDER pick (a); no multi-select here.
      setRestoreFrom({ id: a.id, label: labelOf(a) });
      setSelection({});
      setSideBySide(layout === "sideBySide");
      setCompareLabels({ left: labelOf(a), right: labelOf(b) });
      void runDiff(a.id, b.id);
    }
  };

  // "Restore this state" on a version row: revert the WHOLE workspace to that
  // version. We diff it against now and mark every change "all", reusing the
  // selective-restore machinery (no separate full-restore path needed).
  const restoreWholeVersion = (v: ProjectVersionMeta) => runExclusiveRestore(async () => {
    const changes = await loadDiff(v.id, "now");
    const sel = selectableSelection(changes);
    // ★★ Gate on the SELECTION, not on `changes`. A `changes.length === 0` test
    // lets a documents-only session straight through: its diff is NON-empty
    // (which is what arms a capture) while its selection is EMPTY, because
    // document history is managed per document — so the restore would revert
    // nothing and report success.
    if (Object.keys(sel).length === 0) {
      // ★★ ONE guard, TWO messages, and the split is deliberate: these are
      // different facts, not one fact twice. An empty diff means the snapshot is
      // dead or identical to the current state (previously a SILENT no-op, so
      // say so rather than leave it a mystery); a NON-empty diff reaching here
      // means every change in it is managed elsewhere. Collapsing them would
      // tell a documents-only user "no differences from the current project"
      // while the document rows on screen say otherwise — a falsehood this
      // slice itself introduced, by making those rows visible in the diff.
      const key = changes.length === 0 ? "historyRestoreNothing" : "historyRestoreNothingManaged";
      showToast("info", t(lang, key));
      return;
    }
    await restore(v.id, sel, labelOf(v));
  });

  // Delete a snapshot from history (confirm-gated — it's irreversible).
  const deleteVersionRow = async (v: ProjectVersionMeta) => {
    if (!onDelete) return;
    if (!(await confirm({ message: t(lang, "historyDeleteConfirm", labelOf(v)) }))) return;
    const ok = await onDelete(v.id);
    if (!ok) { showToast("error", t(lang, "historyDeleteFailed")); return; }
    // Drop the deleted id from the two-version tick list, else a lingering dead id
    // makes the NEXT "Compare selected" a silent no-op (find() → undefined → no
    // diff, no feedback — the same silent-no-op class this feature fixes).
    setSelected((prev) => prev.filter((x) => x !== v.id));
    // If the deleted version was the active compare source, drop the compare view.
    if (compareFrom?.id === v.id || restoreFrom?.id === v.id) { setDiff(null); setCompareFrom(null); setRestoreFrom(null); }
  };

  // "Restore this" on a single record row — reverts that record to `restoreFrom`
  // (the vs-now source, or the older pick in a two-version compare).
  const restoreRecord = (key: string) => {
    const rf = restoreFrom;
    if (!rf) return;
    // Refuse a key `applyRestore` would skip, rather than reporting success over
    // a row nothing reverted. Unreachable through the rendered UI today — see
    // `recordSelection`.
    const sel = recordSelection(key, diff ?? []);
    if (!sel) return;
    void runExclusiveRestore(() => restore(rf.id, sel, rf.label)).then((ok) => {
      // Only clear the compare/selection context on a real success — a failed
      // restore (surfaced via onError) leaves it intact so the user can retry.
      if (!ok) return;
      setSelection({});
      setDiff(null);
      setCompareFrom(null);
      setRestoreFrom(null);
    });
  };

  // T8 — compare-header restore controls (vs-now compare only; the checkboxes
  // that these act on live in that mode).
  const buildAllSelection = (): RestoreSelection => selectableSelection(diff ?? []);
  // ★★ Gate the header's restore controls on the SELECTABLE changes, not on
  // `diff.length`. A documents-only diff is non-empty yet yields an EMPTY
  // selection, so "Restore this state" here would revert nothing and report
  // success — the same over-promise `selectableSelection` exists to remove.
  const selectableCount = Object.keys(buildAllSelection()).length;
  const selectAllRecords = () => setSelection(buildAllSelection());
  const deselectAllRecords = () => setSelection({});
  // "Restore this state" from the compare header: revert the whole compared
  // snapshot (every diff record marked "all"), reusing the success reset.
  const restoreCompareState = () => {
    const cf = compareFrom;
    if (!cf) return;
    void runExclusiveRestore(() => restore(cf.id, buildAllSelection(), cf.label)).then((ok) => {
      if (!ok) return;
      setSelection({});
      setDiff(null);
      setCompareFrom(null);
      setRestoreFrom(null);
    });
  };

  return (
    <div ref={paneRef} className={`print-root ${VIEW_PANE_RESIZABLE_CLASS}`}>
      <div className="mb-3 flex shrink-0 items-center justify-between">
        <h2 className="text-lg font-semibold text-foreground">{t(lang, "historyTitle")}</h2>
        <span className="flex items-center gap-2 print:hidden">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => compareSelected("inline")}
            disabled={selected.length !== 2 || comparing || restoring}
            title={t(lang, "historyCompareSelectedHint")}
          >
            {t(lang, "historyCompareSelected")}
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => compareSelected("sideBySide")}
            disabled={selected.length !== 2 || comparing || restoring}
            title={t(lang, "historyCompareSideBySideHint")}
          >
            {t(lang, "historyCompareSideBySide")}
          </Button>
          {naming ? (
            <span className="flex items-center gap-2">
              <Input
                type="text"
                autoFocus
                value={draftLabel}
                onChange={(e) => setDraftLabel(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") confirmSave(); else if (e.key === "Escape") cancelSave(); }}
                placeholder={t(lang, "historyManualLabelPrompt")}
              />
              <Button
                size="sm"
                onClick={confirmSave}
                disabled={busy}
              >
                {t(lang, "add")}
              </Button>
              <button
                type="button"
                onClick={cancelSave}
                aria-label={t(lang, "cancel")}
                title={t(lang, "cancel")}
                className={`rounded-full px-1 text-muted-foreground hover:text-ui-pink ${INTERACTIVE}`}
              >
                ×
              </button>
            </span>
          ) : (
            <Button
              size="sm"
              onClick={() => setNaming(true)}
              disabled={busy}
            >
              {t(lang, "historySaveNow")}
            </Button>
          )}
          <PrintButton lang={lang} />
          <ResetSizeButton onClick={resetSize} lang={lang} />
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-auto pr-2">
      {versions.length === 0 ? (
        <EmptyState compact title={t(lang, "historyEmpty")} />
      ) : (
        <ul className="flex flex-col gap-1">
          {versions.map((v) => {
            const token = rowTokens.get(v.id) ?? labelOf(v);
            return (
            <li key={v.id} className="flex items-center justify-between rounded-md border border-line bg-surface px-3 py-2 text-sm">
              <span className="flex items-center gap-2">
                <Checkbox
                  checked={selected.includes(v.id)}
                  onChange={() => toggleSelect(v.id)}
                  aria-label={rowLabel(t(lang, "historyCompareSelect"), token)}
                />
                <Badge size="md" className={v.trigger === "manual" ? "bg-ui-green/15 text-ui-dark-blue dark:text-ui-light-grey" : "bg-surface-muted text-muted-foreground"}>
                  {v.trigger === "manual" ? `★ ${t(lang, "historyManual")}` : t(lang, "historyAuto")}
                </Badge>
                <span className="text-foreground">{v.label ?? formatDisplayTimestamp(v.capturedAt, displayTz, lang)}</span>
                {v.summary && (
                  <>
                    <span className="text-xs text-muted-foreground" aria-hidden="true">|</span>
                    <span className="text-xs text-muted-foreground">{v.summary}</span>
                  </>
                )}
              </span>
              <span className="flex items-center gap-2">
                <TextButton
                  onClick={() => { setSideBySide(false); setCompareLabels(null); setCompareFrom({ id: v.id, label: labelOf(v) }); setRestoreFrom({ id: v.id, label: labelOf(v) }); setSelection({}); void runDiff(v.id, "now"); }}
                  // ★★ `restoring` too, and it is not symmetry for its own
                  // sake: `runDiff` reads the LIVE workspace through
                  // `getPayload()`, so a compare started mid-restore diffs
                  // against a workspace being rewritten underneath it.
                  // ★ An earlier revision gave a WEAKER reason — "every
                  // successful restore clears the compare view" — which is
                  // false for `restoreWholeVersion`, the one path reachable
                  // from this very row: it ends at `await restore(...)` and
                  // touches no compare state at all. Three of the four paths
                  // reset; the stale-workspace reason above covers all four.
                  disabled={comparing || restoring}
                  title={t(lang, "historyCompareVsNowHint")}
                  aria-label={rowLabel(t(lang, "historyCompareVsNow"), token)}
                  className="text-xs"
                >
                  {t(lang, "historyCompareVsNow")}
                </TextButton>
                <Button
                  variant="secondary"
                  size="xs"
                  onClick={() => { void restoreWholeVersion(v); }}
                  disabled={busy || comparing || restoring}
                  title={t(lang, "historyRestoreStateHint")}
                  aria-label={rowLabel(t(lang, "historyRestoreState"), token)}
                >
                  {t(lang, "historyRestoreState")}
                </Button>
                {onDelete && (
                  <Button
                    variant="destructive"
                    size="xs"
                    onClick={() => { void deleteVersionRow(v); }}
                    disabled={busy || comparing}
                    title={t(lang, "historyDelete")}
                    aria-label={rowLabel(t(lang, "historyDelete"), token)}
                  >
                    {t(lang, "historyDelete")}
                  </Button>
                )}
                <span className="text-xs text-muted-foreground">{formatDisplayTimestamp(v.capturedAt, displayTz, lang)}</span>
              </span>
            </li>
            );
          })}
        </ul>
      )}

      {diff !== null && (
        <div ref={compareRef} className="mt-4">
          <div className="mb-2 flex items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-foreground">{t(lang, "historyCompareTitle")}</h3>
            <span className="flex items-center gap-2">
              {/* Restore controls (vs-now compare with at least one RESTORABLE
                  change only — they act on the ticked records; an identical
                  snapshot has none, and neither does a diff whose every row is
                  managed per document). */}
              {compareFrom !== null && selectableCount > 0 && (
                <>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={selectAllRecords}
                  >
                    {t(lang, "historySelectAll")}
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={deselectAllRecords}
                    disabled={Object.keys(selection).length === 0}
                  >
                    {t(lang, "historyDeselectAll")}
                  </Button>
                  <Button
                    variant="primary"
                    size="sm"
                    disabled={Object.keys(selection).length === 0 || restoring}
                    onClick={() => { const cf = compareFrom; if (cf) void runExclusiveRestore(() => restore(cf.id, selection, cf.label)).then((ok) => { if (!ok) return; setSelection({}); setDiff(null); setCompareFrom(null); setRestoreFrom(null); }); }}
                    title={t(lang, "historyRestoreSelectedHint")}
                  >
                    {t(lang, "historyRestoreSelected")}
                  </Button>
                  {/* Bare on purpose (§243): this block only renders for a vs-now
                      compare, where compareFrom is set and compareLabels is always
                      null, so it stays row-unique against the token-suffixed row
                      buttons. Naming compareFrom.label here would re-create the
                      collision it fixes — that's the same string this button's own
                      row would already carry whenever that row's token is bare. */}
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={restoreCompareState}
                    disabled={restoring}
                    aria-label={t(lang, "historyRestoreState")}
                    title={t(lang, "historyRestoreStateHint")}
                  >
                    {t(lang, "historyRestoreState")}
                  </Button>
                </>
              )}
              <button
                type="button"
                onClick={() => { setDiff(null); setSelected([]); setSelection({}); setCompareFrom(null); setRestoreFrom(null); setSideBySide(false); setCompareLabels(null); }}
                aria-label={t(lang, "alertModalClose")}
                title={t(lang, "alertModalClose")}
                className={`cursor-pointer rounded-full px-1 text-muted-foreground hover:text-ui-pink ${INTERACTIVE}`}
              >
                ×
              </button>
            </span>
          </div>
          {compareFrom !== null && diff.length === 0 ? (
            // A SUCCESSFUL vs-now compare that yielded no changes = an identical
            // snapshot. (Load/parse failures also resolve empty but log diagnostics
            // in use-version-history; here we give the identical case a clear
            // message instead of the generic "no differences" text.) A two-version
            // empty compare falls through to VersionDiffView's own "no differences".
            <p className="text-sm text-muted-foreground">{t(lang, "historyCompareIdentical")}</p>
          ) : (
            <VersionDiffView
              key={compareNonce}
              lang={lang}
              changes={diff}
              restoreBusy={restoring}
              selectable={compareFrom !== null}
              selection={selection}
              onToggleRecord={toggleRecord}
              onToggleField={toggleField}
              onRestoreRecord={restoreFrom !== null ? restoreRecord : undefined}
              layout={sideBySide ? "sideBySide" : "inline"}
              leftLabel={sideBySide ? compareLabels?.left : undefined}
              rightLabel={sideBySide ? compareLabels?.right : undefined}
            />
          )}
        </div>
      )}
      </div>
    </div>
  );
}
