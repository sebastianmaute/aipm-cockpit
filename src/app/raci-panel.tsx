"use client";

import { useMemo, useState } from "react";
import { TABLE_HEAD_CLASS } from "./table-styles";
import { FOCUS_RING, TRANSITION } from "./interaction-styles";
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
import { ViewCallout } from "./view-callout";

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface RaciPanelProps {
  lang: Lang;
  stakeholders: readonly Stakeholder[];
  milestones: readonly Milestone[];
  onSave: (item: Stakeholder) => void;
  showHints?: boolean;
  isPopout?: boolean;
  onLearnMore?: (conceptId: string) => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function RaciPanel({ lang, stakeholders, milestones, onSave, showHints, isPopout, onLearnMore }: RaciPanelProps) {
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

  // Person (column) filter — additive: `filtered` holds the ids to SHOW (empty = all shown).
  const [filtered, setFiltered] = useState<ReadonlySet<number>>(new Set());
  const [filterInput, setFilterInput] = useState("");
  const visibleStakeholders = useMemo(
    () => (filtered.size === 0 ? stakeholders : stakeholders.filter((s) => filtered.has(s.id))),
    [stakeholders, filtered],
  );
  const visibleIds = useMemo(
    () => new Set(visibleStakeholders.map((s) => s.id)),
    [visibleStakeholders],
  );

  function addPerson(rawName: string) {
    const needle = rawName.trim().toLowerCase();
    if (needle === "") return;
    const match = stakeholders.find((s) => s.name.trim().toLowerCase() === needle);
    if (!match) return;
    setFiltered((prev) => {
      if (prev.has(match.id)) return prev;
      const next = new Set(prev);
      next.add(match.id);
      return next;
    });
    setFilterInput("");
  }

  function removePerson(id: number) {
    setFiltered((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
  }

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
      {onLearnMore && (
        <ViewCallout view="raci" lang={lang} showHints={showHints !== false} isPopout={!!isPopout} onLearnMore={onLearnMore} />
      )}
      {/* Person (column) filter + actions on one row — type a name to add a person
          to the filter (empty filter shows everyone); added persons appear as
          removable chips. The chips wrap onto further rows when space runs out;
          Print/Reset stay top-right. */}
      <div className="mb-2 flex shrink-0 flex-wrap items-start gap-2 print:hidden">
        <div className="flex flex-1 flex-wrap items-center gap-2">
          <input
            type="text"
            value={filterInput}
            onChange={(e) => {
              const v = e.target.value;
              setFilterInput(v);
              // Picking a datalist option fires change with the full name → add it.
              if (stakeholders.some((s) => s.name.trim().toLowerCase() === v.trim().toLowerCase())) {
                addPerson(v);
              }
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addPerson(filterInput);
              }
            }}
            list="raci-filter-people"
            aria-label={t(lang, "raciFilterAdd")}
            placeholder={t(lang, "raciFilterAdd")}
            className={`w-48 rounded border border-line bg-surface px-2 py-1 text-sm text-foreground ${FOCUS_RING} ${TRANSITION}`}
          />
          <datalist id="raci-filter-people">
            {stakeholders
              .filter((s) => !filtered.has(s.id))
              .map((s) => (
                <option key={s.id} value={s.name} />
              ))}
          </datalist>
          {visibleStakeholders
            .filter((s) => filtered.has(s.id))
            .map((s) => (
              <span
                key={s.id}
                className="inline-flex items-center gap-1 rounded border border-line px-1.5 py-0.5 text-xs text-foreground"
              >
                <span>{s.name}</span>
                <button
                  type="button"
                  onClick={() => removePerson(s.id)}
                  aria-label={t(lang, "raciFilterRemove", s.name)}
                  className={`inline-flex h-4 w-4 items-center justify-center rounded text-muted-foreground hover:text-AIPM-dark-blue ${FOCUS_RING} ${TRANSITION}`}
                >
                  &times;
                </button>
              </span>
            ))}
          {filtered.size > 0 && (
            <button
              type="button"
              onClick={() => setFiltered(new Set())}
              className={`rounded border border-line px-1.5 py-0.5 text-xs text-foreground hover:text-AIPM-dark-blue ${FOCUS_RING} ${TRANSITION}`}
            >
              {t(lang, "raciFilterClear")}
            </button>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <PrintButton lang={lang} />
          <ResetSizeButton onClick={resetPaneSize} lang={lang} />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto rounded-md border border-line pr-2">
        <table className="min-w-full text-left text-sm">
          <thead className={TABLE_HEAD_CLASS}>
            <tr>
              <th className="px-3 py-2 font-medium">{t(lang, "navMilestones")}</th>
              {visibleStakeholders.map((s) => (
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
                  {row.cells.filter((c) => visibleIds.has(c.stakeholderId)).map((cell) => {
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
