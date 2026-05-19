import { describe, test, expect } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { type ReactNode } from "react";
import {
  TaskFormProvider,
  useTaskForm,
  emptyForm,
  emptyBulkEdit,
} from "./task-form-context";

function wrapper({ children }: { children: ReactNode }) {
  return <TaskFormProvider>{children}</TaskFormProvider>;
}

describe("TaskFormProvider", () => {
  test("exposes the documented defaults", () => {
    const { result } = renderHook(() => useTaskForm(), { wrapper });
    expect(result.current.form).toEqual(emptyForm());
    expect(result.current.bulkEdit).toEqual(emptyBulkEdit());
    expect(result.current.editingId).toBeNull();
    expect(result.current.taskModalOpen).toBe(false);
    expect(result.current.bulkEditOpen).toBe(false);
  });

  test("setForm accepts object replacement", () => {
    const { result } = renderHook(() => useTaskForm(), { wrapper });

    act(() =>
      result.current.setForm({ ...emptyForm(), taskName: "hello" }),
    );

    expect(result.current.form.taskName).toBe("hello");
    expect(result.current.form.assignee).toBe("");
    expect(result.current.form.priority).toBe("Medium");
  });

  test("setForm accepts an updater function", () => {
    const { result } = renderHook(() => useTaskForm(), { wrapper });

    act(() =>
      result.current.setForm((prev) => ({ ...prev, priority: "High" })),
    );

    expect(result.current.form.priority).toBe("High");
    // Other fields should still be defaults.
    expect(result.current.form.taskName).toBe("");
    expect(result.current.form.assignee).toBe("");
  });
});
