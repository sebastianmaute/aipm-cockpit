// §389: `ModalHeader` defaults every modal's ✕ to the same `alertModalClose`
// string, so two stacked modals present two controls with one accessible
// name — screen readers scope by `aria-modal`, but speech input does not, so
// "click Close" with two Closes rendered resolves against either one.
//
// Five dialogs that can genuinely be open on top of another modal now pass
// `closeLabel`, qualified with their OWN title via `rowLabel` (the shared
// en-dash convention `row-tokens.ts` and `task-time-tracking-modal.tsx`'s
// `qualifyWithTitle` both use — reused here rather than a new separator).
// The OUTER modal in every pair (TaskFormModal / AssetLibraryModal /
// EditModalShell) keeps its bare ✕ — see modal-header.tsx's `closeLabel`
// docstring; verified by reading each outer's own `<ModalHeader>` call,
// which passes no `closeLabel`.
//
// ★★★ THE POINT OF THIS FILE. The open-followups entry says a unit test is
// the only possible detector for this class of defect, and it MUST render
// BOTH layers — a fixture with one modal cannot fail. `BareOuterHeader`
// stands in for the outer's bare close (byte-identical to what TaskFormModal
// / AssetLibraryModal / EditModalShell actually render — same component, no
// `closeLabel`), so each test below mounts it ALONGSIDE the real inner
// component and asserts the two rendered close buttons are distinct.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ModalHeader } from "./modal-header";
import { TaskLinkedTaskModal } from "./task-linked-task-modal";
import { JiraConflictsModal } from "./jira-conflicts-modal";
import { AssetPreviewModal } from "./asset-preview-modal";
import { ConfirmProvider, useConfirm } from "./confirm-dialog";
import { TypeToConfirmDialog } from "./type-to-confirm-dialog";
import { t } from "./i18n";
import { expectRowUniqueNames } from "../test/row-unique-names";
import type { DocumentAsset } from "./document-asset";
import type { ConflictItem } from "./jira-api";

// Modal's focus-management effect schedules through rAF; synchronous shim so
// it settles within the same tick (mirrors confirm-dialog.test.tsx).
beforeEach(() => {
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
    cb(0);
    return 0;
  });
  vi.stubGlobal("cancelAnimationFrame", () => {});
});

const BARE_CLOSE = t("en-US", "alertModalClose");

/** Stand-in for the always-bare outer modal's own `ModalHeader`. */
function BareOuterHeader({ title }: { title: string }) {
  return <ModalHeader lang="en-US" title={title} onClose={() => {}} />;
}

function asset(id: string, name: string): DocumentAsset {
  return { id, name, mime: "image/png", size: 42, hash: `hash-${id}`, createdAt: "2026-01-01T00:00:00.000Z" };
}

const CONFLICT: ConflictItem = {
  taskId: 42,
  jiraKey: "PROJ-7",
  jiraIssueType: "Story",
  remoteDone: false,
  remoteStatus: "To Do",
  localStatus: "To Do",
  fields: [{ key: "taskName", localValue: "Local title", remoteValue: "Remote title" }],
};

function ConfirmTrigger() {
  const confirm = useConfirm();
  return (
    <button type="button" onClick={() => void confirm({ message: "Delete this item?" })}>
      open confirm
    </button>
  );
}

describe("§389 — stacked modals' close buttons stay distinct", () => {
  it("task editor + \"new linked task\" modal", () => {
    render(
      <>
        <BareOuterHeader title="Task editor" />
        <TaskLinkedTaskModal lang="en-US" today="2026-07-10" onCreate={() => {}} onClose={() => {}} />
      </>,
    );
    expect(screen.getByRole("button", { name: BARE_CLOSE })).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: `${BARE_CLOSE} – ${t("en-US", "taskEditorNewLinkedTask")}`,
      }),
    ).toBeInTheDocument();
    expectRowUniqueNames({ minControls: 2, roles: ["button"], requireCollisionSeed: false });
  });

  it("task editor + Jira conflicts modal", () => {
    render(
      <>
        <BareOuterHeader title="Task editor" />
        <JiraConflictsModal lang="en-US" conflicts={[CONFLICT]} onResolve={() => {}} onClose={() => {}} />
      </>,
    );
    expect(screen.getByRole("button", { name: BARE_CLOSE })).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: `${BARE_CLOSE} – ${t("en-US", "jiraConflictTitle")}`,
      }),
    ).toBeInTheDocument();
    expectRowUniqueNames({ minControls: 2, roles: ["button"], requireCollisionSeed: false });
  });

  it("asset library + asset preview modal", async () => {
    render(
      <>
        <BareOuterHeader title="Asset library" />
        <AssetPreviewModal
          lang="en-US"
          open
          onClose={() => {}}
          assets={[asset("a", "Alpha")]}
          startIndex={0}
          loadImage={vi.fn(async () => "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7")}
        />
      </>,
    );
    const qualified = `${BARE_CLOSE} – ${t("en-US", "assetPreviewTitle", "Alpha")}`;
    expect(await screen.findByRole("button", { name: qualified })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: BARE_CLOSE })).toBeInTheDocument();
    expectRowUniqueNames({ minControls: 2, roles: ["button"], requireCollisionSeed: false });
  });

  it("edit modal + confirm dialog (delete gate)", async () => {
    const user = userEvent.setup();
    render(
      <ConfirmProvider lang="en-US">
        <BareOuterHeader title="Edit item" />
        <ConfirmTrigger />
      </ConfirmProvider>,
    );
    await user.click(screen.getByRole("button", { name: "open confirm" }));
    const qualified = `${BARE_CLOSE} – ${t("en-US", "confirmTitle")}`;
    expect(await screen.findByRole("button", { name: qualified })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: BARE_CLOSE })).toBeInTheDocument();
    expectRowUniqueNames({ minControls: 2, roles: ["button"], requireCollisionSeed: false });
  });

  it("task editor + type-to-confirm dialog (voice clear-all)", () => {
    const title = "Clear all tasks?";
    render(
      <>
        <BareOuterHeader title="Task editor" />
        <TypeToConfirmDialog
          lang="en-US"
          title={title}
          message="Type the phrase to confirm."
          confirmValue="DELETE"
          confirmLabel="Clear all"
          onConfirm={() => {}}
          onCancel={() => {}}
        />
      </>,
    );
    expect(screen.getByRole("button", { name: BARE_CLOSE })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: `${BARE_CLOSE} – ${title}` })).toBeInTheDocument();
    expectRowUniqueNames({ minControls: 2, roles: ["button"], requireCollisionSeed: false });
  });
});
