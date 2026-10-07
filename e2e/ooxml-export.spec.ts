import type { Page } from "@playwright/test";
import { test, expect, gotoApp } from "./seed";
import { readZipEntries } from "../src/app/unzip";
import baseline from "../docs/baselines/ooxml-parts.json";

/**
 * §234 (b) — the OOXML export, driven end to end through the real Export menu.
 * The builders have heavy unit coverage and an ordered part manifest
 * (`ooxml-package-manifest.test.ts`, §216), but nothing downloaded a package
 * from the running app. This spec does, for Word and PowerPoint, unzips the
 * bytes with the app's own reader (`unzip.ts`) and checks each package's parts.
 *
 * ★ It compares PART PATHS, not the baseline's digests: the baseline packages are
 * built from a one-paragraph body, while these carry the seeded workspace's tasks,
 * so every content part differs by design. What must hold for any workspace is the
 * set of parts, and for PowerPoint that every slide is declared and related.
 */

const BASELINE = baseline as unknown as Record<string, { parts: { path: string }[] }>;
const paths = (key: string) => BASELINE[key].parts.map((p) => p.path).sort();

async function download(page: Page, label: string): Promise<Map<string, Uint8Array>> {
  await page.getByRole("button", { name: "Export tasks", exact: true }).click();
  const menu = page.getByRole("dialog", { name: "Export tasks", exact: true });
  await expect(menu).toBeVisible();
  const pending = page.waitForEvent("download");
  await menu.getByText(label, { exact: true }).click();
  const file = await pending;
  const path = await file.path();
  const fs = await import("node:fs/promises");
  return readZipEntries(await fs.readFile(path));
}

// The guided tour opens over a first-run app and its overlay takes every click.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("aipm-cockpit:settings", JSON.stringify({ tourSeen: true }));
  });
});

const text = (bytes: Uint8Array | undefined) => new TextDecoder().decode(bytes ?? new Uint8Array());

test("the Word export downloads a package with the landscape docx parts", async ({ page }) => {
  await gotoApp(page);
  const parts = await download(page, "Word (.docx)");
  const names = [...parts.keys()];
  // Every part of the baseline package, plus only two kinds of extra: content-driven
  // ones (the seeded descriptions hold lists, and Word lists bring a numbering part,
  // §154) and the page header and footer every export carries, with the header's
  // rels and the logo only when a brand logo is set (§512).
  for (const p of paths("docxLandscape")) expect(names, `missing part ${p}`).toContain(p);
  const extra = names.filter((n) => !paths("docxLandscape").includes(n));
  const allowed = (n: string) =>
    ["word/numbering.xml", "word/header1.xml", "word/footer1.xml", "word/_rels/header1.xml.rels"].includes(n) ||
    /^word\/media\/brand-logo\.[a-z]+$/.test(n);
  expect(extra.filter((n) => !allowed(n))).toEqual([]);
  const types = text(parts.get("[Content_Types].xml"));
  const rels = text(parts.get("word/_rels/document.xml.rels"));
  if (extra.includes("word/numbering.xml")) {
    expect(types).toContain('PartName="/word/numbering.xml"');
    expect(rels).toContain('Target="numbering.xml"');
  }
  for (const p of ["header1.xml", "footer1.xml"]) {
    expect(names, `missing part word/${p}`).toContain(`word/${p}`);
    expect(types).toContain(`PartName="/word/${p}"`);
    expect(rels).toContain(`Target="${p}"`);
  }
  // The body really carries the workspace, not an empty shell.
  const body = text(parts.get("word/document.xml"));
  expect(body).toContain("<w:tbl>");
});

test("the PowerPoint export downloads a package whose every slide is declared and related", async ({ page }) => {
  await gotoApp(page);
  const parts = await download(page, "PowerPoint (.pptx)");
  const names = [...parts.keys()];
  const slides = names.filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n));
  // A title slide plus one per task: the seeded workspace has tasks, so at least two.
  expect(slides.length).toBeGreaterThanOrEqual(2);
  // Every fixed (non-slide) part of the baseline package is present.
  const fixed = paths("pptx").filter((p) => !/^ppt\/slides\//.test(p));
  for (const p of fixed) expect(names, `missing part ${p}`).toContain(p);
  const types = text(parts.get("[Content_Types].xml"));
  const presRels = text(parts.get("ppt/_rels/presentation.xml.rels"));
  for (const s of slides) {
    const file = s.split("/").pop()!;
    expect(names, `${s} has no rels part`).toContain(`ppt/slides/_rels/${file}.rels`);
    expect(types, `${s} is not declared in [Content_Types].xml`).toContain(`PartName="/${s}"`);
    expect(presRels, `${s} is not related from presentation.xml`).toContain(`Target="slides/${file}"`);
  }
});
