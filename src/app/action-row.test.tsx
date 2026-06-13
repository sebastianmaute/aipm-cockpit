import { describe, expect, it, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import { ActionRow } from "./action-row";
import type { SuggestedAction } from "./next-actions/types";

const action: SuggestedAction = {
  id: "raid:1:severity", source: "raid", moduleId: "raid",
  title: { key: "actionRaidTitle", params: [1, "Server down"] },
  why: { key: "actionRaidWhySeverity", params: ["Critical"] },
  score: 30, tier: "soon", cta: { kind: "open", view: "raid", id: 1 },
};

describe("ActionRow", () => {
  it("clicking the row fires onOpen with the action", () => {
    const onOpen = vi.fn();
    const { getByRole } = render(<ActionRow lang="en-US" action={action} onOpen={onOpen} />);
    fireEvent.click(getByRole("button", { name: /Server down/i }));
    expect(onOpen).toHaveBeenCalledWith(action);
  });
  it("clicking the Open button fires onOpen exactly once (stopPropagation)", () => {
    const onOpen = vi.fn();
    const { getByRole } = render(<ActionRow lang="en-US" action={action} onOpen={onOpen} />);
    fireEvent.click(getByRole("button", { name: "Open" }));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });
});
