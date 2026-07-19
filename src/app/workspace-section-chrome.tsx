// src/app/workspace-section-chrome.tsx
//
// Presentational chrome extracted from workspace-section (move-only): the two
// tab-navigation strips (primary tablist + sub-tablist) plus the resize handle.
// workspace-section.tsx keeps the view-routing tabpanel switch; this file holds
// the surrounding chrome so the router file stays focused on routing.
//
// Both strips are gated by the parent on `!isPopout && !fullBleed`; the parent
// renders <WorkspaceTabStrip> only in that mode, matching the former inline
// guards exactly. The component reproduces the prior markup verbatim.
import type React from "react";
import { ChevronDownIcon } from "@heroicons/react/24/outline";
import { t } from "./i18n";
import { openPopoutWindow } from "./broadcast-sync";
import { TabButton, ResetSizeButton } from "./task-manager-ui";
import { useTablistRoving } from "./use-tablist-roving";
import { navLabelKey } from "./nav-config";
import { isModuleEnabled } from "./feature-modules";
import type { Lang } from "./i18n";
import type { AppView } from "./nav-config";
import type { FeatureModuleId } from "./feature-modules";

interface SubTab {
  view: AppView;
}

export interface WorkspaceTabStripProps {
  lang: Lang;
  activeTab: AppView;
  setActiveTab: (view: AppView) => void;
  workspaceCollapsed: boolean;
  setWorkspaceCollapsed: React.Dispatch<React.SetStateAction<boolean>>;
  resetWorkspaceSize: () => void;
  features: readonly FeatureModuleId[];
  reuseWindow: boolean;
  handleClearRaidTaskFilter: () => void;
  subTabs: readonly SubTab[];
}

export function WorkspaceTabStrip({
  lang,
  activeTab,
  setActiveTab,
  workspaceCollapsed,
  setWorkspaceCollapsed,
  resetWorkspaceSize,
  features,
  reuseWindow,
  handleClearRaidTaskFilter,
  subTabs,
}: WorkspaceTabStripProps) {
  const roving = useTablistRoving();
  return (
    <>
      <div
        role="tablist"
        aria-label="Workspace tabs"
        onKeyDown={roving}
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
          onPopout={() => openPopoutWindow("chat", reuseWindow)}
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
          onPopout={() => openPopoutWindow("reports", reuseWindow)}
          popoutLabel={t(lang, "popoutOpenInNewWindow")}
        >
          {t(lang, "tabReports")}
        </TabButton>
        {isModuleEnabled("gantt", features) && (
          <TabButton
            active={activeTab === "gantt"}
            onClick={() => {
              setActiveTab("gantt");
              if (workspaceCollapsed) setWorkspaceCollapsed(false);
            }}
            controls="panel-gantt"
            onPopout={() => openPopoutWindow("gantt", reuseWindow)}
            popoutLabel={t(lang, "popoutOpenInNewWindow")}
          >
            {t(lang, "tabGantt")}
          </TabButton>
        )}
        {isModuleEnabled("raid", features) && (
          <TabButton
            active={activeTab === "raid"}
            onClick={() => {
              setActiveTab("raid");
              handleClearRaidTaskFilter();
              if (workspaceCollapsed) setWorkspaceCollapsed(false);
            }}
            controls="panel-raid"
            onPopout={() => openPopoutWindow("raid", reuseWindow)}
            popoutLabel={t(lang, "popoutOpenInNewWindow")}
          >
            {t(lang, "tabRaid")}
          </TabButton>
        )}
        {isModuleEnabled("resources", features) && (
          <TabButton
            active={activeTab === "resources"}
            onClick={() => {
              setActiveTab("resources");
              if (workspaceCollapsed) setWorkspaceCollapsed(false);
            }}
            controls="panel-resources"
            onPopout={() => openPopoutWindow("resources", reuseWindow)}
            popoutLabel={t(lang, "popoutOpenInNewWindow")}
          >
            {t(lang, "tabResources")}
          </TabButton>
        )}
        {isModuleEnabled("budget", features) && (
          <TabButton
            active={activeTab === "budget"}
            onClick={() => {
              setActiveTab("budget");
              if (workspaceCollapsed) setWorkspaceCollapsed(false);
            }}
            controls="panel-budget"
            onPopout={() => openPopoutWindow("budget", reuseWindow)}
            popoutLabel={t(lang, "popoutOpenInNewWindow")}
          >
            {t(lang, "tabBudget")}
          </TabButton>
        )}
        <TabButton
          active={activeTab === "activity"}
          onClick={() => {
            setActiveTab("activity");
            if (workspaceCollapsed) setWorkspaceCollapsed(false);
          }}
          controls="panel-activity"
          onPopout={() => openPopoutWindow("activity", reuseWindow)}
          popoutLabel={t(lang, "popoutOpenInNewWindow")}
        >
          {t(lang, "tabActivity")}
        </TabButton>
        {!workspaceCollapsed && (
          <ResetSizeButton
            onClick={resetWorkspaceSize}
            lang={lang}
            className="ml-auto mb-1"
          />
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
              ? "ml-auto mb-1 rounded-md p-1.5 text-foreground hover:bg-surface-muted hover:text-ui-dark-blue"
              : "mb-1 rounded-md p-1.5 text-foreground hover:bg-surface-muted hover:text-ui-dark-blue"
          }
        >
          <ChevronDownIcon
            aria-hidden="true"
            className={`h-4 w-4 transition-transform ${workspaceCollapsed ? "rotate-180" : ""}`}
          />
        </button>
      </div>

      {subTabs.length > 0 && (
        <div
          role="tablist"
          aria-label="Workspace sub-tabs"
          onKeyDown={roving}
          className="mb-2 flex flex-wrap items-center gap-1 border-b border-line pb-1"
        >
          {subTabs.map((child) => (
            <TabButton
              key={child.view}
              active={activeTab === child.view}
              onClick={() => {
                setActiveTab(child.view);
                if (workspaceCollapsed) setWorkspaceCollapsed(false);
              }}
              controls={`panel-${child.view}`}
            >
              {t(lang, navLabelKey(child.view))}
            </TabButton>
          ))}
        </div>
      )}
    </>
  );
}
