"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { FiltersProvider } from "./filters-context";
import { WorkspaceProvider, useWorkspace } from "./workspace-context";
import { TaskFormProvider } from "./task-form-context";
import type { CalendarEvent } from "./calendar-event";
import {
  type Absence,
  type ChangeItem,
  type Milestone,
  type ProjectMeta,
  type RaidItem,
  type Resource,
  type Shift,
  type Stakeholder,
  type Task,
} from "./types";

/** The workspace slices a test may seed. Every one is optional and defaults to
 *  empty, so existing callers passing `tasks` alone are untouched.
 *  ★ Slices are added here ON DEMAND — this is not meant to grow into a mirror
 *  of `Workspace`. A test needing one the hook under test never reads would be
 *  paying setup cost for nothing. */
export interface TestSeed {
  tasks?: Task[];
  resources?: Resource[];
  raid?: RaidItem[];
  changes?: ChangeItem[];
  milestones?: Milestone[];
  stakeholders?: Stakeholder[];
  absences?: Absence[];
  shifts?: Shift[];
  project?: ProjectMeta;
  /** ★★★ OPTIONAL FOR TWO REASONS, and the second one is load-bearing.
   *  `Workspace.calendarEvents` is `readonly CalendarEvent[] | undefined` and
   *  `undefined` means "the slice is ABSENT", which is not the same claim as
   *  "this project has no meetings" — the context maintains that distinction
   *  deliberately and the write path is pinned on it.
   *  ★★ IT IS AN IN-MEMORY DISTINCTION, NOT A PERSISTED ONE. `workspaceToJson`
   *   emits the `calendarEvents` key only when the array is non-empty, so `[]`
   *   and `undefined` produce identical JSON — seeding `[]` here would therefore
   *   NOT be caught by any round-trip test, which is exactly why the rule has to
   *   be written down. So an unseeded slice must
   *  stay `undefined`, which the `?.length` guard below already delivers; never
   *  default it to `[]` here or in the `Seeder`. */
  calendarEvents?: CalendarEvent[];
}

function Seeder({ seed }: { seed: TestSeed }) {
  const {
    setTasks, setResources, setRaid, setChanges, setMilestones, setStakeholders,
    setAbsences, setCalendarEvents, setShifts, setProject,
  } = useWorkspace();
  const seededRef = useRef(false);
  useEffect(() => {
    if (seededRef.current) return;
    seededRef.current = true;
    // ★ Each guarded on non-empty rather than set unconditionally: an empty
    // write is not a no-op for a provider that starts with its own default,
    // and it would also mint a fresh array identity for every unseeded slice.
    if (seed.tasks?.length) setTasks(seed.tasks);
    if (seed.resources?.length) setResources(seed.resources);
    if (seed.raid?.length) setRaid(seed.raid);
    if (seed.changes?.length) setChanges(seed.changes);
    if (seed.milestones?.length) setMilestones(seed.milestones);
    if (seed.stakeholders?.length) setStakeholders(seed.stakeholders);
    if (seed.absences?.length) setAbsences(seed.absences);
    if (seed.shifts?.length) setShifts(seed.shifts);
    if (seed.project) setProject(seed.project);
    // ★ The guard is not merely tidiness on THIS line — see `calendarEvents` on
    // `TestSeed`. Writing `[]` for an unseeded project would assert the slice is
    // PRESENT AND EMPTY, a different fact from absent, and would defeat the one
    // distinction the calendar write path is built around.
    if (seed.calendarEvents?.length) setCalendarEvents(seed.calendarEvents);
    // Seed once on mount; subsequent `seed` prop changes are intentionally ignored.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}

export function TestProviders({
  children,
  tasks = [],
  seed,
}: {
  children: ReactNode;
  /** Kept as its own prop — every existing caller passes it positionally by
   *  name, and folding it into `seed` would be a churn-only rename. When both
   *  are given, `seed.tasks` wins. */
  tasks?: Task[];
  seed?: TestSeed;
}) {
  const merged: TestSeed = { tasks, ...seed };
  return (
    <FiltersProvider>
      <WorkspaceProvider>
        <Seeder seed={merged} />
        <TaskFormProvider>{children}</TaskFormProvider>
      </WorkspaceProvider>
    </FiltersProvider>
  );
}
