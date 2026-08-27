import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { TimelogPeopleTable } from "./timelog-people-table";
import type { RowSelection } from "./use-row-selection";
import type { TimelogUser } from "./timelog-types";
import { expectRowUniqueNames } from "../test/row-unique-names";

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

  // §247/§248: `displayId` is `u.email || String(u.userId)`, and email is free
  // text arriving from a system this repo does not own — a duplicate email
  // collides all four of a row's labels (the resource select, the clear
  // button, the row checkbox, and the remove button) at once, even though
  // `userId` itself cannot repeat. `roles` names every control type the row
  // renders: the select-all + row checkboxes, the resource comboboxes, and
  // the remove buttons. Whole-document scope: the table has no other control
  // reusing a per-row name.
  it("keeps every per-row control distinct when two users share an email", () => {
    const dupes: readonly TimelogUser[] = [
      { userId: 1, firstName: "Ada", lastName: "Lovelace", initials: "AL", email: "dup@x.com", isActive: true },
      { userId: 2, firstName: "Alan", lastName: "Turing", initials: "AT", email: "dup@x.com", isActive: true },
    ];
    render(
      <TimelogPeopleTable
        lang="en-US"
        isPopout={false}
        colWidths={{ select: 40, people: 200, resource: 200, actions: 80 }}
        startColResize={() => {}}
        sel={SEL}
        visibleFilteredIds={dupes.map((u) => u.userId)}
        filteredUsers={dupes}
        // A link on both rows so the "Clear" button renders too (with no
        // link it never mounts, and the mutation proof below could not
        // reach it — see the commit's own record of that).
        effectiveUserLinks={[
          { timelogUserId: 1, resourceId: 1, manual: true },
          { timelogUserId: 2, resourceId: 1, manual: true },
        ]}
        matchableResources={[
          { id: 1, firstName: "R", lastName: "One", roleId: null, utilizationMode: "percent", utilization: {} },
        ]}
        manualLinkUser={() => {}}
        removeUsers={vi.fn()}
      />,
    );
    // Measured (`expectRowUniqueNames` with minControls set high, then read
    // the printed list): 1 select-all checkbox + 2 row checkboxes + 2
    // resource comboboxes + 2 Clear buttons + 2 remove buttons = 9.
    expectRowUniqueNames({
      minControls: 9,
      roles: ["button", "checkbox", "combobox"],
      requireCollisionSeed: true,
    });
  });
});
