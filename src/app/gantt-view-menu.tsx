"use client";

// src/app/gantt-view-menu.tsx — the Gantt toolbar's "View" popover: every
// display toggle for the chart in one place.
//
// The three older toggles (critical path, baseline, inline milestones) used to
// sit inline in the toolbar; five layer toggles were added on top, which would
// have put eight chips in an already-crowded row. They collect here instead.
// Behaviour is unchanged — each control still calls the same `useGanttPrefs`
// setter it always did.
//
// ★ Every control is a `ToggleButton`, never a hand-rolled `<button
//   aria-pressed>`: the primitive supplies the non-colour pressed marker that
//   WCAG 1.4.1 needs (the accent border+tint alone measures ~1.0–1.2:1 against
//   the unpressed border in the dark schemes), and it pins the label/state
//   coherence rule — the visible label names what pressed=true ENABLES and
//   never flips to the opposite action.

import { useCallback, useRef, useState } from "react";
import {
  AdjustmentsHorizontalIcon,
  ArrowLongRightIcon,
  BoltIcon,
  CalendarDaysIcon,
  FlagIcon,
  MapPinIcon,
  Squares2X2Icon,
  SunIcon,
  UserMinusIcon,
} from "./icons";
import { Button } from "./button";
import { PopoverPanel } from "./popover-panel";
import { ToggleButton } from "./toggle-button";
import { type Lang, t } from "./i18n";
import type { GanttPrefs } from "./gantt-engine";

const ICON_CLASS = "h-3.5 w-3.5 shrink-0";
/** Each toggle fills the panel width so the labels form one readable column. */
const ROW_CLASS = "w-full justify-start";

export function GanttViewMenu({
  lang,
  prefs,
  hasBaseline,
  hasMilestones,
  toggleCriticalPath,
  toggleBaseline,
  toggleMilestonePlacement,
  toggleHolidays,
  toggleAbsences,
  toggleDependencies,
  toggleMilestones,
  toggleGrid,
}: {
  lang: Lang;
  prefs: GanttPrefs;
  /** Baseline data exists (Turso snapshot) — otherwise there is nothing to show. */
  hasBaseline: boolean;
  /** The chart has at least one milestone — gates BOTH milestone controls. */
  hasMilestones: boolean;
  toggleCriticalPath: () => void;
  toggleBaseline: () => void;
  toggleMilestonePlacement: () => void;
  toggleHolidays: () => void;
  toggleAbsences: () => void;
  toggleDependencies: () => void;
  toggleMilestones: () => void;
  toggleGrid: () => void;
}) {
  const [open, setOpen] = useState(false);
  // PopoverPanel portals the panel to <body>, so it escapes the toolbar's
  // wrapping/overflow; it owns anchoring, outside-click, Escape and focus.
  // `onClose` must be stable or its listeners re-subscribe every render.
  const triggerRef = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => setOpen(false), []);

  return (
    <div className="relative inline-block">
      <Button
        ref={triggerRef}
        variant="secondary"
        size="xs"
        onClick={() => setOpen((o) => !o)}
        aria-label={t(lang, "ganttViewMenu")}
        aria-expanded={open}
        title={t(lang, "ganttViewMenuHint")}
        className="inline-flex items-center gap-1.5"
      >
        <AdjustmentsHorizontalIcon aria-hidden="true" className={ICON_CLASS} />
        {t(lang, "ganttViewMenu")}
      </Button>
      <PopoverPanel
        open={open}
        anchorRef={triggerRef}
        onClose={close}
        role="dialog"
        ariaLabel={t(lang, "ganttViewMenu")}
        className="w-60 p-3"
      >
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {t(lang, "ganttViewMenuHint")}
        </p>
        <div className="flex flex-col gap-1.5">
          <ToggleButton
            lang={lang}
            pressed={prefs.showDependencies}
            onToggle={toggleDependencies}
            title={t(lang, "ganttShowDependenciesHint")}
            className={ROW_CLASS}
            icon={<ArrowLongRightIcon aria-hidden="true" className={ICON_CLASS} />}
          >
            {t(lang, "ganttShowDependencies")}
          </ToggleButton>
          <ToggleButton
            lang={lang}
            pressed={prefs.showHolidays}
            onToggle={toggleHolidays}
            title={t(lang, "ganttShowHolidaysHint")}
            className={ROW_CLASS}
            icon={<SunIcon aria-hidden="true" className={ICON_CLASS} />}
          >
            {t(lang, "ganttShowHolidays")}
          </ToggleButton>
          <ToggleButton
            lang={lang}
            pressed={prefs.showAbsences}
            onToggle={toggleAbsences}
            title={t(lang, "ganttShowAbsencesHint")}
            className={ROW_CLASS}
            icon={<UserMinusIcon aria-hidden="true" className={ICON_CLASS} />}
          >
            {t(lang, "ganttShowAbsences")}
          </ToggleButton>
          <ToggleButton
            lang={lang}
            pressed={prefs.showGrid}
            onToggle={toggleGrid}
            title={t(lang, "ganttShowGridHint")}
            className={ROW_CLASS}
            icon={<Squares2X2Icon aria-hidden="true" className={ICON_CLASS} />}
          >
            {t(lang, "ganttShowGrid")}
          </ToggleButton>
          <ToggleButton
            lang={lang}
            pressed={prefs.showCriticalPath}
            onToggle={toggleCriticalPath}
            accent="pink"
            title={t(lang, "ganttCriticalPathHint")}
            className={ROW_CLASS}
            icon={<BoltIcon aria-hidden="true" className={ICON_CLASS} />}
          >
            {t(lang, "ganttCriticalPath")}
          </ToggleButton>
          {hasBaseline && (
            <ToggleButton
              lang={lang}
              pressed={prefs.showBaseline}
              onToggle={toggleBaseline}
              title={t(lang, "ganttBaselineHint")}
              className={ROW_CLASS}
              icon={<FlagIcon aria-hidden="true" className={ICON_CLASS} />}
            >
              {t(lang, "ganttBaseline")}
            </ToggleButton>
          )}
          {hasMilestones && (
            <>
              <ToggleButton
                lang={lang}
                pressed={prefs.showMilestones}
                onToggle={toggleMilestones}
                title={t(lang, "ganttShowMilestonesHint")}
                className={ROW_CLASS}
                icon={<CalendarDaysIcon aria-hidden="true" className={ICON_CLASS} />}
              >
                {t(lang, "ganttShowMilestones")}
              </ToggleButton>
              <ToggleButton
                lang={lang}
                // Name/state coherence: the visible label is pinned to what the
                // toggle ENABLES ("Inline milestones") and aria-pressed tracks
                // THAT state, so "Inline milestones, pressed" ⇒ inline is on.
                pressed={prefs.milestonePlacement === "inline"}
                onToggle={toggleMilestonePlacement}
                title={t(lang, "ganttMilestonesInlineHint")}
                className={ROW_CLASS}
                icon={<MapPinIcon aria-hidden="true" className={ICON_CLASS} />}
              >
                {t(lang, "ganttMilestonesInline")}
              </ToggleButton>
            </>
          )}
        </div>
      </PopoverPanel>
    </div>
  );
}
