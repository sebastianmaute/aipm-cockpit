"use client";

import { useMemo } from "react";
import { TABLE_HEAD_CLASS } from "./table-styles";
import { VIEW_PANE_CLASS, VIEW_PANE_RESIZABLE_CLASS } from "./view-styles";
import { type Lang, t } from "./i18n";
import {
  buildRaciMatrix,
  accountableCountByMilestone,
  raciWarningFor,
  setRaciRole,
} from "./stakeholders";
import { type RaciRole, type Stakeholder, type Milestone } from "./types";
import { RaciChipPicker, RaciLegend } from "./raci-chip-picker";
import { useResizable } from "./use-resizable";
import { PrintButton, ResetSizeButton } from "./task-manager-ui";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface RaciPanelProps {
  lang: Lang;
  stakeholders: readonly Stakeholder[];
  milestones: readonly Milestone[];
  onSave: (item: Stakeholder) => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function RaciPanel({ lang, stakeholders, milestones, onSave }: RaciPanelProps) {
  const rows = useMemo(
    () => buildRaciMatrix(stakeholders, milestones),
    [stakeholders, milestones],
  );

  // Build a quick id→stakeholder map for onChange lookups
  const stakeholderMap = useMemo(() => {
    const m = new Map<number, Stakeholder>();
    for (const s of stakeholders) m.set(s.id, s);
    return m;
  }, [stakeholders]);

  const { ref: paneRef, reset: resetPaneSize } = useResizable("lop-app:raci-size");

  // Empty states — no resize affordance needed
  if (milestones.length === 0) {
    return (
      <div className={`${VIEW_PANE_CLASS} p-10 text-center text-sm text-muted-foreground`}>
        {t(lang, "raciNoMilestones")}
      </div>
    );
  }

  if (stakeholders.length === 0) {
    return (
      <div className={`${VIEW_PANE_CLASS} p-10 text-center text-sm text-muted-foreground`}>
        {t(lang, "raciNoStakeholders")}
      </div>
    );
  }

  return (
    <div ref={paneRef} className={`${VIEW_PANE_RESIZABLE_CLASS} print-root print-landscape`}>
      <div className="mb-2 flex shrink-0 flex-wrap items-center gap-2 print:hidden">
        <h2 className="text-base font-semibold text-foreground">
          {t(lang, "stakeholderRaciTitle")}
        </h2>
        <span className="ml-auto" />
        <PrintButton lang={lang} />
        <ResetSizeButton onClick={resetPaneSize} lang={lang} />
      </div>

      <div className="min-h-0 flex-1 overflow-auto rounded-md border border-line pr-2">
        <table className="min-w-full text-left text-sm">
          <thead className={TABLE_HEAD_CLASS}>
            <tr>
              <th className="px-3 py-2 font-medium">{t(lang, "navMilestones")}</th>
              {stakeholders.map((s) => (
                <th key={s.id} className="px-3 py-2 font-medium">
                  {s.name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map((row) => {
              const count = accountableCountByMilestone(stakeholders, row.milestone.id);
              const warning = raciWarningFor(count);
              return (
                <tr key={row.milestone.id}>
                  <td className="px-3 py-2 font-medium text-foreground">
                    <span className="inline-flex items-center gap-2">
                      {row.milestone.name}
                      {warning === "missing" && (
                        <span className="inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium bg-amber-500/20 text-AIPM-purple">
                          {t(lang, "raciAccountableMissing")}
                        </span>
                      )}
                      {warning === "multiple" && (
                        <span className="inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium bg-amber-500/20 text-AIPM-purple">
                          {t(lang, "raciAccountableMultiple")}
                        </span>
                      )}
                    </span>
                  </td>
                  {row.cells.map((cell) => {
                    const stakeholder = stakeholderMap.get(cell.stakeholderId);
                    const stakeholderName = stakeholder?.name ?? String(cell.stakeholderId);
                    const ariaLabel = `${row.milestone.name} · ${stakeholderName}`;
                    return (
                      <td key={cell.stakeholderId} className="px-3 py-2">
                        <RaciChipPicker
                          value={(cell.role ?? "") as RaciRole | ""}
                          ariaPrefix={ariaLabel}
                          lang={lang}
                          onChange={(role) => {
                            if (!stakeholder) return;
                            onSave(setRaciRole(stakeholder, row.milestone.id, role === "" ? null : role));
                          }}
                        />
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <RaciLegend lang={lang} />
    </div>
  );
}
