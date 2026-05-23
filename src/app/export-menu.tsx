"use client";

// Header dropdown that exposes the six export formats. Same UX pattern as
// HelpMenu / VersionMenu: a small icon button that toggles a popover-style
// list of options. Each option is one click → file download (or, for PDF,
// a new-tab print dialog).
//
// Format-specific hints are surfaced in the popover so users know roughly
// what each output looks like before they pick one.

import { useEffect, useRef, useState } from "react";
import { type ExportFormat, exportWorkspace } from "./export";
import { type Lang, type TranslationKey, t } from "./i18n";
import type { Absence, Discipline, Grade, RaidItem, Resource, ResourcePlan, Role, Shift, Task } from "./types";

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
}: {
  lang: Lang;
  tasks: Task[];
  raid: RaidItem[];
  absences: Absence[];
  shifts: Shift[];
  resources: Resource[];
  roles: Role[];
  disciplines: Discipline[];
  grades: Grade[];
  plan: ResourcePlan;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onMouseDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function pick(format: ExportFormat) {
    setOpen(false);
    // Run on the next tick so the popover has closed before the browser
    // pops the save dialog / new tab. Some browsers focus-steal the dialog
    // and the popover never visually closes otherwise.
    setTimeout(() => {
      void exportWorkspace({ tasks, raid, absences, shifts, resources, roles, disciplines, grades, plan }, format);
    }, 0);
  }

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={t(lang, "exportTitle")}
        aria-expanded={open}
        title={t(lang, "exportTitle")}
        className="rounded-md p-2 text-AIPM-dark-grey hover:bg-AIPM-light-grey hover:text-AIPM-dark-blue focus:outline-none focus:ring-2 focus:ring-AIPM-dark-blue dark:text-AIPM-medium-grey dark:hover:bg-zinc-800 dark:hover:text-AIPM-light-grey"
      >
        <svg
          viewBox="0 0 20 20"
          fill="currentColor"
          aria-hidden="true"
          className="h-5 w-5"
        >
          {/* Download / outbox icon — tray with a down arrow. */}
          <path
            fillRule="evenodd"
            d="M10 2a.75.75 0 01.75.75v7.69l1.97-1.97a.75.75 0 111.06 1.06l-3.25 3.25a.75.75 0 01-1.06 0L6.22 9.53a.75.75 0 111.06-1.06l1.97 1.97V2.75A.75.75 0 0110 2zM3 14.75A.75.75 0 013.75 14h12.5a.75.75 0 01.75.75v1.5A1.75 1.75 0 0115.25 18h-10.5A1.75 1.75 0 013 16.25v-1.5z"
            clipRule="evenodd"
          />
        </svg>
      </button>

      {open && (
        <div
          role="dialog"
          aria-label={t(lang, "exportTitle")}
          className="absolute right-0 top-full z-20 mt-2 w-72 overflow-y-auto rounded-lg border border-zinc-200 bg-white p-3 shadow-lg dark:border-zinc-800 dark:bg-zinc-900"
        >
          <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-AIPM-medium-grey">
            {t(lang, "exportTitle")}
          </h3>
          <p className="mb-2 text-xs text-AIPM-dark-grey dark:text-AIPM-medium-grey">
            {t(lang, "exportSubtitle", tasks.length)}
          </p>
          <ul className="space-y-1">
            {OPTIONS.map((o) => (
              <li key={o.format}>
                <button
                  type="button"
                  onClick={() => pick(o.format)}
                  className="flex w-full flex-col items-start gap-0.5 rounded-md px-2.5 py-2 text-left text-sm hover:bg-AIPM-light-grey dark:hover:bg-zinc-800"
                >
                  <span className="font-medium text-AIPM-dark-blue dark:text-AIPM-light-grey">
                    {t(lang, o.labelKey)}
                  </span>
                  <span className="text-xs text-AIPM-medium-grey">
                    {t(lang, o.hintKey)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
