# Next Actions Visual Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign the "Next actions" panel into a focus-hero + kept-tiers layout with action-first compact rows, with zero change to the scoring engine, data, or persistence.

**Architecture:** A new pure i18n-free CTA picker (`next-actions/action-cta.ts`) decides each action's primary verb + overflow set and holds the tier→RAG-token map. A new `action-hero-card.tsx` renders the top group prominently; `action-row.tsx` is refactored to consume the picker (drop icon/pill, source→why-prefix, score→expert-only, promote the real verb to a filled primary). `actions-panel.tsx` selects the hero (`groups[0]` when its tier ≠ monitor), de-dupes it from the tiers, and adds tier-colour dots. A shared `action-reasons.tsx` holds the "+N reasons" expander used by both hero and row.

**Tech Stack:** Next.js (forked) + React + TypeScript, Tailwind v4 AIPM tokens, Vitest + Testing Library. Constraints: eslint `--max-warnings=0`; i18n EN/DE parity (tsc-enforced); palette/dual-CI gates (RAG via `--rag-*` tokens only; no gradients; shadows only via `--shadow-*` token; never a `*`/pipe inside a Tailwind arbitrary bracket).

**File structure:**
- Create `src/app/next-actions/action-cta.ts` — pure picker + caps + `TIER_RAG`.
- Create `src/app/next-actions/action-cta.test.ts` — pure unit tests.
- Create `src/app/action-reasons.tsx` — shared reasons expander.
- Create `src/app/action-hero-card.tsx` — hero card.
- Create `src/app/action-hero-card.test.tsx`.
- Modify `src/app/action-row.tsx` — consume picker; new layout; `expertMode` prop.
- Modify `src/app/action-row.test.tsx` — update broken assertions.
- Modify `src/app/actions-panel.tsx` — hero select + de-dupe + tier dots + thread `expertMode`.
- Modify `src/app/actions-panel.test.tsx` — update 2 tests + add hero tests.
- Modify `src/app/i18n.ts`, `src/app/i18n.de.ts` — `actionHeroEyebrow`.
- (Release-time only, not in TDD tasks) `version.ts` / `CHANGELOG.md` / `APP_HIGHLIGHT_KEYS`.

---

## Task 1: Pure CTA picker + tier-token map

**Files:**
- Create: `src/app/next-actions/action-cta.ts`
- Test: `src/app/next-actions/action-cta.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/app/next-actions/action-cta.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { pickPrimaryCta, overflowCtas, type ActionCaps } from "./action-cta";
import type { SuggestedAction } from "./types";

const ALL: ActionCaps = {
  assign: true, draft: true, escalate: true, rebaseline: true, snapshotActive: true,
  reschedule: true, markDone: true, clearBlocker: true, snooze: true, createTask: true,
};
const NONE: ActionCaps = {
  assign: false, draft: false, escalate: false, rebaseline: false, snapshotActive: false,
  reschedule: false, markDone: false, clearBlocker: false, snooze: false, createTask: false,
};
function a(source: string, whyKey: string, view = "open-points"): SuggestedAction {
  return {
    id: `${source}:1:x`, source,
    title: { key: "actionRaidTitle", params: [1, "X"] },
    why: { key: whyKey },
    score: 10, tier: "now", cta: { kind: "open", view, id: 1 },
  } as never;
}

describe("pickPrimaryCta", () => {
  it("assign wins for a no-owner raid", () => {
    expect(pickPrimaryCta(a("raid", "actionRaidWhyNoOwner", "raid"), ALL)).toBe("assign");
  });
  it("assign wins for an unassigned task-attention", () => {
    expect(pickPrimaryCta(a("task-attention", "actionTaskWhyUnassigned"), ALL)).toBe("assign");
  });
  it("clearBlocker for a blocked task-attention", () => {
    expect(pickPrimaryCta(a("task-attention", "actionTaskWhyBlocked"), ALL)).toBe("clearBlocker");
  });
  it("reschedule for an overdue task-due (beats markDone)", () => {
    expect(pickPrimaryCta(a("task-due", "actionTaskWhyOverdue"), ALL)).toBe("reschedule");
  });
  it("rebaseline for an at-risk milestone", () => {
    expect(pickPrimaryCta(a("milestone", "actionMilestoneWhyAtRisk", "milestones"), ALL)).toBe("rebaseline");
  });
  it("rebaseline for a slipping schedule only when snapshotActive", () => {
    expect(pickPrimaryCta(a("schedule", "actionScheduleWhySlipping", "trends"), ALL)).toBe("rebaseline");
    expect(pickPrimaryCta(a("schedule", "actionScheduleWhySlipping", "trends"), { ...ALL, snapshotActive: false })).toBe("open");
  });
  it("escalate for a severity raid", () => {
    expect(pickPrimaryCta(a("raid", "actionRaidWhySeverity", "raid"), ALL)).toBe("escalate");
  });
  it("draft for a task-due when no reschedule bundle (beats markDone)", () => {
    expect(pickPrimaryCta(a("task-due", "actionTaskWhyOverdue"), { ...ALL, reschedule: false })).toBe("draft");
  });
  it("markDone when only markDone applies", () => {
    expect(pickPrimaryCta(a("change-pending", "actionChangeWhyPending"), { ...NONE, markDone: true })).toBe("markDone");
  });
  it("falls back to open with no caps", () => {
    expect(pickPrimaryCta(a("raid", "actionRaidWhySeverity", "raid"), NONE)).toBe("open");
  });
});

describe("overflowCtas", () => {
  it("excludes the promoted primary and lists menu order", () => {
    // task-due overdue, all caps: primary=reschedule; markDone+createTask gated, snooze present.
    // createTask is hidden for task-due; draft is applicable but task-due+draft → draft NOT primary (reschedule is) so it appears.
    const o = overflowCtas(a("task-due", "actionTaskWhyOverdue"), ALL);
    expect(o).toEqual(["markDone", "draft", "snooze"]);
  });
  it("snooze only when wired", () => {
    expect(overflowCtas(a("raid", "actionRaidWhySeverity", "raid"), { ...NONE, snooze: true })).toEqual(["snooze"]);
    expect(overflowCtas(a("raid", "actionRaidWhySeverity", "raid"), NONE)).toEqual([]);
  });
  it("createTask hidden for task-due, shown otherwise", () => {
    expect(overflowCtas(a("raid", "actionRaidWhySeverity", "raid"), { ...NONE, createTask: true })).toEqual(["createTask"]);
    expect(overflowCtas(a("task-due", "actionTaskWhyOverdue"), { ...NONE, createTask: true })).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/app/next-actions/action-cta.test.ts`
Expected: FAIL — "Cannot find module './action-cta'".

- [ ] **Step 3: Write the implementation**

Create `src/app/next-actions/action-cta.ts`:

```ts
// src/app/next-actions/action-cta.ts
//
// Pure, i18n-free decision layer over a SuggestedAction: which single verb is the
// row's primary call-to-action, and which secondaries fall into the ⋮ overflow.
// Shared by action-row.tsx (compact row) and action-hero-card.tsx (hero). Also the
// single home of the tier -> RAG-token class map so hero/row/panel stay in lockstep
// and all switch under the Mockup/Custom styles.
import type { SuggestedAction, ActionTier } from "./types";

export type PrimaryCtaKind =
  | "assign" | "clearBlocker" | "reschedule" | "rebaseline"
  | "escalate" | "draft" | "markDone" | "open";

export type SecondaryCtaKind = "markDone" | "clearBlocker" | "draft" | "createTask" | "snooze";

/** Which optional handler bundles/flags are wired in for this surface — presence
 *  === capability. Assembled from the props ActionRow/ActionHeroCard already hold. */
export interface ActionCaps {
  assign: boolean;        // assignOwner bundle present
  draft: boolean;         // onDraftMessage present
  escalate: boolean;      // escalate bundle present
  rebaseline: boolean;    // rebaseline bundle present
  snapshotActive: boolean;// rebaseline bundle present AND bundle.snapshotActive
  reschedule: boolean;    // reschedule bundle present
  markDone: boolean;      // onMarkDone present
  clearBlocker: boolean;  // onClearBlocker present
  snooze: boolean;        // onSnooze present
  createTask: boolean;    // onCreateTask present
}

const isOpen = (a: SuggestedAction): boolean => a.cta.kind === "open";
const onPoints = (a: SuggestedAction): boolean => a.cta.kind === "open" && a.cta.view === "open-points";

// Applicability predicates — copied verbatim from action-row.tsx's can* booleans so
// there is ONE definition. ActionRow now consumes these instead of re-deriving.
export function canAssign(a: SuggestedAction, c: ActionCaps): boolean {
  return c.assign && isOpen(a) &&
    ((a.source === "raid" && a.why.key === "actionRaidWhyNoOwner") ||
     (a.source === "task-attention" && a.why.key === "actionTaskWhyUnassigned"));
}
export function canClearBlocker(a: SuggestedAction, c: ActionCaps): boolean {
  return c.clearBlocker && onPoints(a) && a.source === "task-attention" && a.why.key === "actionTaskWhyBlocked";
}
export function canReschedule(a: SuggestedAction, c: ActionCaps): boolean {
  return c.reschedule && a.source === "task-due" && isOpen(a);
}
export function canRebaseline(a: SuggestedAction, c: ActionCaps): boolean {
  const milestone = c.rebaseline && a.source === "milestone" && isOpen(a) &&
    (a.why.key === "actionMilestoneWhyAtRisk" || a.why.key === "actionMilestoneWhyOverdue");
  const snapshot = c.rebaseline && c.snapshotActive && isOpen(a) &&
    ((a.source === "schedule" && a.why.key === "actionScheduleWhySlipping") ||
     (a.source === "budget" && a.why.key === "actionBudgetWhyWorsening"));
  return milestone || snapshot;
}
export function canEscalate(a: SuggestedAction, c: ActionCaps): boolean {
  return c.escalate && a.source === "raid" && a.why.key === "actionRaidWhySeverity" && isOpen(a);
}
export function canDraft(a: SuggestedAction, c: ActionCaps): boolean {
  return c.draft && (a.source === "task-due" || a.source === "stakeholder-comms") && isOpen(a);
}
export function canMarkDone(a: SuggestedAction, c: ActionCaps): boolean {
  return c.markDone && onPoints(a);
}
export function canCreateTask(a: SuggestedAction, c: ActionCaps): boolean {
  return c.createTask && a.source !== "task-due";
}

/** Highest-priority applicable verb; "open" is the always-available fallback. */
export function pickPrimaryCta(a: SuggestedAction, c: ActionCaps): PrimaryCtaKind {
  if (canAssign(a, c)) return "assign";
  if (canClearBlocker(a, c)) return "clearBlocker";
  if (canReschedule(a, c)) return "reschedule";
  if (canRebaseline(a, c)) return "rebaseline";
  if (canEscalate(a, c)) return "escalate";
  if (canDraft(a, c)) return "draft";
  if (canMarkDone(a, c)) return "markDone";
  return "open";
}

/** Menu-able secondaries (NOT the inline popover verbs), in menu order, minus the
 *  one promoted to primary. "snooze" signals the 1h/1d items; the component renders both. */
export function overflowCtas(a: SuggestedAction, c: ActionCaps): SecondaryCtaKind[] {
  const primary = pickPrimaryCta(a, c);
  const out: SecondaryCtaKind[] = [];
  if (canMarkDone(a, c) && primary !== "markDone") out.push("markDone");
  if (canClearBlocker(a, c) && primary !== "clearBlocker") out.push("clearBlocker");
  if (canDraft(a, c) && primary !== "draft") out.push("draft");
  if (canCreateTask(a, c)) out.push("createTask");
  if (c.snooze) out.push("snooze");
  return out;
}

// Tier -> RAG token classes. Concrete `var(--rag-NAME)` strings only — NEVER a single
// arbitrary-value bracket with a pipe/wildcard (Tailwind v4 scans all files; an invalid
// bracket char compiles to broken CSS and 500s globals.css).
export const TIER_RAG: Record<ActionTier, { stripe: string; dot: string; text: string }> = {
  now: { stripe: "border-l-[var(--rag-red)]", dot: "bg-[var(--rag-red)]", text: "text-[var(--rag-red-text)]" },
  soon: { stripe: "border-l-[var(--rag-amber)]", dot: "bg-[var(--rag-amber)]", text: "text-[var(--rag-amber-text)]" },
  monitor: { stripe: "border-l-[var(--rag-green)]", dot: "bg-[var(--rag-green)]", text: "text-[var(--rag-green-text)]" },
};
```

> NOTE for the implementer: confirm the exact `why.key` literals used by each provider
> (`actionChangeWhyPending`, `actionScheduleWhySlipping`, etc.) by grepping
> `src/app/next-actions/providers/`. They are the SAME strings already branched on in
> the current `action-row.tsx`; the test fixtures above use the names from
> `action-row.test.tsx`. If `change-pending` has no markDone path in practice the
> markDone unit test can use any non-task-due open-points source — adjust the fixture,
> not the priority logic.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/app/next-actions/action-cta.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: Typecheck + lint**

Run: `npx tsc --noEmit` → clean. `npm run lint` → clean.

- [ ] **Step 6: Commit**

```bash
git add src/app/next-actions/action-cta.ts src/app/next-actions/action-cta.test.ts
git commit -m "feat(actions): pure primary/overflow CTA picker + tier-token map"
```

---

## Task 2: Shared reasons expander + hero card

**Files:**
- Create: `src/app/action-reasons.tsx`
- Create: `src/app/action-hero-card.tsx`
- Test: `src/app/action-hero-card.test.tsx`

- [ ] **Step 1: Extract the shared reasons expander**

Create `src/app/action-reasons.tsx` (lifted verbatim from `action-row.tsx`'s extra-reasons block so hero and row share one implementation; the container stays always-mounted + `hidden`-toggled so the `aria-controls` target persists):

```tsx
// src/app/action-reasons.tsx
"use client";
import { useState } from "react";
import { type Lang, t } from "./i18n";
import type { SuggestedAction } from "./next-actions/types";
import { FOCUS_RING, TRANSITION } from "./interaction-styles";

interface ActionReasonsProps {
  lang: Lang;
  /** The primary action — its id keys the aria-controls target. */
  action: SuggestedAction;
  extraReasons?: readonly SuggestedAction[];
}

/** "+N more reasons" disclosure shared by the compact row and the hero card. The
 *  reasons list is ALWAYS mounted and `hidden`-toggled (aria-controls target must
 *  stay in DOM). Renders nothing when there are no extra reasons. */
export function ActionReasons({ lang, action, extraReasons }: ActionReasonsProps) {
  const [open, setOpen] = useState(false);
  if (!extraReasons || extraReasons.length === 0) return null;
  const title = t(lang, action.title.key, ...(action.title.params ?? []));
  return (
    <>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={`action-reasons-${action.id}`}
        aria-label={`${t(lang, "actionMoreReasons", extraReasons.length)} – ${title}`}
        onClick={(e) => { e.stopPropagation(); setOpen((o) => !o); }}
        className={`mt-0.5 flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground ${FOCUS_RING} ${TRANSITION}`}
      >
        <span aria-hidden>{open ? "▾" : "▸"}</span>
        {t(lang, "actionMoreReasons", extraReasons.length)}
      </button>
      <span id={`action-reasons-${action.id}`} hidden={!open} className="mt-0.5 block">
        {extraReasons.map((ex) => (
          <span key={ex.id} className="block truncate text-xs text-muted-foreground">
            {t(lang, ex.why.key, ...(ex.why.params ?? []))}
          </span>
        ))}
      </span>
    </>
  );
}
```

- [ ] **Step 2: Write the failing hero test**

Create `src/app/action-hero-card.test.tsx`:

```tsx
import { describe, expect, it, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ActionHeroCard } from "./action-hero-card";
import type { ActionGroup } from "./next-actions/group";
import type { SuggestedAction } from "./next-actions/types";

const noOwner: SuggestedAction = {
  id: "raid:12:noowner", source: "raid", moduleId: "raid",
  title: { key: "actionRaidTitle", params: [12, "Vendor API delay"] },
  why: { key: "actionRaidWhyNoOwner", params: ["High"] },
  score: 80, tier: "now", cta: { kind: "open", view: "raid", id: 12 },
} as never;
const group = (primary: SuggestedAction, extra: SuggestedAction[] = []): ActionGroup =>
  ({ key: "raid:12", primary, extra, score: primary.score, tier: primary.tier });

describe("ActionHeroCard", () => {
  it("renders the eyebrow, untruncated title + why, and an Open button", () => {
    render(<ActionHeroCard lang="en-US" group={group(noOwner)} onOpen={() => {}} />);
    expect(screen.getByText(/Do this first/i)).toBeInTheDocument();
    expect(screen.getByText(/Vendor API delay/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open" })).toBeInTheDocument();
  });
  it("promotes the assign verb when the bundle is wired", () => {
    render(
      <ActionHeroCard lang="en-US" group={group(noOwner)} onOpen={() => {}}
        assignOwner={{ resources: [], onCreateResource: () => 1, onAssign: vi.fn() }} />,
    );
    expect(screen.getByRole("button", { name: /assign owner/i })).toBeInTheDocument();
  });
  it("renders extra reasons when present", () => {
    const extra = [{ ...noOwner, id: "raid:12:severity", why: { key: "actionRaidWhySeverity", params: ["High"] } }] as never;
    render(<ActionHeroCard lang="en-US" group={group(noOwner, extra)} onOpen={() => {}} />);
    const toggle = screen.getByRole("button", { name: /1 more reasons/i });
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
  });
  it("carries the tier RAG stripe (now → red) and a labelled section", () => {
    const { container } = render(<ActionHeroCard lang="en-US" group={group(noOwner)} onOpen={() => {}} />);
    expect(container.querySelector(".border-l-\\[var\\(--rag-red\\)\\]")).toBeTruthy();
    expect(screen.getByRole("region", { name: /Do this first/i })).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `npx vitest run src/app/action-hero-card.test.tsx`
Expected: FAIL — "Cannot find module './action-hero-card'".

- [ ] **Step 4: Write the hero card**

Create `src/app/action-hero-card.tsx`. It reuses the existing popover components for the popover verbs and shares the CTA picker. The primary direct verbs (clearBlocker/markDone/draft/open) render as a filled `bg-AIPM-dark-blue` button; popover verbs render their existing trigger (already an obvious affordance). Secondary verbs go into a ⋮ menu identical in spirit to the row's.

```tsx
// src/app/action-hero-card.tsx
"use client";
import { type Lang, t } from "./i18n";
import type { ActionGroup } from "./next-actions/group";
import type { SuggestedAction } from "./next-actions/types";
import { ActionReasons } from "./action-reasons";
import { ActionPrimaryCta, ActionOverflowMenu, useActionCaps, type ActionHandlers } from "./action-cta-controls";
import { TIER_RAG } from "./next-actions/action-cta";
import { InfoTooltip } from "./info-tooltip";

interface ActionHeroCardProps extends ActionHandlers {
  lang: Lang;
  group: ActionGroup;
  expertMode?: boolean;
}

export function ActionHeroCard(props: ActionHeroCardProps) {
  const { lang, group, expertMode } = props;
  const action = group.primary;
  const caps = useActionCaps(props);
  const rag = TIER_RAG[group.tier];
  const title = t(lang, action.title.key, ...(action.title.params ?? []));
  const why = t(lang, action.why.key, ...(action.why.params ?? []));
  return (
    <section
      aria-label={t(lang, "actionHeroEyebrow")}
      className={`mb-4 rounded-lg border border-line border-l-4 ${rag.stripe} bg-surface p-4 shadow-[var(--shadow-card)]`}
    >
      <div className={`flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide ${rag.text}`}>
        <span aria-hidden>⚑</span>
        {t(lang, "actionHeroEyebrow")}
        {expertMode && (
          <span className="ml-1 font-normal normal-case tracking-normal">
            <InfoTooltip text={t(lang, "actionScoreTooltip", action.score)} />
          </span>
        )}
      </div>
      <h3 className="mt-1 text-base font-semibold text-foreground">{title}</h3>
      <p className="mt-0.5 text-sm text-muted-foreground">{why}</p>
      <ActionReasons lang={lang} action={action} extraReasons={group.extra} />
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <ActionPrimaryCta lang={lang} action={action} caps={caps} handlers={props} prominent />
        <ActionOverflowMenu lang={lang} action={action} caps={caps} handlers={props} />
      </div>
    </section>
  );
}
```

This introduces a shared controls module so the hero and the row render the SAME
CTA controls. Create `src/app/action-cta-controls.tsx`:

```tsx
// src/app/action-cta-controls.tsx
"use client";
import { useState, useRef, useEffect, useCallback } from "react";
import { type Lang, t } from "./i18n";
import type { SuggestedAction } from "./next-actions/types";
import type { Resource } from "./types";
import { SNOOZE_1H, SNOOZE_1D } from "./reminder-snooze";
import { ResourcePicker } from "./resource-picker";
import { EscalatePopover, type EscalateBundle } from "./escalate-popover";
import { RebaselinePopover, type RebaselineBundle } from "./rebaseline-popover";
import { ReschedulePopover, type RescheduleBundle } from "./reschedule-popover";
import { usePopoverDismiss } from "./use-popover-dismiss";
import { FOCUS_RING, INTERACTIVE } from "./interaction-styles";
import { pickPrimaryCta, overflowCtas, type ActionCaps } from "./next-actions/action-cta";

export interface AssignOwnerBundle {
  resources: readonly Resource[];
  onCreateResource: (name: string, email: string) => number;
  onAssign: (action: SuggestedAction, value: { name: string; email: string; resourceId: number | null }) => void;
}

/** Every optional handler/bundle the surface may thread down. Shared by row + hero. */
export interface ActionHandlers {
  onOpen: (action: SuggestedAction) => void;
  onSnooze?: (action: SuggestedAction, durationMs: number) => void;
  onCreateTask?: (action: SuggestedAction) => void;
  assignOwner?: AssignOwnerBundle;
  onDraftMessage?: (action: SuggestedAction) => void;
  escalate?: EscalateBundle;
  rebaseline?: RebaselineBundle;
  reschedule?: RescheduleBundle;
  onMarkDone?: (action: SuggestedAction) => void;
  onClearBlocker?: (action: SuggestedAction) => void;
}

/** Derive the capability flags from which handlers/bundles are present. */
export function useActionCaps(h: ActionHandlers): ActionCaps {
  return {
    assign: h.assignOwner != null,
    draft: h.onDraftMessage != null,
    escalate: h.escalate != null,
    rebaseline: h.rebaseline != null,
    snapshotActive: h.rebaseline?.snapshotActive === true,
    reschedule: h.reschedule != null,
    markDone: h.onMarkDone != null,
    clearBlocker: h.onClearBlocker != null,
    snooze: h.onSnooze != null,
    createTask: h.onCreateTask != null,
  };
}

const GHOST =
  `cursor-pointer rounded-md border border-line px-2 py-1 text-xs font-medium text-AIPM-dark-blue hover:border-AIPM-dark-blue/40 hover:bg-AIPM-dark-blue/10 dark:text-AIPM-light-grey ${INTERACTIVE}`;
const FILLED =
  `cursor-pointer rounded-md border border-AIPM-dark-blue bg-AIPM-dark-blue px-3 py-1 text-xs font-medium text-white hover:opacity-90 ${INTERACTIVE}`;

interface CtaProps {
  lang: Lang;
  action: SuggestedAction;
  caps: ActionCaps;
  handlers: ActionHandlers;
  /** Hero = larger filled treatment for direct verbs. */
  prominent?: boolean;
}

/** Renders the single primary control (popover verbs reuse their existing popover;
 *  direct verbs render a button) PLUS a ghost Open when the primary isn't Open. */
export function ActionPrimaryCta({ lang, action, caps, handlers, prominent }: CtaProps) {
  const [assignOpen, setAssignOpen] = useState(false);
  const assignPopRef = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    if (assignOpen) assignPopRef.current?.querySelector<HTMLElement>("input,button,[tabindex]")?.focus();
  }, [assignOpen]);
  useEffect(() => {
    if (!assignOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setAssignOpen(false); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [assignOpen]);

  const kind = pickPrimaryCta(action, caps);
  const directBtn = prominent ? FILLED : `${FILLED} `; // both filled; prominent kept for future divergence
  const stop = (e: React.MouseEvent) => e.stopPropagation();

  const open = (
    <button type="button" onClick={(e) => { stop(e); handlers.onOpen(action); }}
      className={kind === "open" ? `${directBtn} px-3` : `${GHOST} px-3`}>
      {t(lang, "actionOpen")}
    </button>
  );

  let primary: React.ReactNode = open;
  if (kind === "assign" && handlers.assignOwner) {
    primary = (
      <span className="relative">
        <button type="button" aria-haspopup="dialog" aria-expanded={assignOpen}
          onClick={(e) => { stop(e); setAssignOpen((o) => !o); }} className={GHOST}>
          {t(lang, "actionAssignOwner")}
        </button>
        {assignOpen && (
          <span ref={assignPopRef} role="dialog" aria-label={t(lang, "actionAssignOwner")}
            onClick={stop} onKeyDown={(e) => { if (e.key === "Escape") setAssignOpen(false); }}
            className="absolute right-0 top-full z-20 mt-1 w-64 rounded-md border border-line bg-surface p-2">
            <ResourcePicker lang={lang} value={{ name: "", email: "", resourceId: null }}
              resources={handlers.assignOwner.resources} contacts={[]}
              onCreateResource={handlers.assignOwner.onCreateResource}
              onChange={(next) => { handlers.assignOwner!.onAssign(action, next); setAssignOpen(false); }} />
          </span>
        )}
      </span>
    );
  } else if (kind === "escalate" && handlers.escalate) {
    primary = <EscalatePopover lang={lang} action={action} bundle={handlers.escalate} />;
  } else if (kind === "rebaseline" && handlers.rebaseline) {
    primary = <RebaselinePopover lang={lang} action={action} bundle={handlers.rebaseline} />;
  } else if (kind === "reschedule" && handlers.reschedule) {
    primary = <ReschedulePopover lang={lang} action={action} bundle={handlers.reschedule} />;
  } else if (kind === "clearBlocker" && handlers.onClearBlocker) {
    primary = <button type="button" onClick={(e) => { stop(e); handlers.onClearBlocker!(action); }} className={directBtn}>{t(lang, "actionClearBlocker")}</button>;
  } else if (kind === "markDone" && handlers.onMarkDone) {
    primary = <button type="button" onClick={(e) => { stop(e); handlers.onMarkDone!(action); }} className={directBtn}>{t(lang, "actionMarkDone")}</button>;
  } else if (kind === "draft" && handlers.onDraftMessage) {
    primary = <button type="button" onClick={(e) => { stop(e); handlers.onDraftMessage!(action); }} className={directBtn}>{t(lang, "actionDraftMessage")}</button>;
  }

  return (
    <>
      {primary}
      {kind !== "open" && open /* ghost Open alongside a non-open primary */}
    </>
  );
}

/** The ⋮ overflow holding the menu-able secondaries minus the primary. */
export function ActionOverflowMenu({ lang, action, caps, handlers }: CtaProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const wrapRef = useRef<HTMLSpanElement>(null);
  const close = useCallback(() => setMenuOpen(false), []);
  usePopoverDismiss(menuOpen, wrapRef, close);
  const items = overflowCtas(action, caps);
  if (items.length === 0) return null;
  const title = t(lang, action.title.key, ...(action.title.params ?? []));
  const stop = (e: React.MouseEvent) => e.stopPropagation();
  const item = (label: string, onClick: () => void) => (
    <button key={label} type="button"
      onClick={(e) => { stop(e); setMenuOpen(false); onClick(); }}
      className="px-3 py-1 text-left text-xs text-foreground hover:bg-surface-muted">{label}</button>
  );
  return (
    <span ref={wrapRef} className="relative">
      <button type="button" aria-expanded={menuOpen}
        aria-label={`${t(lang, "actionMoreActions")} – ${title}`}
        onClick={(e) => { stop(e); setMenuOpen((o) => !o); }}
        className={`cursor-pointer rounded-md border border-line px-2 py-1 text-xs font-medium text-muted-foreground hover:border-AIPM-dark-blue/40 hover:bg-AIPM-dark-blue/10 ${FOCUS_RING}`}>
        ⋮
      </button>
      {menuOpen && (
        <span className="absolute right-0 top-full z-20 mt-1 flex w-max flex-col rounded-md border border-line bg-surface py-1">
          {items.map((k) => {
            if (k === "markDone" && handlers.onMarkDone) return item(t(lang, "actionMarkDone"), () => handlers.onMarkDone!(action));
            if (k === "clearBlocker" && handlers.onClearBlocker) return item(t(lang, "actionClearBlocker"), () => handlers.onClearBlocker!(action));
            if (k === "draft" && handlers.onDraftMessage) return item(t(lang, "actionDraftMessage"), () => handlers.onDraftMessage!(action));
            if (k === "createTask" && handlers.onCreateTask) return item(t(lang, "actionCreateTask"), () => handlers.onCreateTask!(action));
            if (k === "snooze" && handlers.onSnooze) return (
              <span key="snooze" className="contents">
                {item(t(lang, "actionSnooze1h"), () => handlers.onSnooze!(action, SNOOZE_1H))}
                {item(t(lang, "actionSnooze1d"), () => handlers.onSnooze!(action, SNOOZE_1D))}
              </span>
            );
            return null;
          })}
        </span>
      )}
    </span>
  );
}
```

> The `directBtn`/`prominent` split is intentionally a no-op divergence point now
> (both filled) so a later tweak can size the hero's button without touching the row.

- [ ] **Step 5: Run hero tests to verify they pass**

Run: `npx vitest run src/app/action-hero-card.test.tsx`
Expected: PASS.

- [ ] **Step 6: Typecheck + lint, then commit**

Run: `npx tsc --noEmit` and `npm run lint` → clean.

```bash
git add src/app/action-reasons.tsx src/app/action-cta-controls.tsx src/app/action-hero-card.tsx src/app/action-hero-card.test.tsx
git commit -m "feat(actions): hero card + shared CTA controls and reasons expander"
```

---

## Task 3: Refactor the compact row to action-first

**Files:**
- Modify: `src/app/action-row.tsx`
- Test: `src/app/action-row.test.tsx`

- [ ] **Step 1: Update the tests that the redesign intentionally breaks**

Edit `src/app/action-row.test.tsx`:

1. Replace the whole `describe("ActionRow source icon + score tooltip", …)` block (lines ~328-337) with:

```tsx
describe("ActionRow source label + expert score", () => {
  it("shows the source label inline and NO standalone icon", () => {
    const scored = { ...action, source: "raid" as const, score: 42 };
    render(<ActionRow lang="en-US" action={scored} onOpen={() => {}} />);
    expect(screen.getByText(/RAID/)).toBeInTheDocument();                 // source label in why-line
    expect(document.querySelector("[data-action-source-icon]")).toBeNull(); // icon removed
    expect(screen.queryByRole("button", { name: /Score: 42/ })).toBeNull(); // score hidden by default
  });
  it("shows the score tooltip only in expert mode", () => {
    const scored = { ...action, source: "raid" as const, score: 42 };
    render(<ActionRow lang="en-US" action={scored} onOpen={() => {}} expertMode />);
    expect(screen.getByRole("button", { name: /Score: 42/ })).toBeInTheDocument();
  });
});
```

2. In `describe("ActionRow reschedule / mark done / clear blocker", …)`, the "Clear blocker"
   assertion must move out of the menu (it is now the inline primary). Replace the second `it`
   (the "shows Assign … Clear blocker on a blocked one" test) with:

```tsx
  it("shows Assign inline on unassigned, Clear blocker inline on a blocked one", () => {
    const onClearBlocker = vi.fn();
    const unassigned = { id: "task-attention:1:unassigned", source: "task-attention",
      title: { key: "actionTaskTitle", params: ["T"] }, why: { key: "actionTaskWhyUnassigned" },
      score: 30, tier: "soon", cta: { kind: "open", view: "open-points", id: 1 } } as never;
    const blocked = { ...(unassigned as SuggestedAction), id: "task-attention:1:blocked", why: { key: "actionTaskWhyBlocked", params: ["x"] } } as never;
    const assignBundle = { resources: [], onCreateResource: () => 1, onAssign: vi.fn() };
    const { rerender } = render(<ActionRow lang="en-US" action={unassigned} onOpen={() => {}} assignOwner={assignBundle} />);
    expect(screen.getByRole("button", { name: /assign owner/i })).toBeTruthy();
    rerender(<ActionRow lang="en-US" action={blocked} onOpen={() => {}} onClearBlocker={onClearBlocker} />);
    fireEvent.click(screen.getByRole("button", { name: /clear blocker/i })); // now inline, not in the menu
    expect(onClearBlocker).toHaveBeenCalled();
  });
```

3. In `describe("ActionRow draft message", …)`, both "shows Draft message …" tests must drop the
   `fireEvent.click(more-actions)` step — draft is now the inline primary (no reschedule bundle in those
   fixtures, so `draft` outranks `markDone`). Delete the `fireEvent.click(screen.getByRole("button", { name: /more actions/i }));`
   line in each, leaving the direct `getByRole(... /draft message/i)` lookups (which now resolve to the inline button).

4. In `describe("ActionRow create task", …)`, the "renders Create task …" test is unaffected (createTask
   stays in the menu) — leave it. The "shows Reschedule popover … and Mark done in the menu" test is
   unaffected (reschedule is primary; markDone stays in menu) — leave it.

- [ ] **Step 2: Run the row test to verify the new expectations fail against the OLD component**

Run: `npx vitest run src/app/action-row.test.tsx`
Expected: FAIL (old component still renders the icon/score + buries clear-blocker/draft in the menu).

- [ ] **Step 3: Rewrite `action-row.tsx` to consume the shared controls**

Replace the entire body of `src/app/action-row.tsx` with:

```tsx
// src/app/action-row.tsx
"use client";
import { type Lang, t } from "./i18n";
import type { SuggestedAction } from "./next-actions/types";
import { ACTION_SOURCE_LABEL } from "./action-source-label";
import { InfoTooltip } from "./info-tooltip";
import { ActionReasons } from "./action-reasons";
import {
  ActionPrimaryCta, ActionOverflowMenu, useActionCaps,
  type ActionHandlers, type AssignOwnerBundle,
} from "./action-cta-controls";
import { TIER_RAG } from "./next-actions/action-cta";

export type { AssignOwnerBundle };

interface ActionRowProps extends ActionHandlers {
  lang: Lang;
  action: SuggestedAction;
  extraReasons?: readonly SuggestedAction[];
  expertMode?: boolean;
}

export function ActionRow(props: ActionRowProps) {
  const { lang, action, extraReasons, expertMode } = props;
  const caps = useActionCaps(props);
  const rag = TIER_RAG[action.tier];
  const title = t(lang, action.title.key, ...(action.title.params ?? []));
  const why = t(lang, action.why.key, ...(action.why.params ?? []));
  const sourceLabel = t(lang, ACTION_SOURCE_LABEL[action.source]);
  return (
    // Mouse convenience only — NOT role=button (nested-interactive a11y). Inner
    // controls are the real keyboard affordances.
    <div
      onClick={() => props.onOpen(action)}
      className={`flex cursor-pointer items-center gap-2 rounded-md border border-line border-l-4 ${rag.stripe} bg-surface px-3 py-1.5 hover:bg-surface-muted`}
    >
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          {expertMode && (
            <span onClick={(e) => e.stopPropagation()} className="shrink-0">
              <InfoTooltip text={t(lang, "actionScoreTooltip", action.score)} />
            </span>
          )}
          <span className="truncate text-sm font-medium text-foreground">{title}</span>
        </span>
        <span className="mt-0.5 block truncate text-xs text-muted-foreground">
          <b className="font-semibold uppercase tracking-wide">{sourceLabel}</b> · {why}
        </span>
        <ActionReasons lang={lang} action={action} extraReasons={extraReasons} />
        {action.learning?.moved && (
          <span className="mt-0.5 block truncate text-xs text-muted-foreground">
            {action.learning.moved === "up" ? t(lang, "learningSurfacedHint") : t(lang, "learningDemotedHint")}
          </span>
        )}
      </span>
      <div className="flex shrink-0 items-center gap-2">
        <ActionPrimaryCta lang={lang} action={action} caps={caps} handlers={props} />
        <ActionOverflowMenu lang={lang} action={action} caps={caps} handlers={props} />
      </div>
    </div>
  );
}
```

Notes:
- `ACTION_SOURCE_ICON` import is gone. Grep `rg "ACTION_SOURCE_ICON"` — if `action-row` was its
  only importer the export in `action-source-icon.ts` is now unused; LEAVE the file (an unused
  module export is not an eslint error) and note it for a later cleanup. (Its exhaustive `Record`
  still typechecks fine.)
- The `b` source prefix replaces the old pill + standalone icon.
- `EscalatePopover`/`RebaselinePopover`/`ReschedulePopover` imports move into `action-cta-controls.tsx`.

- [ ] **Step 4: Run the row test to verify it passes**

Run: `npx vitest run src/app/action-row.test.tsx`
Expected: PASS (all blocks, including the updated ones).

- [ ] **Step 5: Typecheck + lint, then commit**

Run: `npx tsc --noEmit` and `npm run lint` → clean.

```bash
git add src/app/action-row.tsx src/app/action-row.test.tsx
git commit -m "feat(actions): action-first compact row (source in why-line, expert-only score, promoted verb)"
```

---

## Task 4: Panel — hero selection, de-dupe, tier dots

**Files:**
- Modify: `src/app/actions-panel.tsx`
- Test: `src/app/actions-panel.test.tsx`

- [ ] **Step 1: Update the two panel tests the hero changes**

Edit `src/app/actions-panel.test.tsx`:

1. Replace the "renders Now/Soon section headings …" test with hero-aware expectations:

```tsx
  it("promotes the top group to a hero and renders remaining tiers", () => {
    // a(now,60) becomes the hero; b(soon,30) renders in Soon. Now has no remainder.
    const { getByRole, getByText, queryByText } = render(
      <ActionsPanel lang="en-US" actions={[mk("a", "now"), mk("b", "soon")]} onOpen={() => {}} />,
    );
    expect(getByRole("region", { name: /Do this first/i })).toBeTruthy(); // hero present
    expect(getByText(/^Soon/)).toBeTruthy();
    expect(queryByText(/^Monitor/)).toBeNull();
  });
```

2. Replace the "caps the now tier …" test (hero takes one Now item, so the cap math shifts by one):

```tsx
  it("caps the now tier under the hero and reveals the rest via show-more", async () => {
    const user = userEvent.setup();
    const actions = Array.from({ length: 7 }, (_, i) => ({
      id: `n${i}`, source: "raid", moduleId: "raid",
      title: { key: "actionRaidTitle", params: [1, `n${i}`] },
      why: { key: "actionRaidWhySeverity", params: ["High"] },
      score: 70 - i, tier: "now",
      cta: { kind: "open", view: "raid", id: i },
    })) as never;
    render(<ActionsPanel lang="en-US" actions={actions} onOpen={() => {}} />);
    // n0 → hero (1 Open). Remaining 6 in Now, capped at 5 → 5 Opens. Total 6.
    expect(screen.getAllByText("Open")).toHaveLength(6);
    const more = screen.getByRole("button", { name: /show 1 more/i });
    await user.click(more);
    expect(screen.getAllByText("Open")).toHaveLength(7); // hero + all 6
    expect(screen.getByRole("button", { name: /show less/i })).toBeTruthy();
  });
```

3. Add a new test confirming a lone monitor item does NOT become a hero (and the existing monitor
   collapse test stays green):

```tsx
  it("does not promote a monitor-only top group to a hero", () => {
    const actions = [
      { id: "m1", source: "budget", title: { key: "actionBudgetTitle", params: ["P"] },
        why: { key: "actionBudgetWhyCpi", params: ["0.8"] }, score: 10, tier: "monitor",
        cta: { kind: "open", view: "budget", id: 0 } },
    ] as never;
    render(<ActionsPanel lang="en-US" actions={actions} onOpen={() => {}} />);
    expect(screen.queryByRole("region", { name: /Do this first/i })).toBeNull();
    expect(screen.getByRole("button", { name: /monitored/i })).toBeTruthy();
  });
```

> The "collapses multiple signals", "sorts soon-tier rows", "collapses the monitor group", and all
> "AI analysis" / "learning status pill" tests are unaffected (verified: hero reuses the reasons
> expander with the same `action-reasons-<id>` ids; the monitor-only case has no hero). Leave them.

- [ ] **Step 2: Run the panel test to verify the new expectations fail**

Run: `npx vitest run src/app/actions-panel.test.tsx`
Expected: FAIL (old panel has no hero region; cap math is 5/7 not 6/7).

- [ ] **Step 3: Wire the hero + tier dots into `actions-panel.tsx`**

In `src/app/actions-panel.tsx`:

a. Add imports near the existing ones:

```tsx
import { ActionHeroCard } from "./action-hero-card";
import { TIER_RAG } from "./next-actions/action-cta";
```

b. Add an `expertMode` pass-through to the rendered rows. The `renderRow` helper already closes over
   the props; change it to thread `expertMode` (the panel already destructures `expertMode`):

```tsx
  const renderRow = (g: ActionGroup) => (
    <ActionRow
      key={g.key}
      lang={lang}
      action={g.primary}
      extraReasons={g.extra}
      expertMode={expertMode}
      onOpen={onOpen}
      onSnooze={onSnooze}
      onCreateTask={onCreateTask}
      assignOwner={assignOwner}
      onDraftMessage={onDraftMessage}
      escalate={escalate}
      rebaseline={rebaseline}
      reschedule={reschedule}
      onMarkDone={onMarkDone}
      onClearBlocker={onClearBlocker}
    />
  );

  // Hero = the single top-ranked group, but only when it carries real urgency
  // (tier !== monitor — never promote a low/monitor item to "Do this first").
  const hero = groups[0] && groups[0].tier !== "monitor" ? groups[0] : null;
  const heroKey = hero?.key;
```

c. In the `groups.length === 0 ? (...) : (...)` branch, render the hero ABOVE the tier flow and
   filter it out of the tier lists. Replace the tier-list container opening + the `rows` line:

```tsx
        <div className="flex min-h-0 flex-1 flex-col gap-5 overflow-auto pr-2">
          {hero && (
            <ActionHeroCard
              lang={lang}
              group={hero}
              expertMode={expertMode}
              onOpen={onOpen}
              onSnooze={onSnooze}
              onCreateTask={onCreateTask}
              assignOwner={assignOwner}
              onDraftMessage={onDraftMessage}
              escalate={escalate}
              rebaseline={rebaseline}
              reschedule={reschedule}
              onMarkDone={onMarkDone}
              onClearBlocker={onClearBlocker}
            />
          )}
          {TIERS.map(({ tier, labelKey }) => {
            const rows = groups.filter((g) => g.tier === tier && g.key !== heroKey);
            if (rows.length === 0) return null;
```

d. Give the tier headers a RAG dot + tinted count. For the `monitor` `<button>` header, prepend a
   dot span and tint the count; for the Now/Soon `<h3>` header, do the same. Replace the monitor
   header button's inner content:

```tsx
                    <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${TIER_RAG.monitor.dot}`} />
                    <span aria-hidden>{monitorOpen ? "▾" : "▸"}</span>
                    {t(lang, "actionMonitoredCount", rows.length)}
```
(add `inline-flex items-center gap-1.5` to that button's className if not already flex.)

And replace the Now/Soon `<h3>`:

```tsx
                <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${TIER_RAG[tier].dot}`} />
                  {t(lang, labelKey)} <span className={TIER_RAG[tier].text}>({rows.length})</span>
                </h3>
```

> Counts now reflect the post-hero remainder (e.g. "Now (2)" when the hero came from Now). That is
> the intended "N more" semantics; no separate string needed.

- [ ] **Step 4: Run the panel test to verify it passes**

Run: `npx vitest run src/app/actions-panel.test.tsx`
Expected: PASS (all blocks).

- [ ] **Step 5: Run the full Next-Actions test slice**

Run: `npx vitest run src/app/action-cta.test.ts src/app/action-hero-card.test.tsx src/app/action-row.test.tsx src/app/actions-panel.test.tsx`
Expected: PASS.

- [ ] **Step 6: Typecheck + lint, then commit**

Run: `npx tsc --noEmit` and `npm run lint` → clean.

```bash
git add src/app/actions-panel.tsx src/app/actions-panel.test.tsx
git commit -m "feat(actions): focus hero above kept tiers + tier-colour header dots"
```

---

## Task 5: i18n key, full verification, a11y eye-check

**Files:**
- Modify: `src/app/i18n.ts`
- Modify: `src/app/i18n.de.ts` (via node utf8 write — Edit tool corrupts umlauts; this string has none but follow the rule)

- [ ] **Step 1: Add `actionHeroEyebrow` to EN**

Edit `src/app/i18n.ts` — add beside the other `action*` keys:

```ts
  actionHeroEyebrow: "Do this first",
```

- [ ] **Step 2: Add the DE key via node (CRLF-safe, matches `\r\n` anchor)**

Run (from repo root):

```bash
node -e "const fs=require('fs');const p='src/app/i18n.de.ts';let s=fs.readFileSync(p,'utf8');s=s.replace('  actionMoreActions:', '  actionHeroEyebrow: \"Zuerst erledigen\",\r\n  actionMoreActions:');fs.writeFileSync(p,s,'utf8');console.log(s.includes('actionHeroEyebrow')?'OK':'MISS');"
```
Expected stdout: `OK`. (If the `actionMoreActions` anchor line isn't present in `i18n.de.ts`,
pick another existing adjacent `action*` key as the anchor — verify with
`rg "actionMoreActions|actionMoreReasons" src/app/i18n.de.ts` first.)

- [ ] **Step 3: Verify i18n parity + key presence**

Run: `npx tsc --noEmit`
Expected: clean (EN/DE key sets identical — tsc enforces; a missing DE key fails here).

Run: `rg "actionHeroEyebrow" src/app/i18n.ts src/app/i18n.de.ts`
Expected: one hit in each, DE shows the real umlaut-free German "Zuerst erledigen".

- [ ] **Step 4: Full unit suite (capture exit code — never pipe to tail)**

Run: `npm run test:run > C:/Users/SEBAST~1.MAU/AppData/Local/Temp/claude/test.log 2>&1; echo "EXIT:$?"`
Expected: `EXIT:0`. If non-zero, open the log and fix before proceeding.

- [ ] **Step 5: Lint (max-warnings=0)**

Run: `npm run lint`
Expected: clean. Re-check for any now-unused import (e.g. confirm `action-source-icon` has no
remaining importer; if it is truly dead, either leave the exported const or remove the file — do
NOT leave a dead local import anywhere).

- [ ] **Step 6: a11y — determine whether `actions` is axe-scanned, then verify**

Run: `rg "A11Y_VIEWS" e2e/a11y.spec.ts` and check whether `actions` (Next actions) is in the list.
- If present: `npx playwright test e2e/a11y.spec.ts --project=chromium -g "actions"` (or the view's
  display name) — expect green across AIPM-light / AIPM-dark / mockup-light.
- If absent (it is a Turso-independent sub-menu child; confirm): eye-verify in the running app —
  hero CTAs have text labels, ⋮ has a row-unique `aria-label`, tier dots are `aria-hidden`, the
  source `<b>` prefix is text (not an aria-label), and contrast holds for `--rag-*-text` counts +
  the hero eyebrow under all three styles. Toggle `expertMode` and confirm the score tooltip
  appears/disappears.

- [ ] **Step 7: Final commit**

```bash
git add src/app/i18n.ts src/app/i18n.de.ts
git commit -m "feat(actions): i18n actionHeroEyebrow (EN+DE)"
```

---

## Release (only on explicit "release" — not part of TDD tasks)

Per AGENTS.md, at ship time:
1. Bump `src/app/version.ts` — `APP_VERSION` + new `APP_MILESTONE` codename + dated `APP_BUILD_DATE` comment.
2. Append `"versionHighlightNextActionsRedesign"` to `APP_HIGHLIGHT_KEYS`; add EN + DE strings.
3. Add a `CHANGELOG.md` entry.
4. Then the standard push → MR → auto-merge-on-green chain.

## Self-review notes (addressed)

- **Type consistency:** `ActionHandlers`/`AssignOwnerBundle` are defined once in
  `action-cta-controls.tsx`; `action-row.tsx` re-exports `AssignOwnerBundle` so existing importers
  (e.g. `actions-panel.tsx`'s `import type { AssignOwnerBundle } from "./action-row"`) keep working.
- **`pickPrimaryCta` priority** matches the row's historical inline-vs-menu behavior except the three
  intentional promotions (clearBlocker/markDone/draft → inline when lead), which the updated tests cover.
- **No placeholders:** every step has concrete code/commands. The two "confirm the why.key literal" /
  "confirm `actions` in A11Y_VIEWS" notes are verification instructions, not design gaps.
- **Palette:** RAG via `TIER_RAG` tokens only; hero shadow via `--shadow-card`; no gradient; no
  pipe/wildcard inside any Tailwind arbitrary bracket.
```
