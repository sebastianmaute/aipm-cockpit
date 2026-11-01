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
//   back to idle). It refuses to start while `loadPending`, but REMEMBERS the ask and starts it when the hold ends.
// ★ A link write that lands while a reload is in flight is re-applied over the reloaded links: the reload may have
//   read `person_links` before the write, and replacing the links would silently drop it from memory.
// ★ A failed link write leaves the in-memory links untouched, so the matches never
//   claim a state the store does not hold; `onWriteError` lets the caller toast.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Resource, ResourcePlan } from "./types";
import type { TursoConfig } from "./turso-config";
import type { PortfolioMode } from "./portfolio-mode";
import { TursoBackend } from "./turso-backend";
import type { Workspace } from "./workspace";
import { generatePeriods } from "./resource-capacity";
import { resourceDisplayName } from "./resource-foundation";
import { isScopeStale } from "./scope-epoch";
import { logDiag } from "./diagnostics";
import { useStableHandlers } from "./use-stable-handlers";
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
  /** Turso portfolio mode, but this is the only project: nothing else to read (status "unavailable"). */
  singleProject: boolean;
  /** The stored answers could not be loaded, so nothing was matched; cleared by the next request. */
  loadFailed: boolean;
  matches: Map<number, PersonMatch>;
  elsewhere: (resourceId: number) => ElsewhereFigure[];
  /** Display name of a person in ANOTHER project, from the loaded data; "" when nothing is loaded or the person is unknown. */
  nameOf: (projectId: string, resourceId: number) => string;
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
  /** Identity of the database the result was read from; a config change hides it. */
  configKey: string;
  others: OtherProjectData[];
  links: PersonLinkRow[];
  failures: { projectId: string; projectName: string }[];
}

const NO_FAILURES: { projectId: string; projectName: string }[] = [];
const NO_MATCHES = new Map<number, PersonMatch>();

const defaultLoad = (config: TursoConfig, projectId: string): Promise<Workspace> =>
  new TursoBackend(config, projectId).load();

const configKeyOf = (c: TursoConfig): string => `${c.httpUrl}|${c.authToken}`;

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
  const [loadingFor, setLoadingFor] = useState<string | null>(null);
  const [loadFailedFor, setLoadFailedFor] = useState<string | null>(null);
  // The run that currently owns the in-flight state; a run from an older scope never clears a newer one.
  const runRef = useRef<{ id: number; epoch: number } | null>(null);
  const runCounterRef = useRef(0);
  // A request made during the load hold, started when the hold ends.
  const wantedRef = useRef(false);
  // Link edits applied while a run is in flight; re-applied over what that run read.
  const runWritesRef = useRef<((links: PersonLinkRow[]) => PersonLinkRow[])[]>([]);

  const portfolio = portfolioMode === "turso" && tursoConfig !== null && currentProjectId !== null;
  const available = portfolio && projects.length > 1;
  const singleProject = portfolio && projects.length <= 1;
  // A result belongs to the project it was loaded for; after a switch it is invisible.
  const configKey = tursoConfig ? configKeyOf(tursoConfig) : null;
  const effective =
    available && loaded !== null && loaded.projectId === currentProjectId && loaded.configKey === configKey ? loaded : null;

  const request = useCallback((): void => {
    if (!available || !tursoConfig || currentProjectId === null) return;
    if (loadPending) {
      wantedRef.current = true;
      return;
    }
    wantedRef.current = false;
    const startEpoch = getScopeEpoch();
    if (runRef.current !== null && runRef.current.epoch === startEpoch) return; // a run for this scope is already going
    const runId = ++runCounterRef.current;
    runRef.current = { id: runId, epoch: startEpoch };
    runWritesRef.current = [];
    setLoadingFor(currentProjectId);
    setLoadFailedFor(null);
    const key = configKeyOf(tursoConfig);
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
        const merged = runWritesRef.current.reduce((acc, edit) => edit(acc), links);
        setLoaded({ projectId, configKey: key, others, links: merged, failures });
      } catch (err) {
        logDiag("error", "crossProject.linksLoadFailed", { message: messageOf(err) });
        if (!isScopeStale(getScopeEpoch, startEpoch)) setLoadFailedFor(projectId);
      } finally {
        if (runRef.current?.id === runId) {
          runRef.current = null;
          setLoadingFor(null);
        }
      }
    };
    void run();
  }, [available, loadPending, tursoConfig, currentProjectId, projects, getScopeEpoch, load]);

  // The hold ended: start the load somebody asked for during it. Only calls request(); no state is set here.
  useEffect(() => {
    if (!loadPending && wantedRef.current) request();
  }, [loadPending, request]);

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

  const nameOf = useCallback(
    (projectId: string, resourceId: number): string => {
      const r = effective?.others.find((o) => o.projectId === projectId)?.resources.find((x) => x.id === resourceId);
      return r ? resourceDisplayName(r) : "";
    },
    [effective],
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
  const commit = async (write: () => Promise<void>, projectId: string, next: (links: PersonLinkRow[]) => PersonLinkRow[]): Promise<void> => {
    const startEpoch = getScopeEpoch();
    try {
      await write();
    } catch (err) {
      logDiag("error", "crossProject.linkWriteFailed", { message: messageOf(err) });
      onWriteError?.(err);
      return;
    }
    // The stored write stands; only the in-memory reflect is dropped when the scope moved on.
    if (isScopeStale(getScopeEpoch, startEpoch)) return;
    if (runRef.current !== null) runWritesRef.current.push(next);
    setLoaded((prev) => (prev && prev.projectId === projectId ? { ...prev, links: next(prev.links) } : prev));
  };

  const decide = async (hereId: number, rel: Relation, verdict: PersonLinkRow["verdict"]): Promise<void> => {
    const row = buildRow(hereId, rel, verdict);
    if (!row) return;
    const key = canonicalPair(row.projectA, row.resourceA, row.projectB, row.resourceB);
    await commit(
      () => savePersonLink(tursoConfig, row),
      currentProjectId ?? "",
      (links) => [...links.filter((l) => !sameLink(l, key)), row],
    );
  };

  const undo = async (hereId: number, rel: Relation): Promise<void> => {
    if (!currentProjectId || !effective) return;
    const pair = { projectA: currentProjectId, resourceA: hereId, projectB: rel.projectId, resourceB: rel.resourceId };
    const key = canonicalPair(pair.projectA, pair.resourceA, pair.projectB, pair.resourceB);
    await commit(
      () => deletePersonLink(tursoConfig, pair),
      currentProjectId,
      (links) => links.filter((l) => !sameLink(l, key)),
    );
  };

  const status: CrossProjectStatus = !available ? "unavailable" : loadingFor === currentProjectId ? "loading" : effective ? "ready" : "idle";
  // The writers read live render scope, so they go through stable wrappers: the result below keeps ONE identity
  // until something it shows changes, which is what lets the memo()'d Resources panel bail on unrelated renders.
  const writers = useStableHandlers({
    confirm: (hereId: number, rel: Relation) => decide(hereId, rel, "same"),
    reject: (hereId: number, rel: Relation) => decide(hereId, rel, "different"),
    undo,
  });
  const failures = effective?.failures ?? NO_FAILURES;
  const loadFailed = available && loadFailedFor === currentProjectId;
  return useMemo(
    () => ({ status, failures, singleProject, loadFailed, matches, elsewhere, nameOf, request, ...writers }),
    [status, failures, singleProject, loadFailed, matches, elsewhere, nameOf, request, writers],
  );
}
