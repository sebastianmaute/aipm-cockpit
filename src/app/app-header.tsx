"use client";
import dynamic from "next/dynamic";
import type React from "react";
import { t } from "./i18n";
import { type Command } from "./voice";
import { ExportMenu } from "./export-menu";
import { HelpMenu } from "./help-menu";
import { VersionMenu } from "./version-menu";
import { SettingsMenu } from "./settings-menu";
import { useSettings } from "./use-settings";
import { useWorkspace } from "./workspace-context";

const VoiceCommandButton = dynamic(
  () => import("./voice-button").then((m) => m.VoiceCommandButton),
  { ssr: false },
);

export interface AppHeaderProps {
  handleCancelEdit: () => void;
  setTaskModalOpen: React.Dispatch<React.SetStateAction<boolean>>;
  bannerItems: { taskId: number; taskName: string; daysUntilDue: number }[];
  setBannerDismissed: React.Dispatch<React.SetStateAction<boolean>>;
  setDueModalOpen: React.Dispatch<React.SetStateAction<boolean>>;
  showToast: (kind: "success" | "error", text: string) => void;
  handleCommand: (cmd: Command, originalText: string) => void;
  storageDescription: string;
  storageReady: boolean;
  onPickStorageFile: () => Promise<void>;
  onOpenStorageFile: () => Promise<void>;
  onGrantStorageWrite: () => Promise<void>;
}

export function AppHeader({
  handleCancelEdit,
  setTaskModalOpen,
  bannerItems,
  setBannerDismissed,
  setDueModalOpen,
  showToast,
  handleCommand,
  storageDescription,
  storageReady,
  onPickStorageFile,
  onOpenStorageFile,
  onGrantStorageWrite,
}: AppHeaderProps) {
  const { settings, setSettings, lang } = useSettings();
  const { tasks, raid, absences, shifts } = useWorkspace();

  return (
    <header className="mb-8 flex items-start justify-between gap-4">
      <div>
        <h1 className="text-3xl font-semibold tracking-tight text-AIPM-dark-blue dark:text-AIPM-light-grey">
          {t(lang, "appTitle")}
        </h1>
        <p className="mt-1 text-sm text-AIPM-dark-grey dark:text-AIPM-medium-grey">
          {t(lang, "appSubtitle")}
        </p>
      </div>
      <div className="flex flex-col items-end gap-2">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/AIPM-logo.svg"
          alt="Acme"
          className="h-7 w-auto"
        />
        <div className="flex items-center gap-1">
          <VoiceCommandButton
            lang={lang}
            onCommand={handleCommand}
            onError={(msg) => showToast("error", msg)}
          />
          <button
            type="button"
            onClick={() => {
              handleCancelEdit();
              setTaskModalOpen(true);
            }}
            aria-label={t(lang, "addTaskButton")}
            title={t(lang, "addTaskButton")}
            className="rounded-md p-2 text-AIPM-dark-grey hover:bg-AIPM-light-grey hover:text-AIPM-dark-blue focus:outline-none focus:ring-2 focus:ring-AIPM-dark-blue dark:text-AIPM-medium-grey dark:hover:bg-zinc-800 dark:hover:text-AIPM-light-grey"
          >
            <svg
              viewBox="0 0 20 20"
              fill="currentColor"
              aria-hidden="true"
              className="h-5 w-5"
            >
              <path
                fillRule="evenodd"
                d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z"
                clipRule="evenodd"
              />
            </svg>
          </button>
          <button
            type="button"
            onClick={() => {
              setBannerDismissed(false);
              setDueModalOpen(true);
            }}
            aria-label={t(lang, "showDueAlerts")}
            title={t(lang, "showDueAlerts")}
            className="relative rounded-md p-2 text-AIPM-dark-grey hover:bg-AIPM-light-grey hover:text-AIPM-dark-blue focus:outline-none focus:ring-2 focus:ring-AIPM-dark-blue dark:text-AIPM-medium-grey dark:hover:bg-zinc-800 dark:hover:text-AIPM-light-grey"
          >
            <svg
              viewBox="0 0 20 20"
              fill="currentColor"
              aria-hidden="true"
              className="h-5 w-5"
            >
              <path d="M10 2a6 6 0 00-6 6v2.586l-.707.707A1 1 0 004 13h12a1 1 0 00.707-1.707L16 10.586V8a6 6 0 00-6-6zM8 15a2 2 0 104 0H8z" />
            </svg>
            {bannerItems.length > 0 && (
              <span
                aria-hidden
                className="absolute -right-0.5 -top-0.5 inline-flex h-4 min-w-[1rem] items-center justify-center rounded-full bg-AIPM-pink px-1 text-[10px] font-semibold leading-none text-white"
              >
                {bannerItems.length}
              </span>
            )}
          </button>
          <ExportMenu lang={lang} tasks={tasks} raid={raid} absences={absences} shifts={shifts} />
          <HelpMenu lang={lang} />
          <VersionMenu lang={lang} />
          <SettingsMenu
            settings={settings}
            onChange={setSettings}
            storageDescription={storageDescription}
            storageReady={storageReady}
            onPickStorageFile={onPickStorageFile}
            onOpenStorageFile={onOpenStorageFile}
            onGrantStorageWrite={onGrantStorageWrite}
          />
        </div>
      </div>
    </header>
  );
}
