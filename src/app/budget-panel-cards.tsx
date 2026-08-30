"use client";
/** Two presentational leaves of the Budget panel: the per-bucket "Manual %
 *  complete" input, and the CCI tile the project and bucket summaries repeat.
 *
 *  Split out of `budget-panel.tsx` to keep that orchestrator under the 800-line
 *  size ratchet (the gantt orchestrator + presentational-leaf convention).
 *
 *  ★★ AT THE EXTRACTION COMMIT (`74761580`) both bodies moved with every comment
 *  attached and the ONLY change to either was the `export` keyword each
 *  `function` now carries — but that "pure move" claim is now true of `Cci`
 *  ALONE. `58e34d3c` ("fix(a11y): bucket-unique names for budget reorder and
 *  percent controls") gave `ManualPercentCell` a NEW REQUIRED `rowToken` prop
 *  and replaced its template-literal `aria-label` with `rowLabel(...)`, so its
 *  accessible-name computation is no longer the one `budget-panel.tsx` had.
 *  Do not read this file as a mirror of the pre-split orchestrator when
 *  auditing the Budget accessible-name work — read `ManualPercentCell` itself.
 *  Reproduce the split:
 *    git show 74761580 --stat -- src/app/budget-panel-cards.tsx
 *    git log --oneline 74761580..HEAD -- src/app/budget-panel-cards.tsx */
import { type Lang, t } from "./i18n";
import { formatCurrency } from "./resource-cost";
import type { CciValue } from "./budget-report";
import { bucketPercentComplete } from "./budget-earned-value";
import { describeClamp } from "./sanitize-report";
import type { BudgetBucket, Task } from "./types";
import { useCommitDraft } from "./use-commit-draft";
import { RagBadge } from "./rag-badge";
import type { Health } from "./health";
import { InfoTooltip } from "./info-tooltip";
import { rowLabel } from "./row-tokens";
import { FOCUS_RING, TRANSITION } from "./interaction-styles";

/** The bucket's Manual % complete, editable without opening the bucket modal.
 *  The placeholder shows the task-derived percentage so the override
 *  relationship is visible in place. */
export function ManualPercentCell({
  lang, bucket, rowToken, tasks, onCommit,
}: {
  lang: Lang;
  bucket: BudgetBucket;
  /** The bucket's WCAG 2.4.6 disambiguation token, from a `buildRowTokens`
   *  (`row-tokens.ts`) map built over the RENDERED bucket list.
   *
   *  ★ REQUIRED, and it is a prop rather than something computed here because a
   *  per-item component has no sibling visibility — it cannot know whether some
   *  OTHER bucket carries the same name. Only the caller that maps the list can.
   *  Passing `bucket.name` defeats it: names are free text with no uniqueness
   *  constraint (`budget-bucket-modal.tsx` enforces only BUDGET_NAME_MAX). */
  rowToken: string;
  /** OPTIONAL on the panel — a caller that omits it gets no derived hint, never
   *  a misleading 0 %. */
  tasks: readonly Task[] | undefined;
  onCommit: (pct: number | undefined) => void;
}) {
  const derived = bucket.percentComplete === undefined && tasks
    ? bucketPercentComplete({ taskIds: bucket.taskIds, percentComplete: undefined }, tasks)
    : null;
  // Clearing the box must write `undefined`, NOT 0: `bucketPercentComplete`
  // treats a manual 0 as a real override that wins over the task derivation,
  // so a 0 would pin the bucket at 0 % forever.
  const draft = useCommitDraft(
    bucket.percentComplete === undefined ? "" : String(bucket.percentComplete),
    (raw) => onCommit(describeClamp(raw, { min: 0, max: 100, round: 2 }).value),
  );
  return (
    <span className="mt-1 flex items-center gap-1 text-xs text-muted-foreground">
      {t(lang, "budgetPercentComplete")}
      {/* ★ Qualified for the same reason the input below is, and it was missed
          when the input was fixed: the hint trigger is `role="button"`
          `tabIndex={0}`, so it is a control in its own right and N buckets put N
          identically-named ones on the page. It has no visible text of its own,
          so WCAG 2.5.3 does not bind — the token is APPENDED anyway, matching
          every other qualified name in this panel (open-followups §246). */}
      <InfoTooltip
        text={t(lang, "budgetPercentCompleteHint")}
        label={rowLabel(t(lang, "budgetPercentCompleteHint"), rowToken)}
      />
      <input
        // ★★ Bucket-UNIQUE via `rowToken`, NOT merely bucket-qualified. N
        // identical "Manual % complete" labels is a WCAG 2.4.6 failure the axe
        // gate cannot see (of axe-core 4.12.1's rules, not one carrying a tag
        // e2e/a11y.spec.ts requests flags two controls sharing a name), so the
        // only detector is the unit test in `budget-panel.test.tsx` — "keeps
        // every bucket control bucket-unique when two buckets share a name".
        // ★ `budget-bucket-modal.tsx` renders a SECOND percent input carrying
        // the BARE `budgetPercentComplete` label. That is not this collision and
        // must not be "fixed" to match: the modal is the only such control in
        // its own dialog, and `modal.tsx` sets `aria-modal="true"`, which hides
        // these background copies from AT. 2.4.6 is about one context.
        aria-label={rowLabel(t(lang, "budgetPercentComplete"), rowToken)}
        type="number"
        min={0}
        max={100}
        step="1"
        placeholder={derived === null ? "—" : String(Math.round(derived))}
        value={draft.value}
        onChange={(e) => draft.onChange(e.target.value)}
        onFocus={draft.onFocus}
        onBlur={draft.onBlur}
        onKeyDown={draft.onKeyDown}
        className={`w-16 rounded border border-line bg-surface px-1 py-0.5 text-right tabular-nums ${FOCUS_RING} ${TRANSITION}`}
      />
      <span aria-hidden="true">%</span>
    </span>
  );
}

export function Cci({ label, hint, scopeName, value, currency, locale, lang, rag, primary = "amount", unknown = false }: { label: string; hint?: string;
  /** The bucket's WCAG 2.4.6 disambiguation token when this tile is one of N
   *  repeated per bucket; omitted by the project-total block, which renders
   *  exactly once and so has nothing to collide with.
   *
   *  ★ A TOKEN, not a raw bucket name — bucket names are free text with no
   *  uniqueness constraint, so qualifying with one still collides when two
   *  buckets share it. Callers pass a `buildRowTokens` (`row-tokens.ts`) value. */
  scopeName?: string; value: CciValue; currency: string; locale: string; lang: Lang; rag?: Health | null; primary?: "amount" | "percent"; unknown?: boolean }) {
  const pct = value.percent == null ? "—" : `${value.percent.toFixed(1)}%`;
  // `unknown` means the figure could not be computed (no internal rate), NOT
  // that it computed to zero. Both figures go to "—" and the tone stays neutral:
  // the green/red tone reads as a judgement, and there is nothing to judge.
  const tone = unknown
    ? "text-muted-foreground"
    : value.amount >= 0 ? "text-[var(--rag-green-text)]" : "text-[var(--rag-red-text)]";
  const bigFigure = unknown ? "—" : primary === "percent" ? pct : formatCurrency(value.amount, currency, locale);
  const smallFigure = unknown ? "—" : primary === "percent" ? formatCurrency(value.amount, currency, locale) : pct;
  return (
    <div className="rounded-lg border border-line p-3">
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span className="flex items-center gap-1">
          {label}
          {/* ★ APPENDED, never prefixed or replaced. The tooltip trigger has no
              visible text of its own, so WCAG 2.5.3 does not bind here — but the
              same append rule is used across this slice so one convention covers
              every qualified name (open-followups §246). `scopeName` is the
              bucket's row TOKEN, not its raw name: two buckets may share a name.
              The project-total cards pass nothing and keep the bare hint.
              ★ `undefined`, never `""` — and NOT because an empty label would
              blank the name: name computation SKIPS an empty or
              whitespace-only `aria-label` and falls through to content
              (accname step 2C). Here the mechanism is the `??` one line down:
              `InfoTooltip` resolves its name as `label ?? text`, and `""` is
              not nullish, so it would defeat that fallback and leave the
              trigger's literal "i" glyph as its whole accessible name — not a
              blanked name, a wrong one. `undefined` restores the hint. */}
          {hint ? <InfoTooltip text={hint} label={scopeName ? rowLabel(hint, scopeName) : undefined} /> : null}
        </span>
        {rag !== undefined && !unknown ? <RagBadge value={rag} lang={lang} title={label} /> : null}
      </div>
      <div className={`text-lg font-semibold ${tone}`}>{bigFigure}</div>
      <div className="text-xs text-muted-foreground">{smallFigure}</div>
    </div>
  );
}
