// open-followups §316 — each project checkbox is named by the project's name
// and number; with no number, a row token keeps same-named projects apart.
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { TimelogProjectScope } from "./timelog-project-scope";
import { t } from "./i18n";
import { expectRowUniqueNames } from "../test/row-unique-names";

function renderScope(refs: { name: string; no: string }[]) {
  render(
    <TimelogProjectScope
      lang="en-US"
      projects={refs.map((r, i) => ({ id: i + 1, ...r }))}
      selectedIds={new Set()}
      hasCustomer
      filter=""
      onFilterChange={vi.fn()}
      onToggle={vi.fn()}
      onToggleAll={vi.fn()}
    />,
  );
}

const label = () => t("en-US", "timelogProjectScopeLabel");

describe("TimelogProjectScope row names (§316)", () => {
  it("names a project by its name and number", () => {
    renderScope([{ name: "Support", no: "P-1" }, { name: "Support", no: "P-2" }]);
    expect(screen.getByRole("checkbox", { name: `${label()} – Support · P-2` })).toBeInTheDocument();
  });

  it("keeps two same-named projects with no number apart", () => {
    renderScope([{ name: "Support", no: "" }, { name: "Support", no: "" }]);
    expect(screen.getByRole("checkbox", { name: `${label()} – Support (2)` })).toBeInTheDocument();
    expectRowUniqueNames({ minControls: 2, roles: ["checkbox"], requireCollisionSeed: true });
  });
});
