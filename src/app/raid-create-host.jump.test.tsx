import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { RaidEditModalProps } from "./raid-edit-modal";
import type { RaidItem } from "./types";

const captured: { props: RaidEditModalProps | null } = { props: null };
vi.mock("./raid-edit-modal", () => ({
  RaidEditModal: (props: RaidEditModalProps) => {
    captured.props = props;
    return null;
  },
}));

import { RaidCreateHost, type RaidCreateController } from "./raid-create-host";

const draft: RaidItem = {
  id: 1, category: "R", title: "", status: "Open", linkedTaskIds: [], causedByRaidIds: [],
  stakeholderIds: [], raisedDate: "2026-06-20",
};

describe("RaidCreateHost — jump to an existing RAID item", () => {
  it("closes the host FIRST, then forwards the id to onJumpToRaid", () => {
    const cancel = vi.fn();
    const onJumpToRaid = vi.fn();
    const create = {
      request: { draft, origin: { kind: "action", action: {} as never } },
      setDraft: vi.fn(), applyDraftStatus: vi.fn(), applyDraftMatrix: vi.fn(), commit: vi.fn(), cancel,
    } as unknown as RaidCreateController;
    render(
      <RaidCreateHost
        create={create} lang="en-US" tasks={[]} raid={[]} stakeholdersEnabled stakeholders={[]}
        resources={[]} contacts={[]} onCreateResource={() => 1} onJumpToRaid={onJumpToRaid}
      />,
    );
    expect(captured.props?.isNew).toBe(true); // positive control: the stub received the host's props
    captured.props!.onJumpToRaid(5);
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(onJumpToRaid).toHaveBeenCalledWith(5);
    expect(cancel.mock.invocationCallOrder[0]).toBeLessThan(onJumpToRaid.mock.invocationCallOrder[0]);
  });
});
