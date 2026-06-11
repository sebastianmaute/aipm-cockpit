import { describe, test, expect } from "vitest";
import { renderHook, render, fireEvent, act } from "@testing-library/react";
import { memo, useState, type Dispatch, type ReactNode, type SetStateAction } from "react";
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

  test("modal toggles and setEditingId work as a cluster", () => {
    const { result } = renderHook(() => useTaskForm(), { wrapper });

    // Enter "edit task #7" mode.
    act(() => {
      result.current.setEditingId(7);
      result.current.setTaskModalOpen(true);
    });
    expect(result.current.editingId).toBe(7);
    expect(result.current.taskModalOpen).toBe(true);

    // Close modal — editingId is NOT auto-reset.
    act(() => result.current.setTaskModalOpen(false));
    expect(result.current.taskModalOpen).toBe(false);
    expect(result.current.editingId).toBe(7);

    // Bulk-edit cluster mirrors the same pattern.
    act(() => {
      result.current.setBulkEdit((prev) => ({ ...prev, priority: "Urgent" }));
      result.current.setBulkEditOpen(true);
    });
    expect(result.current.bulkEdit.priority).toBe("Urgent");
    expect(result.current.bulkEditOpen).toBe(true);

    act(() => result.current.setBulkEditOpen(false));
    expect(result.current.bulkEditOpen).toBe(false);
    expect(result.current.bulkEdit.priority).toBe("Urgent");
  });

  test("context value is referentially stable across unrelated parent re-renders", () => {
    let consumerRenders = 0;
    const Consumer = memo(function Consumer() {
      useTaskForm();
      consumerRenders += 1;
      return null;
    });

    function Harness() {
      const [, setTick] = useState(0);
      return (
        <>
          <button onClick={() => setTick((t) => t + 1)}>tick</button>
          <TaskFormProvider>
            <Consumer />
          </TaskFormProvider>
        </>
      );
    }

    const { getByText } = render(<Harness />);
    const after = consumerRenders;
    expect(after).toBeGreaterThan(0);

    fireEvent.click(getByText("tick"));
    fireEvent.click(getByText("tick"));
    expect(consumerRenders).toBe(after);
  });

  test("a form state change still re-renders consumers (counter sanity)", () => {
    let consumerRenders = 0;
    const Consumer = memo(function Consumer() {
      useTaskForm();
      consumerRenders += 1;
      return null;
    });

    let setOpenRef: Dispatch<SetStateAction<boolean>> | undefined;
    function CaptureSetter() {
      setOpenRef = useTaskForm().setTaskModalOpen;
      return null;
    }

    render(
      <TaskFormProvider>
        <Consumer />
        <CaptureSetter />
      </TaskFormProvider>,
    );
    const after = consumerRenders;

    act(() => setOpenRef!(true));
    expect(consumerRenders).toBeGreaterThan(after);
  });

  test("useTaskForm() outside a TaskFormProvider throws a documented error", () => {
    // React logs the rendering error to console.error in dev; silence it
    // so the test output stays clean. Restore after to avoid hiding
    // unrelated noise from later tests.
    const original = console.error;
    console.error = () => {};
    try {
      expect(() => renderHook(() => useTaskForm())).toThrow(
        "useTaskForm must be used within TaskFormProvider",
      );
    } finally {
      console.error = original;
    }
  });
});
