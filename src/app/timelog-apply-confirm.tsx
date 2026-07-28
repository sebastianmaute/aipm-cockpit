"use client";
// src/app/timelog-apply-confirm.tsx — the apply-to-budget confirm bar.
//
// Split out of timelog-panel.tsx (the gantt panel convention: a panel past the
// size ratchet sheds PURE presentational pieces). Data + handlers arrive as
// props; this file owns no state and makes no decisions.
//
// It ITEMIZES the pending write. Apply owns every allocation line of a period
// that routed any booking, and `actualHours` is a user-editable input, so a
// figure typed by hand on a line TimeLog never books to is written to 0 — a PM's
// 40h for a designer, zeroed because somebody else booked that week. The dialog
// used to disclose that as a bare count ("Apply 2 bucket changes?"). Showing
// every row is what makes it an informed write instead of a silent overwrite;
// do not reduce this back to a count.
import { t, type Lang } from "./i18n";
import { Button } from "./button";
import type { ApplyDiffLabel } from "./timelog-apply";

export function TimelogApplyConfirm({
  lang,
  rows,
  onApply,
  onCancel,
}: {
  lang: Lang;
  rows: readonly ApplyDiffLabel[];
  onApply: () => void;
  onCancel: () => void;
}) {
  return (
    // items-start, not items-center: once the diff list can grow tall, centring
    // pushes the Apply/Cancel column to the vertical middle of a long list.
    <div className="flex items-start gap-3 rounded-md border border-line bg-surface px-3 py-2 print:hidden">
      <div className="min-w-0">
        <p className="text-sm text-foreground">
          {t(lang, "timelogApplyConfirm", String(rows.length))}
        </p>
        {/* Bounded on purpose: this card gates a FINANCIAL write into
            actualHours, so Apply and Cancel must never be pushed out of reach
            by a long diff. */}
        <ul className="mt-1 max-h-[50vh] overflow-auto pr-2 text-xs text-muted-foreground">
          {rows.map((r) => (
            <li key={`${r.bucketId}:${r.allocIndex}:${r.period}`} className="tabular-nums">
              {[r.bucketName, r.lineName, r.period].filter(Boolean).join(" · ")}
              {": "}
              {r.current} → <span className="font-medium text-foreground">{r.next}</span>
            </li>
          ))}
        </ul>
      </div>
      <Button variant="primary" size="sm" onClick={onApply}>
        {t(lang, "timelogApply")}
      </Button>
      <Button variant="secondary" size="sm" onClick={onCancel}>
        {t(lang, "cancel")}
      </Button>
    </div>
  );
}
