"use client";
// Lazily-loaded (ssr:false) workspace view panels, kept off the main bundle.
// Rendered by workspace-section.tsx.
import dynamic from "next/dynamic";

export const ChatPanel = dynamic(
  () => import("./chat-panel").then((m) => m.ChatPanel),
  { ssr: false },
);
export const GanttPanel = dynamic(
  () => import("./gantt").then((m) => m.GanttPanel),
  { ssr: false },
);
export const ReportsPanel = dynamic(
  () => import("./reports").then((m) => m.ReportsPanel),
  { ssr: false },
);
export const RaidPanel = dynamic(
  () => import("./raid-panel").then((m) => m.RaidPanel),
  { ssr: false },
);
export const ResourcesPanel = dynamic(
  () => import("./resources-panel").then((m) => m.ResourcesPanel),
  { ssr: false },
);
export const ActivityLogPanel = dynamic(
  () => import("./activity-log-panel").then((m) => m.ActivityLogPanel),
  { ssr: false },
);
export const ResourcesReportPanel = dynamic(
  () => import("./resources-report").then((m) => m.ResourcesReportPanel),
  { ssr: false },
);
export const RaidReportPanel = dynamic(
  () => import("./raid-report-panel").then((m) => m.RaidReportPanel),
  { ssr: false },
);
export const ChangePanel = dynamic(
  () => import("./change-panel").then((m) => m.ChangePanel),
  { ssr: false },
);
export const ChangeReportPanel = dynamic(
  () => import("./change-report-panel").then((m) => m.ChangeReportPanel),
  { ssr: false },
);
export const StakeholdersPanel = dynamic(
  () => import("./stakeholders-panel").then((m) => m.StakeholdersPanel),
  { ssr: false },
);
export const RaciPanel = dynamic(
  () => import("./raci-panel").then((m) => m.RaciPanel),
  { ssr: false },
);
export const StakeholderMapPanel = dynamic(
  () => import("./stakeholder-map-panel").then((m) => m.StakeholderMapPanel),
  { ssr: false },
);
export const BudgetPanel = dynamic(
  () => import("./budget-panel").then((m) => m.BudgetPanel),
  { ssr: false },
);
export const BudgetReportPanel = dynamic(
  () => import("./budget-report-panel").then((m) => m.BudgetReportPanel),
  { ssr: false },
);
export const TrendsPanel = dynamic(
  () => import("./trends-panel").then((m) => m.TrendsPanel),
  { ssr: false },
);
export const HistoryPanel = dynamic(
  () => import("./history-panel").then((m) => m.HistoryPanel),
  { ssr: false },
);
export const ProjectsPanel = dynamic(
  () => import("./projects-panel").then((m) => m.ProjectsPanel),
  { ssr: false },
);
export const ActionsPanel = dynamic(
  () => import("./actions-panel").then((m) => m.ActionsPanel),
  { ssr: false },
);
export const DocumentsPanel = dynamic(
  () => import("./documents-panel").then((m) => m.DocumentsPanel),
  { ssr: false },
);
