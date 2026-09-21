"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ReportCard } from "./report-table";
import { buildDashboardInput, computeDashboard, hasNoActiveScope } from "./dashboard";
import { useWorkspace } from "./workspace-context";
import { type Lang, t } from "./i18n";
import type { Health } from "./health";
import type { Absence, BudgetBucket, ChangeItem, Discipline, Grade, Milestone, RaidItem, ResourcePlan, Resource, Role, Task } from "./types";
import type { SuggestedAction } from "./next-actions/types";
import type { ActionGroup } from "./next-actions/group";
import type { ActionHandlers } from "./action-cta-controls";
import { ActionHeroCard } from "./action-hero-card";
import { rowLabel } from "./row-tokens";
import { DashboardStatusRow, DashboardTopRow } from "./dashboard-rows";
import type { InsightActions } from "./insights/insight";
import { useResizable } from "./use-resizable";
import { PrintButton, ResetLayoutButton, ResetSizeButton } from "./task-manager-ui";
import type { VarianceRow, SnapshotRecord } from "./snapshot";
import { useLandingDelta } from "./use-landing-delta";
import { buildGreeting, type RagScope } from "./dashboard-delta";
import { DashboardDeltaStrip } from "./dashboard-delta-strip";
import { computeCompletionTrend } from "./completion-trend";
import { bucketMilestonesByHorizon } from "./milestones";
import { computeCoaching, type SettingsSectionId } from "./dashboard-coaching";
import { DashboardCoachingCard } from "./dashboard-coaching-card";
import { DashboardTipCard } from "./dashboard-tip-card";
import { DigestCardConnected } from "./digest/digest-card-connected";
import { densityClasses, type DashboardDensity } from "./dashboard-density";
import { type AppView } from "./nav-config";
import { NarrativeSummary } from "./dashboard-sections/dashboard-narrative";
import { DashboardHero } from "./dashboard-sections/dashboard-hero";
import type { Insight, InsightEntityRef } from "./insights/insight";
import { PopoverPanel } from "./popover-panel";
import { DashboardGrid } from "./dashboard-grid";
import { DashboardTile, type TileDragProps } from "./dashboard-tile";
import { DashboardTileMenu } from "./dashboard-tile-menu";
import { DashboardShelf, DASHBOARD_SHELF_TRAY_ID } from "./dashboard-shelf";
import { DashboardHiddenBadge } from "./dashboard-hidden-badge";
import { buildTileBodies } from "./dashboard-tile-bodies";
import { useDashboardLayout } from "./use-dashboard-layout";
import { useListReorderDnd } from "./use-list-reorder-dnd";
import { tileById, type DashboardTileId, type TileGateInput, type TileHeight } from "./dashboard-tiles";
import { useMeasuredHeights } from "./use-measured-heights";
import type { PlacedTile } from "./dashboard-layout";

// A stable identity for the "no snapshots yet" default — an inline `[]`
// fallback would mint a fresh array every render, invalidating the `model`
// memo's `snapshots` dependency for no input change (AGENTS.md memo bullet).
const EMPTY_SNAPSHOTS: readonly SnapshotRecord[] = [];

/** Stable empty for the hero's CTA bundle — see `heroHandlers` below. */
const NO_HANDLERS: Omit<ActionHandlers, "onOpen"> = {};

interface DashboardPanelProps {
  lang: Lang;
  tasks: readonly Task[];
  raid: readonly RaidItem[];
  budgets: readonly BudgetBucket[];
  plan: ResourcePlan;
  roles: readonly Role[];
  resources: readonly Resource[];
  absences: readonly Absence[];
  disciplines?: readonly Discipline[];
  grades?: readonly Grade[];
  holidaySet: ReadonlySet<string>;
  workdayHours: number;
  today: string;
  milestones?: readonly Milestone[];
  changes?: readonly ChangeItem[];
  onOpenRaid?: (id: number) => void;
  onOpenTask?: (id: number) => void;
  onOpenMilestone?: (id: number) => void;
  showRaid?: boolean;
  showBudget?: boolean;
  showMilestones?: boolean;
  showChanges?: boolean;
  topActions?: readonly SuggestedAction[];
  onOpenAction?: (a: SuggestedAction) => void;
  /** Row 2's Next-Actions hero (spec C decisions 3–4): `pickHeroGroup` over the
   *  ONE grouping `task-manager.tsx` runs, so this panel and the Next-actions
   *  page cannot promote different groups. null/absent = no Now/Soon group →
   *  Overall status takes the whole row. */
  heroGroup?: ActionGroup | null;
  /** The CTA bundle `ActionsPanel` hands its hero, minus `onOpen` (this panel's
   *  `onOpenAction` is that). Ignored in a popout. */
  actionHandlers?: Omit<ActionHandlers, "onOpen">;
  expertMode?: boolean;
  variance?: readonly VarianceRow[];
  snapshots?: readonly SnapshotRecord[];
  tursoActive?: boolean;
  projectId?: string;
  isPopout?: boolean;
  onOpenChange?: (id: number) => void;
  onNavigate?: (view: AppView, section?: SettingsSectionId) => void;
  aiConfigured?: boolean;
  /** Per-device cockpit density (spacing only). Default "comfortable". Set via Settings → Appearance. */
  density?: DashboardDensity;
  /** Insights lifecycle callbacks (#6B SP1/SP2). Forwarded to InsightsCard. */
  insightActions?: InsightActions;
  /** Id of the insight whose AI recommendation is generating (#6B SP2) —
   *  PER-ROW, forwarded to InsightsCard for the shared Stop affordance. */
  insightGeneratingId?: number | null;
  /** Aborts the in-flight recommendation generate. */
  onCancelInsightRecommendation?: () => void;
  insightAiEnabled?: boolean;
}

export function DashboardPanel(props: DashboardPanelProps) {
  const { lang, today, onOpenRaid, onOpenTask, topActions, onOpenAction } = props;
  const { showRaid = true, showBudget = true, showMilestones = true, showChanges = true } = props;
  const density: DashboardDensity = props.density ?? "comfortable";
  const dc = densityClasses(density);
  const varianceRows = props.variance ?? [];
  const { status, setStatus, insights, activityLog: activity, fxRates, budgetHistory } = useWorkspace();
  // Hoisted above the `model` useMemo below: it depends on this, and it must
  // keep a stable identity when `props.snapshots` is absent so that memo
  // never invalidates for no input change.
  const snapshots = props.snapshots ?? EMPTY_SNAPSHOTS;
  const { ref: sizeRef, reset: resetSize } = useResizable("aipm-cockpit:dashboard-size");

  const model = useMemo(
    () =>
      computeDashboard(
        buildDashboardInput(
          {
            tasks: props.tasks,
            raid: showRaid ? props.raid : [],
            budgets: showBudget ? props.budgets : [],
            plan: props.plan,
            roles: props.roles,
            resources: props.resources,
            absences: props.absences,
            fxRates,
            milestones: showMilestones ? props.milestones : [],
            changes: showChanges ? props.changes : [],
            disciplines: props.disciplines,
            grades: props.grades,
            // Only when Turso trends are active — mirrors the same gate the
            // `gate: TileGateInput` object's `tursoActive` field already reads
            // off this prop, and keeps a stubbed `props.tursoActive=false`
            // caller (most tests) byte-identical to before this change.
            snapshots: props.tursoActive ? snapshots : EMPTY_SNAPSHOTS,
            budgetHistory,
          },
          {
            workdayHours: props.workdayHours,
            holidaySet: props.holidaySet,
            status,
            activity,
            today,
          },
        ),
      ),
    [
      props.tasks, props.raid, props.budgets, props.plan,
      props.roles, props.resources, props.absences,
      props.workdayHours, props.holidaySet,
      props.milestones, props.changes,
      props.disciplines, props.grades,
      showRaid, showBudget, showMilestones, showChanges,
      status, activity, today, fxRates,
      props.tursoActive, snapshots, budgetHistory,
    ],
  );

  // Completion-trend sparkline (slice #6). Snapshot-preferred, activity-log
  // fallback. Deps hoisted to scalars (exhaustive-deps bans obj.member/.length
  // in the array).
  const snapCount = snapshots.length;
  const activityCount = activity.length;
  const currentDone = model.progress.completed;
  // inScope, NOT total: the sparkline's last point is anchored on these counts
  // and renders directly beneath the completion tile, so it must divide by the
  // same denominator the tile's percentage does.
  const currentTotal = model.progress.inScope;
  // Shared with the at-a-glance KPI card, which renders the SAME metric — see
  // hasNoActiveScope. Re-deriving it here is how the two cards once disagreed.
  const noActiveScope = hasNoActiveScope(model.progress);
  const completionSeries = useMemo(
    () =>
      computeCompletionTrend({ snapshots, activity, tasks: props.tasks, currentDone, currentTotal, today }),
    // ★★ `props.tasks` and NOT `props.tasks.length`, which is what the
    //   neighbouring scalar deps (`snapCount`, `activityCount`) make the obvious
    //   reach. The numerator depends on `completedDate` VALUES, not on how many
    //   tasks there are: a date edited to a different past day leaves the count
    //   identical and the curve stale, and the disable below means the linter
    //   cannot catch it either.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [snapCount, activityCount, props.tasks, currentDone, currentTotal, today],
  );

  // Landing cockpit: greeting + "since you last looked" delta.
  const currentRag: Record<RagScope, Health | null> = {
    overall: model.overall.effective,
    schedule: model.schedule.effective,
    budget: model.budget.effective,
    scope: model.scope.effective,
  };
  const currentMetrics = {
    complete: model.progress.percent,
    overdue: model.overdue.length,
    openRaid: model.openRaidCount,
  };
  const { delta, trends } = useLandingDelta({
    projectId: props.projectId ?? "default",
    currentRag,
    currentMetrics,
    overdue: model.overdue,
    today,
    isPopout: props.isPopout ?? false,
    activity,
  });
  // Hour captured once (lazy) to keep `new Date()` out of the render body.
  const [greetHour] = useState(() => new Date().getHours());
  const milestonesSoon =
    model.overdueMilestones.length + model.atRiskMilestones.length + model.dueSoonMilestones.length;
  const greeting = buildGreeting(greetHour, { needsYou: topActions?.length ?? 0, milestonesSoon });
  // Representative task for the strip's task chips (first overdue, else first
  // due-soon). undefined ⇒ the strip downgrades those chips to info-only spans.
  const repTaskId = model.overdue[0]?.id ?? model.dueSoon[0]?.id;

  // ── Row 2: the Next-Actions hero (spec C decisions 3–4) ─────────────────────
  // ★ A popout is read-only: the hero renders without ANY handler, including
  // the two `task-manager.tsx` does not popout-gate (`onSnooze`, `onLogAsRaid`).
  const heroGroup = props.heroGroup ?? null;
  const heroHandlers = props.isPopout ? NO_HANDLERS : (props.actionHandlers ?? NO_HANDLERS);
  // ★★ THE HERO'S TOKEN CARRIES A SECTION SEGMENT HERE, and only here. The Top
  // actions tile keeps listing the hero's action (decision 5), and its rows are
  // row-unique only WITHIN the tile, so a bare title would give the hero and the
  // tile row the same "Open – <title>" — a WCAG 2.4.6 collision axe cannot see.
  // "Open – Do this first – <title>" still contains the visible "Open"; the
  // tile's names are unchanged. Same shape as `AiActionRow`'s section segment.
  const heroEl = heroGroup ? (
    <ActionHeroCard
      {...heroHandlers}
      onOpen={onOpenAction}
      lang={lang}
      group={heroGroup}
      expertMode={props.expertMode}
      rowToken={rowLabel(
        t(lang, "actionHeroEyebrow"),
        t(lang, heroGroup.primary.title.key, ...(heroGroup.primary.title.params ?? [])),
      )}
      className="h-full"
    />
  ) : null;

  // Forward "what's coming" milestone horizon for the dashboard strip.
  const milestoneBuckets = useMemo(
    () =>
      bucketMilestonesByHorizon(
        showMilestones ? (props.milestones ?? []) : [],
        new Map(props.tasks.map((t) => [t.id, t] as const)),
        today,
        props.holidaySet,
      ),
    [showMilestones, props.milestones, props.tasks, today, props.holidaySet],
  );

  // First-open coaching CTAs (self-hide once any task exists). Counts hoisted to
  // locals so the dep array stays scalar (exhaustive-deps rejects a `?.length`
  // member expression in the array).
  const taskCount = props.tasks.length;
  const milestoneCount = props.milestones?.length ?? 0;
  const budgetCount = props.budgets.length;
  const aiConfigured = props.aiConfigured ?? false;
  const coachingCtas = useMemo(
    () => computeCoaching({ taskCount, milestoneCount, budgetCount, showMilestones, showBudget, aiConfigured }),
    [taskCount, milestoneCount, budgetCount, showMilestones, showBudget, aiConfigured],
  );

  // Insights review card (#6B SP1). Insights live in the live workspace state
  // (mirrors `status`); the card self-hides when none are active, and the
  // `hasInsights` tile gate below reads the SAME count so the tile does not
  // render an empty frame.
  const allInsights: readonly Insight[] = insights ?? [];
  const activeInsightCount = allInsights.filter(
    (i) => i.status === "active" || i.status === "acknowledged",
  ).length;
  const openInsightEntity = (ref: InsightEntityRef) => {
    switch (ref.view) {
      case "milestones": props.onOpenMilestone?.(ref.id); break;
      case "raid": onOpenRaid?.(ref.id); break;
      case "changes": props.onOpenChange?.(ref.id); break;
      case "open-points": onOpenTask?.(ref.id); break;
      default: props.onNavigate?.(ref.view); break;
    }
  };

  // ── Arrangeable tile grid ───────────────────────────────────────────────────
  // ★★ THE GATE DECIDES WHAT RENDERS, NEVER WHAT IS STORED. `useDashboardLayout`
  // deliberately takes no `gate` — a gated-off tile keeps its stored position, so
  // switching Budget off and on again does not lose the burn tile's place. The
  // old masonry's inline conditions (`topActions?.length`, `activeInsightCount`,
  // …) live here now instead of wrapping the JSX.
  const gate: TileGateInput = {
    showRaid,
    showBudget,
    showChanges,
    showMilestones,
    tursoActive: !!props.tursoActive,
    hasTopActions: !!topActions?.length,
    hasInsights: activeInsightCount > 0,
    // ★ `&& !noActiveScope` is NOT in the plan and is load-bearing: the old card
    // carried both conditions, and dropping the second would put a flat 0%
    // trajectory beside a completion tile reading "No active scope".
    hasCompletionTrend: completionSeries.length >= 2 && !noActiveScope,
  };
  const arrangement = useDashboardLayout({
    projectId: props.projectId ?? "default",
    isPopout: props.isPopout,
  });
  // Hoisted: `react-hooks/exhaustive-deps` rejects an `obj.member` dependency,
  // and the reorder hook reads this on every render anyway.
  const layout = arrangement.layout;
  // ★★★ THE DRAG AUTOSCROLLER IS THE **CARD'S** CONTENT DIV, NOT ANYTHING THE
  // GRID OWNS. `ReportCard` is `flex h-full min-h-0 flex-col overflow-hidden`
  // and its `contentRef` div is the `min-h-0 flex-1 overflow-y-auto` child — the
  // one element in this subtree with a bounded height and therefore a real
  // `scrollTop`. `DashboardGrid` used to wrap itself in its own
  // `overflow-y-auto` div and hand THAT to the hook; a block-level child of a
  // plain block sizes to its content, so `scrollHeight === clientHeight` and
  // `useDragAutoscroll`'s `scrollTop +=` was a permanent no-op. One ref goes to
  // both the card and the hook, exactly as `reports.tsx` does it.
  const cardScrollRef = useRef<HTMLDivElement>(null);
  const boardIds = layout.board.map((p) => p.id);
  const reorder = useListReorderDnd<DashboardTileId>({
    ids: boardIds,
    // ★ onMove, NOT onReorder: the board stores a size per tile, so a bare id
    // list cannot express the state. The pair form lets the layout engine own
    // the mutation and keep each tile's w/h.
    onMove: arrangement.move,
    scrollRef: cardScrollRef,
    keyboard: false, // the ⋮ menu is this surface's keyboard reorder path
    disabled: arrangement.readOnly,
  });

  const bodies = buildTileBodies({
    lang, dc, model,
    trends,
    // ★★ EUR, never `plan.currency`: this labels the engine's burn-down series
    // (`budgetHours × role.rates.external`), which converts nothing. Narrowing
    // `plan.currency` to the `BudgetCurrency` union did not make it safe — the
    // union still admits USD/GBP — and labelling with it printed EUR money
    // under another symbol on the LANDING view (docs/open-followups.md §465).
    currency: "EUR",
    completionSeries,
    milestoneBuckets,
    varianceRows,
    allInsights,
    openInsightEntity,
    topActions,
    showRaid,
    tursoActive: !!props.tursoActive,
    isPopout: props.isPopout,
    insightActions: props.insightActions,
    insightGeneratingId: props.insightGeneratingId,
    onCancelInsightRecommendation: props.onCancelInsightRecommendation,
    insightAiEnabled: props.insightAiEnabled,
    onNavigate: props.onNavigate,
    onOpenRaid,
    onOpenTask,
    onOpenMilestone: props.onOpenMilestone,
    onOpenChange: props.onOpenChange,
    onOpenAction,
  });

  // ★★ RENDER previewOrder, NOT layout.board. The grid packs densely, so an edge
  // marker on the drop target would routinely point at a slot the tile does not
  // end up in. Rendering the would-be result makes the board reflow under the
  // cursor. `previewOrder === boardIds` at rest, so this costs nothing.
  const sizeById = new Map(layout.board.map((p) => [p.id, p] as const));
  // ★★ ONE predicate for "would this tile actually render?", shared by the board
  // AND the shelf. Two copies drifted: the shelf tested only that the id was a
  // known tile, so a GATED-OFF hidden tile still listed a chip, counted toward
  // "N hidden", and offered a Restore that made the chip vanish with nothing
  // appearing — the board's own filter dropped it again. Storage stays gate-free
  // on purpose (`useDashboardLayout` takes no `gate`): a gate decides what
  // RENDERS, never what is STORED, so the hidden tile keeps its place and
  // reappears on the shelf the moment its module is switched back on.
  //
  // ★★★ THE `bodies[id] != null` HALF IS REDUNDANT AT EVERY TILE TODAY — do not
  // read it as a safety net, which is what this comment used to call it. Every
  // body but one is a React ELEMENT — built unconditionally, or (`burn`) chosen
  // between two elements — and an element whose component renders `null` is
  // still a non-null element, so the check cannot see it. The one that can be
  // null, `completionTrend` (`… >= 2 ? (…) : null`), has a gate,
  // `hasCompletionTrend` = `completionSeries.length >= 2 && !noActiveScope`,
  // that is STRICTLY STRONGER than the body's own condition, so the gate has
  // already excluded every input that would make the body null. List every
  // body key, then the ones that can be null, with:
  //   awk '/^export function buildTileBodies/,0' src/app/dashboard-tile-bodies.tsx \
  //     | grep -nE '^    [a-zA-Z]+:|\) : null'
  // (a `) : null` line closes the body whose key precedes it.) ★★ It is KEPT as the second half of a two-sided
  // contract: a body that becomes conditional without its gate following would
  // otherwise render empty tile chrome — a frame and a heading over nothing.
  // NOTHING ENFORCES THE REDUNDANCY, so a new tile still has to get its gate
  // right; this predicate only stops the failure being visible.
  const isRenderable = (id: DashboardTileId): boolean =>
    (tileById(id)?.gate(gate) ?? false) && bodies[id] != null;
  const visible: PlacedTile[] = reorder.previewOrder
    .map((id) => sizeById.get(id))
    .filter((p): p is PlacedTile => p !== undefined && isRenderable(p.id));
  const visibleIds = visible.map((p) => p.id);
  const measured = useMeasuredHeights({
    density,
    tiles: visible.map((p) => {
      const s = tileById(p.id)!;
      return { id: p.id, minH: s.minH, maxH: s.maxH, flagged: p.hSet === true };
    }),
  });
  /** ★★ The ONE place a tile's displayed height is decided. The tile, the ⋮ menu and the resize
   *  announcement all read it. Reading `p.h` directly in any of them shows the STORED default of a
   *  measured tile, which is exactly the mismatch the spec forbids. The measured value is never
   *  written back: a stored measurement would read as a user's choice on the next open. */
  const renderedH = (p: PlacedTile): TileHeight =>
    p.hSet === true ? p.h : (measured.get(p.id) ?? p.h);

  // ★★★ HIDING AND RESTORING BOTH DESTROY THE CONTROL THE USER JUST PRESSED, so
  // one of them has to say where focus goes or the browser drops it on `<body>`.
  // Hide is pressed inside the ⋮ popover, which unmounts along with the tile it
  // was anchored to; Restore is pressed on a chip that the same click removes.
  // ★★ SPEC C: THE DESTINATION IS THE HIDDEN-TILES BADGE — and it is absent at a
  // count of 0, so hiding the FIRST tile MOUNTS it in the very commit the hide
  // causes. Focus is therefore a POST-COMMIT request (`focusRequest` below, the
  // same effect the Move case uses), never a synchronous `.focus()`, which would
  // find nothing. `PopoverPanel`'s own §297 restore runs in a passive CLEANUP,
  // before this passive effect, so the request wins; its anchor (the hidden
  // tile's ⋮) is detached by then anyway.
  // ★★ Restoring the LAST hidden tile empties the tray and unmounts the badge,
  // so that one case lands on the restored tile's own ⋮ trigger instead.
  const badgeRef = useRef<HTMLButtonElement | null>(null);

  // ★★★ A MOVE IS THE OTHER HALF OF THE SAME DEFECT, AND IT NEEDS A DIFFERENT
  // MECHANISM. The move commands close the popover too, but the TILE survives —
  // so the right destination is the tile's own ⋮ trigger, which keeps the user
  // on the thing they just acted on and lets them press again without
  // re-navigating. That is the entire point of the ⋮ being this surface's
  // keyboard reorder path (`useListReorderDnd` is constructed with
  // `keyboard: false` precisely because this menu IS that path).
  //
  // ★★★ IT MUST FIRE AFTER THE COMMIT, NOT IN THE HANDLER. React reorders a
  // keyed list by MOVING the existing DOM nodes, and moving a focused element
  // blurs it — so focusing synchronously inside `moveByDelta` would be undone
  // by the very re-render the move causes. jsdom cannot tell the two apart
  // (measured: the naive version passes the test), which is exactly why this is
  // written the safe way rather than the way a green test would license.
  //
  // ★★ AND IT RESOLVES BY TILE IDENTITY, NOT A CAPTURED NODE. `menuAnchorRef`
  // holds the element the menu was opened from — a node from BEFORE the
  // reorder. Focusing a detached node is a silent no-op, i.e. this same defect
  // one level down. The map is keyed by tile id and re-registered by React on
  // every commit, so it is current by the time this effect runs.
  //
  // ★ A fresh object per request, never a bare id: two consecutive moves of the
  // SAME tile must both re-run this, and `setState` with an equal id would not.
  // ★ Spec C generalised it: a request names a tile's ⋮ trigger (Move, and a
  // Restore that empties the tray) or the hidden-tiles badge (Hide, Restore).
  const triggerRefs = useRef(new Map<DashboardTileId, HTMLButtonElement>());
  const [focusRequest, setFocusRequest] = useState<{ tile: DashboardTileId } | { badge: true } | null>(null);
  useEffect(() => {
    if (focusRequest === null) return;
    if ("tile" in focusRequest) triggerRefs.current.get(focusRequest.tile)?.focus();
    else badgeRef.current?.focus();
  }, [focusRequest]);

  const [menu, setMenu] = useState<{ id: DashboardTileId; index: number; count: number } | null>(null);
  // PopoverPanel anchors off a ref; `DashboardTile` hands us the trigger ELEMENT,
  // so it is parked here on open (an event handler, never render).
  const menuAnchorRef = useRef<HTMLElement | null>(null);
  const closeMenu = useCallback(() => setMenu(null), []);
  const [announcement, setAnnouncement] = useState("");
  const menuSpec = menu ? tileById(menu.id) : undefined;
  const menuSize = menu ? sizeById.get(menu.id) : undefined;

  // ★★ THE MENU SPEAKS IN DELTAS, THE ENGINE IN TARGET IDS — translate here.
  // ★★ AND OVER THE **VISIBLE** ORDER, not `layout.board`: the plan indexed the
  // stored board while the menu disables its commands on the visible index, so a
  // gated-off tile sitting between two visible ones would have made "Move
  // earlier" swap with something the user cannot see (no visible change at all).
  const moveByDelta = (id: DashboardTileId, delta: -1 | 1 | "first") => {
    const i = visibleIds.indexOf(id);
    if (i < 0) return;
    const j = delta === "first" ? 0 : i + delta;
    if (j === i || j < 0 || j >= visibleIds.length) return;
    arrangement.move(id, visibleIds[j]);
    setFocusRequest({ tile: id });
    const spec = tileById(id);
    if (!spec) return;
    setAnnouncement(
      t(lang, "arrangementTileMoved", t(lang, spec.labelKey), String(j + 1), String(visibleIds.length)),
    );
  };

  // Dropping a tile on the shelf hides it. The GRID owns decoding the drag —
  // `DashboardShelf` takes `dropProps` and never inspects a dataTransfer itself.
  const shelfDropProps: TileDragProps = arrangement.readOnly
    ? {}
    : {
        onDragOver: (e) => e.preventDefault(),
        onDrop: (e) => {
          e.preventDefault();
          const dragged = reorder.dragId;
          if (dragged === null) return;
          arrangement.hide(dragged);
          // ★★★ HIDING UNMOUNTS THE TILE WHOSE GRIP OWNS `onDragEnd`, and a
          // detached node's events never reach React's root container — so the
          // hook's own reset would never run and `dragId` would stay set for the
          // rest of the session. `endDrag` is the primitive's escape hatch for
          // exactly this; see its docstring for the three things a stuck dragId
          // breaks.
          reorder.endDrag();
          const spec = tileById(dragged);
          if (spec) setAnnouncement(t(lang, "arrangementTileHidden", t(lang, spec.labelKey)));
        },
      };

  // The tray's chips. ★★ Filtered by `isRenderable`, the SAME predicate the
  // board uses — the tray must never offer a tile restoring cannot bring back.
  // flatMap, not map + `!`: a stale id would otherwise throw on the title.
  const shelfHidden = layout.hidden.flatMap((id) => {
    const spec = tileById(id);
    return spec && isRenderable(id) ? [{ id, title: t(lang, spec.labelKey) }] : [];
  });
  // ★ Spec C: ONE open state drives the badge's `aria-expanded` and the tray's
  // `hidden`. The tray only SHOWS while there is something to show or a drag is
  // in flight — otherwise it could be left open with no badge to close it.
  const [trayOpen, setTrayOpen] = useState(false);
  const trayShown = trayOpen && (shelfHidden.length > 0 || reorder.isDragging);
  // ★ Fix round 2: a drag that opens the tray via the badge while hidden
  // count is 0 (dragEnter sets `trayOpen`) and then ends WITHOUT a drop
  // leaves `trayOpen` stuck true even though `trayShown` already fell back
  // to false for this render — the very next Hide via the tile menu would
  // then flip `trayShown` back to true unasked. Only clear `trayOpen` when a
  // drag actually JUST ended (this render's `isDragging` is false, the
  // PREVIOUS render's was true) and there is still nothing to show — NOT on
  // every count-0 render, which also happens when a module gate hides the
  // sole chip, where `trayOpen` must survive to reopen the tray once the
  // gate comes back (see "drops a hidden tile from the shelf once its
  // module gate goes off" in dashboard-panel.test.tsx). Render-time
  // reconcile against a last-seen STATE, not a ref (`react-hooks/refs` bans
  // reading/writing a ref during render) and not an effect
  // (`react-hooks/set-state-in-effect` is banned) — same shape as
  // `tasks-section.tsx`'s `handledClearNonce`.
  const [wasDragging, setWasDragging] = useState(reorder.isDragging);
  if (wasDragging !== reorder.isDragging) {
    if (wasDragging && trayOpen && shelfHidden.length === 0) setTrayOpen(false);
    setWasDragging(reorder.isDragging);
  }
  const restoreFromShelf = (id: DashboardTileId) => {
    arrangement.restore(id);
    // ★ Fix round 1: restoring the LAST hidden tile must also close the tray's
    // own `open` state, not just let `trayShown` fall to false for this render.
    // Without this, `trayOpen` stays true and the very next Hide re-opens the
    // tray unasked (`trayShown = trayOpen && shelfHidden.length > 0` flips back
    // true the moment a tile is hidden again).
    if (shelfHidden.length <= 1) setTrayOpen(false);
    setFocusRequest(shelfHidden.length > 1 ? { badge: true } : { tile: id });
  };

  return (
    <ReportCard
      lang={lang}
      sizeRef={sizeRef}
      contentRef={cardScrollRef}
      onResetSize={resetSize}
      hideToolbar
    >
      <div className={dc.outer}>
        {/* Row 1 (spec C decision 1): "since you last looked", the weekly digest
            beside it, and the control stack on the far right. */}
        <DashboardTopRow
          dc={dc}
          delta={
            <DashboardDeltaStrip
              lang={lang}
              delta={delta}
              greeting={greeting}
              onOpenTask={
                // onOpenTask opens a SPECIFIC task editor by id, so only wire it
                // when a representative task exists — otherwise the strip renders
                // the chip as a non-interactive span (no dead -1 click). RAID/
                // milestone/change handlers route to the VIEW (ignore the id), so
                // they stay wired unconditionally below.
                onOpenTask && repTaskId !== undefined ? () => onOpenTask(repTaskId) : undefined
              }
              onOpenRaid={onOpenRaid ? () => onOpenRaid(model.topRaid[0]?.id ?? -1) : undefined}
              onOpenMilestone={props.onOpenMilestone ? () => props.onOpenMilestone!(-1) : undefined}
              onOpenChange={props.onOpenChange ? () => props.onOpenChange!(-1) : undefined}
            />
          }
          digest={
            // Weekly status digest — self-hides until enabled (Settings) + generated;
            // its slot collapses then (`DashboardTopRow`).
            <DigestCardConnected
              lang={lang}
              dc={dc}
              model={model}
              raid={props.raid}
              projectId={props.projectId ?? "default"}
              isPopout={props.isPopout ?? false}
            />
          }
          controls={
            // ★ `gap-2` here is MOVED, unchanged, from this same control stack
            // before spec C — not a new literal (D7 binds new spacing to `dc.*`).
            <div className="flex shrink-0 flex-col gap-2 print:hidden">
              <PrintButton lang={lang} />
              {/* ★★★ The `!arrangement.readOnly` guard is LOAD-BEARING and is not
                  inherited here: the stack itself is gated only on `print:hidden`.
                  Without it a popout — a surface with no grip, no ⋮ menu and no
                  tray by design — gains a working reset. */}
              {!arrangement.readOnly && (
                <ResetLayoutButton onClick={arrangement.reset} lang={lang} />
              )}
              <ResetSizeButton onClick={resetSize} lang={lang} />
              {/* Spec C decision 2: the hidden-tiles badge, directly under Reset
                  size; carries its own `readOnly` guard like Reset layout. */}
              {!arrangement.readOnly && (
                <DashboardHiddenBadge
                  lang={lang}
                  count={shelfHidden.length}
                  open={trayShown}
                  onOpenChange={setTrayOpen}
                  isDragging={reorder.isDragging}
                  dropProps={shelfDropProps}
                  trayId={DASHBOARD_SHELF_TRAY_ID}
                  badgeRef={badgeRef}
                />
              )}
            </div>
          }
        />

        {/* The hidden-tiles tray, directly under row 1 (spec C). The wrapper is
            `hidden` while the tray is shut, so the `space-y` flow gains no empty
            gap; the tray node itself stays mounted for `aria-controls`. */}
        {!arrangement.readOnly && (
          <div className="print:hidden" hidden={!trayShown}>
            <DashboardShelf
              lang={lang}
              hidden={shelfHidden}
              onRestore={restoreFromShelf}
              dropProps={shelfDropProps}
              open={trayShown}
            />
          </div>
        )}

        {/* Row 2 (spec C decision 3): the Next-Actions hero beside Overall
            status; the order below it is narrative → coaching → tip → grid. */}
        <DashboardStatusRow
          dc={dc}
          hero={heroEl}
          status={
            <DashboardHero
              lang={lang}
              today={today}
              model={model}
              status={status}
              setStatus={setStatus}
              showBudget={showBudget}
              showChanges={showChanges}
            />
          }
        />

        {/* Tier 0 — the ONE status summary, edited in place (Edit, or Add when
            empty). It always renders outside a popout: it is the only way to
            write a narrative. */}
        <NarrativeSummary lang={lang} status={status} setStatus={setStatus} readOnly={arrangement.readOnly} />

        {/* First-open coaching — self-hides once the project has any task */}
        <DashboardCoachingCard lang={lang} ctas={coachingCtas} onNavigate={props.onNavigate ?? (() => {})} />

        {/* Tip of the day — dismissable, rotates daily (per-device) */}
        <DashboardTipCard lang={lang} dc={dc} isPopout={props.isPopout} />

        {/* The arrangeable tile grid — REPLACES the fixed masonry flow. Order is
            the whole placement model (`grid-auto-flow: row dense`), so there are
            no coordinates: drag to reorder, ⋮ to resize/hide. */}
        <DashboardGrid dc={dc}>
          {visible.map((p, i) => {
            const spec = tileById(p.id)!;
            return (
              <DashboardTile
                key={p.id}
                id={p.id}
                title={t(lang, spec.labelKey)}
                w={p.w}
                h={renderedH(p)}
                lang={lang}
                readOnly={arrangement.readOnly}
                // ★★★ §425: MUST MATCH `keyboard: false` ON THE
                // `useListReorderDnd` CALL ABOVE. That option makes
                // `handleProps.onKeyDown` undefined, so this grip has NO
                // keyboard action; naming it `reorderHandle` ("Drag or use
                // arrow keys to reorder") told a keyboard user to press a key
                // that does nothing and announces nothing — WCAG 4.1.2, and
                // invisible to axe and to jsdom alike. `false` names it
                // `reorderHandleDragOnly` instead. If you ever turn `keyboard`
                // back on, flip this in the same edit: the ⋮ menu remains this
                // surface's keyboard reorder path, which is why the option is
                // off rather than why the label was wrong.
                keyboardReorder={false}
                dragProps={reorder.itemProps(p.id)}
                handleProps={reorder.handleProps(p.id)}
                onOpenMenu={(anchor) => {
                  menuAnchorRef.current = anchor;
                  setMenu({ id: p.id, index: i, count: visible.length });
                }}
                menuButtonRef={(el) => {
                  if (el) triggerRefs.current.set(p.id, el);
                  else triggerRefs.current.delete(p.id);
                }}
              >
                {bodies[p.id]}
              </DashboardTile>
            );
          })}
        </DashboardGrid>

        {/* ★ `PopoverPanel` owns the shared dismissal protocol (Escape via
            `useDismissable` → the dismissal stack, outside-click across both the
            anchor and the portaled panel, close-on-scroll, focus-first-control).
            The menu content improvises none of it. `onClose` is a `useCallback`
            because the panel re-subscribes its listeners on an unstable one. */}
        {menu && menuSpec && menuSize && !arrangement.readOnly && (
          <PopoverPanel
            open
            anchorRef={menuAnchorRef}
            onClose={closeMenu}
            role="dialog"
            ariaLabel={`${t(lang, "actionMoreActions")} – ${t(lang, menuSpec.labelKey)}`}
            className="w-56 p-1"
          >
            <DashboardTileMenu
              lang={lang}
              tileId={menu.id}
              title={t(lang, menuSpec.labelKey)}
              w={menuSize.w}
              h={renderedH(menuSize)}
              index={menu.index}
              count={menu.count}
              onResize={(axis, v) => {
                arrangement.resize(menu.id, axis, v);
                // `menuSize` is this render's value, so the axis NOT being set
                // reads correctly as its current one.
                setAnnouncement(t(lang, "arrangementTileResized",
                  t(lang, menuSpec.labelKey),
                  String(axis === "w" ? v : menuSize.w),
                  String(axis === "h" ? v : renderedH(menuSize))));
              }}
              onMove={(delta) => moveByDelta(menu.id, delta)}
              onHide={() => {
                arrangement.hide(menu.id);
                setAnnouncement(t(lang, "arrangementTileHidden", t(lang, menuSpec.labelKey)));
                setFocusRequest({ badge: true });
              }}
              onClose={closeMenu}
            />
          </PopoverPanel>
        )}

        {/* ★ Not decoration: the ⋮ menu is this surface's keyboard reorder path,
            and without an announcement a keyboard user gets no feedback that
            anything moved, resized or was hidden. */}
        <p role="status" aria-live="polite" className="sr-only">{announcement}</p>
      </div>
    </ReportCard>
  );
}
