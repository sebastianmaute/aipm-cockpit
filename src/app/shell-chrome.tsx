// src/app/shell-chrome.tsx
//
// Builds the two header mounts — the classic `AppHeader` element (`appHeaderEl`)
// and the modern TopBar's trailing `topBarMenus` slot — from ONE input set, so
// the "wire BOTH headers or the control is invisible in one layout" landmine is
// structural: a control added here appears in classic AND modern automatically.
// Extracted from task-manager (move-only); returns JSX elements, hence `.tsx`.
// The session display-timezone switcher (`displayTzSwitcherEl`) is internal —
// it is shared by both mounts here, matching the former inline behavior.
import { type ReactNode } from "react";
import type { Lang } from "./i18n";
import type { AppView } from "./nav-config";
import type { ProjectTemplate, SaveTemplateInput } from "./templates";
import { AppHeader, type AppHeaderProps } from "./app-header";
import { ActionMenus } from "./action-menus";
import { GlobalSearchConnected } from "./global-search-box";
import { DisplayTzSwitcher } from "./display-tz-switcher";
import { useDisplayTimezone } from "./display-timezone-context";
import { defaultExportConfig } from "./settings-types";

function DisplayTzSwitcherConnected({ lang, additionalTimezones }: { lang: Lang; additionalTimezones: readonly string[] }) {
  const ctx = useDisplayTimezone();
  return <DisplayTzSwitcher lang={lang} ctx={ctx} additionalTimezones={additionalTimezones} />;
}

/** Live render-scope values the dual-header assembly reads each render. */
export interface ShellChromeDeps {
  // pass-through to AppHeader (names/types taken from AppHeaderProps)
  handleCancelEdit: AppHeaderProps["handleCancelEdit"];
  setTaskModalOpen: AppHeaderProps["setTaskModalOpen"];
  showToast: AppHeaderProps["showToast"];
  handleCommand: AppHeaderProps["handleCommand"];
  storageDescription: AppHeaderProps["storageDescription"];
  storageOk: AppHeaderProps["storageReady"];
  onPickStorageFile: AppHeaderProps["onPickStorageFile"];
  onOpenStorageFile: AppHeaderProps["onOpenStorageFile"];
  onGrantWriteAccess: AppHeaderProps["onGrantStorageWrite"];
  onRequestStorageSwitch: AppHeaderProps["onRequestStorageSwitch"];
  setSettings: AppHeaderProps["setSettings"];
  settings: AppHeaderProps["settings"];
  projectSwitcher: AppHeaderProps["projectSwitcher"];
  // values
  lang: Lang;
  activeTab: AppView;
  nowCount: number;
  // raw pieces the former inline arrows referenced
  setActiveTab: (view: AppView) => void;
  migrateCurrentProjectToTurso: () => void | Promise<void>;
  openPopoutWindow: (view: "chat", reuse: boolean) => void;
  requestChat: (prompt: string, autoSend: boolean) => void;
  // ActionMenus (topBarMenus) specifics
  projectTemplates: readonly ProjectTemplate[];
  handleSaveTemplate: (input: SaveTemplateInput) => void;
  handleApplyTemplate: (id: string, opts: { includeSeed: boolean }) => void;
}

// NOT a hook — a plain builder that returns render output (JSX). It calls no
// React hooks in its body (DisplayTzSwitcherConnected calls useDisplayTimezone
// when IT renders, not here), so it is safely called after task-manager's
// `!i18nReady` early return, where render prep belongs.
export function buildShellChrome(deps: ShellChromeDeps): { appHeaderEl: ReactNode; topBarMenus: ReactNode } {
  const {
    handleCancelEdit,
    setTaskModalOpen,
    showToast,
    handleCommand,
    storageDescription,
    storageOk,
    onPickStorageFile,
    onOpenStorageFile,
    onGrantWriteAccess,
    onRequestStorageSwitch,
    setSettings,
    settings,
    projectSwitcher,
    lang,
    activeTab,
    nowCount,
    setActiveTab,
    migrateCurrentProjectToTurso,
    openPopoutWindow,
    requestChat,
    projectTemplates,
    handleSaveTemplate,
    handleApplyTemplate,
  } = deps;

  // Session display-timezone switcher. Sits in both header sites alongside the
  // Ask-Claude pill (dual-header rule); never in popouts (they have no header).
  const displayTzSwitcherEl = settings.showDisplayTzSwitcher ? (
    <DisplayTzSwitcherConnected lang={lang} additionalTimezones={settings.additionalTimezones ?? []} />
  ) : null;

  const topBarMenus = (
    <>
      {displayTzSwitcherEl}
      <ActionMenus
        lang={lang}
        onCommand={handleCommand}
        onVoiceError={(msg) => showToast("error", msg)}
        exportConfig={settings.export ?? defaultExportConfig}
        templates={projectTemplates}
        onSaveTemplate={handleSaveTemplate}
        onApplyTemplate={handleApplyTemplate}
        expertMode={settings.expertMode}
      />
    </>
  );

  const appHeaderEl = (
    <AppHeader
      handleCancelEdit={handleCancelEdit}
      setTaskModalOpen={setTaskModalOpen}
      bannerCount={nowCount}
      onShowAlerts={() => setActiveTab("actions")}
      showToast={showToast}
      handleCommand={handleCommand}
      storageDescription={storageDescription}
      storageReady={storageOk}
      onPickStorageFile={onPickStorageFile}
      onOpenStorageFile={onOpenStorageFile}
      onGrantStorageWrite={onGrantWriteAccess}
      onRequestStorageSwitch={onRequestStorageSwitch}
      onMigrateToTurso={() => { void migrateCurrentProjectToTurso(); }}
      settings={settings}
      setSettings={setSettings}
      lang={lang}
      onOpenAiAssistant={() => openPopoutWindow("chat", settings.popout.reuseWindow)}
      currentView={activeTab}
      onAskClaude={(body) => requestChat(body, true)}
      projectSwitcher={projectSwitcher}
      trailing={
        <div className="flex items-center gap-2">
          <GlobalSearchConnected lang={lang} />
          {displayTzSwitcherEl}
        </div>
      }
    />
  );

  return { appHeaderEl, topBarMenus };
}
