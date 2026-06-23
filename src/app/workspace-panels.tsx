"use client";
// Lazily-loaded (ssr:false) workspace view panels, kept off the main bundle.
// Rendered by workspace-section.tsx. Each shows a PanelSkeleton while its chunk
// loads so the first visit to a view shimmers into place instead of flashing
// blank. The fallback is prop-less (no `lang` in this module scope) → decorative.
import dynamic from "next/dynamic";
import { PanelSkeleton } from "./skeleton";

const loading = () => <PanelSkeleton />;

export const ChatPanel = dynamic(
  () => import("./chat-panel").then((m) => m.ChatPanel),
  { ssr: false, loading },
);
export const GanttPanel = dynamic(
  () => import("./gantt").then((m) => m.GanttPanel),
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
export const DocumentsPanel = dynamic(
  () => import("./documents-panel").then((m) => m.DocumentsPanel),
  { ssr: false, loading },
);
