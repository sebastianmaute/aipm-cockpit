// open-followups §316 — TimeLog project names repeat across customers, so each
// row's controls must be named by a row-unique token, not the bare name.
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { TimelogProjectsTable } from "./timelog-projects-table";
import { t } from "./i18n";
import { expectRowUniqueNames } from "../test/row-unique-names";

function renderTable(names: string[]) {
  render(
    <TimelogProjectsTable
      lang="en-US"
      isPopout={false}
      knownProjectRefs={names.map((name, i) => ({ id: i + 1, name, no: `P-${i + 1}` }))}
      effectiveProjectLinks={names.map((_, i) => ({ timelogProjectId: i + 1, bucketId: null, manual: true }))}
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

describe("TimelogProjectsTable row names (§316)", () => {
  it("keeps the budget select and Clear apart for two projects with one name", () => {
    renderTable(["Support", "Support"]);
    const select = t("en-US", "timelogMatchProjects");
    expect(screen.getByRole("combobox", { name: `${select} – Support (2)` })).toBeInTheDocument();
    expectRowUniqueNames({ minControls: 2, roles: ["combobox"], requireCollisionSeed: true });
    expectRowUniqueNames({ minControls: 2, requireCollisionSeed: true });
  });

  it("leaves a unique project name bare", () => {
    renderTable(["Support", "Rollout"]);
    expect(screen.getByRole("combobox", { name: `${t("en-US", "timelogMatchProjects")} – Rollout` })).toBeInTheDocument();
  });
});
