import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AssetPreviewModal } from "./asset-preview-modal";
import { t } from "./i18n";
import type { DocumentAsset } from "./document-asset";

const TINY_GIF = "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";

// ★★★ THE FIXTURE MIME MUST BE ON THE ALLOWLIST, AND `image/gif` IS NOT.
// `ASSET_MIME_ALLOWED` (`document-asset-upload.ts:15`) is PNG + JPEG + WebP
// only — GIF is excluded deliberately. Declaring `image/png` while carrying
// GIF bytes is legitimate: the decode trusts the passed mime string and never
// sniffs content. A `image/gif` default makes every "shows the image" test
// render the BLOCKED state instead, which reads as a broken component.
// ★ Every REQUIRED field of `DocumentAsset` (`document-asset.ts:27`), so no
// `as DocumentAsset` cast is needed — a cast would hide a field the real type
// gains later.
function asset(id: string, name: string, mime = "image/png"): DocumentAsset {
  return { id, name, mime, size: 42, hash: `hash-${id}`, createdAt: "2026-01-01T00:00:00.000Z" };
}

function renderModal(over: Partial<Parameters<typeof AssetPreviewModal>[0]> = {}) {
  const onClose = vi.fn();
  const utils = render(
    <AssetPreviewModal
      lang="en-US"
      open
      onClose={onClose}
      assets={[asset("a", "Alpha"), asset("b", "Beta")]}
      startIndex={0}
      loadImage={vi.fn(async () => TINY_GIF)}
      {...over}
    />,
  );
  return { ...utils, onClose };
}

describe("AssetPreviewModal — shell", () => {
  it("renders nothing when closed", () => {
    renderModal({ open: false });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("labels the dialog with the current asset name", async () => {
    renderModal();
    expect(await screen.findByRole("dialog", { name: /Alpha/ })).toBeInTheDocument();
  });

  // ★ The ✕ is the SHARED ModalHeader's, named by the existing
  //   `alertModalClose` key — this component adds no close key of its own.
  it("closes from the shared header's close control", async () => {
    const { onClose } = renderModal();
    await userEvent.click(await screen.findByRole("button", { name: t("en-US", "alertModalClose") }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  // ★★ Escape is handled by the shared `Modal` via dismissal-stack.ts. This
  // asserts we are INSIDE that machinery — it is not a test of our own key
  // handler, because we must not have one.
  it("closes on Escape through the shared modal machinery", async () => {
    const { onClose } = renderModal();
    await screen.findByRole("dialog");
    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
