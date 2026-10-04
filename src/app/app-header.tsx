"use client";
import type React from "react";
import { BellIcon, ChatBubbleLeftRightIcon, PlusIcon } from "./icons";
import { type Lang, t } from "./i18n";
import { type Command } from "./voice";
import { type StorageKind } from "./storage";
import { CountBadge } from "./count-badge";
import { IconButton } from "./icon-button";
import { SettingsMenu } from "./settings-menu";
import { ActionMenus } from "./action-menus";
import { ProjectSwitcher, type ProjectSwitcherProps } from "./project-switcher";
import { defaultExportConfig, exportFooterText, type Settings } from "./settings-types";
import { AskClaudeMenu } from "./ask-claude-menu";
import type { AppView } from "./nav-config";
import type { ForecastBundle } from "./budget-forecast-bundle";

export interface AppHeaderProps {
  handleCancelEdit: () => void;
  setTaskModalOpen: React.Dispatch<React.SetStateAction<boolean>>;
  /** Count shown on the bell badge (now-tier suggested-action count). */
  bannerCount: number;
  /** Bell click — navigates to the Action Center. */
  onShowAlerts: () => void;
  showToast: (kind: "info" | "error", text: string) => void;
  handleCommand: (cmd: Command, originalText: string) => void;
  storageDescription: string | null;
  storageReady: boolean;
  onPickStorageFile: () => Promise<void>;
  onOpenStorageFile: () => Promise<void>;
  onGrantStorageWrite: () => Promise<void>;
  onRequestStorageSwitch: (kind: StorageKind) => void;
  onMigrateToTurso?: () => void;
  settings: Settings;
  setSettings: React.Dispatch<React.SetStateAction<Settings>>;
  lang: Lang;
  /** Opens the AI Assistant chat pop-out. */
  onOpenAiAssistant?: () => void;
  /** Current view — drives the Ask-Claude menu's per-view suggestions. */
  currentView?: AppView;
  /** Picking an Ask-Claude prompt — wired to requestChat(body, true). */
  onAskClaude?: (promptBody: string) => void;
  /** When set, renders the current-project indicator + switcher under the title. */
  projectSwitcher?: ProjectSwitcherProps;
  /** Extra control rendered beside the project switcher / Ask-Claude row (e.g. the display-tz switcher). */
  trailing?: React.ReactNode;
  /** §650 — controlled open state of the header's settings popover, so a banner's "open settings"
   *  action can open it (the classic layout has no Settings view). Omitted ⇒ the menu owns it. */
  settingsMenuOpen?: boolean;
  onSettingsMenuOpenChange?: (open: boolean) => void;
  /** §545 — the budget forecast for the Export menu (null with the budget module off). */
  exportForecast?: ForecastBundle | null;
}

export function AppHeader({
  handleCancelEdit,
  setTaskModalOpen,
  bannerCount,
  onShowAlerts,
  showToast,
  handleCommand,
  storageDescription,
  storageReady,
  onPickStorageFile,
  onOpenStorageFile,
  onGrantStorageWrite,
  onRequestStorageSwitch,
  onMigrateToTurso,
  // Settings come from props (not a local useSettings() call) so the classic
  // header's SettingsMenu writes the SAME settings instance that TaskManagerInner
  // owns and whose layout ternary reads — otherwise the layout toggle wouldn't switch the shell.
  settings,
  setSettings,
  lang,
  onOpenAiAssistant,
  currentView,
  onAskClaude,
  projectSwitcher,
  trailing,
  settingsMenuOpen,
  onSettingsMenuOpenChange,
  exportForecast = null,
}: AppHeaderProps) {
  return (
    <header className="mb-8 flex items-start justify-between gap-4">
      {/* §618 — min-w-0 lets this column shrink below its content, so the
          search in the row below can give up width from lg up instead of
          pushing the header wider than the window. */}
      <div className="min-w-0">
        <h1 className="text-3xl font-semibold tracking-tight text-ui-dark-blue dark:text-ui-light-grey">
          {t(lang, "appTitle")}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {t(lang, "appSubtitle")}
        </p>
        {/* Ask-Claude sits beside the project switcher (modern layout mirrors this
            in the TopBar's left cluster). The row renders when EITHER is present so
            Ask-Claude never depends on a switcher being wired. */}
        {(projectSwitcher || (currentView && onAskClaude) || trailing) && (
          <div className="mt-3 flex items-center gap-2">
            {projectSwitcher && <ProjectSwitcher {...projectSwitcher} />}
            {currentView && onAskClaude && (
              <AskClaudeMenu lang={lang} currentView={currentView} onAsk={onAskClaude} />
            )}
            {trailing}
          </div>
        )}
      </div>
      <div className="flex flex-col items-end gap-2">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={settings.branding?.logo || "/ai-pm-cockpit-banner.svg"}
          alt={settings.branding?.logo ? (settings.branding.slogan ?? t(lang, "appTitle")) : t(lang, "appTitle")}
          // Both a custom logo and the default AI PM Cockpit banner render in
          // one fixed 300×70 box — the banner's own 1200×280 aspect — and
          // object-contain letterboxes an upload of any other shape. The size
          // is DEFINITE on both axes, not a cap: the default SVG carries a
          // viewBox but no width/height, so it has no intrinsic size to derive
          // one axis from (the start window's header collapsed on exactly that).
          className="h-[70px] w-[300px] object-contain"
        />
        <div className="flex items-center gap-1">
          {onOpenAiAssistant && (
            <IconButton
              size="md"
              label={t(lang, "openAiAssistant")}
              title={t(lang, "openAiAssistant")}
              onClick={onOpenAiAssistant}
            >
              <ChatBubbleLeftRightIcon aria-hidden="true" className="h-5 w-5" />
            </IconButton>
          )}
          <IconButton
            size="md"
            label={t(lang, "addTaskButton")}
            title={t(lang, "addTaskButton")}
            onClick={() => {
              handleCancelEdit();
              setTaskModalOpen(true);
            }}
          >
            <PlusIcon aria-hidden="true" className="h-5 w-5" />
          </IconButton>
          {/* `relative` is load-bearing: the CountBadge below is absolutely
              positioned against THIS button, so it must stay the containing block. */}
          <IconButton
            size="md"
            className="relative"
            label={t(lang, "showDueAlerts")}
            title={t(lang, "showDueAlerts")}
            onClick={onShowAlerts}
          >
            <BellIcon aria-hidden="true" className="h-5 w-5" />
            {bannerCount > 0 && (
              <CountBadge variant="pink" aria-hidden className="absolute -right-0.5 -top-0.5">
                {bannerCount}
              </CountBadge>
            )}
          </IconButton>
          <ActionMenus
            lang={lang}
            onCommand={handleCommand}
            onVoiceError={(msg) => showToast("error", msg)}
            exportConfig={settings.export ?? defaultExportConfig}
            exportFooter={exportFooterText(settings.branding)}
            exportForecast={exportForecast}
            expertMode={settings.expertMode}
          />
          <SettingsMenu
            settings={settings}
            onChange={setSettings}
            storageDescription={storageDescription}
            storageReady={storageReady}
            onPickStorageFile={onPickStorageFile}
            onOpenStorageFile={onOpenStorageFile}
            onGrantStorageWrite={onGrantStorageWrite}
            onRequestStorageSwitch={onRequestStorageSwitch}
            onMigrateToTurso={onMigrateToTurso}
            open={settingsMenuOpen}
            onOpenChange={onSettingsMenuOpenChange}
          />
        </div>
      </div>
    </header>
  );
}
