// Pure decision for "which customer/project scope should the Time-bookings
// picker start from?", plus the predicate for "is the picker now showing a
// different customer than the loaded bookings came from?".
//
// Extracted out of the panel's render-time reconcile because that block is a
// guarded seeding ladder (userPicked / seededRank, reset by a last-seen project
// key) which is easy to break silently and expensive to test through a mounted
// panel.
//
// i18n-free, clock-free, no React.

import { resolveCustomerByName } from "./timelog-match";
import type { TimelogPickerScope } from "./timelog-picker-store";

export type InitialScopeSource = "picker" | "links" | "auto" | "none";

export interface InitialScope {
  customerId: number | "";
  projectIds: number[];
  source: InitialScopeSource;
}

export function resolveInitialScope(input: {
  /** Per-device picker scope for this project (what is currently selected). */
  picker: TimelogPickerScope;
  /** Workspace-level last-fetched scope. */
  links: { customerId?: number; projectIds?: number[] };
  /** Loaded customer directory — empty until it has been fetched. */
  customers: readonly { id: number; name: string }[];
  /** The project's free-text customer name, for the auto-resolve fallback. */
  customerName: string | undefined;
}): InitialScope {
  const { picker, links, customers, customerName } = input;

  // (1) The device picker wins. It exists precisely so a selection made WITHOUT
  //     fetching survives a reload, so it must outrank the last-fetched scope.
  if (picker.customerId !== undefined) {
    return { customerId: picker.customerId, projectIds: picker.projectIds ?? [], source: "picker" };
  }

  // (2) Else the last-fetched scope.
  if (links.customerId !== undefined) {
    return { customerId: links.customerId, projectIds: links.projectIds ?? [], source: "links" };
  }

  // (3) Else resolve the project's customer name against the directory — only
  //     possible once it has loaded. resolveCustomerByName returns null unless
  //     exactly one customer matches, so an ambiguous name resolves to nothing.
  if (customers.length > 0) {
    const hit = resolveCustomerByName(customers, customerName);
    if (hit) return { customerId: hit.id, projectIds: [], source: "auto" };
  }

  return { customerId: "", projectIds: [], source: "none" };
}

/** True when the picker shows a different customer than the one the currently
 *  loaded bookings came from. The panel surfaces this instead of letting the
 *  picker silently misrepresent what is on screen. */
export function scopeMismatch(
  pickerCustomerId: number | "",
  lastFetchedCustomerId: number | undefined,
): boolean {
  return (
    lastFetchedCustomerId !== undefined &&
    pickerCustomerId !== "" &&
    pickerCustomerId !== lastFetchedCustomerId
  );
}
