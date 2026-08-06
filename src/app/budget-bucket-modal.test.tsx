import { describe, expect, test, vi } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { useEffect, useRef, type ReactNode } from "react";
import { FiltersProvider } from "./filters-context";
import { WorkspaceProvider, useWorkspace } from "./workspace-context";
import { BudgetBucketModal } from "./budget-bucket-modal";
import { applyTier } from "./field-visibility";
import type { FieldTier } from "./modal-fields";
import { t } from "./i18n";
import { selectFieldTier } from "../test/field-tier";
import type { BudgetBucket, Role, Task } from "./types";

// The planning-mode data-loss warning now routes through the branded
// `useConfirm()` hook (async) instead of window.confirm. This test has no
// ConfirmProvider, so mock the hook with a per-test controllable answer.
const confirmMock = vi.hoisted(() => ({ result: true }));
vi.mock("./confirm-dialog", () => ({
  useConfirm: () => () => Promise.resolve(confirmMock.result),
}));

// ModalFieldControls (rendered in the modal header) reads field visibility from
// the workspace, so every render needs a WorkspaceProvider/FiltersProvider.
function wrapper({ children }: { children: ReactNode }) {
  return (
    <FiltersProvider>
      <WorkspaceProvider>{children}</WorkspaceProvider>
    </FiltersProvider>
  );
}

/** Seeds the workspace field-visibility config once on mount. */
function Seed({ tier }: { tier: FieldTier }) {
  const { setFieldVisibility } = useWorkspace();
  const seeded = useRef(false);
  useEffect(() => {
    if (seeded.current) return;
    seeded.current = true;
    setFieldVisibility(() => ({ budget: applyTier("budget", tier) }));
  }, [setFieldVisibility, tier]);
  return null;
}

const roles: Role[] = [
  { id: 3, disciplineId: 1, gradeId: 1, internalRate: 100, externalRate: 150 },
  { id: 4, disciplineId: 1, gradeId: 2, internalRate: 120, externalRate: 180 },
];

const disciplines = [
  { id: 1, name: "Consulting" },
  { id: 2, name: "Development" },
];

const baseBucket: BudgetBucket = {
  id: 1,
  name: "PAM",
  type: "tm",
  currency: "EUR",
  startDate: "2026-01-01",
  endDate: "2026-06-30",
  status: "open",
  allocations: [],
};

const tasks: Task[] = [
  {
    id: 21,
    taskName: "Kickoff workshop",
    assignee: "Sam Lee",
    assigneeEmail: "sam@example.com",
    dueDate: "2026-02-01",
    lastUpdateDate: "2026-01-15",
    priority: "Medium",
    status: "To Do",
    blockers: "",
    description: "",
  },
  {
    id: 22,
    taskName: "Draft scope doc",
    assignee: "Sam Lee",
    assigneeEmail: "sam@example.com",
    dueDate: "2026-02-10",
    lastUpdateDate: "2026-01-15",
    priority: "Medium",
    status: "Done",
    blockers: "",
    description: "",
  },
];

function setup(
  over: Partial<React.ComponentProps<typeof BudgetBucketModal>> = {},
) {
  const onSave = vi.fn();
  const result = render(
    <>
      {/* Seed Full so every field (incl. Full-only rate overrides + planning) renders. */}
      <Seed tier="full" />
      <BudgetBucketModal
        lang="en-US"
        bucket={baseBucket}
        allBuckets={[baseBucket]}
        roles={roles}
        disciplines={[]}
        grades={[]}
        resources={[]}
        onSave={onSave}
        onClose={vi.fn()}
        {...over}
      />
    </>,
    { wrapper },
  );
  return { onSave, ...result };
}

describe("BudgetBucketModal", () => {
  test("editing name and saving emits the updated bucket", () => {
    const { onSave } = setup();
    fireEvent.change(screen.getByDisplayValue("PAM"), {
      target: { value: "PAM v2" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onSave.mock.calls[0][0].name).toBe("PAM v2");
  });

  test("blank name blocks save with a message", () => {
    const { onSave } = setup();
    fireEvent.change(screen.getByDisplayValue("PAM"), {
      target: { value: "  " },
    });
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByText(/name is required/i)).toBeInTheDocument();
  });

  test("start after end blocks save", () => {
    const { onSave } = setup();
    fireEvent.change(screen.getByDisplayValue("2026-06-30"), {
      target: { value: "2025-01-01" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByText(/start date must be/i)).toBeInTheDocument();
  });

  test("negative fixed-price amount blocks save", () => {
    const { onSave } = setup({ bucket: { ...baseBucket, type: "fixed", fixedPriceAmount: 0 } });
    // switch the amount to a negative value
    const amount = screen.getByDisplayValue("0");
    fireEvent.change(amount, { target: { value: "-5" } });
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByText(/amount must be zero or greater/i)).toBeInTheDocument();
  });

  test("zero/negative FX override blocks save", () => {
    const { onSave } = setup();
    const fx = screen.getByLabelText(/manual fx rate/i);
    fireEvent.change(fx, { target: { value: "0" } });
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByText(/fx rate must be greater than zero/i)).toBeInTheDocument();
  });

  test("remove role drops the allocation", () => {
    const { onSave } = setup({
      bucket: { ...baseBucket, allocations: [{ roleId: 3, resourceIds: [], budgetHours: {}, actualHours: {} }] },
    });
    fireEvent.click(screen.getByRole("button", { name: /remove role/i }));
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
    expect((onSave.mock.calls[0][0] as BudgetBucket).allocations).toHaveLength(0);
  });

  test("toggling a resource updates the allocation's resourceIds", () => {
    const resource = { id: 7, firstName: "Sam", lastName: "Lee", roleId: null, utilizationMode: "percent" as const, utilization: {} };
    const { onSave } = setup({
      bucket: { ...baseBucket, allocations: [{ roleId: 3, resourceIds: [], budgetHours: {}, actualHours: {} }] },
      resources: [resource],
    });
    fireEvent.click(screen.getByRole("checkbox", { name: /sam lee/i }));
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
    expect((onSave.mock.calls[0][0] as BudgetBucket).allocations[0].resourceIds).toEqual([7]);
  });

  test("add role appends an allocation with empty hour maps", () => {
    const { onSave } = setup();
    fireEvent.change(screen.getByRole("combobox", { name: /add role/i }), {
      target: { value: "3" },
    });
    fireEvent.click(
      screen.getByRole("button", { name: /\+ add role/i }),
    );
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
    const saved = onSave.mock.calls[0][0] as BudgetBucket;
    expect(saved.allocations).toHaveLength(1);
    expect(saved.allocations[0]).toMatchObject({
      roleId: 3,
      resourceIds: [],
      budgetHours: {},
      actualHours: {},
    });
  });

  test("blended bucket shows discipline rows and can add one", () => {
    const { onSave } = setup({
      disciplines,
      bucket: { ...baseBucket, planningMode: "blended", disciplineAllocations: [] },
    });
    fireEvent.change(screen.getByRole("combobox", { name: /add discipline/i }), {
      target: { value: "2" },
    });
    fireEvent.click(screen.getByRole("button", { name: /\+ add discipline/i }));
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
    const saved = onSave.mock.calls[0][0] as BudgetBucket;
    expect(saved.disciplineAllocations).toEqual([
      { disciplineId: 2, resourceIds: [], budgetHours: {}, actualHours: {} },
    ]);
  });

  test("turning off detailed planning with entered hours warns and clears them on confirm", async () => {
    confirmMock.result = true;
    const { onSave } = setup({
      disciplines,
      bucket: {
        ...baseBucket,
        planningMode: "detailed",
        allocations: [{ roleId: 3, resourceIds: [], budgetHours: { "2026-01": 40 }, actualHours: {} }],
      },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /detailed budget planning/i }));
    });
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
    const saved = onSave.mock.calls[0][0] as BudgetBucket;
    expect(saved.planningMode).toBe("blended");
    expect(saved.allocations[0].budgetHours).toEqual({});
  });

  test("cancelling the warning keeps detailed mode and hours", async () => {
    confirmMock.result = false;
    const { onSave } = setup({
      disciplines,
      bucket: {
        ...baseBucket,
        planningMode: "detailed",
        allocations: [{ roleId: 3, resourceIds: [], budgetHours: { "2026-01": 40 }, actualHours: {} }],
      },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /detailed budget planning/i }));
    });
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
    const saved = onSave.mock.calls[0][0] as BudgetBucket;
    expect(saved.planningMode).toBe("detailed");
    expect(saved.allocations[0].budgetHours).toEqual({ "2026-01": 40 });
  });

  test("turning ON detailed planning with entered discipline hours warns and clears them on confirm", async () => {
    confirmMock.result = true;
    const { onSave } = setup({
      disciplines,
      bucket: {
        ...baseBucket,
        planningMode: "blended",
        allocations: [],
        disciplineAllocations: [{ disciplineId: 1, resourceIds: [], budgetHours: { "2026-01": 20 }, actualHours: {} }],
      },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /detailed budget planning/i }));
    });
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
    const saved = onSave.mock.calls[0][0] as BudgetBucket;
    expect(saved.planningMode).toBe("detailed");
    expect(saved.disciplineAllocations![0].budgetHours).toEqual({});
  });

  test("cancelling the switch-to-detailed warning keeps blended mode and discipline hours", async () => {
    confirmMock.result = false;
    const { onSave } = setup({
      disciplines,
      bucket: {
        ...baseBucket,
        planningMode: "blended",
        allocations: [],
        disciplineAllocations: [{ disciplineId: 1, resourceIds: [], budgetHours: { "2026-01": 20 }, actualHours: {} }],
      },
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /detailed budget planning/i }));
    });
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
    const saved = onSave.mock.calls[0][0] as BudgetBucket;
    expect(saved.planningMode).toBe("blended");
    expect(saved.disciplineAllocations![0].budgetHours).toEqual({ "2026-01": 20 });
  });

  test("negative internal rate override blocks save", () => {
    const { onSave } = setup({ disciplines });
    fireEvent.change(screen.getByLabelText(/internal rate override/i), { target: { value: "-1" } });
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByText(/zero or greater/i)).toBeInTheDocument();
  });

  test("rate override hint is an InfoTooltip (accessible by name), not a native title on the input", () => {
    setup({ disciplines });
    // Both internal and external rate labels get an InfoTooltip with the same hint key —
    // expect two tooltip buttons (one per field).
    const hintText = t("en-US", "budgetRateOverrideHint");
    expect(screen.getAllByRole("button", { name: hintText }).length).toBeGreaterThanOrEqual(1);
    // The internal rate input itself must NOT carry the native title any more.
    const input = screen.getByLabelText(t("en-US", "budgetRateOverrideInternal"));
    expect(input.getAttribute("title")).toBeNull();
  });

  test("tier switch hides advanced/full fields but keeps required ones", () => {
    // Render at the Advanced default (no Seed) and assert against modal-BODY labels.
    render(
      <BudgetBucketModal
        lang="en-US"
        bucket={baseBucket}
        allBuckets={[baseBucket]}
        roles={roles}
        disciplines={[]}
        grades={[]}
        resources={[]}
        onSave={vi.fn()}
        onClose={vi.fn()}
      />,
      { wrapper },
    );

    const fxLabel = t("en-US", "budgetFxOverride"); // advanced
    const rateLabel = t("en-US", "budgetRateOverrideInternal"); // full
    const nameLabel = t("en-US", "budgetBucketName"); // required
    const startLabel = t("en-US", "budgetStartDate"); // required (period)

    // Advanced default: the advanced FX field shows; the Full-only rate override is hidden.
    expect(screen.getByText(fxLabel)).toBeInTheDocument();
    expect(screen.queryByText(rateLabel)).not.toBeInTheDocument();

    // Switch to Simple: the advanced FX field disappears, required fields remain.
    selectFieldTier("fieldViewSimple");
    expect(screen.queryByText(fxLabel)).not.toBeInTheDocument();
    expect(screen.getByText(nameLabel)).toBeInTheDocument();
    expect(screen.getByText(startLabel)).toBeInTheDocument();
  });

  // Root-cause regression (0.169.4): detailed-planning allocations were tier "full",
  // so at the default Advanced tier the add-role/add-discipline controls were hidden
  // and the user "could not add roles or disciplines to budget buckets".
  test("shows the detailed-planning allocation controls at the default Advanced tier", () => {
    render(
      <BudgetBucketModal
        lang="en-US"
        bucket={baseBucket}
        allBuckets={[baseBucket]}
        roles={roles}
        disciplines={[]}
        grades={[]}
        resources={[]}
        onSave={vi.fn()}
        onClose={vi.fn()}
      />,
      { wrapper },
    );
    // No field-visibility Seed → the Advanced default. The detailed-planning toggle
    // and the add-role dropdown must both be present.
    expect(
      screen.getByRole("button", { name: t("en-US", "budgetDetailedPlanning") }),
    ).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: /add role/i })).toBeInTheDocument();
  });

  test("empty rate card: add-role dropdown says 'no roles defined' and shows a hint to Manage roles", () => {
    setup({ roles: [], disciplines: [] });
    expect(screen.getByText(t("en-US", "budgetNoRolesDefined"))).toBeInTheDocument();
    expect(screen.getByText(/add roles under/i)).toBeInTheDocument();
    // The misleading "already allocated" copy must NOT show when zero roles exist.
    expect(screen.queryByText(t("en-US", "budgetNoRolesLeft"))).not.toBeInTheDocument();
  });

  test("empty rate card (blended): discipline dropdown says 'no disciplines defined' with a hint", () => {
    setup({
      roles: [],
      disciplines: [],
      bucket: { ...baseBucket, planningMode: "blended", disciplineAllocations: [] },
    });
    expect(screen.getByText(t("en-US", "budgetNoDisciplinesDefined"))).toBeInTheDocument();
    expect(screen.getByText(/add disciplines under/i)).toBeInTheDocument();
    expect(screen.queryByText(t("en-US", "budgetNoDisciplinesLeft"))).not.toBeInTheDocument();
  });

  // C4: link tasks + manual percent complete -----------------------------

  test("linking a task writes taskIds", () => {
    const { onSave } = setup({ tasks });
    const search = screen.getByLabelText(t("en-US", "budgetLinkedTasks"));
    fireEvent.change(search, { target: { value: "Kickoff" } });
    // The dropdown row IS the option now (no nested button inside role=option).
    fireEvent.click(screen.getByRole("option", { name: /kickoff workshop/i }));
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
    expect(onSave).toHaveBeenCalledTimes(1);
    expect((onSave.mock.calls[0][0] as BudgetBucket).taskIds).toEqual([21]);
  });

  test("removing a linked task drops it from taskIds", () => {
    const { onSave } = setup({ tasks, bucket: { ...baseBucket, taskIds: [21, 22] } });
    // Prefix match: these chips are not click-through, so the unlink button now
    // carries the task's title after its code — otherwise it is the only
    // focusable thing in the chip and names no entity at all.
    fireEvent.click(
      screen.getByRole("button", { name: new RegExp(`^${t("en-US", "taskUnlink")} #21\\b`) }),
    );
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
    expect((onSave.mock.calls[0][0] as BudgetBucket).taskIds).toEqual([22]);
  });

  test("typing a percent writes percentComplete", () => {
    const { onSave } = setup();
    const percent = screen.getByLabelText(t("en-US", "budgetPercentComplete"));
    fireEvent.change(percent, { target: { value: "40" } });
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
    expect(onSave).toHaveBeenCalledTimes(1);
    expect((onSave.mock.calls[0][0] as BudgetBucket).percentComplete).toBe(40);
  });

  test("clearing the percent writes undefined, not 0", () => {
    const { onSave } = setup({ bucket: { ...baseBucket, percentComplete: 50 } });
    const percent = screen.getByLabelText(t("en-US", "budgetPercentComplete"));
    fireEvent.change(percent, { target: { value: "" } });
    fireEvent.blur(percent);
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
    expect(onSave).toHaveBeenCalledTimes(1);
    expect((onSave.mock.calls[0][0] as BudgetBucket).percentComplete).toBeUndefined();
  });

  test("typing an out-of-range percent above 100 clamps on change, not just blur", () => {
    const { onSave } = setup();
    const percent = screen.getByLabelText(t("en-US", "budgetPercentComplete"));
    fireEvent.change(percent, { target: { value: "150" } });
    // Assert the draft/preview is clamped immediately, before any blur.
    expect(percent).toHaveValue(100);
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
    expect(onSave).toHaveBeenCalledTimes(1);
    expect((onSave.mock.calls[0][0] as BudgetBucket).percentComplete).toBe(100);
  });

  test("typing a negative percent clamps to 0 on change", () => {
    const { onSave } = setup();
    const percent = screen.getByLabelText(t("en-US", "budgetPercentComplete"));
    fireEvent.change(percent, { target: { value: "-5" } });
    expect(percent).toHaveValue(0);
    fireEvent.click(screen.getByRole("button", { name: /^save$/i }));
    expect(onSave).toHaveBeenCalledTimes(1);
    expect((onSave.mock.calls[0][0] as BudgetBucket).percentComplete).toBe(0);
  });

  test("the panel carries a default height and min-height, not just a max", () => {
    // Headline claim FIRST: useResizable needs a class-based default height or a
    // dragged height is dead space (same defect as the shared edit-modal shell).
    setup();
    const panel = document.querySelector("[data-modal-panel]") as HTMLElement;
    expect(panel.className).toContain("h-[640px]");
    expect(panel.className).toContain("min-h-[400px]");
    expect(panel.className).toContain("max-h-[95vh]");
  });
});

describe("BudgetBucketModal field-visibility control", () => {
  test("mounts the field-visibility trigger inside the modal header", () => {
    setup();
    const trigger = screen.getByRole("button", {
      name: new RegExp(t("en-US", "configureFields")),
    });
    // PLACEMENT, not presence — see edit-modal-chrome.test.tsx.
    expect(trigger.closest("header")).not.toBeNull();
  });
});
