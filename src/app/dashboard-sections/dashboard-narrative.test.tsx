import { describe, it, expect, beforeAll } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { t } from "../i18n";
import type { ProjectStatus } from "../types";
import { NarrativeSummary, NarrativeEditor } from "./dashboard-narrative";

// ProseMirror (the lean RichTextEditor) touches layout APIs jsdom lacks; stub
// them so the editor mounts. Mirrors notes-window.test.tsx.
beforeAll(() => {
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore jsdom polyfill
  Range.prototype.getClientRects = () => ({ length: 0, item: () => null, [Symbol.iterator]: function* () {} });
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore jsdom polyfill
  Range.prototype.getBoundingClientRect = () => ({ width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0, x: 0, y: 0, toJSON: () => ({}) });
  // userEvent's pointer press calls document.elementFromPoint (absent in jsdom).
  // eslint-disable-next-line @typescript-eslint/ban-ts-comment
  // @ts-ignore jsdom polyfill
  if (!document.elementFromPoint) document.elementFromPoint = () => null;
});

describe("NarrativeSummary", () => {
  it("renders a legacy plain-text narrative + updated date", () => {
    render(
      <NarrativeSummary
        lang="en-US"
        status={{ narrative: "All on track", narrativeUpdatedAt: "2026-06-20T10:00:00.000Z" }}
      />,
    );
    expect(screen.getByText("All on track")).toBeInTheDocument();
    expect(screen.getByText(/Updated/)).toBeInTheDocument();
  });

  it("renders stored rich text as markup, not as escaped source", () => {
    const { container } = render(
      <NarrativeSummary lang="en-US" status={{ narrative: "<p>Ship <strong>R3</strong></p>" }} />,
    );
    expect(container.querySelector("strong")?.textContent).toBe("R3");
  });

  it("strips a script tag at the render sink", () => {
    const { container } = render(
      <NarrativeSummary lang="en-US" status={{ narrative: "<p>ok</p><script>alert(1)</script>" }} />,
    );
    expect(container.querySelector("script")).toBeNull();
    expect(container.textContent).toContain("ok");
  });

  it("renders nothing when the narrative is empty or blank markup", () => {
    expect(render(<NarrativeSummary lang="en-US" status={{}} />).container.firstChild).toBeNull();
    expect(
      render(<NarrativeSummary lang="en-US" status={{ narrative: "<p></p>" }} />).container.firstChild,
    ).toBeNull();
  });

  // ★★ End-to-end for the vanished-narrative defect, through the REAL pipeline
  // (narrativeToHtml -> sanitizeRichHtml -> RichTextView). These tags were treated
  // as ready-to-render HTML while the sink stripped them WITH their text
  // (the retired sanitizeNoteHtml ran KEEP_CONTENT: false), so the stored words
  // were simply deleted on screen: the h1 case rendered "All good" alone, the div
  // and blockquote cases rendered an empty card. Reachable by anyone who pasted
  // HTML into the old plain textarea to fake formatting.
  // ★★ THE ASSERTION IS UNCHANGED AND THE ROUTE UNDERNEATH IT IS NOT — the test
  // pins that the WORDS are visible, never how. h1/h3/blockquote are on
  // RICH_ALLOWED_TAGS now, so those three survive as real markup; div is not, so
  // narrativeToHtml still escapes that value whole and the words show as text.
  // Both routes satisfy this test, which is the point of asserting on the words.
  it.each([
    ["<h1>Q3 status</h1><p>All good</p>", ["Q3 status", "All good"]],
    ["<div>Status text</div>", ["Status text"]],
    ["<blockquote>Quoted</blockquote>", ["Quoted"]],
    ["<h3>Deep heading</h3>", ["Deep heading"]],
  ])("keeps the text of a legacy %s narrative visible", (narrative, expected) => {
    const { container } = render(<NarrativeSummary lang="en-US" status={{ narrative }} />);
    for (const word of expected) expect(container.textContent).toContain(word);
  });

  // The other half: a value that DOES open with a recognised tag but sanitises to
  // nothing. Judging emptiness on the stored value called this non-empty and
  // rendered a card holding nothing but the "Updated <date>" line — a blank status
  // card with a timestamp.
  // ★★★ THE FIXTURE CHANGED AND THE PROPERTY DID NOT. It was
  // "<p><u>underlined only</u></p>", a Word/Outlook paste that collapsed to
  // "<p></p>" because `sanitizeNoteHtml` omitted `u` AND ran KEEP_CONTENT: false.
  // `u` is on RICH_ALLOWED_TAGS now and that value renders in full — measured, as
  // a real failure of this test before it was re-aimed. An element carrying no
  // text of its own is what still empties a wrapper: measured 2026-08-11,
  // sanitizeRichHtml("<p><script>x</script></p>") === "<p></p>", isNarrativeEmpty
  // true. The divergence between stored and sanitised is narrower now, not gone.
  it("renders nothing when the narrative sanitises away to nothing", () => {
    const { container } = render(
      <NarrativeSummary
        lang="en-US"
        status={{ narrative: "<p><script>x</script></p>", narrativeUpdatedAt: "2026-06-20T10:00:00.000Z" }}
      />,
    );
    expect(container.firstChild).toBeNull();
    expect(container.textContent).not.toMatch(/Updated/);
  });
});

// A host that owns ProjectStatus state so the editor's commit/clear + the
// render-time reconcile run against a real setState (mirrors WorkspaceProvider).
function EditorHost({ initial = "", externalNarrative }: { initial?: string; externalNarrative?: string }) {
  const [status, setStatus] = useState<ProjectStatus>({ narrative: initial });
  return (
    <>
      <button type="button" onClick={() => setStatus({ narrative: externalNarrative ?? "" })}>
        external reload
      </button>
      {/* The STORED value, so a test can tell "the editor looks empty" apart from
          "the narrative was actually cleared" — the two diverged in the defect
          this host's Clear tests cover. */}
      <span data-testid="stored">{status.narrative ?? ""}</span>
      <NarrativeEditor lang="en-US" status={status} setStatus={setStatus} />
    </>
  );
}

describe("NarrativeEditor", () => {
  it("renders the editor inside a foldable details with the Status summary label", () => {
    render(<EditorHost />);
    expect(screen.getByText("Status summary").closest("details")).not.toBeNull();
  });

  it("mounts the lean rich-text editor with an accessible name", async () => {
    const user = userEvent.setup();
    render(<EditorHost />);
    await user.click(screen.getByText("Status summary"));
    expect(await screen.findByLabelText(t("en-US", "dashboardNarrativePlaceholder"))).toBeTruthy();
    expect(screen.getByRole("button", { name: /bold/i })).toBeTruthy();
  });

  it("seeds the editor with the stored narrative, upgrading legacy plain text", async () => {
    const user = userEvent.setup();
    render(<EditorHost initial="Legacy plain note" />);
    await user.click(screen.getByText("Status summary"));
    const surface = await screen.findByLabelText(t("en-US", "dashboardNarrativePlaceholder"));
    expect(surface.textContent).toContain("Legacy plain note");
  });

  it("Clear is disabled when the narrative is already empty", () => {
    render(<EditorHost />);
    expect(screen.getByRole("button", { name: /clear/i })).toBeDisabled();
  });

  // ★★ Assert the EDITOR SURFACE, not just the disabled Clear button: that button
  // is disabled by `storedHtml === "" && isNarrativeEmpty(draft)`, both of which
  // were already true in the broken implementation that wiped the stored value
  // while leaving the old text on screen. The surface is the only thing that
  // distinguishes the two.
  it("Clear empties the editor surface, not just the stored value", async () => {
    const user = userEvent.setup();
    render(<EditorHost initial="<p>Something</p>" />);
    await user.click(screen.getByText("Status summary"));
    const before = await screen.findByLabelText(t("en-US", "dashboardNarrativePlaceholder"));
    expect(before.textContent).toContain("Something");
    await user.click(screen.getByRole("button", { name: /clear/i }));
    const surface = screen.getByLabelText(t("en-US", "dashboardNarrativePlaceholder"));
    expect(surface.textContent).toBe("");
    expect(screen.getByTestId("stored").textContent).toBe("");
    expect(screen.getByRole("button", { name: /clear/i })).toBeDisabled();
  });

  // The other half of the same defect: an editor still holding the cleared text
  // merges it back into the next commit, so the deleted narrative reappears.
  it("typing after Clear does not resurrect the cleared narrative", async () => {
    const user = userEvent.setup();
    render(<EditorHost initial="<p>Something</p>" />);
    await user.click(screen.getByText("Status summary"));
    await user.click(screen.getByRole("button", { name: /clear/i }));
    const surface = screen.getByLabelText(t("en-US", "dashboardNarrativePlaceholder"));
    await user.click(surface);
    await user.keyboard("X");
    // Blur out of the editor: commit-on-blur stores the draft.
    await user.click(screen.getByText("Status summary"));
    const stored = screen.getByTestId("stored").textContent ?? "";
    expect(stored).not.toContain("Something");
    expect(stored).toContain("X");
  });

  it("re-seeds the draft when status.narrative changes externally (workspace reload)", async () => {
    const user = userEvent.setup();
    render(<EditorHost externalNarrative="<p>External status from reload</p>" />);
    await user.click(screen.getByText("Status summary"));
    await user.click(screen.getByRole("button", { name: /external reload/i }));
    const surface = await screen.findByLabelText(t("en-US", "dashboardNarrativePlaceholder"));
    expect(surface.textContent).toContain("External status from reload");
  });

  // End-to-end for the sanitizer/input-rule defect: "# " used to become an <h1>
  // that the note sanitizer dropped content and all, so the commit stored "",
  // Save stayed disabled (`unchanged`) and the text was silently never saved.
  it("stores a narrative typed with a markdown '# ' shortcut", async () => {
    const user = userEvent.setup();
    render(<EditorHost />);
    await user.click(screen.getByText("Status summary"));
    const surface = await screen.findByLabelText(t("en-US", "dashboardNarrativePlaceholder"));
    await user.click(surface);
    await user.keyboard("# Q3 highlights");
    await user.click(screen.getByText("Status summary")); // blur -> commit
    expect(screen.getByTestId("stored").textContent).toContain("# Q3 highlights");
  });

  // The toolbar was dead: mousedown on Bold blurred the editor -> committed ->
  // changed status.narrative -> the render-time reconcile bumped the remount
  // nonce -> the `key` swap replaced the editor node BETWEEN mousedown and
  // mouseup, so no click was ever dispatched and the format command never ran.
  it("applies Bold to the selection instead of losing the click to a remount", async () => {
    const user = userEvent.setup();
    render(<EditorHost />);
    await user.click(screen.getByText("Status summary"));
    const surface = await screen.findByLabelText(t("en-US", "dashboardNarrativePlaceholder"));
    await user.click(surface);
    await user.keyboard("hello world");
    await user.keyboard("{Control>}a{/Control}");
    await user.click(screen.getByRole("button", { name: /bold/i }));
    const after = screen.getByLabelText(t("en-US", "dashboardNarrativePlaceholder"));
    expect(after).toBe(surface); // same node: the editor was NOT remounted
    expect(after.querySelector("strong")?.textContent).toBe("hello world");
  });

  it("keeps the editor instance when a commit re-seeds it with its own content", async () => {
    const user = userEvent.setup();
    render(<EditorHost />);
    await user.click(screen.getByText("Status summary"));
    const surface = await screen.findByLabelText(t("en-US", "dashboardNarrativePlaceholder"));
    await user.click(surface);
    await user.keyboard("committed text");
    // Blur out of the editor: commit-on-blur fires and stores the draft.
    await user.click(screen.getByText("Status summary"));
    const after = screen.getByLabelText(t("en-US", "dashboardNarrativePlaceholder"));
    expect(after).toBe(surface);
    expect(after.textContent).toContain("committed text");
  });

  // ★ "Clear" sits beside "Save", where it reads as "clear the draft". It is
  //   not: `clearNarrative` also DELETES the stored narrative whenever
  //   `storedHtml !== ""`. The title states the destructive half.
  // ★★ Hardcoded expected text, not `t(lang, key)` — `t` echoes an unknown key,
  //   so a `t`-based assertion would still pass if the string were deleted.
  it("titles Clear with the fact that it deletes the STORED narrative", async () => {
    const user = userEvent.setup();
    render(<EditorHost />);
    await user.click(screen.getByText("Status summary"));
    expect(screen.getByRole("button", { name: t("en-US", "dashboardStatusClear") })).toHaveAttribute(
      "title",
      "Delete the saved status narrative, not just this draft",
    );
  });
});
