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
import { aiAssistantOpener, defaultExportConfig, exportFooterText, isAiEnabled } from "./settings-types";

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
  /** EFFECTIVE additional timezones (device list folded with the active
   *  project's timezone override) for the display-tz switcher options. Passed
   *  explicitly so `settings` (forwarded wholesale to AppHeader) stays device. */
  additionalTimezones: readonly string[];
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
  /** Top-bar undo control (or null in popouts / empty stack). Placed in BOTH
   *  header mounts so it can't go missing in one layout. */
  undoControl: ReactNode;
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
    additionalTimezones,
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
    undoControl,
  } = deps;

  // Session display-timezone switcher. Sits in both header sites alongside the
  // Ask-Claude pill (dual-header rule); never in popouts (they have no header).
  const displayTzSwitcherEl = settings.showDisplayTzSwitcher ? (
    <DisplayTzSwitcherConnected lang={lang} additionalTimezones={additionalTimezones} />
  ) : null;

  const topBarMenus = (
    <>
      {undoControl}
      {displayTzSwitcherEl}
      <ActionMenus
        lang={lang}
        onCommand={handleCommand}
        onVoiceError={(msg) => showToast("error", msg)}
        exportConfig={settings.export ?? defaultExportConfig}
        exportFooter={exportFooterText(settings.branding)}
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
      onOpenAiAssistant={aiAssistantOpener(settings.ai, () => openPopoutWindow("chat", settings.popout.reuseWindow))}
      currentView={activeTab}
      onAskClaude={isAiEnabled(settings.ai) ? (body) => requestChat(body, true) : undefined}
      projectSwitcher={projectSwitcher}
      trailing={
        // §618 — no `min-w-0` here on purpose. The search wrapper below
        // already carries its own `min-w-0 lg:min-w-56`, which zeroes its
        // contribution to THIS row's automatic minimum regardless of
        // whether the row itself can shrink — measured: removing this row's
        // `min-w-0` (M2) still produces no overflow at 1024/1100 even with
        // both other trailing siblings mounted (the tz switcher AND a
        // populated undo stack, e2e/classic-header-fit.spec.ts's "every
        // sibling present" suite). A `min-w-0` here would be a no-op, not a
        // second load-bearing link in the shrink chain — see the app-header
        // column's own `min-w-0` (app-header.tsx) for the one that matters.
        <div className="flex items-center gap-2">
          {/* §618 — a DEFINITE lg:w-96 is the preferred width and the flex
              basis; lg:min-w-56 is the floor it shrinks to. Not the modern
              mount's w-auto + basis: this row is content-sized, and max-content
              ignores flex-basis (measured: ~209px at 1600). */}
          <div className="min-w-0 w-44 max-w-[55vw] sm:w-72 lg:w-96 lg:min-w-56">
            <GlobalSearchConnected lang={lang} />
          </div>
          {undoControl}
          {displayTzSwitcherEl}
        </div>
      }
    />
  );

  return { appHeaderEl, topBarMenus };
}
