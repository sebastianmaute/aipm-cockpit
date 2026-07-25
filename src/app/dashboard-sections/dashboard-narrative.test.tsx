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

  it("Clear empties a stored narrative", async () => {
    const user = userEvent.setup();
    render(<EditorHost initial="<p>Something</p>" />);
    await user.click(screen.getByText("Status summary"));
    await user.click(screen.getByRole("button", { name: /clear/i }));
    expect(screen.getByRole("button", { name: /clear/i })).toBeDisabled();
  });

  it("re-seeds the draft when status.narrative changes externally (workspace reload)", async () => {
    const user = userEvent.setup();
    render(<EditorHost externalNarrative="<p>External status from reload</p>" />);
    await user.click(screen.getByText("Status summary"));
    await user.click(screen.getByRole("button", { name: /external reload/i }));
    const surface = await screen.findByLabelText(t("en-US", "dashboardNarrativePlaceholder"));
    expect(surface.textContent).toContain("External status from reload");
  });
});
