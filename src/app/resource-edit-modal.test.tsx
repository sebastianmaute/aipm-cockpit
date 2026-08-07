import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render, screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { useEffect, useRef, type ReactNode } from "react";
import { FiltersProvider } from "./filters-context";
import { WorkspaceProvider, useWorkspace } from "./workspace-context";
import { ResourceEditModal } from "./resource-edit-modal";
import { applyTier } from "./field-visibility";
import { t } from "./i18n";
import { selectFieldTier } from "../test/field-tier";
import type { Resource } from "./types";

// ModalFieldControls (rendered in the modal header) reads field visibility from
// the workspace, so every render needs a WorkspaceProvider/FiltersProvider.
function wrapper({ children }: { children: ReactNode }) {
  return (
    <FiltersProvider>
      <WorkspaceProvider>{children}</WorkspaceProvider>
    </FiltersProvider>
  );
}

/** Seeds the workspace field-visibility config once on mount (e.g. Full view). */
function Seed({ tier }: { tier: "full" }) {
  const { setFieldVisibility } = useWorkspace();
  const seeded = useRef(false);
  useEffect(() => {
    if (seeded.current) return;
    seeded.current = true;
    setFieldVisibility(() => ({ resource: applyTier("resource", tier) }));
  }, [setFieldVisibility, tier]);
  return null;
}

const base: Resource = {
  id: 1,
  firstName: "Sample",
  lastName: "Dummy",
  roleId: null,
  utilizationMode: "percent",
  utilization: {},
};

type ModalProps = React.ComponentProps<typeof ResourceEditModal>;

/** Renders the modal at the Advanced default (birthday is Full-only → hidden). */
function setup(over: Partial<ModalProps> = {}) {
  const props: ModalProps = {
    lang: "en-US" as const,
    resource: base,
    isNew: false,
    onSave: vi.fn(),
    onDelete: vi.fn(),
    onClose: vi.fn(),
    ...over,
  };
  const result = render(<ResourceEditModal {...props} />, { wrapper });
  return { props, ...result };
}

/** Like setup, but seeds the Full tier first so the Full-only Birthday block renders. */
function setupFull(over: Partial<ModalProps> = {}) {
  const props: ModalProps = {
    lang: "en-US" as const,
    resource: base,
    isNew: false,
    onSave: vi.fn(),
    onDelete: vi.fn(),
    onClose: vi.fn(),
    ...over,
  };
  const result = render(
    <>
      <Seed tier="full" />
      <ResourceEditModal {...props} />
    </>,
    { wrapper },
  );
  return { props, ...result };
}

describe("ResourceEditModal", () => {
  it("renders nothing when resource is null", () => {
    const { container } = setup({ resource: null });
    expect(container).toBeEmptyDOMElement();
  });

  it("saves with first/last preserved", () => {
    const onSave = vi.fn();
    setup({ onSave });
    fireEvent.submit(
      screen.getByRole("button", { name: /save resource/i }).closest("form")!,
    );
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave.mock.calls[0][0]).toMatchObject({
      firstName: "Sample",
      lastName: "Dummy",
    });
  });

  it("blocks save when both names are empty", () => {
    const onSave = vi.fn();
    setup({ resource: { ...base, firstName: "", lastName: "" }, isNew: true, onSave });
    fireEvent.submit(
      screen.getByRole("button", { name: /save resource/i }).closest("form")!,
    );
    expect(onSave).not.toHaveBeenCalled();
  });

  it("hides Delete in create mode", () => {
    setup({ isNew: true });
    expect(screen.queryByRole("button", { name: /delete/i })).toBeNull();
  });

  it("adds an additional email and saves it (blanks dropped)", () => {
    const onSave = vi.fn();
    setupFull({ onSave });
    fireEvent.click(screen.getByRole("button", { name: /add email/i }));
    // ★ The per-row remove keeps IconButton's `danger` variant — the hand-rolled
    // original already carried this exact hover recipe, and the conversion plan's
    // stated `ghost` default would have silently dropped it.
    expect(screen.getByRole("button", { name: /remove email 1/i }).className).toMatch(
      /\bhover:text-ui-pink-strong\b/,
    );
    const emailInputs = screen.getAllByRole("textbox", { name: /additional emails/i });
    fireEvent.change(emailInputs[0], { target: { value: " alt@x.com " } });
    fireEvent.submit(screen.getByRole("button", { name: /save resource/i }).closest("form")!);
    expect(onSave.mock.calls[0][0]).toMatchObject({ emails: ["alt@x.com"] });
  });

  it("removes an additional email row via its per-row remove button", () => {
    // ★ Behavioural pin for the converted per-row remove: the row must actually
    // disappear. The variant assertion above proves it still LOOKS destructive;
    // this proves it still DOES something. Both were unexercised before.
    setupFull();
    fireEvent.click(screen.getByRole("button", { name: /add email/i }));
    expect(screen.getAllByRole("textbox", { name: /additional emails/i })).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: /remove email 1/i }));
    expect(screen.queryAllByRole("textbox", { name: /additional emails/i })).toHaveLength(0);
  });

  it("saves the External flag when checked", () => {
    const onSave = vi.fn();
    setup({ onSave });
    fireEvent.click(screen.getByRole("checkbox", { name: /external resource/i }));
    fireEvent.submit(screen.getByRole("button", { name: /save resource/i }).closest("form")!);
    expect(onSave.mock.calls[0][0]).toMatchObject({ isExternal: true });
  });

  it("saves a full date when year is known", () => {
    const onSave = vi.fn();
    setupFull({ onSave });
    // "Exact year unknown" defaults checked (no birthday) — uncheck it
    fireEvent.click(screen.getByLabelText(/exact year unknown/i));
    fireEvent.change(screen.getByLabelText("Birthday"), { target: { value: "1990-06-03" } });
    fireEvent.click(screen.getByRole("button", { name: /save resource/i }));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ birthday: "1990-06-03" }));
  });

  it("strips the year to MM-DD when year is unknown", () => {
    const onSave = vi.fn();
    setupFull({ onSave });
    // "Exact year unknown" defaults checked — leave it checked
    fireEvent.change(screen.getByLabelText("Birthday"), { target: { value: "2000-06-03" } });
    fireEvent.click(screen.getByRole("button", { name: /save resource/i }));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ birthday: "06-03" }));
  });

  it("loads an existing MM-DD birthday (year-unknown, anchored) and re-saves it as MM-DD", () => {
    const onSave = vi.fn();
    setupFull({ resource: { ...base, birthday: "06-03" }, onSave });
    expect(screen.getByLabelText(/exact year unknown/i)).toBeChecked();
    expect(screen.getByLabelText("Birthday")).toHaveValue("2000-06-03");
    fireEvent.click(screen.getByRole("button", { name: /save resource/i }));
    expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ birthday: "06-03" }));
  });

  it("renders an InfoTooltip for the Email field (accessible by hint text as aria-label)", () => {
    setupFull();
    expect(screen.getByRole("button", { name: t("en-US", "resourceEmailHint") })).toBeInTheDocument();
  });

  describe("field visibility", () => {
    it("Advanced default shows jobTitle and hides Full-only birthday; switching tiers keeps the required Name input", () => {
      setup();
      // Advanced default: jobTitle (advanced-tier) is visible; birthday (full-tier) is hidden.
      expect(screen.getByText(t("en-US", "resourceJobTitle"))).toBeInTheDocument();
      expect(screen.queryByLabelText("Birthday")).toBeNull();
      // Required Name inputs are always rendered, regardless of tier.
      expect(screen.getByText(t("en-US", "resourceFirstName"))).toBeInTheDocument();

      // Switch to Full via the modal-header control cluster → birthday appears.
      selectFieldTier("fieldViewFull");
      expect(screen.getByLabelText("Birthday")).toBeInTheDocument();
      expect(screen.getByText(t("en-US", "resourceFirstName"))).toBeInTheDocument();

      // Switch to Simple → jobTitle and birthday are hidden, Name still present.
      selectFieldTier("fieldViewSimple");
      expect(screen.queryByText(t("en-US", "resourceJobTitle"))).toBeNull();
      expect(screen.queryByLabelText("Birthday")).toBeNull();
      expect(screen.getByText(t("en-US", "resourceFirstName"))).toBeInTheDocument();
    });
  });

  describe("panel height", () => {
    it("fits its content instead of pinning 620px", () => {
      setup();
      const panel = document.querySelector("[data-modal-panel]") as HTMLElement;
      // h-auto lets the panel shrink to the visible field set; the floor keeps the
      // useResizable drag contract and the cap keeps it inside the viewport.
      expect(panel.className).toContain("h-auto");
      expect(panel.className).toContain("min-h-[280px]");
      expect(panel.className).toContain("max-h-[95vh]");
      expect(panel.className).not.toContain("h-[620px]");
    });

    it("uses a bumped size key so a stored 620px height cannot win", () => {
      // useResizable writes an inline height that beats any class. Without the
      // bump, every user who ever dragged this modal keeps the old fixed height
      // and sees no change at all.
      const src = readFileSync(join(process.cwd(), "src/app", "resource-edit-modal.tsx"), "utf8");
      expect(src).toContain('sizeKey="aipm-cockpit:modal-size:resource-edit-v2"');
    });
  });
});
