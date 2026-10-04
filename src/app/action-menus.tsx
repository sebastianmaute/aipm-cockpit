"use client";
import dynamic from "next/dynamic";
import { type Lang } from "./i18n";
import { type Command } from "./voice";
import { ExportMenu } from "./export-menu";
import { SaveTemplateMenu, ApplyTemplateMenu } from "./template-menus";
import { HelpMenu } from "./help-menu";
import { VersionMenu } from "./version-menu";
import { useWorkspace } from "./workspace-context";
import { buildExportWorkspace } from "./export-workspace";
import { defaultExportConfig, type ExportConfig } from "./settings-types";
import type { ProjectTemplate, SaveTemplateInput } from "./templates";
import type { ForecastBundle } from "./budget-forecast-bundle";

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
  /** Footer line of the PDF/print export, from the same settings as `exportConfig`. */
  exportFooter?: string;
  /** §545 — the budget forecast for the Export menu's derived section. */
  exportForecast?: ForecastBundle | null;
  /** Saved + built-in project templates for the Apply menu. Defaults to []
   *  (e.g. in tests) so the Apply trigger renders with its button disabled. */
  templates?: readonly ProjectTemplate[];
  /** Apply a template to the current project. No-op default for tests. */
  onApplyTemplate?: (id: string, opts: { includeSeed: boolean }) => void;
  /** Capture the current project as a new template. No-op default for tests. */
  onSaveTemplate?: (input: SaveTemplateInput) => void;
  /** Expert mode reveals the Save-as-template / Apply-template menus. */
  expertMode?: boolean;
}

/**
 * The shared header action cluster — Voice, Export, Help, Version — rendered
 * identically by the classic `AppHeader` and the modern `TopBar`. ExportMenu's
 * workspace is `buildExportWorkspace(useWorkspace())` here — the same builder
 * the Projects-panel export uses (§463) — so callers pass only `lang` + the
 * voice handlers (single source of truth; see the action-menus-sweep guard test).
 * Settings come from props (not a local useSettings() call) so the live export
 * config from TaskManagerInner is used — otherwise toggling export sections
 * wouldn't reach the Export button until a full reload.
 */
export function ActionMenus({
  lang,
  onCommand,
  onVoiceError,
  exportConfig = defaultExportConfig,
  exportFooter,
  exportForecast = null,
  templates = [],
  onApplyTemplate,
  onSaveTemplate,
  expertMode = false,
}: ActionMenusProps) {
  const workspace = buildExportWorkspace(useWorkspace());
  return (
    <>
      <VoiceCommandButton lang={lang} onCommand={onCommand} onError={onVoiceError} />
      <ExportMenu lang={lang} workspace={workspace} exportConfig={exportConfig} exportFooter={exportFooter} exportForecast={exportForecast} />
      {expertMode && (
        <>
          <SaveTemplateMenu lang={lang} onSave={onSaveTemplate ?? (() => {})} />
          <ApplyTemplateMenu lang={lang} templates={templates} onApply={onApplyTemplate ?? (() => {})} />
        </>
      )}
      <HelpMenu lang={lang} />
      <VersionMenu lang={lang} />
    </>
  );
}
