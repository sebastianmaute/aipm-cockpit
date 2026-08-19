import { readFileSync } from "node:fs";
import { render, screen } from "@testing-library/react";
import { describe, it, expect, beforeAll } from "vitest";
import { RichTextEditor, RichTextEditorFallback } from "./rich-text-editor-lazy";

// This module exists to make exactly one `dynamic()` call, so what has to be
// pinned is that call's THREE decisions: it loads the real editor, it shows the
// fallback while doing so, and it never renders on the server.
//
// ★★★ THE FALLBACK-SHAPE TESTS BELOW ARE NOT THAT, and an earlier version of this
// file was only those. All three of `loading: RichTextEditorFallback` deleted,
// `ssr: false` flipped to `true`, and the `import()` retargeted survived the
// whole suite — for a 48-line module whose entire job is those three tokens.
// The contract block comes first now because it is the one that would go red.
// ProseMirror touches layout APIs jsdom lacks; stub them so a REAL editor can
// mount here. Without these the boundary never swaps and the test below fails
// looking like a broken import — mirrors note-log-panel.test.tsx.
beforeAll(() => {
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore jsdom polyfill
  Range.prototype.getClientRects = () => ({ length: 0, item: () => null, [Symbol.iterator]: function* () {} });
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore jsdom polyfill
  Range.prototype.getBoundingClientRect = () => ({ width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0, x: 0, y: 0, toJSON: () => ({}) });
});

/** The module source with every comment removed. A source assertion over a
 *  file that documents itself will otherwise happily match its own prose. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

describe("the dynamic() boundary", () => {
  const SRC = readFileSync("src/app/rich-text-editor-lazy.tsx", "utf8");

  it("paints the fallback first, then swaps in the real editor", async () => {
    render(<RichTextEditor value="<p>hi</p>" onChange={() => {}} label="Description" lang="en-US" />);

    // ★★ Synchronous, deliberately: this is the assertion that dies if `loading:`
    //   is dropped. A `dynamic()` with no `loading` renders NULL while the chunk
    //   resolves, so `container` would hold no shimmer — and every fallback-shape
    //   test below would still pass, because they render the component directly
    //   rather than through the boundary.
    expect(document.querySelector(".animate-pulse")).not.toBeNull();
    expect(screen.queryByRole("textbox", { name: "Description" })).toBeNull();

    // ★ And this half dies if the `import()` is retargeted: the fallback would
    //   never be replaced by a real ProseMirror textbox.
    expect(await screen.findByRole("textbox", { name: "Description" })).toBeTruthy();
    expect(document.querySelector(".animate-pulse")).toBeNull();
  });

  it("never renders on the server", () => {
    // ★★ A SOURCE assertion because `ssr` has NO jsdom observable — vitest never
    //   server-renders, so `ssr: true` behaves identically here and the flip is
    //   invisible to every behavioural test that could be written. The real cost
    //   is paid in production: `useEditor` would run during SSR and
    //   `readCspNonce()` with it (see the ★★ block in `csp-nonce.ts`, whose
    //   `typeof document` guard is now the ONLY thing standing behind this line).
    // ★★★ STRIP THE COMMENTS FIRST. A first cut asserted
    //   `toContain("ssr: false")` against the raw source and SURVIVED the
    //   `ssr: true` mutant, because the module's own header discusses
    //   `ssr: false` in prose — the assertion was reading the comment. Measured,
    //   not reasoned: the mutated file passed 5/5. Any source assertion over a
    //   file that documents itself has this failure mode.
    // ★★ Its replacement pinned the exact one-line spelling
    //   `{ ssr: false, loading: RichTextEditorFallback }`, which killed the
    //   mutant but went red the moment the options object was reformatted onto
    //   three lines — a test that fails on prettier is a test that gets deleted.
    //   Stripping comments and matching per-key survives reflow AND cannot read
    //   prose.
    const CODE = stripComments(SRC);
    expect(CODE).toMatch(/ssr:\s*false/);
    expect(CODE).toMatch(/loading:\s*RichTextEditorFallback/);
    // The needle must not have been read out of prose: no comment survives here.
    expect(CODE).not.toContain("★");
  });
});

// What is tested BELOW is the fallback COMPONENT, rendered directly: it must
// shimmer like every other lazy surface in the app, and it must stay out of the
// accessibility tree (the surrounding form labels the field; a decorative
// placeholder announcing itself would be noise).
//
// ★ Two of these three pin `skeleton.tsx`, not this module — `animate-pulse` and
// `aria-hidden` are both emitted by `Skeleton`, so no one-token mutation to
// `rich-text-editor-lazy.tsx` can kill them. They are kept here rather than moved
// because there is no `skeleton.test.tsx` and this is the only direct coverage
// that component has; they DO catch a revert to the old hand-rolled
// `<div className="min-h-40 rounded-md border border-line bg-surface-muted" />`.
describe("RichTextEditorFallback", () => {
  it("shimmers, so a loading editor reads like a loading panel", () => {
    const { container } = render(<RichTextEditorFallback />);
    const el = container.firstElementChild;
    expect(el?.className).toContain("animate-pulse");
  });

  it("is decorative — hidden from assistive technology", () => {
    const { container } = render(<RichTextEditorFallback />);
    expect(container.firstElementChild?.getAttribute("aria-hidden")).toBe("true");
  });

  // ★ Named for what it CHECKS, not for what the height is meant to achieve.
  //   jsdom has no layout, so nothing here can observe a layout shift; whether
  //   160px actually matches toolbar + content is unmeasured, and the two
  //   size-to-content consumers (`milestone-edit-modal`, the draggable
  //   `TaskFormModal`) will still resize on the swap.
  it("declares the reserved-height and field-outline classes", () => {
    const cls = render(<RichTextEditorFallback />).container.firstElementChild?.className ?? "";
    expect(cls).toContain("min-h-40");
    // ★ The border is what the two pre-existing hand-rolled fallbacks drew and
    //   `Skeleton` does not, so without it the placeholder stops reading as a field.
    expect(cls).toContain("border-line");
  });
});
