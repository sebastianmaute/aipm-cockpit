import { describe, test, expect, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useState } from "react";
import { useUndoStack } from "./use-undo-stack";

interface Row { id: number; name: string; status: string; done: string; localModifiedAt?: string }

function harness(initial: readonly Row[]) {
  return renderHook(() => {
    const [rows, setRows] = useState<readonly Row[]>(initial);
    const undo = useUndoStack({
      lang: "en-US",
      logActivity: vi.fn(),
      showToast: vi.fn(),
      showToastAction: vi.fn(),
    });
    return { rows, setRows, undo };
  });
}

describe("captureFieldEdit", () => {
  test("undo reverts only the captured keys; redo re-applies them", () => {
    const { result } = harness([{ id: 1, name: "old", status: "To Do", done: "" }]);
    act(() => {
      result.current.setRows((p) => p.map((r) => (r.id === 1 ? { ...r, name: "new" } : r)));
      result.current.undo.captureFieldEdit({
        setter: result.current.setRows,
        kind: "task.updated",
        id: 1,
        before: { name: "old" },
        after: { name: "new" },
      });
    });
    expect(result.current.rows[0].name).toBe("new");
    act(() => result.current.undo.undo());
    expect(result.current.rows[0].name).toBe("old");
    act(() => result.current.undo.redo());
    expect(result.current.rows[0].name).toBe("new");
  });

  test("multi-key group reverts together (status + done)", () => {
    const { result } = harness([{ id: 1, name: "t", status: "Done", done: "2026-01-01" }]);
    act(() => {
      result.current.undo.captureFieldEdit({
        setter: result.current.setRows,
        kind: "task.updated",
        id: 1,
        before: { status: "To Do", done: "" },
        after: { status: "Done", done: "2026-01-01" },
      });
      result.current.setRows((p) => p.map((r) => ({ ...r, status: "Done", done: "2026-01-01" })));
    });
    act(() => result.current.undo.undo());
    expect(result.current.rows[0]).toMatchObject({ status: "To Do", done: "" });
  });

  test("stampField re-stamps localModifiedAt on undo", () => {
    const { result } = harness([{ id: 1, name: "t", status: "x", done: "", localModifiedAt: "t0" }]);
    act(() => {
      result.current.undo.captureFieldEdit({
        setter: result.current.setRows,
        kind: "task.updated",
        id: 1,
        before: { name: "t" },
        after: { name: "t2" },
        stampField: "localModifiedAt",
      });
    });
    act(() => result.current.undo.undo());
    expect(result.current.rows[0].localModifiedAt).not.toBe("t0");
  });

  test("missing id is a no-op (row deleted since)", () => {
    const { result } = harness([{ id: 1, name: "t", status: "x", done: "" }]);
    act(() => {
      result.current.undo.captureFieldEdit({
        setter: result.current.setRows,
        kind: "task.updated",
        id: 99,
        before: { name: "gone" },
        after: { name: "x" },
      });
    });
    act(() => result.current.undo.undo());
    expect(result.current.rows).toHaveLength(1);
    expect(result.current.rows[0].name).toBe("t");
  });
});
