"use client";

import type { ReactNode, Ref } from "react";
import type { Lang } from "./i18n";
import type { AppView } from "./nav-config";
import { VIEW_PANE_RESIZABLE_CLASS } from "./view-styles";
import { INTERACTIVE } from "./interaction-styles";
import { ViewCallout } from "./view-callout";
import { BulkEditBar } from "./bulk-edit-bar";
import { BulkEditPanel, type BulkField } from "./bulk-edit-panel";

interface PanelTableScaffoldBulk {
  count: number;
  open: boolean;
  onToggleOpen: () => void;
  onClear: () => void;
  fields: readonly BulkField[];
  onApply: (changes: Record<string, string>) => void;
  onCancel: () => void;
}

interface PanelTableScaffoldEmpty {
  text: string;
  addLabel: string;
  onAdd: () => void;
  ariaLabel?: string;
}

interface PanelTableScaffoldProps {
  paneRef: Ref<HTMLDivElement>;
  containerRef: Ref<HTMLDivElement>;
  view: AppView;
  lang: Lang;
  showHints?: boolean;
  isPopout?: boolean;
  onLearnMore?: (conceptId: string) => void;
  toolbar: ReactNode;
  bulk: PanelTableScaffoldBulk;
  bulkPrintHidden?: boolean;
  count: number;
  empty: PanelTableScaffoldEmpty;
  children: ReactNode;
  trailing?: ReactNode;
}

/**
 * Shared presentational render shell for the change / stakeholders / RAID entity
 * panels: pane container + optional ViewCallout + toolbar slot + bulk edit bar/panel +
 * scroll container that switches between a clickable dashed "add first item" empty
 * state and the panel's own <table> (children), plus a trailing slot for the edit
 * modal. Byte-identical to the inline shell each panel used before — every className
 * is a literal here, so the DOM is unchanged across all three callers.
 */
export function PanelTableScaffold({
  paneRef,
  containerRef,
  view,
  lang,
  showHints,
  isPopout,
  onLearnMore,
  toolbar,
  bulk,
  bulkPrintHidden,
  count,
  empty,
  children,
  trailing,
}: PanelTableScaffoldProps) {
  const bulkBlock = (
    <>
      <BulkEditBar
        lang={lang}
        count={bulk.count}
        open={bulk.open}
        onToggleOpen={bulk.onToggleOpen}
        onClear={bulk.onClear}
      />
      {bulk.open && bulk.count > 0 && (
        <BulkEditPanel lang={lang} count={bulk.count} fields={bulk.fields} onApply={bulk.onApply} onCancel={bulk.onCancel} />
      )}
    </>
  );

  return (
    <div ref={paneRef} className={`print-root print-landscape ${VIEW_PANE_RESIZABLE_CLASS}`}>
      {onLearnMore && (
        <ViewCallout view={view} lang={lang} showHints={showHints !== false} isPopout={!!isPopout} onLearnMore={onLearnMore} />
      )}
      {toolbar}

      {bulkPrintHidden === false ? bulkBlock : <div className="print:hidden">{bulkBlock}</div>}

      <div ref={containerRef} className={count === 0 ? undefined : "min-h-[240px] flex-1 overflow-auto rounded-md border border-line pr-2"}>
        {count === 0 ? (
          <button
            type="button"
            onClick={empty.onAdd}
            aria-label={empty.ariaLabel}
            className={`flex w-full flex-col items-center gap-2 rounded-md border border-dashed border-line p-10 text-center text-sm text-muted-foreground hover:border-AIPM-dark-blue hover:text-AIPM-dark-blue dark:hover:text-AIPM-light-grey ${INTERACTIVE}`}
          >
            <span>{empty.text}</span>
            <span className="font-medium">{empty.addLabel}</span>
          </button>
        ) : (
          children
        )}
      </div>

      {trailing}
    </div>
  );
}
