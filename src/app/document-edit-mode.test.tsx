// src/app/document-edit-mode.test.tsx
//
// `DocumentEditModeBody` is the READ seam of the asset byte store's partition
// key: it owns the only production render of `DocumentPreview`, which passes
// the key straight to `loadAssetData`. The WRITE side normalises "" away with
// `||` (documents-asset-section.tsx, over workspace-panels.tsx's producer);
// this file exists because for a while the read side did not, and the two
// halves disagreeing is invisible in every other test — the library above the
// preview goes on listing the same rows as healthy while every image in the
// document dangles.
//
// The preview is mocked: what is under test is which value reaches it, not
// what it draws with it (document-preview.test.tsx owns that).

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";
import { DocumentEditModeBody } from "./document-edit-mode";
import { ASSET_PARTITION_FALLBACK } from "./document-assets-schema";
import { emptyWorkspace } from "./workspace";
import type { ProjectDocument } from "./document-model";
import type { BlockStructuralOps } from "./use-document-editor";
import { DocumentPreview } from "./document-preview";

vi.mock("./document-preview", () => ({ DocumentPreview: vi.fn(() => null) }));

const NOW = "2026-08-21T00:00:00.000Z";

const doc: ProjectDocument = {
  id: 1,
  title: "Status report",
  blocks: [{ type: "paragraph", html: '<p><img data-asset-id="a1" alt="chart"></p>' }],
  createdAt: NOW,
  updatedAt: NOW,
};

const structural: BlockStructuralOps = {
  insert: vi.fn(),
  remove: vi.fn(),
  move: vi.fn(),
};

/** The key the mocked preview actually received. Reads the FIRST call's props
 *  rather than a call count — a count is exactly the derived property that
 *  stays green while the value under it changes. */
function projectIdSeenByPreview(): unknown {
  const call = vi.mocked(DocumentPreview).mock.calls[0];
  expect(call).toBeDefined();
  return (call![0] as { projectId?: unknown }).projectId;
}

function renderBody(assetsProjectId?: string) {
  render(
    <DocumentEditModeBody
      lang="en-US"
      doc={doc}
      ws={emptyWorkspace()}
      editing={false}
      narrow={false}
      onCommitBlock={vi.fn()}
      structural={structural}
      assetsProjectId={assetsProjectId}
    />,
  );
}

beforeEach(() => {
  vi.mocked(DocumentPreview).mockClear();
});

describe("DocumentEditModeBody asset partition key", () => {
  it("folds an empty project id onto the write side's fallback key", () => {
    // ★★★ THE SEAM. `workspace-panels.tsx` normalises with `||`, so bytes for
    // an empty project id are WRITTEN under ASSET_PARTITION_FALLBACK. A `??`
    // (or any bare literal) here would read them back under "" — a partition
    // that by construction holds nothing — and every image would dangle with
    // no error anywhere.
    renderBody("");
    expect(projectIdSeenByPreview()).toBe(ASSET_PARTITION_FALLBACK);
  });

  it("falls back when no project id is supplied at all", () => {
    // The pane is optional (documents-panel.tsx passes `assetPane?.projectId`,
    // i.e. undefined when there is no pane), so undefined has to land on the
    // same key as "" — one normalisation, not a default plus a fallback.
    renderBody(undefined);
    expect(projectIdSeenByPreview()).toBe(ASSET_PARTITION_FALLBACK);
  });

  it("passes a real project id through untouched", () => {
    // The other direction: the fallback must not swallow a live key. Asserted
    // with a value that is neither "" nor the fallback, so a mutant hard-coding
    // ASSET_PARTITION_FALLBACK fails here even though it passes both cases
    // above.
    renderBody("portfolio-7");
    expect(projectIdSeenByPreview()).toBe("portfolio-7");
  });
});
