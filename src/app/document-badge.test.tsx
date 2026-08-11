import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DocumentBadge } from "./document-badge";

describe("DocumentBadge", () => {
  it("renders the count and calls onOpen", async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    render(<DocumentBadge lang="en-US" count={2} entityTitle="Kickoff" onOpen={onOpen} />);
    await user.click(screen.getByRole("button"));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  // ★★★ THE ONLY POSSIBLE DETECTOR for this collision — see hazard 2 above.
  it("gives two badges on different rows row-UNIQUE accessible names", () => {
    render(
      <>
        <DocumentBadge lang="en-US" count={2} entityTitle="Kickoff" onOpen={vi.fn()} />
        <DocumentBadge lang="en-US" count={2} entityTitle="Vendor delay" onOpen={vi.fn()} />
      </>,
    );
    const names = screen.getAllByRole("button").map((b) => b.getAttribute("aria-label"));
    expect(new Set(names).size).toBe(2);
    expect(names[0]).toContain("Kickoff");
  });

  it("renders nothing at count 0", () => {
    const { container } = render(<DocumentBadge lang="en-US" count={0} entityTitle="Kickoff" onOpen={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("stops the click from reaching the row", async () => {
    const user = userEvent.setup();
    const onRowClick = vi.fn();
    render(
      <div onClick={onRowClick}>
        <DocumentBadge lang="en-US" count={1} entityTitle="Kickoff" onOpen={vi.fn()} />
      </div>,
    );
    await user.click(screen.getByRole("button"));
    expect(onRowClick).not.toHaveBeenCalled();
  });
});
