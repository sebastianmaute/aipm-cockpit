"use client";

import type { ReactNode, Ref } from "react";
import type { Lang } from "./i18n";
import type { AppView } from "./nav-config";
import { VIEW_PANE_RESIZABLE_CLASS, INNER_TABLE_CLASS } from "./view-styles";
import { AddFirstItemButton } from "./add-first-item-button";
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
 * modal. The data-view scroller uses the shared INNER_TABLE_CLASS so the three
 * register panels read identically to the tasks / resources tables (rounded-xl
 * bordered surface card), not a divergent rounded-md inset.
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

      <div ref={containerRef} className={count === 0 ? undefined : INNER_TABLE_CLASS}>
        {count === 0 ? (
          <AddFirstItemButton
            onAdd={empty.onAdd}
            ariaLabel={empty.ariaLabel}
            text={empty.text}
            addLabel={empty.addLabel}
            rounded="md"
          />
        ) : (
          children
        )}
      </div>

      {trailing}
    </div>
  );
}
