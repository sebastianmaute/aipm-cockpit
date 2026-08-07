"use client";
import type React from "react";
import { BellIcon, ChatBubbleLeftRightIcon, PlusIcon } from "@heroicons/react/24/outline";
import { type Lang, t } from "./i18n";
import { type Command } from "./voice";
import { type StorageKind } from "./storage";
import { CountBadge } from "./count-badge";
import { IconButton } from "./icon-button";
import { SettingsMenu } from "./settings-menu";
import { ActionMenus } from "./action-menus";
import { ProjectSwitcher, type ProjectSwitcherProps } from "./project-switcher";
import { defaultExportConfig, type Settings } from "./settings-types";
import { AskClaudeMenu } from "./ask-claude-menu";
import type { AppView } from "./nav-config";

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
}: AppHeaderProps) {
  return (
    <header className="mb-8 flex items-start justify-between gap-4">
      <div>
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
          src={settings.branding?.logo || "/AIPM-logo.svg"}
          alt={settings.branding?.logo ? (settings.branding.slogan ?? t(lang, "appTitle")) : t(lang, "appTitle")}
          // Custom logos render as-is (light header → no invert), capped so a
          // large upload can't blow out the header.
          className={settings.branding?.logo ? "max-h-10 w-auto max-w-[200px] object-contain" : "h-7 w-auto"}
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
          />
        </div>
      </div>
    </header>
  );
}
