// Structured Help content backbone — consumed by BOTH Help surfaces, each of
// which renders every group through the shared `help-content-pane.tsx`: the
// in-pane view (`help-view.tsx`) and the floating top-bar panel
// (`help-menu.tsx`).
// ★★ The panel is NOT features-only. It was, via a derived `HELP_SECTIONS`
// slice, and that export outlived its last caller by long enough for this
// comment and `docs/AGENTS/ui-shell.md` to send a later reader planning work
// that was already built. Both were corrected and the export deleted; do not
// reintroduce a group filter here without a caller.
// Each entry is a title + body i18n key pair (EN/DE in i18n*.ts), tagged by
// group, with optional relations (related views + related concept entries) that
// later help surfaces (per-view callouts, the relations map) also read.

import type { TranslationKey } from "./i18n";
import type { AppView } from "./nav-config";

export type HelpGroup = "concepts" | "workflows" | "features" | "automated";

export interface HelpEntry {
  id: string;
  group: HelpGroup;
  titleKey: TranslationKey;
  bodyKey: TranslationKey;
  /** Plain-language framing shown ABOVE the body, at the Guided reading level
   *  only. Concepts group only (a test pins that both ways).
   *  ★ Primers are deliberately CONCEPTUAL — they name no control, path or
   *  setting. Every claim about behaviour is a claim that can rot, and slice 1
   *  spent its entire budget correcting help prose that had; a primer that
   *  explains an idea rather than an interaction has nothing to fall out of
   *  step with. Keep it that way when adding one. */
  primerKey?: TranslationKey;
  relatedViews?: readonly AppView[];
  relatedConcepts?: readonly string[];
}

/** Render order of the groups (TOC + content). */
export const HELP_GROUP_ORDER: readonly HelpGroup[] = ["concepts", "workflows", "features", "automated"];

/** i18n label key per group (group headers in the Help view). */
export const HELP_GROUP_LABEL: Record<HelpGroup, TranslationKey> = {
  concepts: "helpGroupConcepts",
  workflows: "helpGroupWorkflows",
  features: "helpGroupFeatures",
  automated: "helpGroupAutomated",
};

/** The entry literal, deliberately NOT exported and deliberately NOT annotated.
 *
 *  ★★ THE SPLIT INTO TWO BINDINGS IS LOAD-BEARING IN BOTH DIRECTIONS, and
 *  collapsing it either way breaks something. An explicit `: readonly
 *  HelpEntry[]` HERE widens `id` back to `string` even with `as const` below —
 *  `HelpEntryId` then compiles, exports, and catches nothing. But exporting
 *  THIS binding as `HELP_ENTRIES` does not work either: `as const` makes it a
 *  66-member heterogeneous tuple, and the three OPTIONAL fields (`primerKey`,
 *  `relatedViews`, `relatedConcepts`) then do not exist on every member, so
 *  every consumer that reads one fails to typecheck (measured: 18 errors
 *  across 4 files). So the literal keeps the precise type for the union to be
 *  derived from, and `HELP_ENTRIES` below re-exports it at the WIDE type its
 *  consumers have always seen. */
const HELP_ENTRIES_LITERAL = [
  // ── Concepts (what / why / in this app) ──
  { id: "concept-milestone", group: "concepts", titleKey: "helpConceptMilestoneTitle", bodyKey: "helpConceptMilestoneBody", primerKey: "helpConceptMilestonePrimer", relatedViews: ["milestones", "gantt"], relatedConcepts: ["concept-dependency", "concept-baseline"] },
  { id: "concept-raid", group: "concepts", titleKey: "helpConceptRaidTitle", bodyKey: "helpConceptRaidBody", primerKey: "helpConceptRaidPrimer", relatedViews: ["raid"], relatedConcepts: ["concept-change", "concept-stakeholder"] },
  { id: "concept-change", group: "concepts", titleKey: "helpConceptChangeTitle", bodyKey: "helpConceptChangeBody", primerKey: "helpConceptChangePrimer", relatedViews: ["changes"], relatedConcepts: ["concept-raid", "concept-budget"] },
  // ★★ `stakeholder-map` belongs here because the BODY describes the 2×2 grid,
  // which lives in that view and not in `stakeholders` (a table). Adding the
  // view is what forced the body's correction: it had claimed an "interest ×
  // power" matrix in the Stakeholders view, and both halves were false.
  { id: "concept-stakeholder", group: "concepts", titleKey: "helpConceptStakeholderTitle", bodyKey: "helpConceptStakeholderBody", primerKey: "helpConceptStakeholderPrimer", relatedViews: ["stakeholders", "raci", "stakeholder-map"], relatedConcepts: ["concept-raci", "concept-steering"] },
  { id: "concept-raci", group: "concepts", titleKey: "helpConceptRaciTitle", bodyKey: "helpConceptRaciBody", primerKey: "helpConceptRaciPrimer", relatedViews: ["raci", "stakeholders"], relatedConcepts: ["concept-stakeholder"] },
  { id: "concept-budget", group: "concepts", titleKey: "helpConceptBudgetTitle", bodyKey: "helpConceptBudgetBody", primerKey: "helpConceptBudgetPrimer", relatedViews: ["budget", "budget-report"], relatedConcepts: ["concept-resource"] },
  { id: "concept-resource", group: "concepts", titleKey: "helpConceptResourceTitle", bodyKey: "helpConceptResourceBody", primerKey: "helpConceptResourcePrimer", relatedViews: ["resources", "workload", "planning"], relatedConcepts: ["concept-budget"] },
  { id: "concept-steering", group: "concepts", titleKey: "helpConceptSteeringTitle", bodyKey: "helpConceptSteeringBody", primerKey: "helpConceptSteeringPrimer", relatedViews: ["steering-committee"], relatedConcepts: ["concept-stakeholder"] },
  { id: "concept-task-status", group: "concepts", titleKey: "helpConceptTaskStatusTitle", bodyKey: "helpConceptTaskStatusBody", primerKey: "helpConceptTaskStatusPrimer", relatedViews: ["open-points"], relatedConcepts: ["concept-milestone"] },
  { id: "concept-baseline", group: "concepts", titleKey: "helpConceptBaselineTitle", bodyKey: "helpConceptBaselineBody", primerKey: "helpConceptBaselinePrimer", relatedViews: ["trends"], relatedConcepts: ["concept-milestone", "concept-budget"] },
  { id: "concept-dependency", group: "concepts", titleKey: "helpConceptDependencyTitle", bodyKey: "helpConceptDependencyBody", primerKey: "helpConceptDependencyPrimer", relatedViews: ["gantt", "open-points"], relatedConcepts: ["concept-milestone"] },
  { id: "concept-knowledge", group: "concepts", titleKey: "helpConceptKnowledgeTitle", bodyKey: "helpConceptKnowledgeBody", primerKey: "helpConceptKnowledgePrimer", relatedViews: ["knowledge"], relatedConcepts: ["concept-stakeholder"] },

  // ── Workflows (numbered guides) ──
  { id: "workflow-end-to-end", group: "workflows", titleKey: "helpWorkflowEndToEndTitle", bodyKey: "helpWorkflowEndToEndBody", relatedViews: ["dashboard", "open-points", "milestones"], relatedConcepts: ["concept-milestone", "concept-task-status"] },
  { id: "workflow-plan", group: "workflows", titleKey: "helpWorkflowPlanTitle", bodyKey: "helpWorkflowPlanBody", relatedViews: ["milestones", "gantt"], relatedConcepts: ["concept-milestone", "concept-dependency"] },
  { id: "workflow-risk", group: "workflows", titleKey: "helpWorkflowRiskTitle", bodyKey: "helpWorkflowRiskBody", relatedViews: ["raid"], relatedConcepts: ["concept-raid"] },
  { id: "workflow-scope", group: "workflows", titleKey: "helpWorkflowScopeTitle", bodyKey: "helpWorkflowScopeBody", relatedViews: ["changes"], relatedConcepts: ["concept-change"] },
  { id: "workflow-budget", group: "workflows", titleKey: "helpWorkflowBudgetTitle", bodyKey: "helpWorkflowBudgetBody", relatedViews: ["budget", "trends"], relatedConcepts: ["concept-budget", "concept-baseline"] },
  { id: "workflow-stakeholders", group: "workflows", titleKey: "helpWorkflowStakeholdersTitle", bodyKey: "helpWorkflowStakeholdersBody", relatedViews: ["stakeholders", "raci", "steering-committee"], relatedConcepts: ["concept-stakeholder", "concept-raci"] },

  // ── Features (migrated from help-sections.ts) ──
  { id: "feature-rate-card", group: "features", titleKey: "helpSecRateCardTitle", bodyKey: "helpSecRateCardBody", relatedViews: ["resources", "planning"], relatedConcepts: ["concept-resource", "concept-budget"] },
  { id: "feature-usage-limits", group: "features", titleKey: "helpSecUsageLimitsTitle", bodyKey: "helpSecUsageLimitsBody", relatedViews: ["settings", "chat"] },
  { id: "feature-layout", group: "features", titleKey: "helpSecLayoutTitle", bodyKey: "helpSecLayoutBody" },
  { id: "feature-add", group: "features", titleKey: "helpSecAddTitle", bodyKey: "helpSecAddBody" },
  { id: "feature-field-visibility", group: "features", titleKey: "helpSecFieldVisibilityTitle", bodyKey: "helpSecFieldVisibilityBody" },
  { id: "feature-templates", group: "features", titleKey: "helpSecTemplatesTitle", bodyKey: "helpSecTemplatesBody" },
  { id: "feature-per-project-functions", group: "features", titleKey: "helpSecPerProjectFunctionsTitle", bodyKey: "helpSecPerProjectFunctionsBody" },
  { id: "feature-template-suggest", group: "features", titleKey: "helpSecTemplateSuggestTitle", bodyKey: "helpSecTemplateSuggestBody" },
  { id: "feature-workspace", group: "features", titleKey: "helpSecWorkspaceTitle", bodyKey: "helpSecWorkspaceBody" },
  { id: "feature-tabs", group: "features", titleKey: "helpSecTabsTitle", bodyKey: "helpSecTabsBody" },
  { id: "feature-tasks", group: "features", titleKey: "helpSecTasksTitle", bodyKey: "helpSecTasksBody" },
  { id: "feature-task-status", group: "features", titleKey: "helpSecTaskStatusTitle", bodyKey: "helpSecTaskStatusBody" },
  { id: "feature-rich-text", group: "features", titleKey: "helpSecRichTextTitle", bodyKey: "helpSecRichTextBody", relatedViews: ["open-points", "raid", "changes", "milestones"] },
  { id: "feature-gantt", group: "features", titleKey: "helpSecGanttTitle", bodyKey: "helpSecGanttBody" },
  { id: "feature-raid", group: "features", titleKey: "helpSecRaidTitle", bodyKey: "helpSecRaidBody" },
  // ★★ All five sub-tabs, because the body names all five. These were not
  // missing CONTENT — they were missing wiring, and the ratchet cannot tell
  // the two apart: coverage is `relatedViews` membership, so a complete and
  // truthful entry that lists no view reads as a gap. Writing a second entry
  // per sub-tab would have duplicated prose that was already here.
  { id: "feature-resources", group: "features", titleKey: "helpSecResourcesTitle", bodyKey: "helpSecResourcesBody", relatedViews: ["resources", "directory", "workload", "calendar", "planning", "manage-roles"], relatedConcepts: ["concept-resource"] },
  { id: "feature-steering", group: "features", titleKey: "helpSecSteeringTitle", bodyKey: "helpSecSteeringBody" },
  { id: "feature-activity", group: "features", titleKey: "helpSecActivityTitle", bodyKey: "helpSecActivityBody", relatedViews: ["activity"] },
  { id: "feature-knowledge", group: "features", titleKey: "helpSecKnowledgeTitle", bodyKey: "helpSecKnowledgeBody" },
  // ★ `features`, not a group of its own, and NO primer: `HelpGroup` has four
  // members and `help-content.test.ts` pins primers to `concepts` both ways.
  // Every other view-coverage entry (feature-projects, feature-timelog,
  // feature-reports, feature-help) sits here too.
  { id: "feature-documents", group: "features", titleKey: "helpSecDocumentsTitle", bodyKey: "helpSecDocumentsBody", relatedViews: ["documents"], relatedConcepts: ["concept-knowledge"] },
  // ★★ A SECOND entry on the SAME `relatedViews`, deliberately — not a split of
  // the one above for length. `feature-version-history` already owns the phrase
  // "version history" for the Turso-gated WORKSPACE `history` view, so a user
  // searching "restore" needs a title that tells the two apart; folding document
  // versions into `helpSecDocumentsBody` would have left that collision with no
  // title to disambiguate it. Sharing a view is ordinary here (`open-points`
  // carries eight entries) and the coverage ratchet counts views, not entries.
  { id: "feature-document-history", group: "features", titleKey: "helpSecDocumentHistoryTitle", bodyKey: "helpSecDocumentHistoryBody", relatedViews: ["documents"] },
  { id: "feature-voice", group: "features", titleKey: "helpSecVoiceTitle", bodyKey: "helpSecVoiceBody" },
  { id: "feature-notif", group: "features", titleKey: "helpSecNotifTitle", bodyKey: "helpSecNotifBody" },
  { id: "feature-timezones", group: "features", titleKey: "helpSecTimezonesTitle", bodyKey: "helpSecTimezonesBody" },
  { id: "feature-jira", group: "features", titleKey: "helpSecJiraTitle", bodyKey: "helpSecJiraBody" },
  { id: "feature-storage", group: "features", titleKey: "helpSecStorageTitle", bodyKey: "helpSecStorageBody" },
  { id: "feature-setup-wizard", group: "features", titleKey: "helpSecSetupWizardTitle", bodyKey: "helpSecSetupWizardBody" },
  { id: "feature-version-history", group: "features", titleKey: "helpSecVersionHistoryTitle", bodyKey: "helpSecVersionHistoryBody", relatedViews: ["history"], relatedConcepts: ["concept-baseline"] },
  { id: "feature-ai", group: "features", titleKey: "helpSecAiTitle", bodyKey: "helpSecAiBody" },
  { id: "feature-ai-advanced", group: "features", titleKey: "helpSecAiAdvancedTitle", bodyKey: "helpSecAiAdvancedBody" },
  { id: "feature-input-feedback", group: "features", titleKey: "helpSecInputFeedbackTitle", bodyKey: "helpSecInputFeedbackBody" },
  { id: "feature-tour", group: "features", titleKey: "helpSecTourTitle", bodyKey: "helpSecTourBody" },
  { id: "feature-keys", group: "features", titleKey: "helpSecKeysTitle", bodyKey: "helpSecKeysBody" },

  // ── Views that had no entry at all (slice 3) ──
  // ★ TWO of these name a view a reader may not be able to reach:
  // `portfolio-health` (in `TURSO_ONLY_VIEWS`) and `timelog` (a per-project
  // module). `reports` and `help` are in `CORE_VIEWS`, and `projects` belongs
  // to no module and no Turso gate, so `isViewEnabled` returns true for it
  // unconditionally — none of those three can be pruned. Precedent allows
  // covering a gateable view: `trends` is Turso-only and has been covered
  // since slice 1. ★ Both bodies now state their condition — Turso for
  // portfolio health, the per-project module for Time bookings.
  { id: "feature-projects", group: "features", titleKey: "helpSecProjectsTitle", bodyKey: "helpSecProjectsBody", relatedViews: ["projects"] },
  { id: "feature-portfolio-health", group: "features", titleKey: "helpSecPortfolioHealthTitle", bodyKey: "helpSecPortfolioHealthBody", relatedViews: ["portfolio-health"], relatedConcepts: ["concept-baseline"] },
  { id: "feature-timelog", group: "features", titleKey: "helpSecTimelogTitle", bodyKey: "helpSecTimelogBody", relatedViews: ["timelog"], relatedConcepts: ["concept-budget", "concept-resource"] },
  // ★ ONE Reports entry, not three. `raid-report` and `change-report` are the
  // same feature applied to two registers; three near-identical bodies would
  // be three things to keep true for no reader benefit. `budget-report` is
  // already covered by `concept-budget` and set equality does not need it
  // here — it is listed so the Related line is complete rather than
  // arbitrarily truncated.
  { id: "feature-reports", group: "features", titleKey: "helpSecReportsTitle", bodyKey: "helpSecReportsBody", relatedViews: ["reports", "budget-report", "raid-report", "change-report"], relatedConcepts: ["concept-task-status", "concept-raid"] },
  // ★ Absorbs the reading level, so that setting is documented exactly once.
  { id: "feature-help", group: "features", titleKey: "helpSecHelpTitle", bodyKey: "helpSecHelpBody", relatedViews: ["help"] },

  // ── Features the ratchet structurally cannot see (slice 3) ──
  // ★★ Coverage is defined over VIEWS, so a feature that is not a view can
  // never appear in `KNOWN_UNCOVERED` however undocumented it is. These seven
  // had zero help prose and an empty baseline said nothing about them. Adding
  // one here is a judgement call, not a gate result — which is why the gate is
  // not the thing to consult when asking whether Help is complete.
  { id: "feature-saved-views", group: "features", titleKey: "helpSecSavedViewsTitle", bodyKey: "helpSecSavedViewsBody", relatedViews: ["open-points", "raid", "changes", "milestones", "stakeholders", "reports"] },
  // ★★ TITLED "Installing", NOT "offline" — and the body says so outright.
  // `sw.js` registers no `fetch` handler and caches nothing by design, so the
  // app is installable and NOT offline-capable. An entry promising offline use
  // would have been false on the most load-bearing word in it, and the
  // reasonable assumption (installable ⇒ works offline) is exactly why the
  // entry is worth having.
  { id: "feature-install", group: "features", titleKey: "helpSecInstallTitle", bodyKey: "helpSecInstallBody" },
  { id: "feature-undo", group: "features", titleKey: "helpSecUndoTitle", bodyKey: "helpSecUndoBody", relatedViews: ["open-points", "raid", "changes", "stakeholders", "resources"] },
  // ★★ `relatedViews` LISTS THE SURFACES, NOT THE `InlineEntity` MEMBERS, and
  // the two numbers are deliberately not quoted here — this comment carried a
  // "six members, five with a surface" tally that went stale the moment the
  // union grew (`absence` and `calendarEvent` are describable by the chat
  // review card and have no inline editor either, exactly as `resource` does
  // not). No gate reads a count in a `src/` comment, so the number would have
  // gone on rotting silently. Derive both instead:
  //   grep -n "^  | \"" src/app/inline-ai-edit/entity-descriptor.ts   # the union
  //   grep -n "useEntityInlineAiEdit(\"" src/app/workspace-section.tsx
  // ★★★ THE SECOND COMMAND IS DELIBERATELY PATH-SCOPED AND STILL DOES NOT
  // ENUMERATE THE SURFACES ON ITS OWN — measured, and the first draft of this
  // comment shipped the repo-wide form, which returns FOUR surfaces plus a
  // MATCH ON ITS OWN PROSE in `use-entity-inline-ai-edit.tsx`, i.e. it
  // over-counts and under-counts at once. TASKS are the fifth surface and take
  // a DIFFERENT entry point: `use-tasks-inline-ai-edit.tsx` → `useInlineAiEdit`
  // (`use-inline-ai-edit.ts`), a task-bound wrapper over the same generic hook,
  // so no grep for the generic one can ever see it. Count it by hand, or take
  // both wrappers' call sites together.
  // Note this list is NOT the four the rich-text bullet in AGENTS.md happens to
  // list; `stakeholder` is inline-editable too.
  { id: "feature-inline-ai-edit", group: "features", titleKey: "helpSecInlineAiEditTitle", bodyKey: "helpSecInlineAiEditBody", relatedViews: ["open-points", "raid", "changes", "milestones", "stakeholders"] },
  { id: "feature-digest", group: "features", titleKey: "helpSecDigestTitle", bodyKey: "helpSecDigestBody", relatedViews: ["dashboard"] },
  // ★ No `relatedViews` on these two: they apply to nearly every table and
  // view in the app. Listing a handful would imply the rest are exempt, and an
  // invented relation is a false claim like any other.
  { id: "feature-table-columns", group: "features", titleKey: "helpSecTableColumnsTitle", bodyKey: "helpSecTableColumnsBody" },
  { id: "feature-print", group: "features", titleKey: "helpSecPrintTitle", bodyKey: "helpSecPrintBody" },

  // ── What's automated ──
  { id: "automated-tracking", group: "automated", titleKey: "helpAutomatedTrackingTitle", bodyKey: "helpAutomatedTrackingBody", relatedViews: ["dashboard", "actions", "open-points"], relatedConcepts: ["concept-task-status"] },
  { id: "automated-health", group: "automated", titleKey: "helpAutomatedHealthTitle", bodyKey: "helpAutomatedHealthBody", relatedViews: ["dashboard", "budget", "trends"], relatedConcepts: ["concept-budget", "concept-baseline"] },
  // ★ "automated", not "features": nothing here is a control the reader
  // operates — the detection runs whether or not they visit the view.
  { id: "automated-insights", group: "automated", titleKey: "helpAutomatedInsightsTitle", bodyKey: "helpAutomatedInsightsBody", relatedViews: ["insights", "dashboard"], relatedConcepts: ["concept-milestone", "concept-budget", "concept-raid"] },
] as const satisfies readonly HelpEntry[];

/** Every id in `HELP_ENTRIES`, as a union.
 *
 *  ★ It derives from `HELP_ENTRIES_LITERAL`, never from `HELP_ENTRIES` — the
 *  latter is annotated, so deriving from it yields `string`: a union that
 *  compiles, exports, and catches nothing. See that binding's comment.
 *
 *  ★★ IT CATCHES A MISTYPED ID, NEVER A WELL-SPELLED WRONG ONE. Pointing a
 *  surface at an entry that exists but describes something else typechecks
 *  perfectly. Any table mapping a surface to an id is reviewed as CONTENT, and
 *  a green tsc says nothing about whether that mapping is right. */
export type HelpEntryId = (typeof HELP_ENTRIES_LITERAL)[number]["id"];

/** The consumer-facing binding, at the WIDE element type every reader already
 *  expected. Widening here is what keeps this a one-file change. */
export const HELP_ENTRIES: readonly HelpEntry[] = HELP_ENTRIES_LITERAL;

/** Which Help entry each modal's header help icon opens.
 *
 *  ★ A modal absent from this map renders NO icon — that is how confirmations
 *  and gates (confirm-dialog, type-to-confirm-dialog, secret-unlock-gate,
 *  project-empty-state) stay clean without an exclusion list.
 *
 *  ★★ THE VALUES ARE A JUDGEMENT CALL, NOT A TYPECHECK RESULT. `HelpEntryId`
 *  rejects a mistyped id; nothing rejects a well-spelled wrong one. Review a
 *  change here by reading the entry, not by running tsc.
 *
 *  ★ `help-content.test.ts` pins that every value resolves AND that the map
 *  still has 19 rows — the count is the anti-vacuity floor, so update it
 *  deliberately when adding a modal, never to make a red run green.
 *
 *  ★★ ONE KEY MAY SERVE SEVERAL CALL SITES, and `backendConfig` does.
 *  `BackendConfigModal` takes a REQUIRED `helpConceptId`, so its three
 *  consumers each pass a literal: two pass `backendConfig` (Storage) and the
 *  empty-state AI instance passes `aiSettings`, because that instance replaces
 *  the modal's whole body with `AiSection`. The wiring test therefore allows a
 *  key more than one site only through an explicit `MULTI_SITE_KEYS` list with
 *  its reason written beside it — and asserts every listed key really HAS more
 *  than one, so the allowlist cannot rot into covering a key that dropped back
 *  to one.
 *
 *  ★★ A modal with NO apt entry gets NO ROW, and that is the deliberate
 *  answer rather than the nearest-neighbour one. TWO modals have now been
 *  removed on that criterion, not one:
 *    • `taskTimeTracking` (the Jira-style estimate / spent / remaining
 *      dialog) pointed at `feature-timelog`, which describes the external
 *      Timelog INTEGRATION — a different subject that implies those figures
 *      sync somewhere they do not. No entry mentions estimates at all
 *      (reproduce: search every body for "estimate" / "time spent" /
 *      "remaining" — zero hits).
 *    • `calendarEvent` (the recurring MEETING SERIES editor) pointed at
 *      `feature-resources`, whose Calendar sentence enumerates that sub-tab
 *      as "tasks, absences, and holidays" — so the entry told the reader the
 *      surface holds three things that are not what they are editing.
 *      Measured 2026-09-09 over all 66 entries' titles + bodies: "series"
 *      matches ZERO of them.
 *  Do NOT reinstate either by picking the closest-sounding id; write a
 *  task-effort / meeting-series entry first. */
export const MODAL_HELP = {
  raidEdit: "concept-raid",
  changeEdit: "concept-change",
  milestoneEdit: "concept-milestone",
  stakeholderEdit: "concept-stakeholder",
  resourceEdit: "feature-resources",
  absenceEdit: "feature-resources",
  taskForm: "feature-add",
  taskLinkedTask: "concept-dependency",
  budgetBucket: "concept-budget",
  documentsHistory: "feature-document-history",
  documentsRename: "feature-documents",
  assetLibrary: "feature-documents",
  assetPreview: "feature-documents",
  jiraConflicts: "feature-jira",
  backendConfig: "feature-storage",
  aiSettings: "feature-ai",
  backendSetupWizard: "feature-setup-wizard",
  tursoProjectPicker: "feature-projects",
  projectEdit: "feature-projects",
} as const satisfies Record<string, HelpEntryId>;

/** How much teaching the Help surfaces do. Per-DEVICE (`Settings.helpReadingLevel`),
 *  deliberately not per-project — see the field's own comment in settings-types. */
export type HelpReadingLevel = "guided" | "standard" | "expert";

/** Expert reads Help as a reference, not a course: the feature entries and the
 *  "what's automated" pair come first, the teaching material last. */
const EXPERT_GROUP_ORDER: readonly HelpGroup[] = ["features", "automated", "workflows", "concepts"];

/** Group render order for a reading level. Guided and Standard share today's
 *  order — they differ only in whether concept primers render; Expert differs
 *  only in order.
 *  ★ Guided/Standard get `HELP_GROUP_ORDER` BY REFERENCE (the pane only reads
 *  it). A caller wanting a mutable array spreads it, same rule as
 *  `ALL_GANTT_STATUSES`. */
export function helpGroupOrder(level: HelpReadingLevel): readonly HelpGroup[] {
  return level === "expert" ? EXPERT_GROUP_ORDER : HELP_GROUP_ORDER;
}
