"use client";
// Lazily-loaded (ssr:false) workspace view panels, kept off the main bundle.
// Rendered by workspace-section.tsx. Each shows a PanelSkeleton while its chunk
// loads so the first visit to a view shimmers into place instead of flashing
// blank. The fallback is prop-less (no `lang` in this module scope) → decorative.
import dynamic from "next/dynamic";
import { PanelSkeleton } from "./skeleton";
import { useWorkspace } from "./workspace-context";
import { useResizable } from "./use-resizable";
import { VIEW_PANE_RESIZABLE_CLASS } from "./view-styles";
import type { Lang } from "./i18n";

const loading = () => <PanelSkeleton />;

export const ChatPanel = dynamic(
  () => import("./chat-panel").then((m) => m.ChatPanel),
  { ssr: false, loading },
);
export const PortfolioHealthPanel = dynamic(
  () => import("./portfolio-health-panel").then((m) => m.PortfolioHealthPanel),
  { ssr: false, loading },
);
export const GanttView = dynamic(
  () => import("./gantt-view").then((m) => m.GanttView),
  { ssr: false, loading },
);
export const ReportsPanel = dynamic(
  () => import("./reports").then((m) => m.ReportsPanel),
  { ssr: false, loading },
);
export const RaidPanel = dynamic(
  () => import("./raid-panel").then((m) => m.RaidPanel),
  { ssr: false, loading },
);
export const ResourcesPanel = dynamic(
  () => import("./resources-panel").then((m) => m.ResourcesPanel),
  { ssr: false, loading },
);
export const ActivityLogPanel = dynamic(
  () => import("./activity-log-panel").then((m) => m.ActivityLogPanel),
  { ssr: false, loading },
);
export const ResourcesReportPanel = dynamic(
  () => import("./resources-report").then((m) => m.ResourcesReportPanel),
  { ssr: false, loading },
);
export const RaidReportPanel = dynamic(
  () => import("./raid-report-panel").then((m) => m.RaidReportPanel),
  { ssr: false, loading },
);
export const ChangePanel = dynamic(
  () => import("./change-panel").then((m) => m.ChangePanel),
  { ssr: false, loading },
);
export const ChangeReportPanel = dynamic(
  () => import("./change-report-panel").then((m) => m.ChangeReportPanel),
  { ssr: false, loading },
);
export const StakeholdersPanel = dynamic(
  () => import("./stakeholders-panel").then((m) => m.StakeholdersPanel),
  { ssr: false, loading },
);
export const RaciPanel = dynamic(
  () => import("./raci-panel").then((m) => m.RaciPanel),
  { ssr: false, loading },
);
export const StakeholderMapPanel = dynamic(
  () => import("./stakeholder-map-panel").then((m) => m.StakeholderMapPanel),
  { ssr: false, loading },
);
export const BudgetPanel = dynamic(
  () => import("./budget-panel").then((m) => m.BudgetPanel),
  { ssr: false, loading },
);
export const BudgetReportPanel = dynamic(
  () => import("./budget-report-panel").then((m) => m.BudgetReportPanel),
  { ssr: false, loading },
);
export const TrendsPanel = dynamic(
  () => import("./trends-panel").then((m) => m.TrendsPanel),
  { ssr: false, loading },
);
export const HistoryPanel = dynamic(
  () => import("./history-panel").then((m) => m.HistoryPanel),
  { ssr: false, loading },
);
export const ProjectsPanel = dynamic(
  () => import("./projects-panel").then((m) => m.ProjectsPanel),
  { ssr: false, loading },
);
export const ActionsPanel = dynamic(
  () => import("./actions-panel").then((m) => m.ActionsPanel),
  { ssr: false, loading },
);
export const InsightsPanel = dynamic(
  () => import("./insights-panel").then((m) => m.InsightsPanel),
  { ssr: false, loading },
);
export const KnowledgePanel = dynamic(
  () => import("./knowledge-panel").then((m) => m.KnowledgePanel),
  { ssr: false, loading },
);
export const TimelogPanel = dynamic(
  () => import("./timelog-panel").then((m) => m.TimelogPanel),
  { ssr: false, loading },
);
const DocumentsPanelLazy = dynamic(
  () => import("./documents-panel").then((m) => m.DocumentsPanel),
  { ssr: false, loading },
);

/** The Documents tabpanel, state and all.
 *
 *  ★ It owns its own `useWorkspace()` read rather than taking threaded props so
 *  the view router in workspace-section.tsx stays ONE line — that file is a
 *  baselined 963 in the size ratchet, and a per-view render block there costs
 *  ~20 lines of irreducible growth. Reading context here is free: this subtree
 *  is not memoized (the memo caveat applies to `ResourcesPanel` alone).
 *
 *  ★★ The whole context value is passed as `ws` deliberately. It is structurally
 *  a SUPERSET of `Workspace`, and the preview resolves `dataSection` blocks
 *  against every key in `EXPORT_SECTION_KEYS` — so hand-assembling an object
 *  here would be a second place to remember a new slice, failing SILENTLY as an
 *  empty section. Passing the context carries a new slice for free. */
export function DocumentsTabPanel({
  className,
  lang,
  isPopout,
}: {
  className: string;
  lang: Lang;
  isPopout: boolean;
}) {
  const ws = useWorkspace();
  // ★★ The RESIZABLE PANE, and the reason the reset-size control is not a lie.
  // The toolbar has always drawn one, but `onResetSize` was optional, the panel
  // fell back to a no-op, and this call site never passed it — so the button
  // was inert AND there was nothing resizable behind it. The pane lives HERE
  // rather than inside the lazy panel so the storage key and the reset handler
  // are minted at the same level as every other view's (Knowledge, Insights,
  // History all render this exact `print-root + VIEW_PANE_RESIZABLE_CLASS` div
  // inside their tabpanel wrapper). ★ The key is `documents-pane-size`, NOT
  // `documents-size-full` — that one is already taken by knowledge-panel.tsx,
  // whose feature was called "Documents" before the Knowledge rename.
  const { ref: paneRef, reset: resetPaneSize } = useResizable("aipm-cockpit:documents-pane-size");
  return (
    <div id="panel-documents" role="tabpanel" className={className}>
      <div ref={paneRef} className={`print-root ${VIEW_PANE_RESIZABLE_CLASS}`}>
        {/* ★★ `isReadOnly` is what makes the popout guard live, and
            `onResetSize` is what makes the reset control live. The panel's own
            tests cannot catch either being dropped here — they render the
            component directly and supply the props themselves, so an unpassed
            prop is invisible to every one of them. Pinned instead by the
            WIRING-level test in workspace-panels.documents.test.tsx
            (mutation-proved: drop a line and its cases go red). */}
        <DocumentsPanelLazy
          lang={lang}
          documents={ws.documents}
          setDocuments={ws.setDocuments}
          ws={ws}
          isReadOnly={isPopout}
          onResetSize={resetPaneSize}
        />
      </div>
    </div>
  );
}
