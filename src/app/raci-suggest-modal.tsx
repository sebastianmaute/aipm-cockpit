"use client";

// Presentational preview/confirm modal for "Suggest RACI". The caller (the
// use-raci-suggest glue hook) drives the propose -> ground -> apply state
// machine and owns the grounded cells, the per-cell selection, and the
// confirm/cancel handlers. This component owns NO state, reaches into NO
// context, and performs NO writes — it only renders the grounded cells the
// user reviews cell-by-cell before anything is applied. Mirrors
// alloc-plan-modal.tsx.
//
// Itemization is load-bearing, not decorative: `Stakeholder.raci` holds
// hand-maintained assignments, so every proposed cell is shown with its
// current and proposed role and can be individually deselected before Apply.

import { useMemo } from "react";
import { type Lang, t } from "./i18n";
import { Modal } from "./modal";
import { Button } from "./button";
import { Checkbox } from "./form-controls";
import { ROLE_LABEL_KEY } from "./raci-chip-picker";
import {
  cellKey,
  type GroundedRaciCell,
  type SkippedRaciCell,
} from "./raci-suggest/raci-suggest";

type SkipMessageKey =
  | "raciSuggestSkipped"
  | "raciSuggestSkippedInvalidRole"
  | "raciSuggestSkippedAccountable";

// The four SkipReasons do not share an explanation, so they cannot share a
// count. TWO of them mean the cell named something this project does not have.
// "duplicate-accountable" means the opposite — everything resolved, and it was
// refused because the milestone already has an Accountable, which is the one
// skip a PM can act on. "invalid-role" is a third thing again: the stakeholder
// and milestone both resolved and only the role letter was rejected, so "did
// not match this project" is wrong for it too.
//
// EXHAUSTIVE Record on purpose: adding a SkipReason is then a compile error
// here, forcing a decision about how it reads instead of letting it default
// into whichever bucket happens to be the catch-all — which is exactly how
// invalid-role came to describe itself incorrectly. Module-level and typed,
// matching alloc-plan-modal's table, so the render site needs no cast.
export const SKIP_REASON_KEY: Record<SkippedRaciCell["reason"], SkipMessageKey> = {
  "unknown-stakeholder": "raciSuggestSkipped",
  "unknown-milestone": "raciSuggestSkipped",
  "invalid-role": "raciSuggestSkippedInvalidRole",
  "duplicate-accountable": "raciSuggestSkippedAccountable",
};

// Render order is FIXED, not taken from the Map. A Map iterates in insertion
// order — the order the model happened to return its skips — so two runs on
// the same project listed the same explanations in different orders.
//
// ★★ Derived from an exhaustive Record, NOT written as a literal array. A
// `readonly SkipMessageKey[]` says "an array of these", never "all of these":
// a key could be added to SKIP_REASON_KEY, classified correctly, and omitted
// here with tsc silent — and then its skips render nothing while the wrapper
// still draws its border, i.e. an empty bordered box that tells the user
// nothing about why cells were refused. A tuple type does not help either; it
// pins length but not membership, so a duplicate plus an omission typechecks.
// Adding a SkipMessageKey is now a compile error until it is ranked here.
export const SKIP_KEY_RANK: Record<SkipMessageKey, number> = {
  raciSuggestSkipped: 0,
  raciSuggestSkippedInvalidRole: 1,
  raciSuggestSkippedAccountable: 2,
};
export const SKIP_KEY_ORDER: readonly SkipMessageKey[] = (
  Object.keys(SKIP_KEY_RANK) as SkipMessageKey[]
).sort((a, b) => SKIP_KEY_RANK[a] - SKIP_KEY_RANK[b]);

export interface RaciSuggestModalProps {
  lang: Lang;
  open: boolean;
  cells: readonly GroundedRaciCell[];
  skipped: readonly SkippedRaciCell[];
  /** True when the proposal was too large and some cells were not shown at all. */
  truncated: boolean;
  /** True when the CONTEXT was capped — i.e. the model never saw some
   *  stakeholders or milestones. A distinct signal from `truncated`, which is
   *  about the response: this one means a missing proposal may just be
   *  something Claude was never shown, not something it declined to assign. */
  contextTruncated: boolean;
  /** Live entities. Ambiguity is measured against the WHOLE workspace, not just
   *  the proposal — a lone proposed "Ada" is still ambiguous when a second
   *  "Ada" exists and was not proposed, and that is precisely the case where
   *  the user cannot tell who they are about to assign. Mirrors the scope of
   *  raci-panel's own `labelFor`. Structural types so tests need no fixtures. */
  stakeholders: readonly { id: number; name: string }[];
  milestones: readonly { id: number; name: string }[];
  /** cellKey()s the user has selected to apply. */
  selected: ReadonlySet<string>;
  onToggle: (key: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
  /** True while proposing or applying — disables the controls. */
  busy: boolean;
}

export function RaciSuggestModal({
  lang,
  open,
  cells,
  skipped,
  truncated,
  contextTruncated,
  stakeholders,
  milestones,
  selected,
  onToggle,
  onConfirm,
  onCancel,
  busy,
}: RaciSuggestModalProps) {
  const title = t(lang, "raciSuggestTitle");

  // Case-folded name -> occurrences, over the LIVE lists. Same normalisation as
  // raci-panel's labelFor, so the two surfaces qualify the same people.
  const nameCounts = useMemo(() => {
    const tally = (xs: readonly { name: string }[]) => {
      const m = new Map<string, number>();
      for (const x of xs) {
        const k = x.name.trim().toLowerCase();
        m.set(k, (m.get(k) ?? 0) + 1);
      }
      return m;
    };
    return { stakeholder: tally(stakeholders), milestone: tally(milestones) };
  }, [stakeholders, milestones]);
  const selectedCount = cells.reduce((n, c) => (selected.has(cellKey(c)) ? n + 1 : n), 0);
  const canConfirm = !busy && selectedCount > 0;

  const skippedByKey = new Map<SkipMessageKey, number>();
  for (const s of skipped) {
    const key = SKIP_REASON_KEY[s.reason];
    skippedByKey.set(key, (skippedByKey.get(key) ?? 0) + 1);
  }
  // Gate the bordered wrapper on what will actually RENDER, not on
  // `skipped.length`. Gating the box on one count and its contents on another
  // is what turns a missing bucket into an empty bordered box — visible, and
  // uninformative, which is worse than absent.
  const skippedRows = SKIP_KEY_ORDER.map(
    (key) => [key, skippedByKey.get(key) ?? 0] as const,
  ).filter(([, n]) => n > 0);

  return (
    <Modal open={open} onClose={busy ? () => {} : onCancel} ariaLabel={title}>
      <div
        data-modal-panel
        className="relative flex max-h-[90vh] w-[620px] max-w-[95vw] flex-col rounded-xl border border-line bg-surface"
      >
        <div className="border-b border-line px-6 py-4">
          <h2 className="text-base font-semibold text-foreground">{title}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{t(lang, "raciSuggestIntro")}</p>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
          {truncated && (
            <p className="mb-4 text-xs text-muted-foreground">{t(lang, "raciSuggestTruncated")}</p>
          )}
          {contextTruncated && (
            <p className="mb-4 text-xs text-muted-foreground">
              {t(lang, "raciSuggestContextTruncated")}
            </p>
          )}

          {cells.length === 0 ? (
            // "Claude proposed no assignments" is false exactly when this
            // branch is reachable: the hook only opens the preview with zero
            // cells when every proposal was SKIPPED, and the skipped block
            // below already says so. Keep the sentence for the defensive
            // zero-and-zero case only.
            skipped.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t(lang, "raciSuggestNoProposal")}</p>
            ) : (
              <p className="text-sm text-muted-foreground">{t(lang, "raciSuggestAllSkipped")}</p>
            )
          ) : (
            <ul className="space-y-2">
              {cells.map((c) => {
                const key = cellKey(c);
                // Two stakeholders can genuinely share a name, and cells are
                // deduped by (stakeholderId, milestoneId) — not by name — so
                // name+milestone is NOT guaranteed unique. Identical names on N
                // rows is a WCAG 2.4.6 failure the axe gate cannot see (it
                // reports missing names, never duplicate ones). Qualify with the
                // id only when the name actually collides, so the common case
                // stays readable.
                const nameIsAmbiguous =
                  (nameCounts.stakeholder.get(c.stakeholderName.trim().toLowerCase()) ?? 0) > 1;
                const who = nameIsAmbiguous
                  ? `${c.stakeholderName} (#${c.stakeholderId})`
                  : c.stakeholderName;
                // Milestone names collide the same way and for the same reason:
                // cells dedupe on (stakeholderId, milestoneId), and nothing
                // constrains Milestone.name to be unique. One stakeholder with
                // two same-named milestones is the mirror image of the case
                // above, and qualifying only one side leaves it open.
                const milestoneIsAmbiguous =
                  (nameCounts.milestone.get(c.milestoneName.trim().toLowerCase()) ?? 0) > 1;
                const which = milestoneIsAmbiguous
                  ? `${c.milestoneName} (#${c.milestoneId})`
                  : c.milestoneName;
                const on = selected.has(key);
                const currentLabel = c.currentRole ? t(lang, ROLE_LABEL_KEY[c.currentRole]) : t(lang, "raciSuggestNone");
                const proposedLabel = t(lang, ROLE_LABEL_KEY[c.role]);
                return (
                  <li key={key} className="rounded-md border border-line bg-surface-muted px-3 py-2">
                    <label className="flex cursor-pointer items-start gap-2">
                      <Checkbox
                        checked={on}
                        disabled={busy}
                        onChange={() => onToggle(key)}
                        aria-label={`${t(lang, "raciSuggestInclude")} – ${who} – ${which}`}
                        className="mt-0.5 shrink-0"
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-medium text-foreground">
                          {who}
                          <span className="text-muted-foreground"> · {which}</span>
                        </span>
                        <span className="mt-1 block text-sm text-foreground">
                          <span className="text-muted-foreground">{t(lang, "raciSuggestCurrent")}: </span>
                          {currentLabel}
                          {" → "}
                          <span className="text-muted-foreground">{t(lang, "raciSuggestProposed")}: </span>
                          {proposedLabel}
                        </span>
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          )}

          {skippedRows.length > 0 && (
            <div className="mt-4 space-y-1 border-t border-line pt-3 text-xs text-muted-foreground">
              {skippedRows.map(([key, n]) => (
                <p key={key}>{t(lang, key, n)}</p>
              ))}
            </div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-line px-6 py-4">
          <Button variant="secondary" size="sm" onClick={onCancel} disabled={busy}>
            {t(lang, "cancel")}
          </Button>
          <Button variant="primary" size="sm" onClick={onConfirm} disabled={!canConfirm}>
            {t(lang, "raciSuggestApply")}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
