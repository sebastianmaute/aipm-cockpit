import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { TimelogPeopleTable } from "./timelog-people-table";
import type { RowSelection } from "./use-row-selection";
import type { TimelogUser } from "./timelog-types";

const USERS: readonly TimelogUser[] = [
  { userId: 1, firstName: "Ada", lastName: "Lovelace", initials: "AL", email: "ada@x.com", isActive: true },
  { userId: 2, firstName: "Alan", lastName: "Turing", initials: "AT", email: "alan@x.com", isActive: true },
];

const SEL: RowSelection = {
  selectedIds: new Set<number>(),
  count: 0,
  isSelected: () => false,
  toggle: () => {},
  toggleAllVisible: () => {},
  allSelected: () => false,
  clear: () => {},
};

function renderTable(removeUsers = vi.fn()) {
  render(
    <TimelogPeopleTable
      lang="en-US"
      isPopout={false}
      colWidths={{ select: 40, people: 200, resource: 200, actions: 80 }}
      startColResize={() => {}}
      sel={SEL}
      visibleFilteredIds={USERS.map((u) => u.userId)}
      filteredUsers={USERS}
      effectiveUserLinks={[]}
      matchableResources={[]}
      manualLinkUser={() => {}}
      removeUsers={removeUsers}
    />,
  );
  return removeUsers;
}

describe("TimelogPeopleTable", () => {
  it("gives each row's remove button the per-row `danger` recipe, not the wipes-everything one", () => {
    // ★ This unlinks ONE user, so it takes IconButton's `danger` variant —
    // muted at rest, pink on hover — matching the five other per-row removes
    // converted in this batch. `dangerBordered` (border-ui-pink/50 +
    // text-ui-pink-strong AT REST) is reserved for a standing destructive
    // toolbar action; tasks-section's Clear all is its only other call site,
    // and IconButton's own doc comment says so.
    //
    // ★ Bounded with `(^|\s)…(\s|$)`, never `\b`: `-` is a non-word character,
    // so `\bborder-ui-pink\b` would also match `dark:border-ui-pink/50`.
    //
    // ★ This assertion is the ONLY guard on the variant — jsdom has no layout
    // and axe has no rule for colour-at-rest, so the batch shipped this one
    // conversion unpinned and a reviewer caught it by reading.
    renderTable();
    const cls = screen.getByRole("button", { name: /remove – ada@x\.com/i }).className;
    expect(cls).toMatch(/(^|\s)hover:text-ui-pink-strong(\s|$)/);
    expect(cls).not.toMatch(/border-ui-pink/);
  });

  it("names each remove button after its own row", () => {
    // N identical "Remove" buttons in a list is WCAG 2.4.6. The axe gate cannot
    // catch it here — the live app seeds at most one TimeLog user, so the
    // collision never renders at scan time. Two rows in the fixture is what
    // makes this non-vacuous.
    renderTable();
    expect(screen.getByRole("button", { name: /remove – ada@x\.com/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /remove – alan@x\.com/i })).toBeInTheDocument();
  });

  it("removes only the row whose button was clicked", () => {
    const removeUsers = renderTable();
    screen.getByRole("button", { name: /remove – alan@x\.com/i }).click();
    expect(removeUsers).toHaveBeenCalledWith([2]);
  });

  it("disables the row controls in a popout", () => {
    // `disabled` survived the IconButton conversion — the primitive spreads
    // ...props onto the <button>, so this would silently become inoperable-
    // looking-but-live if a future variant destructured instead.
    render(
      <TimelogPeopleTable
        lang="en-US"
        isPopout
        colWidths={{ select: 40, people: 200, resource: 200, actions: 80 }}
        startColResize={() => {}}
        sel={SEL}
        visibleFilteredIds={USERS.map((u) => u.userId)}
        filteredUsers={USERS}
        effectiveUserLinks={[]}
        matchableResources={[]}
        manualLinkUser={() => {}}
        removeUsers={() => {}}
      />,
    );
    expect(screen.getByRole("button", { name: /remove – ada@x\.com/i })).toBeDisabled();
  });
});
