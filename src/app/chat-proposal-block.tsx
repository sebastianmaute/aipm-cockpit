"use client";

// src/app/chat-proposal-block.tsx — the staged-proposal review card.
//
// PRESENTATIONAL ONLY. Rows, selection and every handler arrive as props; this
// file reads no workspace, holds no selection state and never applies anything.
// The one piece of state it owns is the show-all disclosure, which is a purely
// visual concern and cannot change what a later apply writes.
//
// ★★★ EVERY STAGED CALL GETS A ROW, INCLUDING ONE THE DESCRIPTOR ENGINE CANNOT
// DIFF. `describeProposal` emits an EMPTY plan (`{updates:[],creates:[],
// deletes:[],rejected:[],links:[]}`) for every tool with no `INLINE_DESCRIPTORS` entity —
// the three `*_document` tools, plus `delete_all_tasks`, `send_inquiry` and
// `set_task_dependencies`. Those rows carry only `call.name` and `call.input`,
// and they are the rows that most need to be VISIBLE: document writes take no
// undo capture at all (`use-document-tools.ts` says so at three sites), so this
// card is the only thing between the model and an unreviewed multi-document
// rewrite. The TOOL NAME is therefore rendered on EVERY row rather than as an
// empty-plan special case — a branch that only runs for the rows nobody has in
// a fixture is a branch that ships broken.
//
// ★★ NOTHING HERE PROMISES UNDO, and no string in the card may start to. An
// applied plan's updates and deletes to the six inline entities are reversible
// by one undo entry; its CREATES are not (the undo engine has no create op) and
// its DOCUMENT writes are not (they recover through version history instead).
// A blanket "you can undo this" would be false for two of the three shapes this
// card stages.
//
// ★★★ ROW-UNIQUE ACCESSIBLE NAMES ARE PINNED BY A UNIT TEST AND BY NOTHING
// ELSE. axe carries no rule flagging two controls that share an accessible name
// under any tag the e2e gate requests, at any seed size — and this card only
// exists after a live model turn, so no e2e seed will ever render it. The names
// come from the shared `buildRowTokens`/`rowLabel` so the occurrence-index shape
// is the one `requireCollisionSeed` can certify.

import { useMemo, useState } from "react";
import { type Lang, t } from "./i18n";
import { Button } from "./button";
import { Checkbox } from "./form-controls";
import { buildRowTokens, rowLabel } from "./row-tokens";
import type { ProposedCall } from "./chat-proposal";
import type { ProposalFailureKind } from "./chat-proposal-apply";
import { isEmptyPlan, type EditPlan } from "./inline-ai-edit/plan";
import { type InlineEntity } from "./inline-ai-edit/entity-descriptor";
import { fieldLabel, linkLabel } from "./inline-ai-edit/field-labels";
import { TOOL_ENTITY } from "./chat-proposal-describe";

/** Rows shown before the disclosure collapses the rest. */
export const PROPOSAL_COLLAPSE_AFTER = 5;

export interface ProposalCardRow {
  /** Position in the emitted call list — the row's stable identity, matching
   *  `PlanRow.index`, so a deselect keys on the same number the cascade does. */
  readonly index: number;
  readonly call: ProposedCall;
  readonly plan: EditPlan;
  /**
   * The row's display name — what the user reads and what disambiguation is
   * keyed on.
   *
   * ★★ REQUIRED, deliberately. An UPDATE plan carries only `FieldDiff`s and no
   * entity label, so this card cannot derive a title for the commonest row
   * shape; a caller that forgets it must fail to typecheck rather than silently
   * label half the card with tool names. `proposalRowTitle` below is the
   * default a caller should reach for.
   */
  readonly title: string;
  /** A row this one depends on was deselected. Not selectable. */
  readonly cascaded?: boolean;
  /** Apply reached this row and it did not land. */
  readonly failed?: boolean;
  /** WHY it did not land. ★★ `failed` still covers EVERY not-ok row —
   *  under-reporting is the worse direction and a row that did not land must
   *  never read as applied — so this narrows the MESSAGE, never the set.
   *  Absent is treated as "conflict", preserving the pre-existing string for
   *  any caller that has not been updated. */
  readonly failedKind?: ProposalFailureKind;
}

export interface ChatProposalBlockProps {
  readonly lang: Lang;
  readonly rows: readonly ProposalCardRow[];
  readonly selected: ReadonlySet<number>;
  readonly onToggleRow: (index: number) => void;
  readonly onApply: () => void;
  readonly onDiscard: () => void;
  /** Override the disclosure threshold. Tests pass a small number. */
  readonly collapseAfter?: number;
  /** Apply is in flight — both actions go inert without unmounting the card. */
  readonly busy?: boolean;
}

/**
 * The best display name derivable from a described row, for a caller with no
 * better source.
 *
 * ★ A CREATE and a DELETE carry a real label in the plan. An UPDATE does not —
 * `describeEntityCalls` emits `FieldDiff`s alone — so this falls back to the
 * call's own title-ish input and finally to the tool name, which is legible but
 * not identifying. A caller holding the workspace (the wiring layer does) should
 * resolve `input.id` against the live row instead of using that last fallback.
 */
export function proposalRowTitle(call: ProposedCall, plan: EditPlan): string {
  const created = plan.creates[0]?.title;
  if (created) return created;
  const deleted = plan.deletes[0]?.label;
  if (deleted) return deleted;
  const input = call.input as { title?: unknown; taskName?: unknown; name?: unknown };
  for (const candidate of [input.title, input.taskName, input.name]) {
    if (typeof candidate === "string" && candidate.trim() !== "") return candidate;
  }
  return call.name;
}

/** The plan's changes, one line each. Renders nothing when the engine had no
 *  entity for the call — the tool name beside it is then the whole story.
 *
 *  ★★★ THE GUARD IS NOT `isEmptyPlan` ALONE, deliberately. That predicate
 *  answers "would this WRITE anything", which is the right question for
 *  enabling Apply and the wrong one here: it excludes `rejected` because a
 *  rejected call writes nothing. A row whose only outcome is that a field will
 *  NOT land is exactly the row a reviewer most needs to see, and under
 *  `isEmptyPlan` alone the rejection renderer below would be unreachable for
 *  it. Pinned by "renders a rejection on a row whose plan writes nothing". */
function PlanDetail({
  lang,
  plan,
  entity,
}: {
  lang: Lang;
  plan: EditPlan;
  /** ★★ RESOLVED FROM THE ROW'S OWN TOOL NAME, not from the card. A staged
   *  proposal mixes entities freely, so one card-wide entity would mislabel
   *  every row but the first — `impact` is a 1-5 `RiskScale` on a RAID item and
   *  a Low/Medium/High/Critical `ChangeImpact` enum on a change. `undefined` for
   *  a tool the descriptor engine has no entity for (every `*_document` tool,
   *  and `set_task_dependencies`), and `fieldLabel` then falls back to the raw
   *  property name rather than guessing — except for the fields
   *  `ENTITYLESS_FIELD_LABEL_KEY` covers, which it translates instead.
   *
   *  ★★★ DO NOT "ALIGN" THIS TO THE PER-DIFF `d.entity` / `l.entity` THE OTHER
   *   TWO SURFACES READ. `inline-ai-edit-popover.tsx` passes `d.entity` and
   *   `l.entity`, and copying that here is a REGRESSION on the links line —
   *   measured 2026-09-06, not reasoned. `set_task_dependencies` is
   *   deliberately absent from `TOOL_ENTITY`, so this prop is `undefined` for
   *   its row and `fieldLabel` routes through `ENTITYLESS_FIELD_LABEL_KEY`;
   *   `describeDependencyCall` nonetheless sets the diff's own
   *   `entity: "task"`, and `FIELD_LABEL_KEY` declares no `task.dependencies`
   *   member, so `keyedFieldLabel` falls straight back to the RAW property
   *   name. Reproduce with `linkLabel` directly:
   *     linkLabel("en-US", undefined, {field:"dependencies",subject:"Draft brief"})
   *       → "Draft brief – Dependencies"   (today, and the same in DE)
   *     linkLabel("en-US", "task",      {field:"dependencies",subject:"Draft brief"})
   *       → "Draft brief – dependencies"   (after the "alignment")
   *   An untranslated lowercase property name on an approval card, in every
   *   language. The same trade is spelled out from the producer's side in
   *   `chat-proposal-describe.ts`, above its `entity: "task"` push.
   *
   *  ★★ THE UPDATES LINE IS A DIFFERENT CASE AND IS NOT WORTH CHANGING EITHER:
   *   there, this prop and `d.entity` are provably the SAME VALUE, so no test
   *   can discriminate the two forms. `TOOL_ENTITY` is built by walking
   *   `INLINE_DESCRIPTORS` and mapping each descriptor's create/update/delete
   *   tool to that descriptor's `entity`; a `FieldDiff`'s `entity` comes from
   *   the descriptor the engine resolved for the same tool. A row whose tool
   *   has no descriptor gets an EMPTY plan, so `plan.updates` is never
   *   non-empty while this prop is `undefined`. Switching only that line would
   *   buy nothing and leave the file reading as a half-finished edit. */
  entity: InlineEntity | undefined;
}) {
  if (isEmptyPlan(plan) && plan.rejected.length === 0) return null;
  return (
    <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground">
      {plan.updates.map((d, i) => (
        <li key={`u${i}-${d.field}`}>
          <span className="font-medium text-foreground">{fieldLabel(lang, entity, d.field)}</span>:{" "}
          {d.before || "—"} → {d.after || "—"}
        </li>
      ))}
      {/* ★★ A relationship write REPLACES, so an unrendered link change is a
          silent destructive write rather than mere under-disclosure — the
          inline path rebuilds its patch from this bucket. `before`/`after` are
          RESOLVED TITLES (never `rawIds`), and the `|| "—"` is load-bearing:
          `after` is legitimately "" for a cleared FK or a list emptied to
          nothing, which is the most destructive line this card can show. */}
      {plan.links.map((l, i) => (
        <li key={`l${i}-${l.field}`}>
          <span className="font-medium text-foreground">{linkLabel(lang, entity, l)}</span>:{" "}
          {l.before || "—"} → {l.after || "—"}
        </li>
      ))}
      {plan.creates.map((c, i) => (
        <li key={`c${i}`}>{t(lang, "inlineAiEditCreate", c.entity, c.title)}</li>
      ))}
      {plan.deletes.map((del, i) => (
        <li key={`d${i}`}>{t(lang, "inlineAiEditDelete", del.entity, del.label)}</li>
      ))}
      {/* Last, and in the failure colour the row's own not-applied notice uses:
          these are the parts of the call that will NOT land. */}
      {plan.rejected.map((r, i) => (
        <li key={`r${i}`} className="text-ui-pink-strong">
          {t(lang, "inlineAiEditRejected", r.detail)}
        </li>
      ))}
    </ul>
  );
}

function ProposalRow({
  lang,
  row,
  token,
  checked,
  onToggle,
  disabled,
}: {
  lang: Lang;
  row: ProposalCardRow;
  token: string;
  checked: boolean;
  onToggle: () => void;
  disabled: boolean;
}) {
  return (
    <li className="border-t border-line px-3 py-2 first:border-t-0" data-proposal-row={row.index}>
      {/* The wrapper's first labelable descendant IS the checkbox, so the
          binding is the intended one; the checkbox's own aria-label still wins
          the accessible name, and the visible title is contained in it (2.5.3). */}
      <label className="flex cursor-pointer items-start gap-2">
        <Checkbox
          className="mt-0.5"
          checked={checked}
          disabled={disabled}
          onChange={onToggle}
          aria-label={rowLabel(t(lang, "chatProposalRowToggle"), token)}
        />
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium text-foreground">{row.title}</span>
          <span className="block font-mono text-[11px] text-muted-foreground">{row.call.name}</span>
        </span>
      </label>
      <PlanDetail lang={lang} plan={row.plan} entity={TOOL_ENTITY[row.call.name]} />
      {row.cascaded && (
        <p className="mt-1 text-xs text-muted-foreground">{t(lang, "chatProposalCascaded")}</p>
      )}
      {row.failed && (
        <p className="mt-1 text-xs text-ui-pink-strong">
          {t(
            lang,
            row.failedKind === "dependency"
              ? "chatProposalFailedDependency"
              : row.failedKind === "unreadable"
                ? "chatProposalFailedUnreadable"
                : row.failedKind === "error"
                  ? "chatProposalFailedError"
                  : "chatProposalFailed",
          )}
        </p>
      )}
    </li>
  );
}

export function ChatProposalBlock({
  lang,
  rows,
  selected,
  onToggleRow,
  onApply,
  onDiscard,
  collapseAfter = PROPOSAL_COLLAPSE_AFTER,
  busy = false,
}: ChatProposalBlockProps) {
  const [expanded, setExpanded] = useState(false);

  // ★ Built over EVERY row, never over the visible slice — otherwise expanding
  // the disclosure would renumber the rows already on screen, and a token that
  // moves under the user is worse than one that repeats.
  const tokens = useMemo(
    () => buildRowTokens(rows.map((r) => ({ id: r.index, name: r.title }))),
    [rows],
  );

  const collapsed = !expanded && rows.length > collapseAfter;
  const visible = collapsed ? rows.slice(0, collapseAfter) : rows;
  const selectedCount = rows.filter((r) => selected.has(r.index)).length;

  return (
    <section
      className="rounded-lg border border-line bg-surface"
      aria-label={t(lang, "chatProposalTitle")}
    >
      <header className="flex items-baseline justify-between gap-2 px-3 py-2">
        <h3 className="text-sm font-semibold text-foreground">{t(lang, "chatProposalTitle")}</h3>
        <span className="text-xs text-muted-foreground">
          {t(lang, "chatProposalCount", rows.length)}
        </span>
      </header>

      <ul>
        {visible.map((row) => (
          <ProposalRow
            key={row.index}
            lang={lang}
            row={row}
            token={tokens.get(row.index) ?? row.title}
            checked={selected.has(row.index)}
            disabled={busy || row.cascaded === true}
            onToggle={() => onToggleRow(row.index)}
          />
        ))}
      </ul>

      {collapsed && (
        <div className="border-t border-line px-3 py-2">
          <Button
            variant="ghost"
            size="xs"
            aria-expanded={false}
            onClick={() => setExpanded(true)}
          >
            {t(lang, "chatProposalShowMore")}
          </Button>
        </div>
      )}

      <div className="flex justify-end gap-2 border-t border-line px-3 py-2">
        <Button variant="destructive" size="sm" disabled={busy} onClick={onDiscard}>
          {t(lang, "chatProposalDiscard")}
        </Button>
        <Button size="sm" disabled={busy || selectedCount === 0} onClick={onApply}>
          {`${t(lang, "chatProposalApply")} (${t(lang, "chatProposalSelected", selectedCount)})`}
        </Button>
      </div>
    </section>
  );
}
