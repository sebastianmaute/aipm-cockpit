import { describe, expect, it } from "vitest";
import { assetExportPlaceholder } from "./asset-export-placeholder";
import type { DocumentAsset } from "./document-asset";
import { t } from "./i18n";

const meta = (id: string, name: string, mime: string): DocumentAsset =>
  ({ id, name, mime, size: 3, hash: "h", createdAt: "2026-08-06T00:00:00.000Z" });

describe("assetExportPlaceholder (§320)", () => {
  it("names a refused type, a normal image, and a dangling id differently", () => {
    const byId = new Map([
      ["svg", meta("svg", "d.svg", "image/svg+xml")],
      ["png", meta("png", "p.png", "image/png")],
      ["blank", meta("blank", "b", "")],
    ]);
    expect(assetExportPlaceholder("svg", byId, "en-US")).toBe(t("en-US", "assetExportBlocked", "d.svg"));
    expect(assetExportPlaceholder("png", byId, "en-US")).toBe(t("en-US", "assetExportPlaceholder", "p.png"));
    // §225 — an EMPTY mime is not refused; it renders by sniffing in the preview.
    expect(assetExportPlaceholder("blank", byId, "en-US")).toBe(t("en-US", "assetExportPlaceholder", "b"));
    expect(assetExportPlaceholder("gone", byId, "en-US")).toBe(t("en-US", "assetExportPlaceholder", "gone"));
  });
});
