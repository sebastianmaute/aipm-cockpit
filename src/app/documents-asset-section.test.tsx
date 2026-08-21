import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useEffect } from "react";
import { DocumentsAssetSection } from "./documents-asset-section";
import { WorkspaceProvider, useWorkspace } from "./workspace-context";
import { FiltersProvider } from "./filters-context";
import { t } from "./i18n";
import type { ProjectDocument } from "./document-model";
import type { DocumentAsset } from "./document-asset";
import type { BlockStructuralOps } from "./use-document-editor";
import type { TursoConfig } from "./turso-config";
import type { DocResult } from "./document-mutations";

vi.mock("./document-assets-store", () => ({
  saveAssetData: vi.fn(), deleteAssetData: vi.fn(), loadAssetDataIds: vi.fn(),
}));
import { saveAssetData, deleteAssetData, loadAssetDataIds } from "./document-assets-store";

const TURSO_CONFIG: TursoConfig = { httpUrl: "https://db.turso.io", authToken: "t" };

function doc(id: number, blocks: ProjectDocument["blocks"] = []): ProjectDocument {
  return { id, title: `Doc ${id}`, blocks, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" };
}

function okResult(documents: readonly ProjectDocument[]): DocResult {
  return { changed: true, documents, versions: [], rejected: [], documentId: documents[0]?.id ?? null, minted: null };
}

function fakeStructural(): BlockStructuralOps {
  return {
    insert: vi.fn(() => okResult([])),
    remove: vi.fn(() => okResult([])),
    move: vi.fn(() => okResult([])),
  } as unknown as BlockStructuralOps;
}

function fakeAsset(id: string, name = "chart.png"): DocumentAsset {
  return { id, name, mime: "image/png", size: 10, hash: id, createdAt: "2026-01-01T00:00:00.000Z" };
}

/** Seeds `ws.documentAssets` before the section under test ever reads it —
 *  `WorkspaceProvider` takes no seed prop, so a child that calls
 *  `setDocumentAssets` in an effect is the only way in. */
function SeedAssets({ assets }: { assets: readonly DocumentAsset[] }) {
  const ws = useWorkspace();
  const setDocumentAssets = ws.setDocumentAssets;
  useEffect(() => { setDocumentAssets(assets); }, [assets, setDocumentAssets]);
  return null;
}

function renderSection(
  props: Partial<Parameters<typeof DocumentsAssetSection>[0]> = {},
  seedAssets: readonly DocumentAsset[] = [],
) {
  const structural = props.structural ?? fakeStructural();
  const selected = "selected" in props ? props.selected! : doc(1);
  const result = render(
    <FiltersProvider>
      <WorkspaceProvider>
        <SeedAssets assets={seedAssets} />
        <DocumentsAssetSection
          lang="en-US"
          tursoConfig={TURSO_CONFIG}
          projectId="p1"
          documents={[selected]}
          structural={structural}
          selected={selected}
          {...props}
        />
      </WorkspaceProvider>
    </FiltersProvider>,
  );
  return { structural, ...result };
}

beforeEach(() => {
  vi.mocked(saveAssetData).mockReset().mockResolvedValue(undefined);
  vi.mocked(deleteAssetData).mockReset().mockResolvedValue(undefined);
  vi.mocked(loadAssetDataIds).mockReset().mockResolvedValue([]);
});

describe("documents asset library gating", () => {
  it("enables the library when a usable Turso config exists", async () => {
    renderSection({ tursoConfig: TURSO_CONFIG });
    expect(await screen.findByRole("button", { name: t("en-US", "upload") })).toBeEnabled();
    expect(screen.queryByText(t("en-US", "assetLibraryTursoOnly"))).not.toBeInTheDocument();
  });

  it("disables the library when the kind is turso but the config is unset", () => {
    // The config resolver already returns null when a Turso storage kind is
    // set but url/token are missing/quarantined — that resolved-to-null value
    // is exactly what this component receives.
    renderSection({ tursoConfig: null });
    expect(screen.getByText(t("en-US", "assetLibraryTursoOnly"))).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: t("en-US", "upload") })).not.toBeInTheDocument();
  });

  it("disables the library on a file backend", () => {
    renderSection({ tursoConfig: null });
    expect(screen.getByText(t("en-US", "assetLibraryTursoOnly"))).toBeInTheDocument();
  });

  it("disables even with a usable config when the pane is a read-only popout", () => {
    renderSection({ tursoConfig: TURSO_CONFIG, isReadOnly: true });
    expect(screen.getByText(t("en-US", "assetLibraryTursoOnly"))).toBeInTheDocument();
  });
});

describe("documents asset insertion", () => {
  it("inserts a NEW sanitized paragraph block via structural.insert (picker path)", async () => {
    const user = userEvent.setup();
    const d = doc(1, [{ type: "heading", level: 1, text: "Intro" }]);
    const { structural } = renderSection({ selected: d, documents: [d] }, [fakeAsset("a1", "chart.png")]);

    await user.click(await screen.findByRole("button", { name: t("en-US", "assetLibraryInsert") }));
    await user.click(await screen.findByRole("button", { name: `${t("en-US", "insert")} – chart.png` }));

    await waitFor(() => expect(structural.insert).toHaveBeenCalledTimes(1));
    const [at, block] = vi.mocked(structural.insert).mock.calls[0];
    expect(at).toBe(1); // appended after the document's one existing block
    expect(block).toEqual({ type: "paragraph", html: '<img data-asset-id="a1" alt="chart.png">' });
  });

  it("sanitizes an asset name that looks like markup before storing it", async () => {
    const user = userEvent.setup();
    const d = doc(1, []);
    const evilName = "<script>alert(1)</script>";
    const { structural } = renderSection(
      { selected: d, documents: [d] },
      [fakeAsset("a1", evilName)],
    );
    await user.click(await screen.findByRole("button", { name: t("en-US", "assetLibraryInsert") }));
    await user.click(await screen.findByRole("button", { name: `${t("en-US", "insert")} – ${evilName}` }));
    await waitFor(() => expect(structural.insert).toHaveBeenCalledTimes(1));
    const [, block] = vi.mocked(structural.insert).mock.calls[0];
    const html = (block as { html: string }).html;
    expect(html).not.toContain("<script>");
  });

  it("refuses to insert past the 20-image-per-document cap, without calling structural.insert", async () => {
    const user = userEvent.setup();
    const html = Array.from({ length: 20 }, (_, i) => `<img data-asset-id="a${i}">`).join("");
    const d = doc(1, [{ type: "paragraph", html }]);
    const { structural } = renderSection({ selected: d, documents: [d] }, [fakeAsset("a20", "extra.png")]);

    await user.click(await screen.findByRole("button", { name: t("en-US", "assetLibraryInsert") }));
    await user.click(await screen.findByRole("button", { name: `${t("en-US", "insert")} – extra.png` }));

    expect(await screen.findByText(t("en-US", "assetLibraryMaxPerDocument", "20"))).toBeInTheDocument();
    expect(structural.insert).not.toHaveBeenCalled();
  });

  it("does NOT refuse re-inserting an id already present in the document, even at the cap", async () => {
    const user = userEvent.setup();
    const html = Array.from({ length: 20 }, (_, i) => `<img data-asset-id="a${i}">`).join("");
    const d = doc(1, [{ type: "paragraph", html }]);
    const { structural } = renderSection({ selected: d, documents: [d] }, [fakeAsset("a0", "already-here.png")]);

    await user.click(await screen.findByRole("button", { name: t("en-US", "assetLibraryInsert") }));
    await user.click(await screen.findByRole("button", { name: `${t("en-US", "insert")} – already-here.png` }));

    await waitFor(() => expect(structural.insert).toHaveBeenCalledTimes(1));
  });
});
