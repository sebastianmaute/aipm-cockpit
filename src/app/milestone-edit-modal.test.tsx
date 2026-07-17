import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { useEffect, useRef, type ReactNode } from "react";
import { FiltersProvider } from "./filters-context";
import { WorkspaceProvider, useWorkspace } from "./workspace-context";
import { MilestoneEditModal } from "./milestone-edit-modal";
import { applyTier } from "./field-visibility";
import { t } from "./i18n";

// Mock M365 hooks consumed by KnowledgeLinksFieldGated — default: SharePoint off.
vi.mock("./use-settings", () => ({
  useSettings: () => ({ settings: { integrations: { m365: { enabled: false, sharepoint: false } } }, setSettings: vi.fn(), hydrated: true, i18nReady: true, lang: "en-US" }),
}));
vi.mock("./use-ms-auth", () => ({
  useMsAuth: () => ({ account: null, ready: true, signIn: vi.fn(), signOut: vi.fn(), acquireToken: vi.fn(async () => "tok") }),
}));

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
    setFieldVisibility(() => ({ milestone: applyTier("milestone", tier) }));
  }, [setFieldVisibility, tier]);
  return null;
}

it("renders a new-milestone form without crashing", () => {
  render(
    <MilestoneEditModal
      lang="en-US"
      milestone={{ id: 1, name: "", date: "2026-08-01", linkedTaskIds: [] }}
      isNew
      tasks={[]}
      onSave={vi.fn()}
      onDelete={vi.fn()}
      onClose={vi.fn()}
    />,
    { wrapper },
  );
  expect(screen.getByText(/new milestone/i)).toBeTruthy();
});

describe("MilestoneEditModal — document links", () => {
  it("shows the SharePoint hint when M365 is off", () => {
    // documentLinks is a Full-only registry field, hidden at the Advanced
    // default — seed the Full tier so the Documents block renders.
    render(
      <>
        <Seed tier="full" />
        <MilestoneEditModal
          lang="en-US"
          milestone={{ id: 1, name: "M", date: "2026-01-01", linkedTaskIds: [] }}
          isNew
          tasks={[]}
          onSave={vi.fn()}
          onDelete={vi.fn()}
          onClose={vi.fn()}
        />
      </>,
      { wrapper },
    );
    expect(screen.getByText(/enable microsoft 365/i)).toBeInTheDocument();
  });
});

describe("MilestoneEditModal — field visibility", () => {
  // The required Name input is always shown; "Achieved" (milestoneAchieved) is
  // an Advanced field shown by default; documentLinks is Full-only and hidden
  // at the Advanced default. The cog popover is closed, so body labels are safe.
  const ACHIEVED_LABEL = t("en-US", "milestoneAchieved");
  const SIMPLE_LABEL = t("en-US", "fieldViewSimple");

  function renderModal() {
    return render(
      <MilestoneEditModal
        lang="en-US"
        milestone={{ id: 1, name: "M", date: "2026-01-01", linkedTaskIds: [] }}
        isNew
        tasks={[]}
        onSave={vi.fn()}
        onDelete={vi.fn()}
        onClose={vi.fn()}
      />,
      { wrapper },
    );
  }

  it("shows advanced fields and hides Full-only document links at the Advanced default", () => {
    renderModal();
    // Required Name input is always present.
    expect(screen.getByDisplayValue("M")).toBeInTheDocument();
    // Advanced field visible by default.
    expect(screen.getByText(ACHIEVED_LABEL)).toBeInTheDocument();
    // Full-only document-links block hidden at the Advanced default.
    expect(screen.queryByText(t("en-US", "documents"))).not.toBeInTheDocument();
  });

  it("hides advanced fields when switching to Simple while keeping the required Name input", () => {
    renderModal();
    expect(screen.getByText(ACHIEVED_LABEL)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: SIMPLE_LABEL }));

    // Advanced field gone, required Name input remains.
    expect(screen.queryByText(ACHIEVED_LABEL)).not.toBeInTheDocument();
    expect(screen.getByDisplayValue("M")).toBeInTheDocument();
  });
});
