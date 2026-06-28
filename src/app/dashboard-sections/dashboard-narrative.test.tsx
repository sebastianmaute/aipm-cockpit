import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import type { ProjectStatus } from "../types";
import { NarrativeSummary, NarrativeEditor } from "./dashboard-narrative";

describe("NarrativeSummary", () => {
  it("renders the saved narrative text + updated date", () => {
    render(
      <NarrativeSummary
        lang="en-US"
        status={{ narrative: "All on track", narrativeUpdatedAt: "2026-06-20T10:00:00.000Z" }}
      />,
    );
    expect(screen.getByText("All on track")).toBeInTheDocument();
    expect(screen.getByText(/Updated/)).toBeInTheDocument();
  });

  it("renders nothing when the narrative is empty", () => {
    const { container } = render(<NarrativeSummary lang="en-US" status={{}} />);
    expect(container.firstChild).toBeNull();
  });
});

// A host that owns ProjectStatus state so the editor's commit/clear + the
// render-time reconcile run against a real setState (mirrors WorkspaceProvider).
function EditorHost({ initial = "" }: { initial?: string }) {
  const [status, setStatus] = useState<ProjectStatus>({ narrative: initial });
  return <NarrativeEditor lang="en-US" status={status} setStatus={setStatus} />;
}

describe("NarrativeEditor", () => {
  it("renders the editor inside a foldable details with the Status summary label", () => {
    render(<EditorHost />);
    const summary = screen.getByText("Status summary");
    expect(summary.closest("details")).not.toBeNull();
  });

  it("commits via Save and Clear empties the textarea", async () => {
    const user = userEvent.setup();
    render(<EditorHost />);
    // Open the disclosure so the editor is interactive.
    await user.click(screen.getByText("Status summary"));
    const textarea = screen.getByRole("textbox");
    await user.type(textarea, "Weekly note");
    await user.click(screen.getByRole("button", { name: /save/i }));
    const clear = screen.getByRole("button", { name: /clear/i });
    expect(clear).not.toBeDisabled();
    await user.click(clear);
    expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe("");
  });

  it("grows the textarea to scrollHeight on input (autogrow)", async () => {
    const user = userEvent.setup();
    render(<EditorHost />);
    await user.click(screen.getByText("Status summary"));
    const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
    Object.defineProperty(textarea, "scrollHeight", { configurable: true, value: 173 });
    await user.type(textarea, "a\nb\nc");
    expect(textarea.style.height).toBe("173px");
  });

  it("Clear is disabled when the narrative is already empty", () => {
    render(<EditorHost />);
    expect(screen.getByRole("button", { name: /clear/i })).toBeDisabled();
  });
});
