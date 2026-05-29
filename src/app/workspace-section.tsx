"use client";
import dynamic from "next/dynamic";
import type React from "react";
import { t } from "./i18n";
import { openPopoutWindow } from "./broadcast-sync";
import { useSettings } from "./use-settings";
import { useWorkspace } from "./workspace-context";
import { useWorkspaceTab } from "./workspace-tab-context";
import { useFilters } from "./filters-context";
import { TabButton, ResetSizeIcon } from "./task-manager-ui";
import type { ToolDispatcher } from "./chat-tools";
import type { ActivityEntry } from "./activity-log";
import type { Absence, BudgetBucket, RaidItem, Resource, Shift, Task } from "./types";
import { ResourceDirectory } from "./resource-directory";

const ChatPanel = dynamic(
  () => import("./chat-panel").then((m) => m.ChatPanel),
  { ssr: false },
);
const GanttPanel = dynamic(
  () => import("./gantt").then((m) => m.GanttPanel),
  { ssr: false },
);
const ReportsPanel = dynamic(
  () => import("./reports").then((m) => m.ReportsPanel),
  { ssr: false },
);
const RaidPanel = dynamic(
  () => import("./raid-panel").then((m) => m.RaidPanel),
  { ssr: false },
);
const ResourcesPanel = dynamic(
  () => import("./resources-panel").then((m) => m.ResourcesPanel),
  { ssr: false },
);
const ActivityLogPanel = dynamic(
  () => import("./activity-log-panel").then((m) => m.ActivityLogPanel),
  { ssr: false },
);
const ResourcesReportPanel = dynamic(
  () => import("./resources-report").then((m) => m.ResourcesReportPanel),
  { ssr: false },
);
const RaidReportPanel = dynamic(
  () => import("./raid-report-panel").then((m) => m.RaidReportPanel),
  { ssr: false },
);
const BudgetPanel = dynamic(
  () => import("./budget-panel").then((m) => m.BudgetPanel),
  { ssr: false },
);

export interface WorkspaceSectionProps {
  today: string;
  holidaySet: Set<string>;
  workspaceRef: React.RefObject<HTMLElement | null>;
  resetWorkspaceSize: () => void;
  workspaceCollapsed: boolean;
  setWorkspaceCollapsed: React.Dispatch<React.SetStateAction<boolean>>;
  dispatcher: ToolDispatcher;
  handleAcceptAiConsent: () => void;
  handleGanttBarUpdate: (edit: {
    taskId: number;
    startDate: string;
    dueDate: string;
  }) => void;
  handleCancelEdit: () => void;
  setTaskModalOpen: React.Dispatch<React.SetStateAction<boolean>>;
  handleClearRaidTaskFilter: () => void;
  handleSaveRaidItem: (item: RaidItem) => void;
  handleDeleteRaidItem: (id: number) => void;
  handleCreateMitigationTaskFromRaid: (raidId: number) => number | null | undefined;
  handleJumpToTaskFromRaid: (taskId: number) => void;
  activityLog: ActivityEntry[];
  handleClearActivityLog: () => void;
  handleOpenAddAbsence: () => void;
  handleEditAbsence: (absence: Absence) => void;
  handleOpenShiftEditor: (
    existingShift: Shift | null,
    assignee: { display: string; email: string },
  ) => void;
  onManageRoles: () => void;
  onAssignRole: (resourceId: number, disciplineId: number, gradeId: number) => void;
  onSetUtilization: (resourceId: number, periodKey: string, value: number) => void;
  onSetAllUtilizationMode: (mode: "percent" | "hours") => void;
  onSetAbsenceOverride: (resourceId: number, periodKey: string, hours: number | null) => void;
  onSetPlanWindow: (startDate: string, endDate: string) => void;
  onEditResource: (resource: Resource) => void;
  onAddResource: (seed?: Partial<Resource>) => void;
  onImportOutlook?: () => void;
  onEditTask?: (task: Task) => void;
  onChangeBudgets: (next: BudgetBucket[]) => void;
  onRefreshFx: () => void;
  fxLoading?: boolean;
}

export function WorkspaceSection({
  today,
  holidaySet,
  workspaceRef,
  resetWorkspaceSize,
  workspaceCollapsed,
  setWorkspaceCollapsed,
  dispatcher,
  handleAcceptAiConsent,
  handleGanttBarUpdate,
  handleCancelEdit,
  setTaskModalOpen,
  handleClearRaidTaskFilter,
  handleSaveRaidItem,
  handleDeleteRaidItem,
  handleCreateMitigationTaskFromRaid,
  handleJumpToTaskFromRaid,
  activityLog,
  handleClearActivityLog,
  handleOpenAddAbsence,
  handleEditAbsence,
  handleOpenShiftEditor,
  onManageRoles,
  onAssignRole,
  onSetUtilization,
  onSetAllUtilizationMode,
  onSetAbsenceOverride,
  onSetPlanWindow,
  onEditResource,
  onAddResource,
  onImportOutlook,
  onEditTask,
  onChangeBudgets,
  onRefreshFx,
  fxLoading = false,
}: WorkspaceSectionProps) {
  const { settings, lang } = useSettings();
  const { tasks, raid, absences, shifts, resources, roles, disciplines, grades, plan, budgets, fxRates } = useWorkspace();
  const { activeTab, setActiveTab, isPopout } = useWorkspaceTab();
  const { raidFilterTaskId } = useFilters();

  return (
    <section
      ref={workspaceRef}
      className={
        isPopout
          ? "flex min-h-0 w-full flex-1 flex-col overflow-hidden rounded-xl border border-line bg-surface p-6"
          : workspaceCollapsed
          ? "mb-10 flex w-full flex-col rounded-xl border border-line bg-surface p-6"
          : "relative mb-10 flex h-[560px] min-h-[420px] w-full min-w-[520px] resize flex-col overflow-hidden rounded-xl border border-line bg-surface p-6"
      }
    >
      {!isPopout && (
        <div
          role="tablist"
          aria-label="Workspace tabs"
          className={
            workspaceCollapsed
              ? "-mx-2 -mt-2 flex shrink-0 items-end gap-1 px-2"
              : "-mx-2 -mt-2 flex shrink-0 items-end gap-1 border-b border-line px-2"
          }
        >
          <TabButton
            active={activeTab === "chat"}
            onClick={() => {
              setActiveTab("chat");
              if (workspaceCollapsed) setWorkspaceCollapsed(false);
            }}
            controls="panel-chat"
            onPopout={() => openPopoutWindow("chat", settings.popout.reuseWindow)}
            popoutLabel={t(lang, "popoutOpenInNewWindow")}
          >
            {t(lang, "tabChat")}
          </TabButton>
          <TabButton
            active={activeTab === "reports"}
            onClick={() => {
              setActiveTab("reports");
              if (workspaceCollapsed) setWorkspaceCollapsed(false);
            }}
            controls="panel-reports"
            onPopout={() => openPopoutWindow("reports", settings.popout.reuseWindow)}
            popoutLabel={t(lang, "popoutOpenInNewWindow")}
          >
            {t(lang, "tabReports")}
          </TabButton>
          <TabButton
            active={activeTab === "gantt"}
            onClick={() => {
              setActiveTab("gantt");
              if (workspaceCollapsed) setWorkspaceCollapsed(false);
            }}
            controls="panel-gantt"
            onPopout={() => openPopoutWindow("gantt", settings.popout.reuseWindow)}
            popoutLabel={t(lang, "popoutOpenInNewWindow")}
          >
            {t(lang, "tabGantt")}
          </TabButton>
          <TabButton
            active={activeTab === "raid"}
            onClick={() => {
              setActiveTab("raid");
              handleClearRaidTaskFilter();
              if (workspaceCollapsed) setWorkspaceCollapsed(false);
            }}
            controls="panel-raid"
            onPopout={() => openPopoutWindow("raid", settings.popout.reuseWindow)}
            popoutLabel={t(lang, "popoutOpenInNewWindow")}
          >
            {t(lang, "tabRaid")}
          </TabButton>
          <TabButton
            active={activeTab === "resources"}
            onClick={() => {
              setActiveTab("resources");
              if (workspaceCollapsed) setWorkspaceCollapsed(false);
            }}
            controls="panel-resources"
            onPopout={() => openPopoutWindow("resources", settings.popout.reuseWindow)}
            popoutLabel={t(lang, "popoutOpenInNewWindow")}
          >
            {t(lang, "tabResources")}
          </TabButton>
          <TabButton
            active={activeTab === "budget"}
            onClick={() => {
              setActiveTab("budget");
              if (workspaceCollapsed) setWorkspaceCollapsed(false);
            }}
            controls="panel-budget"
            onPopout={() => openPopoutWindow("budget", settings.popout.reuseWindow)}
            popoutLabel={t(lang, "popoutOpenInNewWindow")}
          >
            {t(lang, "tabBudget")}
          </TabButton>
          <TabButton
            active={activeTab === "activity"}
            onClick={() => {
              setActiveTab("activity");
              if (workspaceCollapsed) setWorkspaceCollapsed(false);
            }}
            controls="panel-activity"
            onPopout={() => openPopoutWindow("activity", settings.popout.reuseWindow)}
            popoutLabel={t(lang, "popoutOpenInNewWindow")}
          >
            {t(lang, "tabActivity")}
          </TabButton>
          {!workspaceCollapsed && (
            <button
              type="button"
              onClick={resetWorkspaceSize}
              aria-label={t(lang, "tableResetSizeHint")}
              title={t(lang, "tableResetSizeHint")}
              className="ml-auto mb-1 rounded-md border border-line bg-surface p-1.5 text-muted-foreground hover:bg-surface-muted hover:text-foreground"
            >
              <ResetSizeIcon />
            </button>
          )}
          <button
            type="button"
            onClick={() => setWorkspaceCollapsed((v) => !v)}
            aria-expanded={!workspaceCollapsed}
            aria-controls="workspace-panels"
            title={
              workspaceCollapsed
                ? t(lang, "workspaceExpand")
                : t(lang, "workspaceCollapse")
            }
            className={
              workspaceCollapsed
                ? "ml-auto mb-1 rounded-md p-1.5 text-foreground hover:bg-surface-muted hover:text-AIPM-dark-blue"
                : "mb-1 rounded-md p-1.5 text-foreground hover:bg-surface-muted hover:text-AIPM-dark-blue"
            }
          >
            <svg
              viewBox="0 0 20 20"
              fill="currentColor"
              aria-hidden="true"
              className={`h-4 w-4 transition-transform ${workspaceCollapsed ? "rotate-180" : ""}`}
            >
              <path
                fillRule="evenodd"
                d="M14.78 12.78a.75.75 0 01-1.06 0L10 9.06l-3.72 3.72a.75.75 0 11-1.06-1.06l4.25-4.25a.75.75 0 011.06 0l4.25 4.25a.75.75 0 010 1.06z"
                clipRule="evenodd"
              />
            </svg>
          </button>
        </div>
      )}

      <div
        id="workspace-panels"
        hidden={!isPopout && workspaceCollapsed}
        className="flex min-h-0 flex-1 flex-col"
      >
        <div
          id="panel-chat"
          role="tabpanel"
          hidden={activeTab !== "chat"}
          className="min-h-0 flex-1 pt-4"
        >
          <ChatPanel
            lang={lang}
            ai={settings.ai}
            dispatcher={dispatcher}
            onAcceptConsent={handleAcceptAiConsent}
          />
        </div>

        {activeTab === "reports" && (
          <div
            id="panel-reports"
            role="tabpanel"
            className="min-h-0 flex-1 overflow-y-auto pt-4"
          >
            <ReportsPanel
              tasks={tasks}
              today={today}
              holidaySet={holidaySet}
              lang={lang}
            />
          </div>
        )}

        {activeTab === "gantt" && (
          <div
            id="panel-gantt"
            role="tabpanel"
            className="min-h-0 flex-1 pt-4"
          >
            <GanttPanel
              lang={lang}
              tasks={tasks}
              absences={absences}
              onUpdateBar={handleGanttBarUpdate}
              onAddTask={isPopout ? undefined : () => {
                handleCancelEdit();
                setTaskModalOpen(true);
              }}
              onEditTask={isPopout ? undefined : onEditTask}
            />
          </div>
        )}

        <div
          id="panel-raid"
          role="tabpanel"
          hidden={activeTab !== "raid"}
          className="min-h-0 flex-1 pt-4"
        >
          <RaidPanel
            lang={lang}
            tasks={tasks}
            raid={raid}
            today={today}
            filterTaskId={raidFilterTaskId}
            onClearTaskFilter={handleClearRaidTaskFilter}
            onSave={handleSaveRaidItem}
            onDelete={handleDeleteRaidItem}
            onCreateMitigationTask={handleCreateMitigationTaskFromRaid}
            onJumpToTask={handleJumpToTaskFromRaid}
            onOpenReport={() => openPopoutWindow("raid-report", settings.popout.reuseWindow)}
          />
        </div>

        {activeTab === "resources" && (
          <div
            id="panel-resources"
            role="tabpanel"
            className="min-h-0 flex-1 pt-4"
          >
            <ResourcesPanel
              lang={lang}
              tasks={tasks}
              absences={absences}
              shifts={shifts}
              resources={resources}
              today={today}
              holidaySet={holidaySet}
              onAddAbsence={handleOpenAddAbsence}
              onEditAbsence={handleEditAbsence}
              onEditShift={handleOpenShiftEditor}
              roles={roles}
              disciplines={disciplines}
              grades={grades}
              onManageRoles={onManageRoles}
              onAssignRole={onAssignRole}
              plan={plan}
              workdayHours={settings.resources.workdayHours}
              onSetUtilization={onSetUtilization}
              onSetAllUtilizationMode={onSetAllUtilizationMode}
              onSetAbsenceOverride={onSetAbsenceOverride}
              onSetPlanWindow={onSetPlanWindow}
              onOpenReport={() => openPopoutWindow("resource-report", settings.popout.reuseWindow)}
              onOpenAddressBook={() => openPopoutWindow("address-book", settings.popout.reuseWindow)}
              onImportOutlook={onImportOutlook}
              onEditResource={onEditResource}
              onAddResource={onAddResource}
            />
          </div>
        )}

        {activeTab === "activity" && (
          <div
            id="panel-activity"
            role="tabpanel"
            className="min-h-0 flex-1 pt-4"
          >
            <ActivityLogPanel
              lang={lang}
              entries={activityLog}
              onClear={handleClearActivityLog}
            />
          </div>
        )}

        {activeTab === "resource-report" && (
          <div id="panel-resource-report" role="tabpanel" className="min-h-0 flex-1 overflow-y-auto pt-4">
            <ResourcesReportPanel
              lang={lang} resources={resources} roles={roles} disciplines={disciplines}
              grades={grades} plan={plan} absences={absences} holidaySet={holidaySet}
              workdayHours={settings.resources.workdayHours} />
          </div>
        )}

        {activeTab === "raid-report" && (
          <div id="panel-raid-report" role="tabpanel" className="min-h-0 flex-1 overflow-y-auto pt-4">
            <RaidReportPanel lang={lang} items={raid} today={today} />
          </div>
        )}

        {activeTab === "budget" && (
          <div id="panel-budget" role="tabpanel" className="min-h-0 flex-1 overflow-y-auto pt-4">
            <BudgetPanel
              lang={lang}
              buckets={budgets}
              roles={roles}
              disciplines={disciplines}
              grades={grades}
              resources={resources}
              plan={plan}
              fxRates={fxRates}
              absences={absences}
              holidaySet={holidaySet}
              workdayHours={settings.resources.workdayHours}
              today={today}
              onChangeBuckets={onChangeBudgets}
              onRefreshFx={onRefreshFx}
              fxLoading={fxLoading}
            />
          </div>
        )}

        {activeTab === "address-book" && (
          <div id="panel-address-book" role="tabpanel" className="min-h-0 flex-1 overflow-y-auto pt-4">
            <ResourceDirectory
              lang={lang}
              resources={resources}
              roles={roles}
              disciplines={disciplines}
              grades={grades}
              onAssignRole={onAssignRole}
              onEditResource={onEditResource}
              onAddResource={onAddResource}
            />
          </div>
        )}
      </div>
      {!isPopout && !workspaceCollapsed && (
        <span
          aria-hidden={true}
          title={t(lang, "workspaceResizeHint")}
          className="pointer-events-none absolute bottom-1 right-1 select-none text-muted-foreground"
        >
          ⠿
        </span>
      )}
    </section>
  );
}
