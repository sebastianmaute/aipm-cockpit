import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AssetLibraryModal } from "./asset-library-modal";

// ★ No ConfirmProvider wrapper needed here: `useConfirm()`'s default context
// (confirm-dialog.tsx) resolves false rather than throwing when there is no
// provider, and none of these cases exercise the confirm-gated delete path.
const props = {
  lang: "en-US" as const,
  open: true,
  onClose: vi.fn(),
  assets: [
    { id: "a1", name: "chart.png", mime: "image/png", size: 2048, width: 800, height: 600, hash: "h1", createdAt: "" },
  ],
  usage: { a1: 1 },
  danglingIds: new Set<string>(),
  busyId: null,
  onRename: vi.fn(),
  onDelete: vi.fn(),
  onInsert: vi.fn(),
  onUpload: vi.fn(),
};

describe("AssetLibraryModal", () => {
  it("renders the library inside a dialog", () => {
    render(<AssetLibraryModal {...props} />);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText("chart.png")).toBeInTheDocument();
  });

  it("renders nothing when closed", () => {
    render(<AssetLibraryModal {...props} open={false} />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  // ★★ Insert must CLOSE the modal. Leaving it open after an insert puts the
  //    dialog over the paragraph the user just changed, so they cannot see the
  //    result of their own action.
  it("closes after an insert and forwards the id", async () => {
    const onInsert = vi.fn();
    const onClose = vi.fn();
    render(<AssetLibraryModal {...props} onInsert={onInsert} onClose={onClose} />);
    await userEvent.click(screen.getByRole("button", { name: /insert.*chart\.png/i }));
    expect(onInsert).toHaveBeenCalledWith("a1");
    expect(onClose).toHaveBeenCalled();
  });
});
