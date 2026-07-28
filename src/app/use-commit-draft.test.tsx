import { describe, expect, test, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useCommitDraft } from "./use-commit-draft";

function Harness({ committed, commit }: { committed: string; commit: (raw: string) => void }) {
  const d = useCommitDraft(committed, commit);
  return (
    <input
      aria-label="field"
      value={d.value}
      onChange={(e) => d.onChange(e.target.value)}
      onFocus={d.onFocus}
      onBlur={d.onBlur}
      onKeyDown={d.onKeyDown}
    />
  );
}

describe("useCommitDraft", () => {
  test("typing several characters commits ONCE, on blur", async () => {
    const commit = vi.fn();
    const user = userEvent.setup();
    render(
      <>
        <Harness committed="0" commit={commit} />
        <button>away</button>
      </>,
    );
    await user.clear(screen.getByLabelText("field"));
    await user.type(screen.getByLabelText("field"), "40");
    expect(commit).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "away" }));
    expect(commit).toHaveBeenCalledTimes(1);
    expect(commit).toHaveBeenCalledWith("40");
  });

  test("Enter commits and the following blur does not commit again", async () => {
    const commit = vi.fn();
    const user = userEvent.setup();
    render(
      <>
        <Harness committed="0" commit={commit} />
        <button>away</button>
      </>,
    );
    await user.clear(screen.getByLabelText("field"));
    await user.type(screen.getByLabelText("field"), "7{Enter}");
    expect(commit).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole("button", { name: "away" }));
    expect(commit).toHaveBeenCalledTimes(1);
  });

  test("Escape reverts to the committed value and commits nothing", async () => {
    const commit = vi.fn();
    const user = userEvent.setup();
    render(<Harness committed="12" commit={commit} />);
    await user.clear(screen.getByLabelText("field"));
    await user.type(screen.getByLabelText("field"), "99{Escape}");
    expect(commit).not.toHaveBeenCalled();
    expect(screen.getByLabelText("field")).toHaveValue("12");
  });

  test("an unchanged value commits nothing on blur", async () => {
    const commit = vi.fn();
    const user = userEvent.setup();
    render(
      <>
        <Harness committed="5" commit={commit} />
        <button>away</button>
      </>,
    );
    await user.click(screen.getByLabelText("field"));
    await user.click(screen.getByRole("button", { name: "away" }));
    expect(commit).not.toHaveBeenCalled();
  });

  test("the committed value flows back in after a commit (undo/redo visibility)", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<Harness committed="1" commit={() => {}} />);
    await user.clear(screen.getByLabelText("field"));
    await user.type(screen.getByLabelText("field"), "2");
    await user.tab();
    rerender(<Harness committed="9" commit={() => {}} />);
    expect(screen.getByLabelText("field")).toHaveValue("9");
  });
});
