"use client";
// src/app/timelog-people-table.tsx — the TimeLog people-matching table.
//
// Split out of timelog-panel.tsx (the gantt convention: a panel past the size
// ratchet sheds PURE presentational pieces). Data and handlers arrive as props;
// this file owns no state and makes no decisions.
import { useMemo } from "react";
import { t, type Lang } from "./i18n";
import { DataTable } from "./data-table";
import { Checkbox, Select } from "./form-controls";
import { ColumnResizeHandle } from "./task-manager-ui";
import { INTERACTIVE } from "./interaction-styles";
import { XMarkIcon } from "./icons";
import { IconButton } from "./icon-button";
import type { Resource } from "./types";
import type { RowSelection } from "./use-row-selection";
import type { TimelogUser, TimelogUserLink } from "./timelog-types";
import { buildRowTokens, rowLabel } from "./row-tokens";
import { ROW_RULE_CLASS } from "./table-styles";

// Module-scope accessor (see use-row-tokens.ts): a fresh inline arrow would
// defeat the memo and trip react-hooks/exhaustive-deps (fatal here).
// `TimelogUser` has no `id` field (`userId` instead), so `useRowTokens`
// (constrained to `{ id: number }`) does not fit — this calls
// `buildRowTokens` directly. `displayId` is `u.email || String(u.userId)`:
// `email` is free text arriving from a system this repo does not own, so a
// duplicate email collides all four of this row's labels at once even though
// `userId` itself cannot repeat.
const displayIdOf = (u: TimelogUser) => u.email || String(u.userId);

export function TimelogPeopleTable({
  lang,
  isPopout,
  colWidths,
  startColResize,
  sel,
  visibleFilteredIds,
  filteredUsers,
  effectiveUserLinks,
  matchableResources,
  manualLinkUser,
  removeUsers,
}: {
  lang: Lang;
  isPopout: boolean;
  colWidths: Record<string, number>;
  startColResize: (col: string, e: React.MouseEvent) => void;
  sel: RowSelection;
  visibleFilteredIds: number[];
  filteredUsers: readonly TimelogUser[];
  effectiveUserLinks: readonly TimelogUserLink[];
  matchableResources: readonly Resource[];
  manualLinkUser: (timelogUserId: number, resourceId: number | null) => void;
  removeUsers: (ids: readonly number[]) => void;
}) {
  // Built over `filteredUsers` — the same array rendered below — so the
  // occurrence numbering matches what a screen-reader user navigates.
  const rowTokens = useMemo(
    () => buildRowTokens(filteredUsers.map((u) => ({ id: u.userId, name: displayIdOf(u) }))),
    [filteredUsers],
  );

  return (
    <div className="overflow-x-auto">
      <DataTable className="w-full text-sm" head={<>
          <tr>
            <th scope="col" className="relative px-2 py-1 text-left" style={{ width: colWidths.select, minWidth: colWidths.select }}>
              <Checkbox
                aria-label={t(lang, "selectAllVisibleRows")}
                disabled={isPopout}
                checked={sel.allSelected(visibleFilteredIds)}
                onChange={() => sel.toggleAllVisible(visibleFilteredIds)}
                className="align-middle"
              />
              <ColumnResizeHandle col="select" onMouseDown={startColResize} />
            </th>
            <th scope="col" className="relative px-2 py-1 text-left" style={{ width: colWidths.people, minWidth: colWidths.people }}>
              {t(lang, "timelogMatchPeople")}
              <ColumnResizeHandle col="people" onMouseDown={startColResize} />
            </th>
            <th scope="col" className="relative px-2 py-1 text-left" style={{ width: colWidths.resources, minWidth: colWidths.resources }}>
              {t(lang, "tabResources")}
              <ColumnResizeHandle col="resources" onMouseDown={startColResize} />
            </th>
            <th scope="col" className="relative px-2 py-1 text-left" style={{ width: colWidths.status, minWidth: colWidths.status }}>
              {t(lang, "status")}
              <ColumnResizeHandle col="status" onMouseDown={startColResize} />
            </th>
            <th scope="col" className="relative px-2 py-1 text-left" style={{ width: colWidths.clear, minWidth: colWidths.clear }}>
              {t(lang, "timelogMatchClear")}
              <ColumnResizeHandle col="clear" onMouseDown={startColResize} />
            </th>
            <th scope="col" className="px-2 py-1 text-left" style={{ width: colWidths.remove, minWidth: colWidths.remove }}>
              {t(lang, "remove")}
            </th>
          </tr>
      </>}>
          {filteredUsers.map((u) => {
            const link = effectiveUserLinks.find((l) => l.timelogUserId === u.userId);
            const displayId = displayIdOf(u);
            // ★ Cannot miss: rowTokens is built from this same .map()'s own
            // filteredUsers array, via buildRowTokens covering every userId in it.
            const token = rowTokens.get(u.userId) ?? displayId;
            const selectLabel = rowLabel(t(lang, "timelogMatchPeople"), token);
            const clearLabel = rowLabel(t(lang, "timelogMatchClear"), token);
            const rowSelectLabel = t(lang, "selectItem", token);
            const removeLabel = rowLabel(t(lang, "remove"), token);
            return (
              <tr key={u.userId} className={ROW_RULE_CLASS}>
                <td className="py-2 pr-2">
                  <Checkbox
                    aria-label={rowSelectLabel}
                    disabled={isPopout}
                    checked={sel.isSelected(u.userId)}
                    onChange={() => sel.toggle(u.userId)}
                    className="align-middle"
                  />
                </td>
                <td className="py-2 pr-3 text-foreground">
                  {u.firstName} {u.lastName}
                  {u.email && (
                    <span className="ml-1 text-xs text-muted-foreground">{u.email}</span>
                  )}
                </td>
                <td className="py-2 pr-2">
                  <Select
                    size="xs"
                    aria-label={selectLabel}
                    value={link?.resourceId ?? ""}
                    disabled={isPopout}
                    onChange={(e) =>
                      manualLinkUser(
                        u.userId,
                        e.target.value === "" ? null : Number(e.target.value),
                      )
                    }
                  >
                    <option value="">{t(lang, "timelogMatchNone")}</option>
                    {matchableResources.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.firstName} {r.lastName}
                      </option>
                    ))}
                  </Select>
                </td>
                <td className="py-2 pr-2">
                  {link && (
                    <span className="rounded-full border border-line px-2 py-0.5 text-xs text-muted-foreground">
                      {t(lang, link.manual ? "timelogMatchManual" : "timelogMatchAuto")}
                    </span>
                  )}
                </td>
                <td className="py-2 pr-2">
                  {link && (
                    <button
                      type="button"
                      aria-label={clearLabel}
                      disabled={isPopout}
                      onClick={() => manualLinkUser(u.userId, null)}
                      className={`rounded border border-line px-2 py-0.5 text-xs text-muted-foreground ${INTERACTIVE}`}
                    >
                      {t(lang, "timelogMatchClear")}
                    </button>
                  )}
                </td>
                <td className="py-2">
                  {/* `danger`, not `dangerBordered`: this unlinks ONE user, so it
                      is the per-row remove glyph the primitive documents — muted
                      at rest, pink on hover — matching every other converted
                      row-remove. It drops the old neutral border and the
                      pink-at-rest text; `dangerBordered` is reserved for a
                      standing destructive toolbar action that wipes everything
                      (tasks-section's Clear all is the only other call site). */}
                  <IconButton
                    variant="danger"
                    label={removeLabel}
                    title={removeLabel}
                    disabled={isPopout}
                    onClick={() => removeUsers([u.userId])}
                  >
                    <XMarkIcon aria-hidden="true" className="h-4 w-4" />
                  </IconButton>
                </td>
              </tr>
            );
          })}
      </DataTable>
    </div>
  );
}
