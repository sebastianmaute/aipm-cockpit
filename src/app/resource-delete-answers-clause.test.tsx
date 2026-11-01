// §788 — the delete confirmation says what Undo will NOT bring back, but only where answers are shared.
import { fireEvent, render as rtlRender, screen, waitFor } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { ConfirmProvider } from "./confirm-dialog";
import { FiltersProvider } from "./filters-context";
import { WorkspaceProvider } from "./workspace-context";
import { WorkspaceTabProvider } from "./workspace-tab-context";
import { ResourceEditModal } from "./resource-edit-modal";
import { ResourceDirectory } from "./resource-directory";
import { loadI18n, t } from "./i18n";
import type { Resource } from "./types";
import type { CrossProjectPeople, CrossProjectStatus } from "./use-cross-project-people";

beforeAll(async () => { await loadI18n("de"); });

const person: Resource = {
  id: 1, firstName: "Sofia", lastName: "Ramirez", email: "sofia@acme.test",
  roleId: null, utilizationMode: "percent", utilization: {},
};
const other: Resource = { ...person, id: 2, firstName: "Ada", lastName: "Lovelace", email: "ada@acme.test" };

function cross(status: CrossProjectStatus): CrossProjectPeople {
  return {
    status, failures: [], loadFailed: false, singleProject: false, protectedProjects: [], matches: new Map(),
    elsewhere: () => [], suggestionHours: () => 0, nameOf: () => "", request: vi.fn(),
    confirm: vi.fn(async () => {}), reject: vi.fn(async () => {}), undo: vi.fn(async () => {}), forgetPeople: vi.fn(async () => {}),
  };
}

function Providers({ children }: { children: ReactNode }) {
  return (
    <FiltersProvider><WorkspaceProvider><WorkspaceTabProvider><ConfirmProvider lang="en-US">{children}</ConfirmProvider></WorkspaceTabProvider></WorkspaceProvider></FiltersProvider>
  );
}

const note = t("en-US", "resourceDeleteAnswersNote");

describe("the clause", () => {
  it("is worded in both languages and says Undo does not bring the answers back", () => {
    expect(note).toMatch(/Undo/);
    expect(t("de", "resourceDeleteAnswersNote")).toMatch(/Rückgängig/);
  });
});

describe("single delete confirmation (ResourceEditModal)", () => {
  async function openConfirm(crossProject: CrossProjectPeople | undefined) {
    rtlRender(
      <Providers>
        <ResourceEditModal lang="en-US" resource={person} isNew={false} onSave={vi.fn()} onDelete={vi.fn()} onClose={vi.fn()} crossProject={crossProject} />
      </Providers>,
    );
    fireEvent.click(screen.getByRole("button", { name: /^delete$/i }));
    await screen.findByText(new RegExp(t("en-US", "resourceConfirmDelete").replace(/[?]/g, "\\?")));
  }

  it.each(["ready", "idle", "loading"] as const)("shows the clause when answers are shared (status %s)", async (status) => {
    await openConfirm(cross(status));
    expect(screen.getByText(new RegExp(note.slice(0, 30)))).toBeTruthy();
  });

  it("does not show it when the feature is unavailable, or absent (popout)", async () => {
    await openConfirm(cross("unavailable"));
    expect(screen.queryByText(new RegExp(note.slice(0, 30)))).toBeNull();
  });

  it("does not show it without a crossProject", async () => {
    await openConfirm(undefined);
    expect(screen.queryByText(new RegExp(note.slice(0, 30)))).toBeNull();
  });
});

describe("bulk delete confirmation (ResourceDirectory)", () => {
  async function openBulk(sharesAnswers: boolean | undefined) {
    rtlRender(
      <Providers>
        <ResourceDirectory
          lang="en-US" resources={[person, other]} roles={[]} disciplines={[]} grades={[]}
          onAssignRoleById={vi.fn()} onEditResource={vi.fn()} onAddResource={vi.fn()} onAddAbsence={vi.fn()}
          onBulkEditResources={vi.fn()} onBulkDeleteResources={vi.fn()} sharesAnswers={sharesAnswers}
        />
      </Providers>,
    );
    fireEvent.click(screen.getByRole("checkbox", { name: /select all/i }));
    fireEvent.click(screen.getByRole("button", { name: /delete selected/i }));
    await screen.findByText(/calendar entries \(absences and shifts\) will also be removed/i);
  }

  it("shows the clause when answers are shared", async () => {
    await openBulk(true);
    await waitFor(() => expect(screen.getByText(new RegExp(note.slice(0, 30)))).toBeTruthy());
  });

  it("does not show it when they are not, or the prop is absent", async () => {
    await openBulk(false);
    expect(screen.queryByText(new RegExp(note.slice(0, 30)))).toBeNull();
  });

  it("does not show it when the prop is absent", async () => {
    await openBulk(undefined);
    expect(screen.queryByText(new RegExp(note.slice(0, 30)))).toBeNull();
  });
});
