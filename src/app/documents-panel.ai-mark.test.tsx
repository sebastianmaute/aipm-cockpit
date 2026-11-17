import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { DocumentsPanel } from "./documents-panel";
import { ConfirmProvider } from "./confirm-dialog";
import { ToastProvider } from "./toast-context";
import { WorkspaceTabProvider } from "./workspace-tab-context";
import { ActivityLogProvider } from "./activity-log-context";
import { applyDocMutation, type DocMutation, type DocResult } from "./document-mutations";
import type { ProjectDocument } from "./document-model";
import type { DocVersion, DocVersionSource } from "./document-versions";
import { emptyWorkspace } from "./workspace";
import { mintId } from "./id-mint-session";
import { t } from "./i18n";

vi.mock("./document-assets-store", () => ({
  loadAssetData: vi.fn(async () => "QUJD"),
  loadAssetDataIds: vi.fn(async () => []),
  saveAssetData: vi.fn(async () => {}),
  deleteAssetData: vi.fn(async () => {}),
}));

const NOW = "2026-11-17T00:00:00.000Z";
const BADGE = t("en-US", "docAiMarkBadge");
const REMOVE = t("en-US", "docAiMarkRemove");

function doc(aiGenerated: boolean): ProjectDocument {
  return { id: 1, title: "Status report", blocks: [], createdAt: NOW, updatedAt: NOW, ...(aiGenerated ? { aiGenerated: true as const } : {}) };
}

function setup(initial: ProjectDocument, opts: { isReadOnly?: boolean } = {}) {
  const box: { docs: readonly ProjectDocument[]; versions: readonly DocVersion[] } = { docs: [initial], versions: [] };
  const mutate = vi.fn((m: DocMutation, source: DocVersionSource): DocResult => {
    const r = applyDocMutation({ documents: box.docs, versions: box.versions }, m, {
      now: NOW,
      source,
      mintDocId: () => mintId("document", box.docs),
      mintVersionId: () => mintId("documentVersion", box.versions),
    });
    box.docs = r.documents;
    box.versions = r.versions;
    return r;
  });
  const log = vi.fn();
  const wrap = (children: ReactNode) => (
    <WorkspaceTabProvider>
      <ToastProvider value={{ showToast: vi.fn(), showToastAction: vi.fn() }}>
        <ConfirmProvider lang="en-US">
          <ActivityLogProvider value={log}>{children}</ActivityLogProvider>
        </ConfirmProvider>
      </ToastProvider>
    </WorkspaceTabProvider>
  );
  render(
    wrap(
      <DocumentsPanel lang="en-US" documents={[initial]} mutateDocuments={mutate} documentVersions={[]} ws={emptyWorkspace()} onResetSize={() => {}} isReadOnly={opts.isReadOnly} />,
    ),
  );
  return { box, mutate, log };
}

const removeCalls = (mutate: ReturnType<typeof setup>["mutate"]) => mutate.mock.calls.filter(([m]) => m.kind === "removeAiMark");

describe("document view AI-generated mark (§801)", () => {
  it("shows the badge and a remove button named by its visible label on a marked document", () => {
    setup(doc(true));
    expect(screen.getByText(BADGE)).toBeInTheDocument();
    const btn = screen.getByRole("button", { name: REMOVE });
    expect(btn).toHaveTextContent(REMOVE);
  });

  it("shows neither on an unmarked document", () => {
    setup(doc(false));
    expect(screen.queryByText(BADGE)).toBeNull();
    expect(screen.queryByRole("button", { name: REMOVE })).toBeNull();
  });

  it("offers no remove on a read-only surface but still shows the badge", () => {
    setup(doc(true), { isReadOnly: true });
    expect(screen.getByText(BADGE)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: REMOVE })).toBeNull();
  });

  it("asks first; cancel changes nothing and logs nothing", async () => {
    const user = userEvent.setup();
    const { mutate, log } = setup(doc(true));
    await user.click(screen.getByRole("button", { name: REMOVE }));
    expect(await screen.findByText(t("en-US", "docAiMarkRemoveConfirm"))).toBeInTheDocument();
    expect(removeCalls(mutate)).toHaveLength(0);
    await user.click(screen.getByRole("button", { name: t("en-US", "cancel") }));
    await waitFor(() => expect(screen.queryByText(t("en-US", "docAiMarkRemoveConfirm"))).toBeNull());
    expect(removeCalls(mutate)).toHaveLength(0);
    expect(log).not.toHaveBeenCalled();
  });

  it("Escape in the confirm dialog cancels: no mutation, no log", async () => {
    const user = userEvent.setup();
    const { mutate, log } = setup(doc(true));
    await user.click(screen.getByRole("button", { name: REMOVE }));
    await screen.findByText(t("en-US", "docAiMarkRemoveConfirm"));
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByText(t("en-US", "docAiMarkRemoveConfirm"))).toBeNull());
    expect(removeCalls(mutate)).toHaveLength(0);
    expect(log).not.toHaveBeenCalled();
  });

  it("confirm removes the mark through mutateDocuments as the user and logs exactly one entry", async () => {
    const user = userEvent.setup();
    const { mutate, box, log } = setup(doc(true));
    await user.click(screen.getByRole("button", { name: REMOVE }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: REMOVE }));
    await waitFor(() => expect(removeCalls(mutate)).toHaveLength(1));
    expect(removeCalls(mutate)[0]).toEqual([{ kind: "removeAiMark", id: 1 }, "user"]);
    expect(box.docs[0].aiGenerated).toBeUndefined();
    expect(log).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith("user", "document.aiMarkRemoved", "Status report");
  });

  it("does not log when the mutation is refused", async () => {
    const user = userEvent.setup();
    const { mutate, log } = setup(doc(true));
    mutate.mockImplementationOnce(() => ({ documents: [], versions: [], changed: false, rejected: ["x"], documentId: null, minted: null }));
    await user.click(screen.getByRole("button", { name: REMOVE }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: REMOVE }));
    await waitFor(() => expect(removeCalls(mutate)).toHaveLength(1));
    expect(log).not.toHaveBeenCalled();
  });
});
