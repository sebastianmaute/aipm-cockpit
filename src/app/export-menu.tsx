"use client";

// Header dropdown that exposes the six export formats. Same UX pattern as
// HelpMenu / VersionMenu: a small icon button that toggles a popover-style
// list of options. Each option is one click → file download (or, for PDF,
// a new-tab print dialog).
//
// Format-specific hints are surfaced in the popover so users know roughly
// what each output looks like before they pick one.

import { useCallback, useRef, useState } from "react";
import { ArrowDownTrayIcon } from "@heroicons/react/24/outline";
import { PopoverPanel } from "./popover-panel";
import { INTERACTIVE } from "./interaction-styles";
import { type ExportFormat, exportWorkspace } from "./export";
import { type Lang, type TranslationKey, t } from "./i18n";
import type { Absence, BudgetBucket, Discipline, FxRates, Grade, RaidItem, Resource, ResourcePlan, Role, Shift, Task } from "./types";
import type { ExportConfig } from "./settings-types";
import { reportSilentFailure } from "./guard-feedback";
import { useToastContext } from "./toast-context";

const OPTIONS: Array<{
  format: ExportFormat;
  labelKey: TranslationKey;
  hintKey: TranslationKey;
}> = [
  { format: "csv", labelKey: "exportCsv", hintKey: "exportCsvHint" },
  { format: "md", labelKey: "exportMd", hintKey: "exportMdHint" },
  { format: "pdf", labelKey: "exportPdf", hintKey: "exportPdfHint" },
  { format: "docx", labelKey: "exportDocx", hintKey: "exportDocxHint" },
  { format: "xlsx", labelKey: "exportXlsx", hintKey: "exportXlsxHint" },
  { format: "pptx", labelKey: "exportPptx", hintKey: "exportPptxHint" },
];

export function ExportMenu({
  lang,
  tasks,
  raid,
  absences,
  shifts,
  resources,
  roles,
  disciplines,
  grades,
  plan,
  budgets,
  fxRates,
  exportConfig,
}: {
  lang: Lang;
  tasks: readonly Task[];
  raid: readonly RaidItem[];
  absences: readonly Absence[];
  shifts: readonly Shift[];
  resources: readonly Resource[];
  roles: readonly Role[];
  disciplines: readonly Discipline[];
  grades: readonly Grade[];
  plan: ResourcePlan;
  budgets: readonly BudgetBucket[];
  fxRates: FxRates | null;
  exportConfig?: ExportConfig;
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => setOpen(false), []);
  const showToast = useToastContext();

  function pick(format: ExportFormat) {
    setOpen(false);
    // Run on the next tick so the popover has closed before the browser
    // pops the save dialog / new tab. Some browsers focus-steal the dialog
    // and the popover never visually closes otherwise.
    setTimeout(() => {
      void exportWorkspace({ tasks, raid, absences, shifts, resources, roles, disciplines, grades, plan, budgets, fxRates }, format, exportConfig, lang)
        .catch((e) => reportSilentFailure(showToast, lang, "export.failed", e, "guardExportFailed"));
    }, 0);
  }

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={t(lang, "exportTitle")}
        aria-expanded={open}
        title={t(lang, "exportTitle")}
        className="rounded-md p-2 text-foreground hover:bg-surface-muted hover:text-ui-dark-blue focus:outline-none focus:ring-2 focus:ring-ui-green dark:text-muted-foreground dark:hover:text-ui-light-grey"
      >
        <ArrowDownTrayIcon aria-hidden="true" className="h-5 w-5" />
      </button>

      <PopoverPanel
        open={open}
        anchorRef={triggerRef}
        onClose={close}
        role="dialog"
        ariaLabel={t(lang, "exportTitle")}
        className="w-72 overflow-y-auto p-3"
      >
        <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {t(lang, "exportTitle")}
        </h3>
          <p className="mb-2 text-xs text-foreground">
            {t(lang, "exportSubtitle", tasks.length)}
          </p>
          <ul className="space-y-1">
            {OPTIONS.map((o) => (
              <li key={o.format}>
                <button
                  type="button"
                  onClick={() => pick(o.format)}
                  className={`flex w-full flex-col items-start gap-0.5 rounded-md px-2.5 py-2 text-left text-sm hover:bg-surface-muted ${INTERACTIVE}`}
                >
                  <span className="font-medium text-ui-dark-blue dark:text-ui-light-grey">
                    {t(lang, o.labelKey)}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {t(lang, o.hintKey)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
      </PopoverPanel>
    </div>
  );
}
