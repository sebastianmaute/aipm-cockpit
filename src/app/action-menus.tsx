"use client";
import dynamic from "next/dynamic";
import { type Lang } from "./i18n";
import { type Command } from "./voice";
import { ExportMenu } from "./export-menu";
import { HelpMenu } from "./help-menu";
import { VersionMenu } from "./version-menu";
import { useWorkspace } from "./workspace-context";
import { defaultExportConfig, type ExportConfig } from "./settings-types";

// Lazy-loaded like in app-header.tsx — the speech-recognition bundle is only
// fetched client-side when the button mounts.
const VoiceCommandButton = dynamic(
  () => import("./voice-button").then((m) => m.VoiceCommandButton),
  { ssr: false },
);

interface ActionMenusProps {
  lang: Lang;
  onCommand: (cmd: Command, originalText: string) => void;
  onVoiceError: (msg: string) => void;
  /** Live export config threaded from TaskManagerInner's settings state.
   *  Falls back to defaultExportConfig when omitted (e.g. in tests). */
  exportConfig?: ExportConfig;
}

/**
 * The shared header action cluster — Voice, Export, Help, Version — rendered
 * identically by the classic `AppHeader` and the modern `TopBar`. ExportMenu's
 * data comes from `useWorkspace()` here so callers pass only `lang` + the voice
 * handlers (single source of truth; see the action-menus-sweep guard test).
 * Settings come from props (not a local useSettings() call) so the live export
 * config from TaskManagerInner is used — otherwise toggling export sections
 * wouldn't reach the Export button until a full reload.
 */
export function ActionMenus({ lang, onCommand, onVoiceError, exportConfig = defaultExportConfig }: ActionMenusProps) {
  const { tasks, raid, absences, shifts, resources, roles, disciplines, grades, plan, budgets, fxRates } = useWorkspace();
  return (
    <>
      <VoiceCommandButton lang={lang} onCommand={onCommand} onError={onVoiceError} />
      <ExportMenu lang={lang} tasks={tasks} raid={raid} absences={absences} shifts={shifts} resources={resources} roles={roles} disciplines={disciplines} grades={grades} plan={plan} budgets={budgets} fxRates={fxRates} exportConfig={exportConfig} />
      <HelpMenu lang={lang} />
      <VersionMenu lang={lang} />
    </>
  );
}
