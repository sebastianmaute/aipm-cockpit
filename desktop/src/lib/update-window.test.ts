import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { notesToSafeHtml } from "./release-notes-html";
import {
  UPDATE_DURATION_HINT, UPDATE_PROMPT_SCRIPT, buildUpdatePromptHtml, escapeHtml, parseChoiceTitle, updatePromptUrl,
} from "./update-window";

const safe = (notes: string) => notesToSafeHtml(notes, 20_000);

describe("buildUpdatePromptHtml", () => {
  it("shows the version, the notes and all three choices", () => {
    const html = buildUpdatePromptHtml({ version: "1.15.0", notesHtml: safe("Line one\nLine two") });
    expect(html).toContain("AI PM Cockpit 1.15.0 is available.");
    expect(html).toContain("Line one\nLine two");
    for (const c of ["download", "later", "skip"]) expect(html).toContain(`data-choice="${c}"`);
  });

  it("lets a release body add no markup or script of its own", () => {
    const html = buildUpdatePromptHtml({
      version: "1.0.0",
      notesHtml: safe('<p>ok</p><script>alert(1)</script><img src=x onerror="y"><SCRIPT src=x>alert(2)</SCRIPT>'),
    });
    expect(html).toContain("<p>ok</p>");
    expect(html).not.toContain("<img");
    expect(html).not.toContain("alert(");
    // Exactly one script element, in any letter case or with attributes: the page's own.
    expect(html.toLowerCase().split("<script").length - 1).toBe(1);
  });

  it("renders the notes as markup, not as escaped text", () => {
    const html = buildUpdatePromptHtml({ version: "1.0.0", notesHtml: safe("<h3>Added</h3><ul><li><strong>A</strong></li></ul>") });
    expect(html).toContain("<h4>Added</h4><ul><li><strong>A</strong></li></ul>");
    expect(html).toContain('<div class="notes" tabindex="0" role="region" aria-labelledby="notes-title">');
  });

  it("says that installing takes a while and the app may seem frozen, before the choices", () => {
    const html = buildUpdatePromptHtml({ version: "1.0.0", notesHtml: safe("x") });
    expect(UPDATE_DURATION_HINT).toMatch(/takes a few minutes/);
    expect(UPDATE_DURATION_HINT).toMatch(/seem frozen/);
    const hint = html.indexOf(`<p class="hint">${escapeHtml(UPDATE_DURATION_HINT)}</p>`);
    expect(hint).toBeGreaterThan(html.indexOf('class="notes"'));
    expect(hint).toBeLessThan(html.indexOf('data-choice="download"'));
  });

  it("puts the notes in a scrolling box", () => {
    const html = buildUpdatePromptHtml({ version: "1.0.0", notesHtml: safe("x") });
    expect(html).toMatch(/\.notes \{[^}]*overflow-y: auto/);
    expect(html).toMatch(/\.notes \{[^}]*min-height: 0/);
  });

  // A CSP that allowed some OTHER script would let the page's own buttons die silently.
  it("allows exactly the inline script on the page, by hash, and nothing else", () => {
    const html = buildUpdatePromptHtml({ version: "1.0.0", notesHtml: safe("x") });
    const hash = createHash("sha256").update(UPDATE_PROMPT_SCRIPT, "utf8").digest("base64");
    expect(html).toContain(`<script>${UPDATE_PROMPT_SCRIPT}</script>`);
    expect(html).toContain(`script-src 'sha256-${hash}'`);
    expect(html).toContain("default-src 'none'");
    expect(html).not.toContain("unsafe-eval");
    expect(html).not.toMatch(/script-src[^"]*'unsafe-inline'/);
  });
});

describe("parseChoiceTitle", () => {
  it("reads the three choices the script writes", () => {
    expect(parseChoiceTitle("aipm-update:download")).toBe("download");
    expect(parseChoiceTitle("aipm-update:later")).toBe("later");
    expect(parseChoiceTitle("aipm-update:skip")).toBe("skip");
  });
  it("ignores any other title, including the page's own", () => {
    expect(parseChoiceTitle("Update available")).toBeNull();
    expect(parseChoiceTitle("aipm-update:install")).toBeNull();
    expect(parseChoiceTitle("aipm-update:")).toBeNull();
  });
});

describe("updatePromptUrl", () => {
  it("round-trips the page through a base64 data URL", () => {
    const html = buildUpdatePromptHtml({ version: "1.0.0", notesHtml: safe("Ünïcode & #hash ?query") });
    const url = updatePromptUrl(html);
    expect(url.startsWith("data:text/html;charset=utf-8;base64,")).toBe(true);
    const decoded = Buffer.from(url.slice(url.indexOf(",") + 1), "base64").toString("utf8");
    expect(decoded).toBe(html);
  });
});

describe("escapeHtml", () => {
  it("escapes the five significant characters", () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe("&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;");
  });
});
