import { test, expect, vi } from "vitest";
import type React from "react";
import { renderHook, act } from "@testing-library/react";
import { useChangeLog } from "./use-change-log";
import type { ChangeItem } from "./types";

vi.mock("./workspace-context", () => {
  let state: readonly ChangeItem[] = [];
  const setChanges = (u: React.SetStateAction<readonly ChangeItem[]>) => {
    state = typeof u === "function" ? (u as (p: readonly ChangeItem[]) => readonly ChangeItem[])(state) : u;
  };
  return {
    useWorkspace: () => ({ changes: state, setChanges }),
    __seed: (rows: readonly ChangeItem[]) => { state = rows; },
  };
});

test("editing one field pushes a captureFieldEdit for that field", async () => {
  const mod = (await import("./workspace-context")) as unknown as { __seed: (r: readonly ChangeItem[]) => void };
  const existing = { id: 1, title: "C", description: "old" } as ChangeItem;
  mod.__seed([existing]);
  const captureFieldEdit = vi.fn();
  const { result } = renderHook(() => useChangeLog({ today: "2026-01-01", captureFieldEdit }));
  act(() => result.current.handleSaveChange({ ...existing, description: "new" }, false));
  expect(captureFieldEdit).toHaveBeenCalledTimes(1);
  expect(captureFieldEdit.mock.calls[0][0]).toMatchObject({
    kind: "change.updated", id: 1, before: { description: "old" }, after: { description: "new" },
  });
});
