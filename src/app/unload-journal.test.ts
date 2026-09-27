// src/app/unload-journal.test.ts
//
// §629 — unload journal: record write/read/clear, the fingerprint, and its
// round-trip stability proof for the backend kinds that do not need a
// dedicated mock for `./idb` (browser/IndexedDB, SharePoint JSON, Turso). The
// local-json round trip lives in `local-file-backend.test.ts` instead — that
// file already mocks `./idb` as an in-memory handle store, and mocking it
// here too would break the real fake-indexeddb calls the browser-kind proof
// below needs from the SAME module.
import "fake-indexeddb/auto";
import { IDBFactory } from "fake-indexeddb";
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

import * as diagnostics from "./diagnostics";
import { BrowserBackend } from "./browser-backend";
import { SharePointBackend } from "./sharepoint-backend";
import {
  rowsToWorkspace, selectStatements, workspaceToStatements,
  type PipelineResultLike, type SqlStmt,
} from "./turso-schema";
import { emptyWorkspace, jsonToWorkspace, type StorageKind, type Workspace } from "./workspace";
import {
  UNLOAD_JOURNAL_MAX_CHARS, UNLOAD_JOURNAL_PREFIX,
  clearUnloadJournal, fingerprintWorkspace, journalProjectKey,
  readUnloadJournal, writeUnloadJournal,
} from "./unload-journal";

const repoRoot = join(import.meta.dirname, "..", "..");
const smallWs = jsonToWorkspace(readFileSync(join(repoRoot, "sample-workspace-small.json"), "utf8"));
const bigWs = jsonToWorkspace(readFileSync(join(repoRoot, "sample-workspace-big.json"), "utf8"));

// --- journalProjectKey -------------------------------------------------

describe("journalProjectKey", () => {
  it("returns the Turso project id for kind turso", () => {
    expect(journalProjectKey("turso", "tp-1", "registry-current")).toBe("tp-1");
  });

  it("returns the registry's current project id for every other kind", () => {
    const kinds: StorageKind[] = ["browser", "local-json", "local-csv", "local-md", "sp-json", "sp-csv"];
    for (const kind of kinds) {
      expect(journalProjectKey(kind, "tp-1", "registry-current"), kind).toBe("registry-current");
    }
  });

  it("falls back to browser when the current project id is null or empty", () => {
    expect(journalProjectKey("local-json", "tp-1", null)).toBe("browser");
    expect(journalProjectKey("local-json", "tp-1", undefined)).toBe("browser");
    expect(journalProjectKey("local-json", "tp-1", "")).toBe("browser");
  });

  // ★★★ The key must never be derived from `storageTargetKey` (the Turso
  // token holder) — this asserts the Turso branch reads ONLY the id argument,
  // never anything shaped like a token, by using a value that looks nothing
  // like one and confirming it comes through unchanged.
  it("never derives from anything token-shaped — the turso id passes through verbatim", () => {
    expect(journalProjectKey("turso", "not-a-token-just-an-id", "ignored")).toBe("not-a-token-just-an-id");
  });
});

// --- writeUnloadJournal / readUnloadJournal / clearUnloadJournal -------

const REC = {
  projectKey: "proj-1",
  tabId: "tab-1",
  savedAt: 1000,
  baseFingerprint: "abc123",
  workspace: JSON.stringify({ tasks: [] }),
};

describe("writeUnloadJournal / readUnloadJournal", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  it("round-trips the record", () => {
    expect(writeUnloadJournal(REC)).toBe(true);
    expect(readUnloadJournal(REC.projectKey)).toEqual({ v: 1, ...REC });
  });

  // ★★★ The key can never carry a credential: the API takes only a
  // `projectKey`, and the stored localStorage key is exactly prefix+that
  // string — nothing else is folded in.
  it("stores under exactly prefix + projectKey", () => {
    writeUnloadJournal(REC);
    expect(window.localStorage.key(0)).toBe(`${UNLOAD_JOURNAL_PREFIX}${REC.projectKey}`);
    expect(window.localStorage.length).toBe(1);
  });

  it("skips a record over the cap: writes nothing, returns false, logs the size", () => {
    const spy = vi.spyOn(diagnostics, "logDiag").mockImplementation(() => {});
    const oversized = { ...REC, workspace: "x".repeat(UNLOAD_JOURNAL_MAX_CHARS) };
    expect(writeUnloadJournal(oversized)).toBe(false);
    expect(window.localStorage.getItem(`${UNLOAD_JOURNAL_PREFIX}${REC.projectKey}`)).toBeNull();
    expect(spy).toHaveBeenCalledWith(
      "warn",
      "workspace.unloadJournalSkipped",
      expect.objectContaining({ projectKey: REC.projectKey, size: expect.any(Number) }),
    );
  });

  it("a setItem that throws (QuotaExceededError) returns false, logs, and never throws", () => {
    const spy = vi.spyOn(diagnostics, "logDiag").mockImplementation(() => {});
    const err = new DOMException("quota", "QuotaExceededError");
    const setItemSpy = vi
      .spyOn(Object.getPrototypeOf(window.localStorage) as Storage, "setItem")
      .mockImplementation(() => {
        throw err;
      });
    expect(() => writeUnloadJournal(REC)).not.toThrow();
    expect(writeUnloadJournal(REC)).toBe(false);
    expect(spy).toHaveBeenCalledWith(
      "warn",
      "workspace.unloadJournalSkipped",
      expect.objectContaining({ projectKey: REC.projectKey }),
    );
    setItemSpy.mockRestore();
  });

  it("a corrupt value reads as null, removes the key, logs a diagnostic", () => {
    const spy = vi.spyOn(diagnostics, "logDiag").mockImplementation(() => {});
    window.localStorage.setItem(`${UNLOAD_JOURNAL_PREFIX}${REC.projectKey}`, "{not json");
    expect(readUnloadJournal(REC.projectKey)).toBeNull();
    expect(window.localStorage.getItem(`${UNLOAD_JOURNAL_PREFIX}${REC.projectKey}`)).toBeNull();
    expect(spy).toHaveBeenCalledWith(
      "warn",
      "workspace.unloadJournalCorrupt",
      expect.objectContaining({ projectKey: REC.projectKey }),
    );
  });

  it("a well-formed but wrong-version value also reads as null and is removed", () => {
    window.localStorage.setItem(
      `${UNLOAD_JOURNAL_PREFIX}${REC.projectKey}`,
      JSON.stringify({ ...REC, v: 2 }),
    );
    expect(readUnloadJournal(REC.projectKey)).toBeNull();
    expect(window.localStorage.getItem(`${UNLOAD_JOURNAL_PREFIX}${REC.projectKey}`)).toBeNull();
  });

  it("absent key reads as null without touching diagnostics", () => {
    const spy = vi.spyOn(diagnostics, "logDiag").mockImplementation(() => {});
    expect(readUnloadJournal("no-such-project")).toBeNull();
    expect(spy).not.toHaveBeenCalled();
  });
});

describe("clearUnloadJournal", () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it("removes unconditionally with no guard (the Discard path)", () => {
    writeUnloadJournal(REC);
    clearUnloadJournal(REC.projectKey);
    expect(readUnloadJournal(REC.projectKey)).toBeNull();
  });

  it("keeps a record written by a DIFFERENT tab", () => {
    writeUnloadJournal({ ...REC, tabId: "tab-A", savedAt: 100 });
    clearUnloadJournal(REC.projectKey, { tabId: "tab-B", ifSavedAtAtMost: 999 });
    expect(readUnloadJournal(REC.projectKey)).not.toBeNull();
  });

  it("keeps a NEWER record from the same tab", () => {
    writeUnloadJournal({ ...REC, tabId: "tab-A", savedAt: 500 });
    clearUnloadJournal(REC.projectKey, { tabId: "tab-A", ifSavedAtAtMost: 100 });
    expect(readUnloadJournal(REC.projectKey)).not.toBeNull();
  });

  it("removes a same-tab record whose savedAt is <= the guard", () => {
    writeUnloadJournal({ ...REC, tabId: "tab-A", savedAt: 100 });
    clearUnloadJournal(REC.projectKey, { tabId: "tab-A", ifSavedAtAtMost: 100 });
    expect(readUnloadJournal(REC.projectKey)).toBeNull();
  });

  it("removes a same-tab record strictly older than the guard too", () => {
    writeUnloadJournal({ ...REC, tabId: "tab-A", savedAt: 50 });
    clearUnloadJournal(REC.projectKey, { tabId: "tab-A", ifSavedAtAtMost: 100 });
    expect(readUnloadJournal(REC.projectKey)).toBeNull();
  });

  it("is a no-op, not a throw, when nothing is stored", () => {
    expect(() => clearUnloadJournal("no-such-project")).not.toThrow();
    expect(() => clearUnloadJournal("no-such-project", { tabId: "t", ifSavedAtAtMost: 1 })).not.toThrow();
  });
});

// --- fingerprintWorkspace: determinism + per-slice sensitivity ---------

describe("fingerprintWorkspace", () => {
  it("is deterministic for the same workspace", () => {
    expect(fingerprintWorkspace(smallWs)).toBe(fingerprintWorkspace(smallWs));
    // A structurally-equal but freshly-built copy must hash the same — the
    // fingerprint is over content, not object identity.
    expect(fingerprintWorkspace(JSON.parse(JSON.stringify(smallWs)))).toBe(fingerprintWorkspace(smallWs));
  });

  function bumpId(id: unknown): unknown {
    if (typeof id === "number") return id + 1_000_000;
    if (typeof id === "string") return `${id}-mutated`;
    return id;
  }

  /** Mutates ONE slice, regardless of its shape, in a way that survives that
   *  slice's own load-time sanitizer (several of `emptyWorkspace()`'s slices
   *  are whitelist-sanitized on decode — see `sanitizeProjectStatus` et al. —
   *  so an arbitrary unknown marker field is silently stripped there and the
   *  "before"/"after" fingerprints would collide for the wrong reason: the
   *  mutation never survived to be hashed, not that the fingerprint is blind
   *  to it). `plan`/`fxRates`/`status` get a dedicated, schema-shaped tweak;
   *  a non-empty entity array gets an appended clone of its last row with a
   *  bumped `id` (every entity here — absences/shifts/resources/roles/
   *  disciplines/grades/budgets/milestones/changes/stakeholders — has one).
   *  Everything else (tasks/raid, and any empty array) falls back to a marker
   *  field/element, which IS enough for tasks/raid: their decode is a
   *  patch over the stored object, not a whitelist reconstruction. */
  function mutateSlice(ws: Workspace, key: keyof Workspace): Workspace {
    const current = (ws as unknown as Record<string, unknown>)[key];

    if (key === "plan" && current && typeof current === "object") {
      const plan = current as Record<string, unknown>;
      return { ...ws, plan: { ...plan, budgetFollowsPlan: !plan.budgetFollowsPlan } } as Workspace;
    }
    if (key === "fxRates") {
      // `sanitizeLoadedFxRates` whitelists `rates` to SUPPORTED_CURRENCIES and
      // requires `base === "EUR"`, so an unsupported code or a different base
      // would be dropped/reject the whole record on the next canonicalisation
      // pass — bumping an EXISTING supported rate's value survives instead.
      const fx = current as Record<string, unknown> | null | undefined;
      const rates = (fx?.rates as Record<string, number> | undefined) ?? {};
      const nextFx = fx
        ? { ...fx, rates: { ...rates, USD: (typeof rates.USD === "number" ? rates.USD : 1) + 0.5 } }
        : { base: "EUR", date: "2026-01-01", fetchedAt: "2026-01-01T00:00:00.000Z", rates: { USD: 1.5 } };
      return { ...ws, fxRates: nextFx } as Workspace;
    }
    if (key === "status" && current && typeof current === "object") {
      const status = current as Record<string, unknown>;
      const narrative = `${typeof status.narrative === "string" ? status.narrative : ""} (mutated)`;
      return { ...ws, status: { ...status, narrative } } as Workspace;
    }
    if (Array.isArray(current) && current.length > 0) {
      const last = current[current.length - 1] as Record<string, unknown>;
      const clone = { ...(JSON.parse(JSON.stringify(last)) as Record<string, unknown>), id: bumpId(last.id) };
      return { ...ws, [key]: [...current, clone] } as Workspace;
    }
    const mutated = Array.isArray(current)
      ? [...current, { __unloadJournalTestMarker: true }]
      : current && typeof current === "object"
        ? { ...(current as Record<string, unknown>), __unloadJournalTestMarker: true }
        : { __unloadJournalTestMarker: true };
    return { ...ws, [key]: mutated } as Workspace;
  }

  // Parametrised over emptyWorkspace()'s own keys, per the brief: a new slice
  // added to Workspace and wired into emptyWorkspace() is covered automatically,
  // with no separate list to keep in sync.
  const slices = Object.keys(emptyWorkspace()) as (keyof Workspace)[];
  it("covers at least the slices emptyWorkspace() currently declares", () => {
    expect(slices.length).toBeGreaterThan(0);
  });

  for (const key of slices) {
    it(`changes when '${String(key)}' changes`, () => {
      const before = fingerprintWorkspace(smallWs);
      const after = fingerprintWorkspace(mutateSlice(smallWs, key));
      expect(after, String(key)).not.toBe(before);
    });
  }
});

// --- Step 3: round-trip stability proof ---------------------------------
//
// fingerprintWorkspace(saved) must equal fingerprintWorkspace(loaded) for
// every backend kind, since the restore compares a fingerprint taken BEFORE
// a save with one taken of what the NEXT load returns. Proved here for
// browser (IndexedDB, real fake-indexeddb) and sp-json (mocked fetch as a
// one-file store); Turso via a real node:sqlite engine below; local-json in
// local-file-backend.test.ts (see the file banner above for why).

describe("fingerprint round-trip: browser (IndexedDB)", () => {
  beforeEach(() => {
    // Fresh in-memory IDB per test — same idiom as browser-backend.test.ts /
    // browser-backend.documents.test.ts.
    globalThis.indexedDB = new IDBFactory();
  });

  it("small sample workspace", async () => {
    const before = fingerprintWorkspace(smallWs);
    await new BrowserBackend().save(smallWs);
    const loaded = await new BrowserBackend().load();
    expect(fingerprintWorkspace(loaded)).toBe(before);
  });

  it("bigger sample workspace (documents included)", async () => {
    const before = fingerprintWorkspace(bigWs);
    await new BrowserBackend().save(bigWs);
    const loaded = await new BrowserBackend().load();
    expect(fingerprintWorkspace(loaded)).toBe(before);
  });
});

describe("fingerprint round-trip: sp-json (SharePoint JSON)", () => {
  let fetchSpy: ReturnType<typeof vi.fn>;
  let stored: string | null;

  beforeEach(() => {
    stored = null;
    fetchSpy = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === "PUT") {
        stored = init.body as string;
        return { ok: true, status: 200, text: async () => "" } as unknown as Response;
      }
      if (stored === null) return { ok: false, status: 404, text: async () => "" } as unknown as Response;
      return { ok: true, status: 200, text: async () => stored as string } as unknown as Response;
    });
    vi.stubGlobal("fetch", fetchSpy);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function spBackend(): SharePointBackend {
    return new SharePointBackend(
      { kind: "sp-json", hostname: "contoso.sharepoint.com", sitePath: "/sites/pm", itemPath: "project.json" },
      async () => "token",
    );
  }

  it("small sample workspace", async () => {
    const before = fingerprintWorkspace(smallWs);
    const backend = spBackend();
    await backend.save(smallWs);
    const loaded = await backend.load();
    expect(fingerprintWorkspace(loaded)).toBe(before);
  });

  it("bigger sample workspace (documents included)", async () => {
    const before = fingerprintWorkspace(bigWs);
    const backend = spBackend();
    await backend.save(bigWs);
    const loaded = await backend.load();
    expect(fingerprintWorkspace(loaded)).toBe(before);
  });
});

describe("fingerprint round-trip: turso (real node:sqlite engine)", () => {
  // Shapes node:sqlite rows as the Hrana result the decoders read — the same
  // pattern `snapshot-schema.execute.test.ts` uses for the same reason (a
  // real SELECT, not a hand-typed fixture, is the thing worth trusting here).
  function runStatements(db: DatabaseSync, statements: readonly SqlStmt[]): void {
    for (const s of statements) {
      if (!s.args || s.args.length === 0) { db.exec(s.sql); continue; }
      db.prepare(s.sql).run(...s.args.map((a) => a.value ?? null));
    }
  }

  function asPipelineResult(rows: Record<string, unknown>[], names: readonly string[]): PipelineResultLike {
    return {
      type: "ok",
      response: { type: "execute", result: {
        cols: names.map((name) => ({ name })),
        rows: rows.map((row) => names.map((n) => ({ value: row[n] }))),
      } },
    };
  }

  function query(db: DatabaseSync, sql: string): PipelineResultLike {
    const rows = db.prepare(sql).all() as Record<string, unknown>[];
    const names = rows.length > 0 ? Object.keys(rows[0]) : [];
    return asPipelineResult(rows, names);
  }

  function tursoRoundTrip(ws: Workspace): Workspace {
    const db = new DatabaseSync(":memory:");
    try {
      runStatements(db, workspaceToStatements(ws));
      const results = selectStatements().map((s) => query(db, s.sql));
      return rowsToWorkspace(results);
    } finally {
      db.close();
    }
  }

  it("small sample workspace", () => {
    const before = fingerprintWorkspace(smallWs);
    const loaded = tursoRoundTrip(smallWs);
    expect(fingerprintWorkspace(loaded)).toBe(before);
  });

  it("bigger sample workspace (documents included)", () => {
    const before = fingerprintWorkspace(bigWs);
    const loaded = tursoRoundTrip(bigWs);
    expect(fingerprintWorkspace(loaded)).toBe(before);
  });
});
