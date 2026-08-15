"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ReportCard } from "./report-table";
import { buildDashboardInput, computeDashboard, hasNoActiveScope } from "./dashboard";
import { useWorkspace } from "./workspace-context";
import { loadActivityLog, type ActivityEntry } from "./activity-log";
import { type Lang, t, localeFor } from "./i18n";
import type { Health } from "./health";
import type { Absence, BudgetBucket, ChangeItem, Milestone, RaidItem, ResourcePlan, Resource, Role, Task } from "./types";
import { formatCurrency } from "./resource-cost";
import type { SuggestedAction } from "./next-actions/types";
import type { InsightActions } from "./insights/insight";
import { useResizable } from "./use-resizable";
import { PrintButton, ResetSizeButton } from "./task-manager-ui";
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
import { NarrativeSummary, NarrativeEditor } from "./dashboard-sections/dashboard-narrative";
import { DashboardHero } from "./dashboard-sections/dashboard-hero";
import type { Insight, InsightEntityRef } from "./insights/insight";
import { Button } from "./button";
import { PopoverPanel } from "./popover-panel";
import { DashboardGrid } from "./dashboard-grid";
import { DashboardTile, type TileDragProps } from "./dashboard-tile";
import { DashboardTileMenu } from "./dashboard-tile-menu";
import { DashboardShelf } from "./dashboard-shelf";
import { buildTileBodies } from "./dashboard-tile-bodies";
import { useDashboardLayout } from "./use-dashboard-layout";
import { useListReorderDnd } from "./use-list-reorder-dnd";
import { tileById, type DashboardTileId, type TileGateInput } from "./dashboard-tiles";
import type { PlacedTile } from "./dashboard-layout";

interface DashboardPanelProps {
  lang: Lang;
  tasks: readonly Task[];
  raid: readonly RaidItem[];
  budgets: readonly BudgetBucket[];
  plan: ResourcePlan;
  roles: readonly Role[];
  resources: readonly Resource[];
  absences: readonly Absence[];
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
  const { status, setStatus, insights } = useWorkspace();
  const { ref: sizeRef, reset: resetSize } = useResizable("aipm-cockpit:dashboard-size");

  const locale = localeFor(lang);
  const money = (n: number) => formatCurrency(n, props.plan.currency || "EUR", locale);

  const [activity] = useState<ActivityEntry[]>(() => loadActivityLog());

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
            milestones: showMilestones ? props.milestones : [],
            changes: showChanges ? props.changes : [],
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
      showRaid, showBudget, showMilestones, showChanges,
      status, activity, today,
    ],
  );

  // Completion-trend sparkline (slice #6). Snapshot-preferred, activity-log
  // fallback. Deps hoisted to scalars (exhaustive-deps bans obj.member/.length
  // in the array).
  const snapshots = props.snapshots ?? [];
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
      computeCompletionTrend({ snapshots, activity, currentDone, currentTotal, today }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [snapCount, activityCount, currentDone, currentTotal, today],
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
  });
  // Hour captured once (lazy) to keep `new Date()` out of the render body.
  const [greetHour] = useState(() => new Date().getHours());
  const milestonesSoon =
    model.overdueMilestones.length + model.atRiskMilestones.length + model.dueSoonMilestones.length;
  const greeting = buildGreeting(greetHour, { needsYou: topActions?.length ?? 0, milestonesSoon });
  // Representative task for the strip's task chips (first overdue, else first
  // due-soon). undefined ⇒ the strip downgrades those chips to info-only spans.
  const repTaskId = model.overdue[0]?.id ?? model.dueSoon[0]?.id;

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
    money,
    currency: props.plan.currency || "EUR",
    noActiveScope,
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
  // read it as a safety net, which is what this comment used to call it. TEN of
  // the eleven bodies are React ELEMENTS built unconditionally, and an element
  // whose component renders `null` is still a non-null element, so the check
  // cannot see it. The eleventh, `completionTrend`, is the one ternary
  // (`… >= 2 ? (…) : null`) — and its gate, `hasCompletionTrend`, is
  // `completionSeries.length >= 2 && !noActiveScope`, i.e. STRICTLY STRONGER
  // than the body's own condition, so the gate has already excluded every input
  // that would make the body null. Count the two shapes with:
  //   awk '/^export function buildTileBodies/,0' src/app/dashboard-tile-bodies.tsx \
  //     | grep -cE '^    [a-zA-Z]+: \('
  // (10, against 11 keys total.) ★★ It is KEPT as the second half of a two-sided
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

  // ★★★ HIDING AND RESTORING BOTH DESTROY THE CONTROL THE USER JUST PRESSED, so
  // one of them has to say where focus goes or the browser drops it on `<body>`.
  // Hide is pressed inside the ⋮ popover, which unmounts along with the tile it
  // was anchored to; Restore is pressed on a chip that the same click removes.
  // `PopoverPanel` does NOT restore focus to its anchor on close (it focuses the
  // first control on OPEN only), so nothing else was going to catch either case.
  // The shelf disclosure is the destination for both: it is the one node in that
  // subtree that never unmounts, it is where the hidden tile now lives, and it
  // is the route back. The `.focus()` is safe to call synchronously because the
  // toggle is already mounted and stays mounted across the state update.
  const shelfToggleRef = useRef<HTMLButtonElement | null>(null);
  const focusShelfToggle = () => shelfToggleRef.current?.focus();

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
  const triggerRefs = useRef(new Map<DashboardTileId, HTMLButtonElement>());
  const [focusAfterMove, setFocusAfterMove] = useState<{ id: DashboardTileId } | null>(null);
  useEffect(() => {
    if (focusAfterMove === null) return;
    triggerRefs.current.get(focusAfterMove.id)?.focus();
  }, [focusAfterMove]);

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
    setFocusAfterMove({ id });
    const spec = tileById(id);
    if (!spec) return;
    setAnnouncement(
      t(lang, "dashboardTileMoved", t(lang, spec.labelKey), String(j + 1), String(visibleIds.length)),
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
          if (spec) setAnnouncement(t(lang, "dashboardTileHidden", t(lang, spec.labelKey)));
        },
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
        {/* Landing: greeting + since-you-last-looked. The heading is removed; the
            Print + Reset-size controls are stacked to the RIGHT of this first box. */}
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
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
          </div>
          <div className="flex shrink-0 flex-col gap-2 print:hidden">
            <PrintButton lang={lang} />
            <ResetSizeButton onClick={resetSize} lang={lang} />
          </div>
        </div>

        {/* Tier 0 — read-only status narrative summary (self-hides when empty) */}
        <NarrativeSummary lang={lang} status={status} />

        {/* First-open coaching — self-hides once the project has any task */}
        <DashboardCoachingCard lang={lang} ctas={coachingCtas} onNavigate={props.onNavigate ?? (() => {})} />

        {/* Tip of the day — dismissable, rotates daily (per-device) */}
        <DashboardTipCard lang={lang} dc={dc} isPopout={props.isPopout} />

        {/* Weekly status digest — self-hides until enabled (Settings) + generated */}
        <DigestCardConnected
          lang={lang}
          dc={dc}
          model={model}
          raid={props.raid}
          projectId={props.projectId ?? "default"}
          isPopout={props.isPopout ?? false}
        />

        {/* Tier 1 — hero: Overall RAG band + Adjust-health disclosure */}
        <DashboardHero
          lang={lang}
          today={today}
          model={model}
          status={status}
          setStatus={setStatus}
          showBudget={showBudget}
          showChanges={showChanges}
        />

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
                h={p.h}
                lang={lang}
                readOnly={arrangement.readOnly}
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

        {/* Popout is READ-ONLY: no shelf, no reset, no menu — and the tile
            chrome drops its own grip and ⋮ on the same flag. */}
        {!arrangement.readOnly && (
          <div className="print:hidden">
            <div className="flex justify-end">
              <Button variant="ghost" size="xs" onClick={arrangement.reset}>
                {t(lang, "dashboardResetLayout")}
              </Button>
            </div>
            <DashboardShelf
              lang={lang}
              // flatMap, not map + `!`: `reconcile` drops unknown ids from
              // `hidden`, but a stale id would otherwise throw on the title.
              // ★★ Filtered by `isRenderable`, the SAME predicate the board
              // uses — the shelf must never offer a tile that restoring cannot
              // bring back.
              hidden={layout.hidden.flatMap((id) => {
                const spec = tileById(id);
                return spec && isRenderable(id) ? [{ id, title: t(lang, spec.labelKey) }] : [];
              })}
              onRestore={(id) => { arrangement.restore(id); focusShelfToggle(); }}
              dropProps={shelfDropProps}
              isDragging={reorder.isDragging}
              toggleRef={shelfToggleRef}
            />
          </div>
        )}

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
              h={menuSize.h}
              index={menu.index}
              count={menu.count}
              onResize={(axis, v) => {
                arrangement.resize(menu.id, axis, v);
                // `menuSize` is this render's value, so the axis NOT being set
                // reads correctly as its current one.
                setAnnouncement(t(lang, "dashboardTileResized",
                  t(lang, menuSpec.labelKey),
                  String(axis === "w" ? v : menuSize.w),
                  String(axis === "h" ? v : menuSize.h)));
              }}
              onMove={(delta) => moveByDelta(menu.id, delta)}
              onHide={() => {
                arrangement.hide(menu.id);
                setAnnouncement(t(lang, "dashboardTileHidden", t(lang, menuSpec.labelKey)));
                focusShelfToggle();
              }}
              onClose={closeMenu}
            />
          </PopoverPanel>
        )}

        {/* ★ Not decoration: the ⋮ menu is this surface's keyboard reorder path,
            and without an announcement a keyboard user gets no feedback that
            anything moved, resized or was hidden. */}
        <p role="status" aria-live="polite" className="sr-only">{announcement}</p>

        {/* Tier 3 — folded status-summary editor */}
        <NarrativeEditor lang={lang} status={status} setStatus={setStatus} />
      </div>
    </ReportCard>
  );
}
