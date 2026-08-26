// src/app/version-diff-view.tsx
// Read-only grouped diff display for version compare. Two layouts:
//  - "inline" (default): one row per record, before→after shown inline; in the
//    vs-now mode it also carries restore checkboxes (+ optional per-record
//    "Restore this" buttons via onRestoreRecord).
//  - "sideBySide": two columns (earlier | later) for a two-version compare.
// Presentational only.
//
// ★★ A change carrying `restorable: false` (documents, documentVersions) gets
// NEITHER a checkbox NOR a restore button in EITHER layout — `applyRestore`
// skips those collections, so both controls would be silent no-ops reporting
// success. The row renders `historyNotRestorable` in their place instead.

import { useId, useState } from "react";
import { t } from "./i18n";
import type { Lang } from "./i18n";
import type { VersionChange, ChangeType } from "./version-diff";
import { changeKey, type RestoreSelection } from "./version-restore";
import { Checkbox } from "./form-controls";
import { buildRowTokens, rowLabel } from "./row-tokens";

const TYPE_KEY: Record<ChangeType, "historyAdded" | "historyRemoved" | "historyModified"> = {
  added: "historyAdded", removed: "historyRemoved", modified: "historyModified",
};
const TYPE_CLASS: Record<ChangeType, string> = {
  added: "text-ui-green-strong", removed: "text-ui-pink-strong", modified: "text-muted-foreground",
};

function fmt(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

export function VersionDiffView({
  lang,
  changes,
  selectable = false,
  selection = {},
  onToggleRecord,
  onToggleField,
  onRestoreRecord,
  restoreBusy = false,
  layout = "inline",
  leftLabel,
  rightLabel,
}: {
  lang: Lang;
  changes: VersionChange[];
  selectable?: boolean;
  selection?: RestoreSelection;
  onToggleRecord?: (key: string) => void;
  onToggleField?: (key: string, field: string) => void;
  /** When set (vs-now compare), each record row gets a "Restore this" button
   *  that restores just that record. */
  onRestoreRecord?: (key: string) => void;
  /** A restore is already running. The owner also guards this with a ref, so
   *  this is the AFFORDANCE, not the correctness: without it these buttons stay
   *  live for the whole restore and a rejected second click is
   *  indistinguishable from a dead control. */
  restoreBusy?: boolean;
  /** "inline" stacks before→after per field; "sideBySide" shows two columns. */
  layout?: "inline" | "sideBySide";
  /** Column headers for the side-by-side layout (the two versions' labels). */
  leftLabel?: string;
  rightLabel?: string;
}) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  // ★★ THE PANEL IDS CANNOT BE DERIVED FROM `changeKey`, which is what the
  // obvious version of this did. That key is `JSON.stringify([collection, id])`
  // — quotes, brackets and a comma are all legal in an HTML5 id, but a SPACE is
  // not, and `knowledgeItems` ids are free-form strings. Sanitising instead
  // would risk two keys collapsing onto one id, which axe DOES flag
  // (`duplicate-id-aria`, tag `wcag2a`), turning an a11y fix into an a11y
  // failure. `useId` also keeps two mounted diff views from colliding.
  const uid = useId();
  if (changes.length === 0) {
    return <p className="text-sm text-muted-foreground">{t(lang, "historyNoChanges")}</p>;
  }
  const groups = new Map<string, VersionChange[]>();
  for (const c of changes) groups.set(c.collectionLabel, [...(groups.get(c.collectionLabel) ?? []), c]);

  const keyOf = (c: VersionChange) => changeKey(c.collection, c.recordId);
  const toggle = (k: string) => setOpen((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });

  // ★★ Row-unique accessible names. `recordLabel` uses the record's nameField,
  // and two documents titled "Q3 report" (or two tasks named "Alpha") are
  // ordinary — so the bare label names two checkboxes identically, a WCAG 2.4.6
  // fail no gate in this repo can see. A per-item component cannot fix this:
  // only the list owner can see the siblings, which is why the map is built
  // HERE and threaded down.
  // ★★★ BUILT ONCE OVER **ALL** `changes`, NEVER PER GROUP. It used to be built
  // inside each group map, over that group's items alone — and `buildRowTokens`
  // emits the BARE name when a name occurs once in the rows it was handed. So a
  // task named "Go-live" and a milestone named "Go-live" each got the bare token
  // in their own group and rendered two identically-named checkboxes and two
  // identically-named restore buttons, in ONE document, with every group on
  // screen at once. Cross-collection name overlap ("Go-live", "UAT sign-off") is
  // ordinary, and every collision test seeded a single collection, so nothing
  // caught it. The keys are `keyOf(c)` = `changeKey(collection, recordId)`,
  // already globally unique, so one map serves every group.
  const tokens = buildRowTokens(changes.map((c) => ({ id: keyOf(c), name: c.recordLabel })));
  // Built over ALL changes for the same reason `tokens` is: the keys are
  // globally unique, so one map serves every group.
  const panelIds = new Map(changes.map((c, i) => [keyOf(c), `${uid}fields-${i}`]));

  if (layout === "sideBySide") {
    // For a two-version compare: earlier state on the left, later on the right.
    // `before` is the earlier (from) version, `after` the later (to) version.
    return (
      <div className="flex flex-col gap-3">
        {(leftLabel || rightLabel) && (
          <div className="grid grid-cols-2 gap-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            <span className="truncate">{leftLabel}</span>
            <span className="truncate">{rightLabel}</span>
          </div>
        )}
        {[...groups.entries()].map(([label, items]) => (
          <div key={label}>
            <h3 className="mb-1 text-sm font-semibold text-foreground">{label}</h3>
            <ul className="flex flex-col gap-2">
              {items.map((c) => {
                const k = keyOf(c);
                const revertible = c.restorable !== false;
                return (
                <li key={k} className="rounded-md border border-line bg-surface px-3 py-1.5 text-sm">
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <span className="text-foreground">{c.recordLabel}</span>
                    <span className="flex items-center gap-2">
                      <span className={`text-xs ${TYPE_CLASS[c.type]}`}>{t(lang, TYPE_KEY[c.type])}</span>
                      {!revertible && (
                        <span className="shrink-0 text-xs text-muted-foreground">
                          {t(lang, "historyNotRestorable")}
                        </span>
                      )}
                      {onRestoreRecord && revertible && (
                        <button
                          type="button"
                          onClick={() => onRestoreRecord(k)}
                          title={t(lang, "historyRestoreRecordHint")}
                          aria-label={rowLabel(t(lang, "historyRestoreRecord"), tokens.get(k) ?? c.recordLabel)}
                          disabled={restoreBusy}
                          className="shrink-0 cursor-pointer rounded-md border border-line px-2 py-0.5 text-xs font-medium text-ui-dark-blue transition-colors hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-60 dark:text-ui-light-grey"
                        >
                          {t(lang, "historyRestoreRecord")}
                        </button>
                      )}
                    </span>
                  </div>
                  <ul className="flex flex-col gap-0.5">
                    {c.fields.map((f) => (
                      <li key={f.field} className="grid grid-cols-2 gap-3 text-xs">
                        <span className="flex flex-wrap items-baseline gap-1">
                          <span className="font-medium text-muted-foreground">{f.label}:</span>
                          <span className="text-foreground">{fmt(f.before)}</span>
                        </span>
                        <span className="flex flex-wrap items-baseline gap-1">
                          <span className="font-medium text-muted-foreground">{f.label}:</span>
                          <span className="text-foreground">{fmt(f.after)}</span>
                        </span>
                      </li>
                    ))}
                  </ul>
                </li>
                );
              })}
            </ul>
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      {[...groups.entries()].map(([label, items]) => (
        <div key={label}>
          <h3 className="mb-1 text-sm font-semibold text-foreground">{label}</h3>
          <ul className="flex flex-col gap-1">
            {items.map((c) => {
              const k = keyOf(c);
              const expandable = c.fields.length > 0;
              // ★★ `restorable: false` (documents, documentVersions) is
              // diff-visible but `applyRestore` SKIPS it — so a checkbox or a
              // restore button here would be a silent no-op that reports
              // success. The row says so instead.
              const revertible = c.restorable !== false;
              return (
                <li key={k} className="rounded-md border border-line bg-surface px-3 py-1.5 text-sm">
                  <div className="flex items-center gap-1">
                    {selectable && revertible && (
                      <Checkbox
                        checked={selection[k] !== undefined}
                        onChange={() => onToggleRecord?.(k)}
                        aria-label={rowLabel(t(lang, "historySelectRecord"), tokens.get(k) ?? c.recordLabel)}
                        className="mr-2"
                      />
                    )}
                    <button
                      type="button"
                      onClick={() => expandable && toggle(k)}
                      // ★★ NAMED FROM THE TOKEN, not from its own content. This
                      // button's name used to come from the two spans below, so
                      // two records sharing a display name announced identically
                      // — the same WCAG 2.4.6 fail as the checkbox, one control
                      // over. The type badge is `aria-hidden` and folded into the
                      // name instead, which is what keeps WCAG 2.5.3 satisfied:
                      // axe's label-content-name-mismatch reads VISIBLE text only
                      // (it skips aria-hidden content), so the visible label
                      // reduces to the bare record label, and the name CONTAINS
                      // the token — which is that label, plus an occurrence
                      // index only when it collides. Containment therefore holds
                      // for a colliding row AND a non-colliding one. AT still
                      // hears the type; nothing is lost. (2.5.3 is containment,
                      // case-insensitive and position-INdependent, so putting the
                      // type first costs nothing here.)
                      // ★★★ IT MUST GO THROUGH `rowLabel`, PUTTING THE TOKEN LAST,
                      // and this line built the name by hand the other way round
                      // until 0.260.x. `src/test/row-unique-names.ts` strips a
                      // trailing ` (N)` (`OCCURRENCE_SUFFIX`) before checking for
                      // a collision seed, and its docstring names the invariant it
                      // leans on: "`rowLabel` puts the token last, so it is at the
                      // end of the accessible name too". With the token FIRST the
                      // index landed mid-string and never stripped, so
                      // `requireCollisionSeed: true` THREW "the fixture seeded no
                      // two rows sharing a display name" against a fixture that
                      // seeded exactly that — which made the one shape that most
                      // needs the assertion, two NON-restorable rows sharing a
                      // title (this button is then the row's ONLY control),
                      // impossible to write. Do not hand-roll this name again.
                      aria-label={rowLabel(t(lang, TYPE_KEY[c.type]), tokens.get(k) ?? c.recordLabel)}
                      // ★★ `aria-expanded` is `undefined` WHEN THE ROW HAS NO
                      // FIELDS, and that is not tidiness: `false` would promise
                      // a disclosure that can never open, since this button's
                      // click handler is itself gated on `expandable`.
                      aria-expanded={expandable ? open.has(k) : undefined}
                      // ★★★ AND `aria-controls` IS SET ONLY WHILE THE PANEL IS
                      // OPEN — it must never name an id that is not in the
                      // document (axe `aria-valid-attr-value`, tag wcag2a).
                      // ★★ THE FIRST CUT CLOSED THAT THE EXPENSIVE WAY, by
                      // always mounting the panel and toggling `hidden` — the
                      // pattern the next-actions reasons list uses. It is the
                      // wrong trade HERE, and the difference is what each
                      // hidden element COSTS: there, a bounded handful of short
                      // reason strings per row; here, a whole record's field
                      // list. A vs-now compare against a week-old capture can
                      // carry hundreds of modified records, and mounting every
                      // collapsed panel materialises each one's field rows plus,
                      // in `selectable` mode, a `Checkbox` per field — thousands
                      // of elements nobody can see, re-rendered on every tick of
                      // a selection checkbox.
                      // ★★★ THE ATTRIBUTE IS OPTIONAL AND THAT IS WHAT MAKES
                      // THIS FREE. WAI-ARIA does not require `aria-controls` on
                      // a disclosure button and neither does the APG pattern —
                      // only `aria-expanded` — so the conformance story is
                      // identical either way, and axe has no rule demanding it.
                      // Naming the panel only while it exists is both cheaper
                      // and more truthful than naming one that is hidden: there
                      // is nothing to move to until it opens. Do NOT "complete
                      // the pattern" by making this unconditional without also
                      // restoring the always-mounted panel — an unconditional
                      // attribute over a conditional panel is the dangling
                      // reference this comment exists to prevent.
                      aria-controls={expandable && open.has(k) ? panelIds.get(k) : undefined}
                      // ★ Only for a NON-restorable row, where the hint is the
                      // answer to "why is there no restore button here?" and
                      // this button is the row's only control. On a restorable
                      // row no hint renders, so there is nothing to point at.
                      aria-describedby={revertible ? undefined : `${panelIds.get(k)}-managed`}
                      className="flex w-full items-center justify-between text-left"
                    >
                      <span className="text-foreground">{c.recordLabel}</span>
                      <span aria-hidden="true" className={`text-xs ${TYPE_CLASS[c.type]}`}>{t(lang, TYPE_KEY[c.type])}</span>
                    </button>
                    {!revertible && (
                      <span id={`${panelIds.get(k)}-managed`} className="ml-2 shrink-0 text-xs text-muted-foreground">
                        {t(lang, "historyNotRestorable")}
                      </span>
                    )}
                    {onRestoreRecord && revertible && (
                      <button
                        type="button"
                        onClick={() => onRestoreRecord(k)}
                        title={t(lang, "historyRestoreRecordHint")}
                        aria-label={rowLabel(t(lang, "historyRestoreRecord"), tokens.get(k) ?? c.recordLabel)}
                        disabled={restoreBusy}
                        className="ml-2 shrink-0 cursor-pointer rounded-md border border-line px-2 py-0.5 text-xs font-medium text-ui-dark-blue transition-colors hover:bg-surface-muted disabled:cursor-not-allowed disabled:opacity-60 dark:text-ui-light-grey"
                      >
                        {t(lang, "historyRestoreRecord")}
                      </button>
                    )}
                  </div>
                  {/* Rendered only while open — see the `aria-controls` note on
                      the button above for why this is NOT hidden-toggled. The
                      `id` is what that attribute points at, so the two are one
                      decision: change either and you must change both. */}
                  {expandable && open.has(k) && (
                    <ul
                      id={panelIds.get(k)}
                      className="mt-1 flex flex-col gap-0.5 border-t border-line pt-1"
                    >
                      {c.fields.map((f) => (
                        <li key={f.field} className="flex flex-wrap items-center gap-1 text-xs">
                          {selectable && revertible && (
                            <Checkbox
                              size="sm"
                              checked={selection[k] === "all" || (Array.isArray(selection[k]) && (selection[k] as string[]).includes(f.field))}
                              onChange={() => onToggleField?.(k, f.field)}
                              // ★★ QUALIFIED BY THE ROW, not the bare field
                              // label. Several records can be expanded at once,
                              // so two rows both showing a changed "Title"
                              // rendered two checkboxes named "Title" — the same
                              // WCAG 2.4.6 fail as the record controls, one
                              // level down (register §257).
                              aria-label={rowLabel(f.label, tokens.get(k) ?? c.recordLabel)}
                              className="mr-1"
                            />
                          )}
                          <span className="font-medium text-muted-foreground">{f.label}:</span>
                          <span className="text-ui-pink-strong line-through">{fmt(f.before)}</span>
                          <span className="text-muted-foreground">→</span>
                          <span className="text-ui-green-strong">{fmt(f.after)}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}
