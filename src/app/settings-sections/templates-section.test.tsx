import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { TemplatesSection } from "./templates-section";
import { FiltersProvider } from "../filters-context";
import { WorkspaceProvider } from "../workspace-context";
import { t } from "../i18n";
import { SETTINGS_KEY } from "../use-settings";
import { useTemplates } from "../use-templates";
import { expectRowUniqueNames } from "../../test/row-unique-names";

afterEach(() => window.localStorage.clear());

// TemplatesSection now reads the live workspace (useCurrentWorkspace) to capture
// "save current project as a template", so it needs the workspace providers.
function wrapper({ children }: { children: ReactNode }) {
  return (
    <FiltersProvider>
      <WorkspaceProvider>{children}</WorkspaceProvider>
    </FiltersProvider>
  );
}

describe("TemplatesSection", () => {
  it("lists the three built-in templates", () => {
    render(<TemplatesSection lang="en-US" />, { wrapper });
    expect(screen.getByText("Minimal")).toBeInTheDocument();
    expect(screen.getByText("Standard PM")).toBeInTheDocument();
    expect(screen.getByText("Full delivery")).toBeInTheDocument();
  });
  it("built-in templates have no action button", () => {
    render(<TemplatesSection lang="en-US" />, { wrapper });
    expect(screen.queryByRole("button", { name: t("en-US", "templatesDuplicate") })).toBeNull();
  });
  it("saves the current project as a user template", () => {
    render(<TemplatesSection lang="en-US" />, { wrapper });
    expect(screen.getByText(t("en-US", "templatesSaveCurrent"))).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText(t("en-US", "templateSaveName")), {
      target: { value: "My saved project" },
    });
    fireEvent.click(screen.getByRole("button", { name: t("en-US", "templateSaveAction") }));
    expect(screen.getByDisplayValue("My saved project")).toBeInTheDocument();
  });

  // §247/§248: the rename input's aria-label was the constant translated
  // "Template name" for EVERY row (not merely colliding when names match —
  // colliding always), and the Delete button carried no aria-label at all
  // (falls back to its constant CONTENT "Delete"), found while grounding this
  // task's own enumeration. Both now key off a shared per-list token. Seed
  // two user templates with the SAME name via the real save flow (there is no
  // `userTemplates` prop to seed directly — it comes from the settings hook).
  //
  // Mutation-proved: rename input -> bare constant gives "Template name" x2.
  // Mutation-proved: Delete button -> aria-label removed entirely gives "Delete" x2.
  it("keeps every per-row control distinct when two user templates share a name", () => {
    render(<TemplatesSection lang="en-US" />, { wrapper });
    const nameInput = screen.getByLabelText(t("en-US", "templateSaveName"));
    const saveButton = screen.getByRole("button", { name: t("en-US", "templateSaveAction") });
    fireEvent.change(nameInput, { target: { value: "Copy" } });
    fireEvent.click(saveButton);
    fireEvent.change(nameInput, { target: { value: "Copy" } });
    fireEvent.click(saveButton);

    // Measured (`expectRowUniqueNames` with minControls set high, then read
    // the printed list): the save-name textbox + Save button + 2 rename
    // textboxes + 2 Delete buttons = 6.
    expectRowUniqueNames({
      minControls: 6,
      roles: ["textbox", "button"],
      requireCollisionSeed: true,
    });
  });
});

// ★★★ §622 class — the user-template rename input is uncontrolled and commits
// only on blur/Enter. A window close, reload or navigation runs neither, so a
// typed rename was LOST. `pagehide` commits it; a tab switch must not (owner
// rule), and a close with nothing typed must rename nothing. Asserted on the
// persisted settings, synchronously after the event — the page is gone after.
describe("TemplatesSection rename commits via pagehide (§622)", () => {
  const storedNames = (): string[] =>
    ((JSON.parse(window.localStorage.getItem(SETTINGS_KEY) ?? "{}") as { templates?: { name: string }[] }).templates ?? [])
      .map((tpl) => tpl.name);
  const renameBox = () => screen.getByRole("textbox", { name: new RegExp(`^${t("en-US", "templatesRename")} – `) });
  async function seedTemplate(name: string, beside?: ReactNode) {
    render(<><TemplatesSection lang="en-US" />{beside}</>, { wrapper });
    fireEvent.change(screen.getByLabelText(t("en-US", "templateSaveName")), { target: { value: name } });
    fireEvent.click(screen.getByRole("button", { name: t("en-US", "templateSaveAction") }));
    await waitFor(() => expect(storedNames()).toEqual([name]));
  }
  const pageHide = () => act(() => { window.dispatchEvent(new Event("pagehide")); });

  it("persists a typed-but-unblurred rename on pagehide", async () => {
    await seedTemplate("Draft");
    fireEvent.change(renameBox(), { target: { value: "Final" } });
    pageHide();
    expect(storedNames()).toEqual(["Final"]);
  });

  it("persists nothing on a tab switch", async () => {
    await seedTemplate("Draft");
    fireEvent.change(renameBox(), { target: { value: "Final" } });
    act(() => {
      const spy = vi.spyOn(document, "visibilityState", "get").mockReturnValue("hidden");
      document.dispatchEvent(new Event("visibilitychange"));
      spy.mockRestore();
    });
    expect(storedNames()).toEqual(["Draft"]);
  });

  it("renames nothing on pagehide when unedited or blanked", async () => {
    await seedTemplate("Draft");
    const before = window.localStorage.getItem(SETTINGS_KEY);
    pageHide();
    fireEvent.change(renameBox(), { target: { value: "   " } });
    pageHide();
    expect(window.localStorage.getItem(SETTINGS_KEY)).toBe(before);
  });

  // ★★ Abandon, never clobber: a blur-committed rename must not survive its own
  // commit. Another settings writer (import/restore) renaming the template while
  // this section stays mounted must win over the OLD typed name on close.
  function ExternalRenamer() {
    const { userTemplates, updateTemplate } = useTemplates();
    return (
      <button type="button" onClick={() => updateTemplate(userTemplates[0].id, { name: "External" })}>
        external rename
      </button>
    );
  }
  it("does not write a blur-committed rename back over a newer external name", async () => {
    await seedTemplate("Draft", <ExternalRenamer />);
    fireEvent.change(renameBox(), { target: { value: "Final" } });
    fireEvent.blur(renameBox());
    await waitFor(() => expect(storedNames()).toEqual(["Final"]));
    fireEvent.click(screen.getByRole("button", { name: "external rename" }));
    await waitFor(() => expect(storedNames()).toEqual(["External"]));
    pageHide();
    expect(storedNames()).toEqual(["External"]);
  });

  // Same rule for a PAGEHIDE-committed rename: after a bfcache restore, a second
  // pagehide must not replay it over a newer external name.
  it("does not write a pagehide-committed rename back over a newer external name", async () => {
    await seedTemplate("Draft", <ExternalRenamer />);
    fireEvent.change(renameBox(), { target: { value: "Final" } });
    pageHide();
    expect(storedNames()).toEqual(["Final"]);
    fireEvent.click(screen.getByRole("button", { name: "external rename" }));
    await waitFor(() => expect(storedNames()).toEqual(["External"]));
    pageHide();
    expect(storedNames()).toEqual(["External"]);
  });
});
