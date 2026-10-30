"use client";

// src/app/chat-proposal-block.tsx — the staged-proposal review card.
//
// PRESENTATIONAL ONLY. Rows, selection and every handler arrive as props; this
// file reads no workspace, holds no selection state and never applies anything.
// The one piece of state it owns is the show-all disclosure, which is a purely
// visual concern and cannot change what a later apply writes.
//
// ★★★ EVERY STAGED CALL GETS A ROW, INCLUDING ONE THE DESCRIPTOR ENGINE CANNOT
// DIFF. `describeProposal` emits an EMPTY plan for the stageable write tools that have no
// `INLINE_DESCRIPTORS` entity and no hand-written describer. The authoritative list is the test
// "omits exactly the stageable write tools the descriptor engine cannot diff" in
// `chat-proposal-describe.test.ts` — read it there rather than restating it here; a copy of
// that list in this comment went stale once already (it named a tool that had since gained
// a describer). Those rows carry only `call.name` and `call.input` (a document write also carries
// `document`, what it writes, AI-02), and they are the rows
// that most need to be VISIBLE: document writes take no
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
import { type Lang, type TranslationKey, t, tPlural } from "./i18n";
import { Button } from "./button";
import { Checkbox } from "./form-controls";
import { buildRowTokens, rowLabel } from "./row-tokens";
import { carriesEnabledModules, type ProposedCall } from "./chat-proposal";
import type { FunctionsChange } from "./chat-proposal-describe-functions";
import type { DeviceChange } from "./chat-proposal-describe-device";
import type { DocOpKind, DocumentChange } from "./chat-proposal-describe-document";
import type { Filters } from "./chat-tools";
import { moduleNames } from "./functions-picker";
import type { ProposalFailureKind } from "./chat-proposal-apply";
import { isEmptyPlan, type DiffEntity, type EditPlan, type Rejected } from "./inline-ai-edit/plan";
import { fieldLabel, linkLabel } from "./inline-ai-edit/field-labels";
import { CreateFieldsList } from "./create-fields-list";
import { AbsenceClashNotes } from "./absence-clash-notes";
import {
  forecastRowLine,
  previewEntityOf,
  projectRowName,
  type DescribedRow,
  type ForecastChangeCount,
  type ForecastLine,
  type ForecastScenarioRef,
} from "./chat-proposal-describe";
import type { Workspace } from "./workspace";

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
  /** §779 — what a staged `update_settings { enabledModules }` switches, from `DescribedRow.functions`.
   *  Absent on every other row, which then renders exactly as before. */
  readonly functions?: FunctionsChange;
  /** AI-02 — what a staged `create_document` or `update_document` writes, from `DescribedRow.document`. Absent
   *  on every other row. */
  readonly document?: DocumentChange;
}

export interface ChatProposalBlockProps {
  readonly lang: Lang;
  readonly rows: readonly ProposalCardRow[];
  readonly selected: ReadonlySet<number>;
  readonly onToggleRow: (index: number) => void;
  /** Select every selectable row, or clear the selection.
   *
   *  ★★ OPTIONAL, so the card still renders for a caller that has no such
   *   handler — the control simply does not appear. It is NOT given a no-op
   *   default: a checkbox that draws and does nothing is the false affordance
   *   this codebase already rejects for the resize grip. */
  readonly onToggleAll?: (next: boolean) => void;
  readonly onApply: () => void;
  readonly onDiscard: () => void;
  /** Override the disclosure threshold. Tests pass a small number. */
  readonly collapseAfter?: number;
  /** Apply is in flight — both actions go inert without unmounting the card. */
  readonly busy?: boolean;
  /** Rows committed by the last Apply, or `null` before any Apply on this card.
   *
   *  ★★★ SUCCESS WAS THE ONE OUTCOME WITH NO STRING. Four failure kinds each had
   *   one; a clean Apply merely emptied the selection and disabled the button,
   *   which is what a dead button looks like — a user reported the click as
   *   never having fired, on a batch that had in fact been written. `0` and
   *   `null` are different states and must stay so: nothing applied yet, versus
   *   an Apply that committed nothing. */
  readonly applied?: number | null;
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

/** §779 — the card line for an `update_settings` call carrying `enabledModules`, or null for any other
 *  call. Translated here, beside the card's other strings: `liveRowTitle` is i18n-free. */
export function functionsRowTitle(lang: Lang, call: ProposedCall): string | null {
  return carriesEnabledModules(call) ? t(lang, "chatProposalFunctionsTitle") : null;
}

/** AI-02 — the card line for an `escalate_raid_item` call, or null for any other call. The describer emits no
 *  diff for it, so this line is where the user sees the RAID item and the recipient ADDRESS the escalation would
 *  record. `raid` is the live register; an item it does not hold is named by its id. */
export function escalationRowTitle(
  lang: Lang,
  call: ProposedCall,
  raid: readonly { readonly id: number; readonly title?: string }[],
): string | null {
  if (call.name !== "escalate_raid_item") return null;
  const input = call.input as { id?: unknown; toEmail?: unknown; toName?: unknown };
  const id = Number(input.id);
  const found = raid.find((r) => r.id === id)?.title;
  const item = typeof found === "string" && found.trim() !== "" ? found : `#${String(input.id)}`;
  const email = typeof input.toEmail === "string" ? input.toEmail : "";
  const name = typeof input.toName === "string" ? input.toName.trim() : "";
  return t(lang, "chatProposalEscalateTitle", item, name !== "" ? `${name} <${email}>` : email);
}

/** AI-02 — the card line for the three task tools the describer gives no title: `delete_all_tasks` (with the
 *  live task count), `send_inquiry` and `set_task_dependencies` (each naming the live task, or its id). Null for
 *  any other call. */
export function taskToolRowTitle(
  lang: Lang,
  call: ProposedCall,
  tasks: readonly { readonly id: number; readonly taskName?: string }[],
): string | null {
  if (call.name === "delete_all_tasks") return t(lang, "chatProposalDeleteAllTasksTitle", tasks.length);
  const key: TranslationKey | null =
    call.name === "send_inquiry" ? "chatProposalInquiryTitle"
    : call.name === "set_task_dependencies" ? "chatProposalDependenciesTitle"
    : null;
  if (key === null) return null;
  const rawId = (call.input as { id?: unknown }).id;
  const found = tasks.find((task) => task.id === Number(rawId))?.taskName;
  return t(lang, key, typeof found === "string" && found.trim() !== "" ? found : `#${String(rawId)}`);
}

/** The card line for a row `liveRowTitle` (`chat-proposal-stage.ts`) could not title from the live workspace: the
 *  translated lines first, the call's own title-ish input last. The panel passes it to `proposalTitles`; the
 *  coverage test in `chat-proposal-describe.test.ts` runs every stageable tool through the same pair.
 *  `pendingScenarios` names the forecast scenarios the same plan creates (`pendingScenarioNames`). */
export function cardRowTitle(
  lang: Lang,
  row: DescribedRow,
  ws: Workspace,
  pendingScenarios: ReadonlyMap<number, string> = new Map(),
): string {
  const forecast = forecastRowLine(row.call, ws, pendingScenarios);
  const projectName = projectRowName(row.call, ws.project);
  return (
    (forecast === null ? null : forecastRowTitle(lang, forecast)) ??
    (projectName === null ? null : t(lang, "chatProposalProjectTitle", t(lang, "chatProposalQuoted", projectName))) ??
    functionsRowTitle(lang, row.call) ??
    escalationRowTitle(lang, row.call, ws.raid ?? []) ??
    taskToolRowTitle(lang, row.call, ws.tasks ?? []) ??
    deviceRowTitle(lang, row.device) ??
    proposalRowTitle(row.call, row.plan)
  );
}

function scenarioText(lang: Lang, ref: ForecastScenarioRef): string {
  return ref.kind === "named" ? t(lang, "chatProposalQuoted", ref.name) : `#${ref.id}`;
}

function changeCountText(lang: Lang, changes: ForecastChangeCount): string {
  if (changes.kind === "rows") return tPlural(lang, "chatProposalForecastChanges", changes.count, changes.count);
  // Singular only when both counts are 1.
  const key = changes.before === 1 && changes.after === 1 ? "chatProposalForecastReplaceSingular" : "chatProposalForecastReplace";
  return t(lang, key, changes.before, changes.after);
}

/** §502 — a staged forecast write's card line, translated from the data `forecastRowLine` returns. */
export function forecastRowTitle(lang: Lang, line: ForecastLine): string {
  const withCount = (base: string, changes: ForecastChangeCount | null): string =>
    changes === null ? base : `${base} (${changeCountText(lang, changes)})`;
  switch (line.kind) {
    case "target":
      return t(lang, "chatProposalForecastTarget", line.value);
    case "save":
      return withCount(t(lang, "chatProposalForecastSave", t(lang, "chatProposalQuoted", line.name)), line.changes);
    case "clearProposal":
      return t(lang, "chatProposalForecastClear");
    case "propose":
      return t(lang, "chatProposalForecastPropose", scenarioText(lang, line.scenario));
    case "delete":
      return t(lang, line.isProposal ? "chatProposalForecastDeleteProposal" : "chatProposalForecastDelete", scenarioText(lang, line.scenario));
    case "edit": {
      const base = line.rename === null
        ? t(lang, "chatProposalForecastEdit", scenarioText(lang, line.scenario))
        : t(lang, "chatProposalForecastEditRenamed", scenarioText(lang, line.scenario), t(lang, "chatProposalQuoted", line.rename));
      return withCount(base, line.changes);
    }
  }
}

/** Settings as the tool names them, `key = value`; no settings label table exists. */
function settingPairs(settings: readonly { readonly key: string; readonly value: string }[]): string {
  return settings.map((o) => `${o.key} = ${o.value}`).join(", ");
}

/** The languages' own names, as the language picker in Settings shows them. */
const LANGUAGE_NAMES: Readonly<Record<string, string>> = { "en-US": "English (US)", "en-GB": "English (UK)", de: "Deutsch" };

/** Each filter's label, in the order the task list's toolbar shows them. */
const FILTER_LABEL_KEY: Readonly<Record<keyof Filters, TranslationKey>> = {
  search: "chatProposalFilterSearch",
  priority: "priority",
  assignee: "assignee",
  group: "group",
  label: "labels",
};

function filterPairs(lang: Lang, filters: Filters): string {
  const pairs = (Object.keys(FILTER_LABEL_KEY) as (keyof Filters)[])
    .filter((k) => filters[k] !== undefined)
    .map((k) => {
      const value = filters[k];
      return `${t(lang, FILTER_LABEL_KEY[k])} = ${value === "" || value === "All" ? t(lang, "chatProposalFilterAll") : value}`;
    });
  return pairs.length > 0 ? pairs.join(", ") : "—";
}

/** AI-02 — the card line for a staged `set_language`, `set_filters` or device-only `update_settings`, built from
 *  what the call changes (`DescribedRow.device`), or null for any other row. */
export function deviceRowTitle(lang: Lang, device: DeviceChange | undefined): string | null {
  if (device === undefined) return null;
  switch (device.kind) {
    case "language":
      return t(lang, "chatProposalLanguageTitle", LANGUAGE_NAMES[device.language] ?? device.language);
    case "filters":
      return t(lang, "chatProposalFiltersTitle", filterPairs(lang, device.filters));
    case "settings":
      return t(lang, "chatProposalSettingsTitle", device.settings.length > 0 ? settingPairs(device.settings) : "—");
  }
}

/** §779 — the functions a staged row switches on and off, by the labels the Functions picker shows. */
function FunctionsDetail({ lang, change }: { lang: Lang; change: FunctionsChange }) {
  const unchanged = change.on.length === 0 && change.off.length === 0;
  return (
    <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground">
      {change.on.length > 0 && <li>{t(lang, "chatProposalFunctionsOn", moduleNames(lang, change.on))}</li>}
      {change.off.length > 0 && <li>{t(lang, "chatProposalFunctionsOff", moduleNames(lang, change.off))}</li>}
      {unchanged && <li>{t(lang, "chatProposalFunctionsUnchanged")}</li>}
      {change.dropped.length > 0 && (
        <li className="text-ui-pink-strong">{t(lang, "chatProposalFunctionsDropped", change.dropped.join(", "))}</li>
      )}
      {/* The rest of the same call: under the title "Project functions" it would otherwise be invisible.
          No settings label table exists, so the keys are named as the tool names them. */}
      {change.others.length > 0 && (
        <li>{t(lang, "chatProposalFunctionsOthers", settingPairs(change.others))}</li>
      )}
      {/* The functions write takes no undo capture, while the rest of an applied plan does: neither the
          shortcut (Ctrl+Z, Cmd+Z on a Mac) nor the undo button reverses it, so no shortcut is named. */}
      <li>{t(lang, "chatProposalFunctionsNoUndo")}</li>
    </ul>
  );
}

/** Each `update_document` op kind's label. */
const DOC_OP_LABEL_KEY: Readonly<Record<DocOpKind, TranslationKey>> = {
  append: "chatProposalDocOpAppend",
  insert: "chatProposalDocOpInsert",
  replace: "chatProposalDocOpReplace",
  replaceAll: "chatProposalDocOpReplaceAll",
  move: "chatProposalDocOpMove",
  delete: "chatProposalDocOpDelete",
};

/** AI-02 — what a staged document write puts into the document: a new document's block count, an update's op
 *  kinds and new title, and the opening text either writes. The text is a plain-text projection rendered as a
 *  React text node, so markup in it is shown, never interpreted. */
function DocumentDetail({ lang, change }: { lang: Lang; change: DocumentChange }) {
  return (
    <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground">
      {change.kind === "create" && <li>{t(lang, "chatProposalDocBlocks", change.blockCount)}</li>}
      {change.kind === "update" && change.ops.length > 0 && (
        <li>
          {t(lang, "chatProposalDocOps", change.ops.map((o) => `${t(lang, DOC_OP_LABEL_KEY[o.op])} × ${o.count}`).join(", "))}
        </li>
      )}
      {change.kind === "update" && change.rename !== null && <li>{t(lang, "chatProposalDocRename", change.rename)}</li>}
      {change.excerpt !== "" && <li>{t(lang, "chatProposalDocText", change.excerpt)}</li>}
    </ul>
  );
}

/** A rejection's line. A project refusal carries the bare reason and names its field here, in the project
 *  form's label (§715); every other rejection's detail already names its field or target. */
function rejectedText(lang: Lang, entity: DiffEntity | undefined, r: Rejected): string {
  return entity === "project" && r.field !== undefined ? `${fieldLabel(lang, entity, r.field)}: ${r.detail}` : r.detail;
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
   *  `"project"` for `update_project` (§715, `previewEntityOf`), labelled with
   *  the project form's own keys through `PROJECT_FIELD_LABEL_KEY`.
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
   *       → "Draft brief – Dependencies"   (today)
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
  entity: DiffEntity | undefined;
}) {
  // §773 — a pending row's plan is empty but for its clashes (`chat-proposal-turn-clashes.ts`), so they count.
  if (isEmptyPlan(plan) && plan.rejected.length === 0 && plan.clashes.length === 0) return null;
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
        <li key={`c${i}`}>{t(lang, "inlineAiEditCreate", c.entity, c.title)}<CreateFieldsList lang={lang} item={c} /></li>
      ))}
      {plan.deletes.map((del, i) => (
        <li key={`d${i}`}>{t(lang, "inlineAiEditDelete", del.entity, del.label)}</li>
      ))}
      {/* §773 — a warning, not a refusal: the row still applies. */}
      <AbsenceClashNotes lang={lang} clashes={plan.clashes} />
      {/* Last, and in the failure colour the row's own not-applied notice uses:
          these are the parts of the call that will NOT land. */}
      {plan.rejected.map((r, i) => (
        <li key={`r${i}`} className="text-ui-pink-strong">
          {t(lang, "inlineAiEditRejected", rejectedText(lang, entity, r))}
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
      <PlanDetail lang={lang} plan={row.plan} entity={previewEntityOf(row.call.name)} />
      {row.functions && <FunctionsDetail lang={lang} change={row.functions} />}
      {row.document && <DocumentDetail lang={lang} change={row.document} />}
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
                : row.failedKind === "rejected"
                  ? "chatProposalFailedRejected"
                  : row.failedKind === "scopeChanged"
                    ? "chatProposalFailedScope"
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
  onToggleAll,
  onApply,
  onDiscard,
  collapseAfter = PROPOSAL_COLLAPSE_AFTER,
  busy = false,
  applied = null,
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
  // ★★ MEASURED AGAINST EVERY ROW, cascaded ones included. A select-all selects
  //  the whole plan, which makes no row cascaded — cascading is a function of
  //  the selection, and every dependency is another row of this same plan — so
  //  the all-checked state is always reachable. An earlier cut excluded
  //  cascaded rows here to pair with a handler that skipped them, and that
  //  handler was itself the bug.
  const totalCount = rows.length;

  return (
    <section
      className="rounded-lg border border-line bg-surface"
      aria-label={t(lang, "chatProposalTitle")}
    >
      <header className="flex items-baseline justify-between gap-2 px-3 py-2">
        <h3 className="text-sm font-semibold text-foreground">{t(lang, "chatProposalTitle")}</h3>
        <span className="text-xs text-muted-foreground">
          {tPlural(lang, "chatProposalCount", rows.length, rows.length)}
        </span>
      </header>

      {/* ★★ THE CHECKED STATE IS "EVERY ROW", cascaded ones included — see the
          note on `totalCount`. While a create is refused its dependent shows as
          cascaded and unticked, so the box reads unchecked; ticking it selects
          the whole plan, which resolves the cascade rather than fighting it.
          ★ An empty card disables it: with no rows, both directions are no-ops. */}
      {onToggleAll && (
        <div className="border-b border-line px-3 pb-2">
          {/* Same wrapper shape as a row: the first labelable descendant IS the
              checkbox, and its own aria-label wins the accessible name while
              the visible text is contained in it (2.5.3). */}
          <label className="flex cursor-pointer items-center gap-2">
            <Checkbox
              checked={totalCount > 0 && selectedCount === totalCount}
              disabled={busy || totalCount === 0}
              onChange={(e) => onToggleAll(e.target.checked)}
              aria-label={t(lang, "chatProposalSelectAll")}
            />
            <span className="text-xs font-medium text-foreground">
              {t(lang, "chatProposalSelectAll")}
            </span>
          </label>
        </div>
      )}

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

      {/* ★★ `role="status"` so the outcome is ANNOUNCED, not merely drawn: the
          Apply that produced it is a click, so a sighted user sees the card
          change while a screen-reader user would otherwise get nothing at all —
          the button simply stops being pressable.
          ★ Rendered whenever an Apply has run, INCLUDING a zero. "0 applied"
          beside the failure rows is the honest reading of a batch that was
          entirely refused; suppressing it would restore the silence this closes. */}
      {applied !== null && (
        <div className="border-t border-line px-3 py-2" role="status">
          <p className="text-xs font-medium text-ui-green-strong">
            {t(lang, "chatProposalApplied", applied)}
          </p>
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
