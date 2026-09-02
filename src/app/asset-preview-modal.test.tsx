import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AssetPreviewModal } from "./asset-preview-modal";
import { t } from "./i18n";
import type { DocumentAsset } from "./document-asset";
import { expectRowUniqueNames } from "../test/row-unique-names";

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

describe("AssetPreviewModal — object URL lifecycle", () => {
  let created: string[];
  let revoked: string[];
  beforeEach(() => {
    created = [];
    revoked = [];
    let n = 0;
    vi.stubGlobal("URL", {
      ...URL,
      createObjectURL: vi.fn(() => { const u = `blob:${++n}`; created.push(u); return u; }),
      revokeObjectURL: vi.fn((u: string) => { revoked.push(u); }),
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("shows the image with the asset name as alt text", async () => {
    renderModal();
    const img = await screen.findByRole("img", { name: "Alpha" });
    expect(img).toHaveAttribute("src", created[0]);
  });

  // ★★★ THE LEAK TEST. Navigating mints a new URL; the previous one must be
  // revoked at that moment, not merely at close.
  it("revokes the previous object URL when navigating", async () => {
    renderModal();
    await screen.findByRole("img", { name: "Alpha" });
    await userEvent.click(screen.getByRole("button", { name: t("en-US", "assetPreviewNext") }));
    await screen.findByRole("img", { name: "Beta" });
    expect(revoked).toContain(created[0]);
  });

  // ★★★ THE IDENTITY-STABILITY TEST. Task 8's real call site passes an inline
  // arrow as `loadImage` — a fresh function identity on every parent render.
  // A re-render while the modal is open (for any reason unrelated to
  // navigate/close) must NOT revoke or re-mint the URL currently on screen.
  // Every other test in this file passes a STABLE `vi.fn()` loader across
  // renders, so none of them can see this defect — this is the only one
  // that varies the loader's identity between renders of the SAME asset.
  it("does not revoke or re-mint the visible URL when only the loadImage identity changes", async () => {
    const loader1 = vi.fn(async () => TINY_GIF);
    const { rerender } = renderModal({ loadImage: loader1 });
    const img = await screen.findByRole("img", { name: "Alpha" });
    const shownUrl = img.getAttribute("src")!;
    expect(created).toHaveLength(1);

    const loader2 = vi.fn(async () => TINY_GIF);
    rerender(
      <AssetPreviewModal
        lang="en-US" open onClose={vi.fn()}
        assets={[asset("a", "Alpha"), asset("b", "Beta")]}
        startIndex={0} loadImage={loader2}
      />,
    );

    // Give any wrongly-fired effect a chance to run.
    await Promise.resolve();
    await Promise.resolve();

    expect(created).toHaveLength(1);
    expect(revoked).not.toContain(shownUrl);
    expect(screen.getByRole("img", { name: "Alpha" })).toHaveAttribute("src", shownUrl);
  });

  it("revokes the current object URL on close", async () => {
    const { rerender } = renderModal();
    await screen.findByRole("img", { name: "Alpha" });
    rerender(
      <AssetPreviewModal
        lang="en-US" open={false} onClose={vi.fn()}
        assets={[asset("a", "Alpha"), asset("b", "Beta")]}
        startIndex={0} loadImage={vi.fn(async () => TINY_GIF)}
      />,
    );
    expect(revoked).toContain(created[created.length - 1]);
  });
});

describe("AssetPreviewModal — navigation", () => {
  it("disables previous at the first item and next at the last", async () => {
    renderModal({ startIndex: 0 });
    await screen.findByRole("dialog");
    expect(screen.getByRole("button", { name: t("en-US", "assetPreviewPrev") })).toBeDisabled();
    expect(screen.getByRole("button", { name: t("en-US", "assetPreviewNext") })).toBeEnabled();
    await userEvent.click(screen.getByRole("button", { name: t("en-US", "assetPreviewNext") }));
    expect(screen.getByRole("button", { name: t("en-US", "assetPreviewNext") })).toBeDisabled();
    expect(screen.getByRole("button", { name: t("en-US", "assetPreviewPrev") })).toBeEnabled();
  });

  // ★★ NO WRAPPING, DECIDED DELIBERATELY. With two images, wrapping makes
  // "next" and "previous" land on the same picture, which reads as a broken
  // control.
  it("does not wrap past the end", async () => {
    renderModal({ startIndex: 1 });
    await screen.findByRole("dialog");
    const next = screen.getByRole("button", { name: t("en-US", "assetPreviewNext") });
    expect(next).toBeDisabled();
    await userEvent.click(next);
    expect(await screen.findByRole("dialog", { name: /Beta/ })).toBeInTheDocument();
  });

  it("renders position as 'n of total'", async () => {
    renderModal({ startIndex: 0 });
    expect(await screen.findByText(t("en-US", "assetPreviewPosition", 1, 2))).toBeInTheDocument();
  });

  it("renders inert navigation for a single-asset list", async () => {
    renderModal({ assets: [asset("solo", "Solo")], startIndex: 0 });
    await screen.findByRole("dialog");
    expect(screen.getByRole("button", { name: t("en-US", "assetPreviewPrev") })).toBeDisabled();
    expect(screen.getByRole("button", { name: t("en-US", "assetPreviewNext") })).toBeDisabled();
  });

  // ★★★ THE REOPEN-ON-THE-WRONG-IMAGE REGRESSION. Both call sites collapse
  // `startIndex` to a fixed value (often 0) while CLOSED, so a reconcile that
  // only watches `startIndex` cannot see the closed→open transition: navigate
  // to index 1, close (startIndex settles back to 0, already equal to the
  // last-seen value), reopen at index 0 — nothing reseeds `index`, and the
  // modal shows the SECOND image for a click that asked for the first. This
  // drives the component through exactly that sequence via the PUBLIC props
  // only (no internals), the way both real call sites re-mount/re-render it.
  it("reopens on the requested image, not wherever a previous session left off", async () => {
    const props = {
      lang: "en-US" as const,
      onClose: vi.fn(),
      assets: [asset("a", "Alpha"), asset("b", "Beta")],
      loadImage: vi.fn(async () => "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7"),
    };
    const { rerender } = render(<AssetPreviewModal {...props} open startIndex={0} />);
    await screen.findByText(t("en-US", "assetPreviewPosition", 1, 2));

    // Navigate to the second image.
    await userEvent.click(screen.getByRole("button", { name: t("en-US", "assetPreviewNext") }));
    await screen.findByText(t("en-US", "assetPreviewPosition", 2, 2));

    // Close — the caller collapses startIndex back to 0 while closed.
    rerender(<AssetPreviewModal {...props} open={false} startIndex={0} />);
    expect(screen.queryByRole("dialog")).toBeNull();

    // Reopen on row 0 (startIndex 0 again — unchanged from what it was while closed).
    rerender(<AssetPreviewModal {...props} open startIndex={0} />);

    expect(await screen.findByText(t("en-US", "assetPreviewPosition", 1, 2))).toBeInTheDocument();
  });
});

describe("AssetPreviewModal — degraded assets", () => {
  it("states that the data is missing rather than rendering a broken image", async () => {
    renderModal({ loadImage: vi.fn(async () => null) });
    expect(await screen.findByText(t("en-US", "assetPreviewUnavailable"))).toBeInTheDocument();
    expect(screen.queryByRole("img")).toBeNull();
  });

  it("states that the format is unsupported for a blocked mime", async () => {
    renderModal({ assets: [asset("a", "Alpha", "image/svg+xml"), asset("b", "Beta")] });
    expect(await screen.findByText(t("en-US", "assetPreviewBlocked"))).toBeInTheDocument();
    expect(screen.queryByRole("img")).toBeNull();
  });

  // ★★ Navigation must still work PAST a broken asset — otherwise one missing
  // image strands the user on it.
  it("navigates past an unavailable asset", async () => {
    const loadImage = vi.fn(async (id: string) => (id === "a" ? null : TINY_GIF));
    renderModal({ loadImage });
    await screen.findByText(t("en-US", "assetPreviewUnavailable"));
    await userEvent.click(screen.getByRole("button", { name: t("en-US", "assetPreviewNext") }));
    expect(await screen.findByRole("img", { name: "Beta" }));
  });
});

describe("AssetPreviewModal — accessible names", () => {
  it("gives every control in the dialog a distinct accessible name", async () => {
    renderModal();
    const dialog = await screen.findByRole("dialog");
    // ★ `scope` is load-bearing: without it the helper counts every button in
    // the document. `minControls` is the MEASURED count for this dialog —
    // prev, next, plus the shared ModalHeader's ✕ (`alertModalClose`) and its
    // reset-layout button (`modalResetSize`), which `onResetLayout` renders.
    // No `VoiceCommandButton` renders here: `useVoiceCommand()` reads a
    // context whose default is `null` and this test wraps no
    // `VoiceCommandProvider`. Keep the floor exact; a floor set too low
    // passes silently.
    expectRowUniqueNames({ scope: dialog, minControls: 4, roles: ["button"] });
  });

  // ★★★ NOTHING ELSE PINS `ariaLabelledby` OVER `ariaLabel`, and the obvious
  // test does not. The shell's "labels the dialog with the current asset name"
  // matches on the COMPUTED accessible name, so switching the component to
  // `ariaLabel` with the identical string passes it unchanged. `ModalProps` is
  // a discriminated union, so the compiler forces exactly one of the two — but
  // it does not care WHICH, and the entire reason for choosing
  // `ariaLabelledby` is that the dialog's name and the heading a sighted user
  // reads then CANNOT drift apart. Assert the mechanism, not the string.
  it("names the dialog FROM its visible heading, so the two cannot drift", async () => {
    renderModal();
    const dialog = await screen.findByRole("dialog");
    const labelledBy = dialog.getAttribute("aria-labelledby");
    expect(labelledBy, "the dialog must be labelled BY an element, not by a bare string").toBeTruthy();
    const heading = document.getElementById(labelledBy!);
    expect(heading, `no element with id "${labelledBy}"`).not.toBeNull();
    expect(heading).toHaveTextContent("Alpha");
  });
});
