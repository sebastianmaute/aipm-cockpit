// src/app/use-cross-project-people.ts
"use client";
//
// §785 — loads the OTHER Turso projects on request so Plan with AI and the
// Resources entry can see a person's load elsewhere. Nothing loads until
// `request()`; every request reloads (no cache); projects load SEQUENTIALLY like
// use-portfolio-health.ts (load() runs DDL outside the write lock). The only
// write is to `person_links`, through person-links-store.
//
// ★ A request captures `getScopeEpoch()` before its first await and re-checks it
//   after every await: a project switch mid-load drops the result (status goes
//   back to idle). It also refuses to start while `loadPending`.
// ★ A failed link write leaves the in-memory links untouched, so the matches never
//   claim a state the store does not hold; `onWriteError` lets the caller toast.
import { useCallback, useMemo, useRef, useState } from "react";
import type { Resource, ResourcePlan } from "./types";
import type { TursoConfig } from "./turso-config";
import type { PortfolioMode } from "./portfolio-mode";
import { TursoBackend } from "./turso-backend";
import type { Workspace } from "./workspace";
import { generatePeriods } from "./resource-capacity";
import { isScopeStale } from "./scope-epoch";
import { logDiag } from "./diagnostics";
import { deletePersonLink, loadPersonLinks, savePersonLink } from "./person-links-store";
import {
  canonicalPair,
  matchPeople,
  usableEmails,
  type PersonLinkRow,
  type PersonMatch,
  type PersonRelation,
} from "./cross-project/person-match";
import { elsewhereFor, type ElsewhereFigure, type OtherProjectData } from "./cross-project/elsewhere-hours";

export type CrossProjectStatus = "unavailable" | "idle" | "loading" | "ready";

type Relation = Omit<PersonRelation, "via">;

export interface CrossProjectPeople {
  status: CrossProjectStatus;
  failures: { projectId: string; projectName: string }[];
  matches: Map<number, PersonMatch>;
  elsewhere: (resourceId: number) => ElsewhereFigure[];
  request: () => void;
  confirm: (hereResourceId: number, rel: Relation) => Promise<void>;
  reject: (hereResourceId: number, rel: Relation) => Promise<void>;
  undo: (hereResourceId: number, rel: Relation) => Promise<void>;
}

export interface CrossProjectDeps {
  tursoConfig: TursoConfig | null;
  portfolioMode: PortfolioMode;
  projects: readonly { id: string; name: string }[];
  currentProjectId: string | null;
  resources: readonly Resource[];
  plan: ResourcePlan;
  workdayHours: number;
  holidaySet: ReadonlySet<string>;
  loadPending: boolean;
  getScopeEpoch: () => number;
  actorLabel?: string;
  /** Called after a link write failed (the failure is also logged); the matches are left unchanged. */
  onWriteError?: (err: unknown) => void;
  load?: (config: TursoConfig, projectId: string) => Promise<Workspace>;
}

interface Loaded {
  projectId: string;
  others: OtherProjectData[];
  links: PersonLinkRow[];
  failures: { projectId: string; projectName: string }[];
}

const NO_FAILURES: { projectId: string; projectName: string }[] = [];
const NO_MATCHES = new Map<number, PersonMatch>();

const defaultLoad = (config: TursoConfig, projectId: string): Promise<Workspace> =>
  new TursoBackend(config, projectId).load();

const messageOf = (err: unknown): string => (err instanceof Error ? err.message : String(err));

// Rows are held as built (either order); compare in canonical order, as the store keys them.
const sameLink = (l: PersonLinkRow, p: ReturnType<typeof canonicalPair>): boolean => {
  const c = canonicalPair(l.projectA, l.resourceA, l.projectB, l.resourceB);
  return c.projectA === p.projectA && c.resourceA === p.resourceA && c.projectB === p.projectB && c.resourceB === p.resourceB;
};

export function useCrossProjectPeople(deps: CrossProjectDeps): CrossProjectPeople {
  const {
    tursoConfig, portfolioMode, projects, currentProjectId, resources, plan,
    workdayHours, holidaySet, loadPending, getScopeEpoch, actorLabel, onWriteError,
  } = deps;
  const load = deps.load ?? defaultLoad;
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [loading, setLoading] = useState(false);
  const inFlightRef = useRef(false);

  const available = portfolioMode === "turso" && tursoConfig !== null && currentProjectId !== null && projects.length > 1;
  // A result belongs to the project it was loaded for; after a switch it is invisible.
  const effective = loaded !== null && loaded.projectId === currentProjectId ? loaded : null;

  const request = useCallback((): void => {
    if (!available || loadPending || inFlightRef.current || !tursoConfig || currentProjectId === null) return;
    inFlightRef.current = true;
    setLoading(true);
    const startEpoch = getScopeEpoch();
    const projectId = currentProjectId;
    const run = async (): Promise<void> => {
      try {
        const others: OtherProjectData[] = [];
        const failures: Loaded["failures"] = [];
        for (const p of projects) {
          if (p.id === projectId) continue;
          try {
            const ws = await load(tursoConfig, p.id);
            if (isScopeStale(getScopeEpoch, startEpoch)) return;
            others.push({
              projectId: p.id, projectName: p.name, plan: ws.plan ?? null,
              resources: ws.resources ?? [], absences: ws.absences ?? [], tasks: ws.tasks ?? [],
            });
          } catch (err) {
            if (isScopeStale(getScopeEpoch, startEpoch)) return;
            logDiag("warn", "crossProject.projectLoadFailed", { projectId: p.id, message: messageOf(err) });
            failures.push({ projectId: p.id, projectName: p.name });
          }
        }
        const links = await loadPersonLinks(tursoConfig);
        if (isScopeStale(getScopeEpoch, startEpoch)) return;
        setLoaded({ projectId, others, links, failures });
      } catch (err) {
        logDiag("error", "crossProject.linksLoadFailed", { message: messageOf(err) });
      } finally {
        inFlightRef.current = false;
        setLoading(false);
      }
    };
    void run();
  }, [available, loadPending, tursoConfig, currentProjectId, projects, getScopeEpoch, load]);

  const matches = useMemo(
    () =>
      effective && currentProjectId
        ? matchPeople(
            currentProjectId,
            resources,
            effective.others.map((o) => ({ projectId: o.projectId, projectName: o.projectName, resources: o.resources })),
            effective.links,
          )
        : NO_MATCHES,
    [effective, currentProjectId, resources],
  );

  const herePeriods = useMemo(
    () => generatePeriods(plan.startDate, plan.endDate, plan.granularity),
    [plan.startDate, plan.endDate, plan.granularity],
  );

  const elsewhere = useCallback(
    (resourceId: number): ElsewhereFigure[] => {
      const m = matches.get(resourceId);
      if (!effective || !m || m.matched.length === 0) return [];
      return elsewhereFor(m.matched, effective.others, herePeriods, workdayHours, holidaySet);
    },
    [matches, effective, herePeriods, workdayHours, holidaySet],
  );

  const buildRow = (hereId: number, rel: Relation, verdict: PersonLinkRow["verdict"]): PersonLinkRow | null => {
    if (!effective || !currentProjectId) return null;
    const here = resources.find((r) => r.id === hereId);
    const there = effective.others.find((o) => o.projectId === rel.projectId)?.resources.find((r) => r.id === rel.resourceId);
    if (!here || !there) return null;
    return {
      projectA: currentProjectId, resourceA: hereId, projectB: rel.projectId, resourceB: rel.resourceId, verdict,
      firstA: here.firstName, lastA: here.lastName, firstB: there.firstName, lastB: there.lastName,
      emailsA: usableEmails(here).join(","), emailsB: usableEmails(there).join(","),
      decidedAt: new Date().toISOString(), decidedBy: actorLabel ?? "",
    };
  };

  // Write first, then reflect: a throwing store leaves the in-memory links as they were.
  const commit = async (write: () => Promise<void>, next: (links: PersonLinkRow[]) => PersonLinkRow[]): Promise<void> => {
    try {
      await write();
    } catch (err) {
      logDiag("error", "crossProject.linkWriteFailed", { message: messageOf(err) });
      onWriteError?.(err);
      return;
    }
    setLoaded((prev) => (prev ? { ...prev, links: next(prev.links) } : prev));
  };

  const decide = async (hereId: number, rel: Relation, verdict: PersonLinkRow["verdict"]): Promise<void> => {
    const row = buildRow(hereId, rel, verdict);
    if (!row) return;
    const key = canonicalPair(row.projectA, row.resourceA, row.projectB, row.resourceB);
    await commit(
      () => savePersonLink(tursoConfig, row),
      (links) => [...links.filter((l) => !sameLink(l, key)), row],
    );
  };

  const undo = async (hereId: number, rel: Relation): Promise<void> => {
    if (!currentProjectId) return;
    const pair = { projectA: currentProjectId, resourceA: hereId, projectB: rel.projectId, resourceB: rel.resourceId };
    const key = canonicalPair(pair.projectA, pair.resourceA, pair.projectB, pair.resourceB);
    await commit(
      () => deletePersonLink(tursoConfig, pair),
      (links) => links.filter((l) => !sameLink(l, key)),
    );
  };

  const status: CrossProjectStatus = !available ? "unavailable" : loading ? "loading" : effective ? "ready" : "idle";
  return {
    status,
    failures: effective?.failures ?? NO_FAILURES,
    matches,
    elsewhere,
    request,
    confirm: (hereId, rel) => decide(hereId, rel, "same"),
    reject: (hereId, rel) => decide(hereId, rel, "different"),
    undo,
  };
}
