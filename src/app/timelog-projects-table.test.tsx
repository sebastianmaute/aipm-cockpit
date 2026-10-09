// open-followups §316 — TimeLog project names repeat across customers, so each
// row's controls must be named apart: by the project number, and by a row
// token when two rows still read alike.
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { TimelogProjectsTable } from "./timelog-projects-table";
import { t } from "./i18n";
import { expectRowUniqueNames } from "../test/row-unique-names";
import { buttonClassFor } from "../test/button-variant";
import { primitiveClassFor } from "../test/primitive-class";
import { Badge } from "./badge";

function renderTable(refs: { name: string; no: string }[]) {
  render(
    <TimelogProjectsTable
      lang="en-US"
      isPopout={false}
      knownProjectRefs={refs.map((r, i) => ({ id: i + 1, ...r }))}
      effectiveProjectLinks={refs.map((_, i) => ({ timelogProjectId: i + 1, bucketId: null, manual: true }))}
      budgets={[]}
      onManualLinkProject={vi.fn()}
      includeClosedProjects={false}
      onIncludeClosedChange={vi.fn()}
      syncBusy={false}
      isMisconfigured={false}
      confirming={false}
      onLoadManagedProjects={vi.fn()}
    />,
  );
}

const select = () => t("en-US", "timelogMatchProjects");

describe("TimelogProjectsTable row names (§316)", () => {
  it("tells two projects with one name apart by their project numbers", () => {
    renderTable([{ name: "Support", no: "P-1" }, { name: "Support", no: "P-2" }]);
    expect(screen.getByRole("combobox", { name: `${select()} – Support · P-2` })).toBeInTheDocument();
    expectRowUniqueNames({ minControls: 2, roles: ["combobox"] });
  });

  it("falls back to a row token when the projects have no number", () => {
    renderTable([{ name: "Support", no: "" }, { name: "Support", no: "" }]);
    expect(screen.getByRole("combobox", { name: `${select()} – Support (2)` })).toBeInTheDocument();
    expectRowUniqueNames({ minControls: 2, roles: ["combobox"], requireCollisionSeed: true });
    expectRowUniqueNames({ minControls: 2, requireCollisionSeed: true });
  });
});

// §102 (batch 23, owner decision 2026-10-09): the near-size buttons moved to the shared `xs`.
describe("TimelogProjectsTable buttons on the shared Button", () => {
  it("draws Load my projects and a row's Clear link as secondary xs", () => {
    renderTable([{ name: "Alpha", no: "P1" }]);
    const secondary = buttonClassFor({ variant: "secondary", size: "xs" });
    expect(screen.getByRole("button", { name: t("en-US", "timelogLoadManagedProjects") }).className).toBe(secondary);
    expect(screen.getByRole("button", { name: /^Clear link – / }).className).toBe(secondary);
  });
});

// §695 — the match chip is the shared Badge pill.
describe("TimelogProjectsTable match chip", () => {
  it("renders the shared Badge", () => {
    renderTable([{ name: "Alpha", no: "P-1" }]);
    expect(screen.getByText(t("en-US", "timelogMatchManual")).className).toBe(
      primitiveClassFor(<Badge pill className="border border-line text-muted-foreground">x</Badge>),
    );
  });
});
