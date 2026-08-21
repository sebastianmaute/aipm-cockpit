# Prune the open-followups register — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Shrink `docs/open-followups.md` from 4490 lines to ~2900 by compressing 21 CLOSED entries in place, without deleting a single sentence that a code comment points at or that carries a transferable lesson — then resolve every citation the 58 OPEN entries make against HEAD.

**Architecture:** Two phases against one file. Phase 1 compresses closed entries **by deletion only** — every surviving sentence is byte-identical to one in the file today, because this file's own history is a list of falsehoods introduced while rewriting other claims. Phase 2 runs a throwaway node instrument that resolves the open bodies' 107 paths, 63 `file:line` cites and 371 symbols against the working tree, repairing only what is provably repairable and flagging the rest. A mechanical invariant guards the whole pass: **no open section may lose a line, and every `§N` cited from shipped source must still resolve to a heading.**

**Tech Stack:** node (ESM, no deps), git, ripgrep via `Grep`. No app code is touched. No CI gate is added.

**Spec:** `docs/superpowers/specs/2026-08-05-prune-open-followups-design.md`

---

## Ground truth measured 2026-08-05 on `main` @ `4224b5c3`

- File: **4490 lines**, **81 `## ` sections** — 78 numbered items + 3 meta.
- **20 CLOSED-titled sections = 1744 lines**, plus `§48-was` (35 lines, titled as if open) = **21 entries this pass touches, 1779 lines**.
- 58 OPEN sections = 2358 lines, a count that *includes* `§48-was`; after the fold, 57. Meta (`Decided` 48 · `Provenance` 170 · `Standing notes` 32) = 250.
- Open bodies cite **107 bare paths, 63 `file:line`, 371 backticked symbols**. A baseline snapshot taken 2026-08-05 reports **50 unresolved cites** across the whole file.
- `scripts/check-agents-symbols.mjs` globs `AGENTS.md` + `docs/AGENTS/*.md` only. **This file is ungated.** The diff is the review.

### The 21 closed sections, with line spans as of `4224b5c3`

| § | lines | span | group |
|---|---|---|---|
| 34 | 29 | 1126–1154 | 1 |
| 11 | 91 | 511–601 | 1 |
| 14 | 65 | 670–734 | 1 |
| 15 | 61 | 735–795 | 1 |
| 29 | 40 | 982–1021 | 1 |
| 45 | 127 | 1672–1798 | 1 |
| 48 | 44 | 1849–1892 | 1 |
| 48-was | 35 | 1893–1927 | 1 (folds into §48) |
| 49 | 49 | 1928–1976 | 1 |
| 2 | 97 | 208–304 | 2 |
| 58 | 84 | 2504–2587 | 2 (SPLITS — half stays open) |
| 63 | 68 | 2733–2800 | 2 |
| 72 | 230 | 3135–3364 | 3 |
| 73 | 64 | 3365–3428 | 3 |
| 74 | 102 | 3429–3530 | 3 |
| 75 | 199 | 3531–3729 | 3 |
| 76 | 127 | 3730–3856 | 3 |
| 80 | 22 | 3927–3948 | 4 (no strikethrough in title) |
| 81 | 43 | 3949–3991 | 4 (no strikethrough in title) |
| 84 | 54 | 4039–4092 | 4 |
| 85 | 148 | 4093–4240 | 4 |

**Spans shift as you edit. Never navigate by the numbers in this table after the first commit — locate a section by its `## N.` heading text.**

### Inbound pointers from shipped source — these entries cannot be deleted

| § | cited from (paths relative to `src/app/` unless shown) |
|---|---|
| 2 | `use-reference-data.ts`, `use-resource-directory.ts` |
| 11 | `abort-error.ts` |
| 14 | `timelog-panel.tsx`, `timelog-panel.test.tsx` |
| 15 | `file-picker-button.tsx` |
| 29 | `task-form-fields.tsx`, `task-form-modal.test.tsx` |
| 48 | `use-resource-planner.ts`, `use-resource-planner.test.tsx`, `use-resource-planner.undo.test.tsx` |
| 49 | `use-chat-dispatcher.test.tsx` |
| 58 | `layout.tsx`, `e2e/a11y.spec.ts` |
| 72 | `use-storage-backend.ts`, `use-storage-backend.test.tsx`, `use-scheduled-jobs.ts` |
| 74 | `timelog-guards.ts`, `timelog-panel.tsx` |
| 75 | `modern-shell.test.tsx`, `use-storage-backend.test.tsx` |
| 76 | `use-scheduled-jobs.ts`, `use-operating-guides.ts` |
| 85 | `strictmode.meta.test.tsx` |

Open entries are cited too (§1 §24 §28 §32 §36 §37 §38 §39 §51 §55 §62 §64 §65) — they are not edited structurally, but the instrument checks them anyway.

---

## The compression contract — read before Task 3

**Rule 1 — deletion only.** Every sentence that survives is byte-identical to a sentence in the file today. No re-phrasing, no summarising, no merging two sentences. New prose is allowed in exactly three one-line places: the `**Was:**` clause, the `**Cited from:**` line, and the index-table clause.

**Rule 2 — keep verbatim, always:**
- every ★★ / ★★★ transferable lesson
- every prohibition ("Do NOT …", "do not re-run this sweep", "do not re-propose")
- every negative result
- every symbol name that appears in the inbound-pointer table above
- any passage describing **still-open residual work** inside a closed entry. Label it `**Residual (still open):**` and keep the passage uncut. §72 is the known instance: it is closed **for caller callbacks only**, and names `applyWorkspace`, `onOpenStorageFile`'s raw `setTasks`/`setRaid`, `args.setActivityLog` and `refreshBackendStatus`'s three unpinned guards as surviving. Losing that passage loses open work.

**Rule 3 — delete:** measurement logs, probe traces, before/after transcripts, round-by-round review narrative, "the original write-up follows" sections, fix options considered and not taken (unless Rule 4 applies), and any passage restating `AGENTS.md` — replace with a pointer.

**Rule 4 — a rejected option worth not re-proposing moves to `Decided — do not re-litigate`, verbatim.** Do not paraphrase it on the way.

**Rule 5 — slice attribution comes from the entry's own current header, never from memory.** Two records disagree about whether §76 closed in !346 or !349. The entry is the record that ships.

**Rule 6 — TRANSITIVE KEEP. Added 2026-08-05 after a cold review of Task 3 found six instances.** A passage may not be deleted if a **surviving** passage points at it. `the correction block below` · `the table below` · `the advice below` · `quoted further down` · `kept below the line` · `named in advance by this entry` · `see the sweep above` — each makes its referent **transitively mandated-verbatim**, exactly as if the referent carried its own ★★. Deleting it turns a mandated-keep sentence into a false one, which is this file's single documented failure mode, and Rule 1 forbids rewording your way out.

Two legal moves when you hit that shape: **keep the referent**, or **delete the referring passage too**. Nothing else.

★★ This is not hypothetical. Task 3 shipped `see the correction block below for what it claimed versus what \`npm audit\` reports` with no comparison block below it, and left a surviving table asserting `still 9 high` after deleting every correction of that number. Both were caught only by a cold read.

★ Before committing any entry, grep the entry you just compressed for `below`, `above`, `further down`, `named in advance`, `see the` — and resolve every hit.

### Template

```markdown
## 15. ~~Two file-picker patterns — extract a `FilePickerButton` primitive~~ — CLOSED in 0.211.1

**Was:** the app opened a file dialog in two structurally different ways, both on Settings → Appearance.
**Cited from:** `file-picker-button.tsx` — this entry cannot be deleted.

<the Resolution paragraph, verbatim>

<each ★★/★★★ lesson and prohibition, verbatim>
```

### Worked example — §15, 61 lines → 20

This is the exact output expected for §15. Every line below except `**Was:**` and `**Cited from:**` is byte-identical to a line in the file today.

```markdown
## 15. ~~Two file-picker patterns — extract a `FilePickerButton` primitive~~ — CLOSED in 0.211.1

**Was:** the app opened a file dialog in two structurally different ways, both on Settings → Appearance.
**Cited from:** `file-picker-button.tsx` — this entry cannot be deleted.

**Resolution:** `file-picker-button.tsx` — a DS `Button` plus the `sr-only` input it owns
(`tabIndex={-1}`, `aria-hidden`, value reset **before** the callback so the same file re-picks). It owns
**no validation**: `onFile` hands back the raw `File` and `branding-image-input.tsx` keeps its `FILE_RE`
raster-mime allowlist and `MAX_BYTES` raw-byte cap.

★ **THREE** call sites moved, not the two this entry scoped: `theme-gallery.tsx`,
`color-scheme-editor.tsx` and `branding-image-input.tsx`. The entry's own scoping sentence ("the
follow-up is scoped to those two") was right about what to change and wrong about what was there to
find — the third site was a third copy of the label shape, and looking at it turned up **§46**, while
the excluded `chat-panel.tsx` turned out to carry **§47**.

★ Accepted cosmetic consequence: in `color-scheme-editor.tsx` the Import control is now a DS `Button`
while its neighbours in that flex row keep the file-local hand-rolled `btn` string. Correctness over
local consistency — matching them would mean copying `btn` into a second file and minting a `dup:check`
clone against a BLOCKING gate, which is the very thing this entry says not to do.

★ Do NOT "fix" this by making the input `display:none` — a hidden input cannot be clicked in every
browser, which is why both sites use `sr-only`.
```

**Dropped from §15, and why:** the `branding-image-input.test.tsx` query-move paragraph (measurement of a finished change); the two-shape table, the two "neither should be converted" bullets and the scope-check grep — the fix shipped and the shapes they describe no longer exist.

★★★ **CORRECTED 2026-08-05 — an earlier revision of this worked example told the executor to drop the whole "The original write-up follows." block, and that instruction destroyed a lesson.** Buried in it were two things that had to survive: that the gallery's sibling input was a second tab stop announcing the same accessible name until `df507f95`, **and that the axe gate cannot see a duplicate accessible name — it reports missing names only**; plus the ★ recording that `theme-gallery.test.tsx`'s tab-order walk is that defect's regression guard and was deliberately left untouched. `AGENTS.md` states a narrower fact (duplicate row labels pass because the live seed renders one row) and nowhere says axe reports missing names only, so this is not a Rule-3 restatement. Without the ★, the surviving test reads as redundant and invites deletion. **A "delete this whole block" instruction is exactly as dangerous as a rewording — read what is in the block before trusting the label on it.**

**Kept that a careless pass would drop:** the ★ THREE-call-sites lesson (the entry was wrong about its own scope, which is this register's most-repeated failure), the cosmetic-consequence decision (it stops someone "fixing" the Import button), and the `display:none` prohibition (a standing rule, and §47 is open against exactly that shape).

---

## File structure

| File | Responsibility | Committed? |
|---|---|---|
| `docs/open-followups.md` | the only edited artifact | yes |
| `<scratchpad>/followup-audit.mjs` | the instrument: snapshot + compare | **no** — throwaway, this pass adds no gate |
| `<scratchpad>/baseline.json` | pre-pass snapshot, the invariant's reference | no |
| `<scratchpad>/after-taskN.json` | per-task snapshots | no |
| `<scratchpad>/mutant.md` | mutation-proof copy, Task 2 only | no |

`<scratchpad>` = `C:\Users\SEBAST~1.MAU\AppData\Local\Temp\claude\C--Projects-aipm-cockpit\b2f44446-d3d1-4642-8689-f32e41649bef\scratchpad`

---

## Task 1: Build the audit instrument and capture the baseline

**Files:**
- Create: `<scratchpad>/followup-audit.mjs`
- Create (output): `<scratchpad>/baseline.json`

- [ ] **Step 1: Create the branch**

```bash
git checkout -b docs/prune-open-followups
git status --short   # expect: clean
```

- [ ] **Step 2: Write the instrument**

Create `<scratchpad>/followup-audit.mjs` with exactly this content:

```javascript
// followup-audit.mjs — throwaway instrument for the open-followups prune (2026-08-05).
// NOT committed. Adds no gate. Two modes:
//   node followup-audit.mjs snapshot <out.json>
//   node followup-audit.mjs compare  <before.json> <after.json>
// Env: REPO_ROOT (default C:/Projects/aipm-cockpit), DOC_PATH (default <root>/docs/open-followups.md)
import fs from "node:fs";
import path from "node:path";

const ROOT = process.env.REPO_ROOT ?? "C:/Projects/aipm-cockpit";
const DOC = process.env.DOC_PATH ?? path.join(ROOT, "docs/open-followups.md");
const SCAN_DIRS = ["src", "scripts", "e2e"];
const SCAN_EXT = [".ts", ".tsx", ".mjs", ".css", ".json"];

// Verbatim from scripts/check-agents-symbols.mjs — a deliberate absence must not fire.
const ABSENCE_MARKERS = [
  "REMOVED", "RETIRED", "DELETED", "GONE", "is gone", "are gone", "no such",
  "does not exist", "never existed", "NOT built", "not built", "Do NOT", "do NOT",
  "the dead ", "takes no ", "was renamed", "were renamed", "RENAMED", "(was ",
  "deprecated", "vestigial",
];

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name === ".next") continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (SCAN_EXT.includes(path.extname(e.name))) out.push(p);
  }
  return out;
}

const files = SCAN_DIRS.flatMap((d) => walk(path.join(ROOT, d)));
const rel = (f) => path.relative(ROOT, f).replace(/\\/g, "/");
const contents = new Map(files.map((f) => [rel(f), fs.readFileSync(f, "utf8")]));
const relPaths = new Set(contents.keys());
const byBase = new Map();
for (const p of relPaths) {
  const b = p.split("/").pop();
  if (!byBase.has(b)) byBase.set(b, []);
  byBase.get(b).push(p);
}
const sourceText = [...contents.values()].join("\n");

const resolvePath = (tok) => {
  for (const c of [tok, `src/app/${tok}`, `src/${tok}`, `docs/${tok}`]) {
    if (relPaths.has(c)) return { state: "ok", at: c };
  }
  if (fs.existsSync(path.join(ROOT, tok))) return { state: "ok", at: tok };
  const hits = byBase.get(tok.split("/").pop());
  if (hits?.length === 1) return { state: "moved", at: hits[0] };
  if (hits?.length > 1) return { state: "ambiguous", at: hits.join(" | ") };
  return { state: "missing", at: null };
};

const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;
const isSymbolCandidate = (n) =>
  IDENTIFIER.test(n) && n.length > 3 && /[a-z]/.test(n) && /[A-Z_]/.test(n);

function parseSections(text) {
  const lines = text.split(/\r?\n/);
  const heads = lines.map((l, i) => [i, l]).filter(([, l]) => /^## /.test(l));
  return heads.map(([i, l], k) => {
    const end = k + 1 < heads.length ? heads[k + 1][0] : lines.length;
    const key = (l.match(/^## ([\w-]+)\./) || [])[1] ?? l.slice(3, 40).trim();
    return {
      key,
      title: l,
      closed: /CLOSED/.test(l),
      meta: !/^## [\w-]+\./.test(l),
      lines: end - i,
      body: lines.slice(i, end).join("\n"),
    };
  });
}

function citesOf(section) {
  const out = [];
  const bodyLines = section.body.split("\n");
  // Track each line's byte offset. Do NOT use body.indexOf(line) for the
  // absence-marker window — a repeated line resolves to the first occurrence
  // and the window is then read from the wrong place.
  const offsets = [];
  let acc = 0;
  for (const l of bodyLines) { offsets.push(acc); acc += l.length + 1; }
  bodyLines.forEach((line, li) => {
    for (const m of line.matchAll(/`([^`\n]+)`/g)) {
      const tok = m[1];
      const fileLine = tok.match(/^([\w./-]+\.(?:ts|tsx|mjs|json|css|md|yml)):(\d+)$/);
      if (fileLine) {
        const r = resolvePath(fileLine[1]);
        if (r.state !== "ok" && r.state !== "moved") {
          out.push({ kind: "file:line", tok, verdict: `path ${r.state}`, line: li });
          continue;
        }
        const src = contents.get(r.at) ?? fs.readFileSync(path.join(ROOT, r.at), "utf8");
        const srcLines = src.split(/\r?\n/);
        const n = Number(fileLine[2]);
        if (n > srcLines.length) {
          out.push({ kind: "file:line", tok, verdict: `line ${n} > ${srcLines.length}`, line: li });
          continue;
        }
        // Corroborate: some other backticked identifier on the same doc line must
        // appear within +/-15 lines of the cited line.
        const peers = [...line.matchAll(/`([^`\n]+)`/g)]
          .map((x) => x[1])
          .filter((x) => x !== tok && isSymbolCandidate(x));
        if (peers.length) {
          const win = srcLines.slice(Math.max(0, n - 16), n + 15).join("\n");
          if (!peers.some((p) => win.includes(p))) {
            out.push({ kind: "file:line", tok, verdict: `no peer of [${peers.join(",")}] within +/-15`, line: li });
          }
        }
        continue;
      }
      if (/^[\w./-]+\.(ts|tsx|mjs|json|css|md|yml)$/.test(tok)) {
        const r = resolvePath(tok);
        if (r.state !== "ok") out.push({ kind: "path", tok, verdict: `${r.state}${r.at ? ` -> ${r.at}` : ""}`, line: li });
        continue;
      }
      const bare = tok.replace(/\(.*$/, "");
      if (!isSymbolCandidate(bare)) continue;
      if (sourceText.includes(bare)) continue;
      const idx = offsets[li];
      const win = section.body.slice(Math.max(0, idx - 400), idx + 400);
      if (ABSENCE_MARKERS.some((w) => win.includes(w))) continue;
      out.push({ kind: "symbol", tok: bare, verdict: "not found in src/scripts/e2e", line: li });
    }
  });
  return out;
}

function inboundPointers() {
  const map = {};
  for (const [p, text] of contents) {
    for (const m of text.matchAll(/open-followups/g)) {
      const win = text.slice(m.index, m.index + 300);
      for (const s of win.matchAll(/§(\d+)/g)) {
        (map[s[1]] ??= new Set()).add(p);
      }
    }
  }
  return Object.fromEntries(Object.entries(map).map(([k, v]) => [k, [...v].sort()]));
}

const mode = process.argv[2];

if (mode === "snapshot") {
  const sections = parseSections(fs.readFileSync(DOC, "utf8"));
  const snap = {
    doc: DOC,
    totalLines: fs.readFileSync(DOC, "utf8").split(/\r?\n/).length,
    sections: Object.fromEntries(sections.map((s) => [s.key, { lines: s.lines, closed: s.closed, meta: s.meta }])),
    cites: Object.fromEntries(sections.map((s) => [s.key, citesOf(s)]).filter(([, c]) => c.length)),
    inbound: inboundPointers(),
  };
  fs.writeFileSync(process.argv[3], JSON.stringify(snap, null, 2));
  const unresolved = Object.values(snap.cites).flat().length;
  console.log(`lines=${snap.totalLines} sections=${Object.keys(snap.sections).length} unresolved-cites=${unresolved}`);
  for (const [k, list] of Object.entries(snap.cites)) {
    for (const c of list) console.log(`  §${k} [${c.kind}] \`${c.tok}\` — ${c.verdict}`);
  }
  process.exit(0);
}

if (mode === "compare") {
  const before = JSON.parse(fs.readFileSync(process.argv[3], "utf8"));
  const after = JSON.parse(fs.readFileSync(process.argv[4], "utf8"));
  // A section may legitimately disappear only when this pass retires it on
  // purpose. `48-was` is the one such case; it must be named explicitly, so a
  // section deleted by accident stays fatal.
  const REMOVED_OK = new Set((process.env.ALLOW_REMOVED ?? "").split(",").filter(Boolean));
  let fatal = 0;
  for (const [key, b] of Object.entries(before.sections)) {
    const a = after.sections[key];
    if (!a) {
      if (REMOVED_OK.has(key)) { console.log(`note: §${key} retired on purpose`); continue; }
      console.log(`FATAL missing section §${key}`); fatal++; continue;
    }
    if (!b.closed && !b.meta && a.lines < b.lines) {
      console.log(`FATAL open §${key} shrank ${b.lines} -> ${a.lines}`);
      fatal++;
    }
  }
  for (const key of Object.keys(before.inbound)) {
    if (!after.sections[key]) {
      console.log(`FATAL inbound pointer §${key} (${before.inbound[key].join(", ")}) resolves to no heading`);
      fatal++;
    }
  }
  const bC = Object.entries(before.sections).filter(([, s]) => s.closed).reduce((n, [, s]) => n + s.lines, 0);
  const aC = Object.entries(after.sections).filter(([, s]) => s.closed).reduce((n, [, s]) => n + s.lines, 0);
  const bU = Object.values(before.cites).flat().length;
  const aU = Object.values(after.cites).flat().length;
  console.log(`closed-lines ${bC} -> ${aC} | total ${before.totalLines} -> ${after.totalLines} | unresolved-cites ${bU} -> ${aU}`);
  console.log(fatal === 0 ? "OK" : `FAILED with ${fatal} fatal`);
  process.exit(fatal === 0 ? 0 : 1);
}

console.log("usage: snapshot <out.json> | compare <before.json> <after.json>");
process.exit(2);
```

- [ ] **Step 3: Capture the baseline**

```bash
node "<scratchpad>/followup-audit.mjs" snapshot "<scratchpad>/baseline.json"
echo "EXIT=$?"
```

Expected: `EXIT=0`, a first line reading `lines=4490 sections=81 unresolved-cites=50`, then 50 indented lines. **Do not pipe this into `head`/`tail`/`grep`** — redirect and read the file if it is long:

```bash
node "<scratchpad>/followup-audit.mjs" snapshot "<scratchpad>/baseline.json" > "<scratchpad>/baseline.log" 2>&1; echo "EXIT=$?"
```

- [ ] **Step 4: Record the baseline numbers in this plan's execution notes**

Write down `totalLines`, `unresolved-cites`, and the closed-lines total. Every later task compares against them. If `sections` is not 81 or `lines` is not 4490, the working tree is not `4224b5c3` — stop and reconcile before editing.

- [ ] **Step 5: No commit.** The instrument lives in the scratchpad and is never added to git. Confirm:

```bash
git status --short   # expect: still clean
```

---

## Task 2: Prove the instrument discriminates (mutation test)

A guard that cannot fail is worse than no guard — it reports success. All three checks get mutated before any of them is trusted.

**Files:**
- Create: `<scratchpad>/mutant.md`, `<scratchpad>/mutant.json`

- [ ] **Step 1: Copy the doc**

```bash
cp docs/open-followups.md "<scratchpad>/mutant.md"
```

- [ ] **Step 2: Mutation A — inject three unresolvable cites**

Append to `<scratchpad>/mutant.md`:

```markdown
## 999. Mutation probe — open

Cites `noSuchSymbolXyz`, `src/app/no-such-file-xyz.ts`, and `task-manager.tsx:99999`.
```

- [ ] **Step 3: Run and verify all three fire**

```bash
DOC_PATH="<scratchpad>/mutant.md" node "<scratchpad>/followup-audit.mjs" snapshot "<scratchpad>/mutant.json"; echo "EXIT=$?"
```

Expected: three new lines, one per cite —

```
  §999 [symbol] `noSuchSymbolXyz` — not found in src/scripts/e2e
  §999 [path] `src/app/no-such-file-xyz.ts` — missing
  §999 [file:line] `task-manager.tsx:99999` — line 99999 > <actual>
```

If any of the three is silent, the corresponding check is inert — fix it before continuing.

- [ ] **Step 4: Mutation B — prove the absence-marker suppression works**

Change the probe line in `<scratchpad>/mutant.md` to:

```markdown
Cites `noSuchSymbolXyz`, which was REMOVED, and `src/app/no-such-file-xyz.ts`, and `task-manager.tsx:99999`.
```

Re-run Step 3's command. Expected: the `noSuchSymbolXyz` line is **gone**, the other two remain. That proves a deliberate absence does not fire — and that the suppression is not swallowing everything.

- [ ] **Step 5: Mutation C — prove the open-shrink invariant fires**

Delete any 5 consecutive lines from the body of `## 50.` (an open section) in `<scratchpad>/mutant.md`, then:

```bash
DOC_PATH="<scratchpad>/mutant.md" node "<scratchpad>/followup-audit.mjs" snapshot "<scratchpad>/mutant.json" > /dev/null
node "<scratchpad>/followup-audit.mjs" compare "<scratchpad>/baseline.json" "<scratchpad>/mutant.json"; echo "EXIT=$?"
```

Expected: `FATAL open §50 shrank 35 -> 30`, `FAILED with 1 fatal`, `EXIT=1`.

- [ ] **Step 6: Mutation D — prove the inbound-pointer invariant fires**

In `<scratchpad>/mutant.md`, delete the whole `## 74.` heading line. Re-run Step 5's two commands.

Expected: `FATAL inbound pointer §74 (src/app/timelog-guards.ts, src/app/timelog-panel.tsx) resolves to no heading`, `EXIT=1`.

- [ ] **Step 7: Discard the mutant**

```bash
rm "<scratchpad>/mutant.md" "<scratchpad>/mutant.json"
git status --short   # expect: clean — the real doc was never touched
```

- [ ] **Step 8: No commit.**

---

## Task 3: Compress group 1 — the 0.210.0 and 0.211.1 entries

**Sections:** §34 · §11 · §14 · §15 · §29 · §45 · §48 (+ fold §48-was) · §49. **476 lines in, ~110 expected out.**

**Files:**
- Modify: `docs/open-followups.md`

- [ ] **Step 1: Compress §15 first, to the worked example above**

Locate `## 15. ~~Two file-picker patterns` and replace the section (heading through the `---` that ends it, exclusive of the `---`) with the 20-line block given in "Worked example" above. It is reproduced there in full — copy it exactly.

- [ ] **Step 2: Verify §15 alone**

```bash
node "<scratchpad>/followup-audit.mjs" snapshot "<scratchpad>/after-t3a.json" > "<scratchpad>/t3a.log" 2>&1; echo "EXIT=$?"
node "<scratchpad>/followup-audit.mjs" compare "<scratchpad>/baseline.json" "<scratchpad>/after-t3a.json"; echo "EXIT=$?"
```

Expected: `OK`, `EXIT=0`, and `closed-lines 1744 -> 1703`.

- [ ] **Step 3: Compress the remaining seven, one at a time, applying the contract**

For **each** of §34, §11, §14, §29, §45, §48, §49 — in that order, re-running Step 2's compare after each:

1. Read the section in full.
2. Find its `**Resolution:**` / "what closed it" paragraph → keep verbatim.
3. Find every ★★ / ★★★ lesson and every "Do NOT" prohibition → keep verbatim.
4. Check the inbound table above → add `**Cited from:**` if the § appears there (§11 · §14 · §29 · §48 · §49 do).
5. Write the one-line `**Was:**` clause from the strikethrough title.
6. Delete everything else. If a dropped passage is a *rejected option worth not re-proposing*, move it verbatim into `Decided — do not re-litigate` in the same edit.

Section-specific notes measured in advance:

- **§45 (127 lines, `brace-expansion` advisory).** Almost all of it is npm-audit output and version-resolution narrative. Keep the `overrides` recipe and the major-scoped-pair reasoning; drop the audit transcripts.
- **§48 + §48-was.** `## 48-was.` is a 35-line duplicate left behind when §48 closed. Delete the `## 48-was.` heading and fold any sentence it holds that §48's body does not into §48's compressed body. **The number `48-was` disappears; `48` is never reused.** §48 has three inbound pointers — its `**Cited from:**` line is mandatory.
- **§14.** Its resolution ("no fallback — a pre-existing cache is orphaned and refetched once") is the transferable half; the two-key archaeology is not.
- **§34.** Only 29 lines already; expect little change. Do not pad it.

- [ ] **Step 4: Full verification**

```bash
node "<scratchpad>/followup-audit.mjs" snapshot "<scratchpad>/after-t3.json" > "<scratchpad>/t3.log" 2>&1; echo "EXIT=$?"
ALLOW_REMOVED=48-was node "<scratchpad>/followup-audit.mjs" compare "<scratchpad>/baseline.json" "<scratchpad>/after-t3.json"; echo "EXIT=$?"
```

Expected: `OK`, `EXIT=0`. Closed lines down by ~370. **`unresolved-cites` must not increase** — a rise means a compressed entry now names a symbol whose absence marker was in a paragraph you deleted.

- [ ] **Step 5: Read the diff in full**

```bash
git diff docs/open-followups.md > "<scratchpad>/t3.diff"; echo "EXIT=$?"
```

Read `<scratchpad>/t3.diff` end to end. For every removed line, confirm it is measurement, narrative, or a superseded write-up — not a lesson, prohibition, or residual. This file is ungated; this read is the review.

- [ ] **Step 6: Commit**

```bash
git add docs/open-followups.md
git commit -F - <<'EOF'
docs: compress the eight closed 0.210.0/0.211.1 follow-ups in place

Deletion only — every surviving sentence is byte-identical to one that was
there before. Each entry keeps its number, its resolution paragraph, every
transferable lesson and every prohibition, plus a Cited-from line naming the
shipped source that points at it.

Folds the leftover 48-was duplicate into 48. The number is not reused.
EOF
```

---

## Task 4: Compress group 2 — §2, §58 (split), §63

**249 lines in, ~90 expected out** — §58 keeps a full open half.

**Files:**
- Modify: `docs/open-followups.md`

- [ ] **Step 1: Compress §2 and §63**

Apply the contract. §2's `**Cited from:**` is `use-reference-data.ts`, `use-resource-directory.ts`.

★★ §2's own entry is the register's canonical example of a rotted number — it recorded 1037/1038 when the truth was 1043/1043. **Keep the paragraph that says so**; it is the lesson, not the measurement.

§63 has no inbound pointer. Keep its resolution (`gantt.tsx` split, 715 lines, baseline entry gone) and drop the split narrative.

- [ ] **Step 2: Split §58 — this one is not a compression**

§58 is `HALF CLOSED`. It becomes two parts under **one** heading, because `layout.tsx` and `e2e/a11y.spec.ts` both point at `§58`:

1. **Closed half** — compress to the template. Keep verbatim: the `**Resolution (the gate half only).**` paragraph, the `★★ STILL ONLY HALF` paragraph, the `★★ The error message names a cause the guard cannot detect` paragraph, the `★ DECIDED 2026-08-03 — the production DOM change stays` paragraph, and — mandatory — the `★★★ THE OBVIOUS MUTATION PROOF CANNOT WORK` paragraph, which is a standing trap about `page.addInitScript` and `document.documentElement` being `null`.
2. **Open half** — the entire `### The remaining half — follow-up, not yet built` subsection stays **uncut**. Candidates (a), (b) and (c) are unverified design sketches plus one recorded rejection; deleting (c) invites its re-proposal.

Change the heading state marker to make the split legible without renumbering:

```markdown
## 58. The axe gate can pass against a STALE dev server — gate half CLOSED post-0.212.0, sibling-worktree half OPEN
```

- [ ] **Step 3: Verify**

```bash
node "<scratchpad>/followup-audit.mjs" snapshot "<scratchpad>/after-t4.json" > "<scratchpad>/t4.log" 2>&1; echo "EXIT=$?"
ALLOW_REMOVED=48-was node "<scratchpad>/followup-audit.mjs" compare "<scratchpad>/baseline.json" "<scratchpad>/after-t4.json"; echo "EXIT=$?"
```

Expected: `OK`, `EXIT=0`.

★ The compare treats §58 as *closed* (its title still contains `CLOSED`), so the open-shrink invariant does **not** protect its open half. Check that half by eye against the pre-edit text: the `### The remaining half` subsection must be present and identical.

- [ ] **Step 4: Read `git diff docs/open-followups.md` in full, then commit**

```bash
git add docs/open-followups.md
git commit -F - <<'EOF'
docs: compress §2 and §63, split §58 into its closed and open halves

§58 keeps one heading because layout.tsx and e2e/a11y.spec.ts both point at
the number. The gate half compresses; the sibling-worktree half — three
unverified candidates and one recorded rejection — is carried uncut.
EOF
```

---

## Task 5: Compress group 3 — the machine-unblocking slices (§72–§76)

**722 lines in, ~120 expected out.** This is the largest group and the one with the most inbound pointers: all five are cited from shipped source.

**Files:**
- Modify: `docs/open-followups.md`

- [ ] **Step 1: §72 — compress, and preserve its residual**

§72 (230 lines) is closed **for caller callbacks only**. Its `**Residual (still open):**` block is mandatory and carries, verbatim, the passage naming `applyWorkspace`, `onOpenStorageFile`'s raw `setTasks`/`setRaid`, `args.setActivityLog`, and the three **unpinned** `refreshBackendStatus` guards whose deletion leaves every gate green. Losing that passage loses open work.

`**Cited from:**` — `use-storage-backend.ts`, `use-storage-backend.test.tsx`, `use-scheduled-jobs.ts`.

- [ ] **Step 2: §73 — compress**

Its content now lives in `AGENTS.md`'s `npm run test:run` block. Replace the duplicated explanation with a pointer to that block (Rule 3), and keep the ★ noting the gate's only anchor for the name is three warning comments with no call site.

- [ ] **Step 3: §74 — compress**

`**Cited from:**` — `timelog-guards.ts`, `timelog-panel.tsx`. Keep verbatim the ★★★ "declared CLOSED three times before it was" lesson — three successive closures each covered every site the author had looked at. That is the entry's whole value.

- [ ] **Step 4: §75 — compress**

Keep the ★★ scope limit: verified at seeds 1/2/3/7 plus unshuffled only, **not a general property**. Keep the `npm run test:shuffle` / `unit-tests-shuffled` pointer. Drop the per-seed run logs.

- [ ] **Step 5: §76 — compress**

Keep verbatim: the ★★ correction that the long-claimed symptom ("never leaves its loading state") was **false** — `ready` is unread by both consumers, and the real symptom is that `use-ai-orchestration`'s runner sees an empty list so no scheduled job fires in dev. Keep the ★★★ that it shipped untested on a belief since retracted. Read the header for its slice attribution (Rule 5) — do not write !346 or !349 from memory.

- [ ] **Step 6: Verify**

```bash
node "<scratchpad>/followup-audit.mjs" snapshot "<scratchpad>/after-t5.json" > "<scratchpad>/t5.log" 2>&1; echo "EXIT=$?"
ALLOW_REMOVED=48-was node "<scratchpad>/followup-audit.mjs" compare "<scratchpad>/baseline.json" "<scratchpad>/after-t5.json"; echo "EXIT=$?"
```

Expected: `OK`, `EXIT=0`, closed-lines down ~1000 cumulatively.

- [ ] **Step 7: Read the diff in full, then commit**

```bash
git add docs/open-followups.md
git commit -F - <<'EOF'
docs: compress the five machine-unblocking follow-ups (72-76)

All five are cited from shipped source, so all five keep their numbers and
gain a Cited-from line. §72 carries a Residual block: it closed for caller
callbacks only, and the sites it does not cover are still open work.
EOF
```

---

## Task 6: Compress group 4 — §80, §81, §84, §85

**267 lines in, ~55 expected out.**

**Files:**
- Modify: `docs/open-followups.md`

- [ ] **Step 1: §80 and §81 — normalise the titles, then compress**

Both are closed but their titles carry no `~~strikethrough~~`, unlike the other 19. Add it, keeping the wording identical:

```markdown
## 80. ~~Both hide-external toggles trust whatever `readDeviceJson` returns~~ — CLOSED
## 81. ~~The swimlane no-op drop guard no longer holds for a name-resolved task~~ — CLOSED
```

§80 is already 22 lines — expect almost no change; do not pad it. §81 keeps its ★★★: the first fix broke the ASSIGN control (inert select), so `source` now carries caller **intent**.

- [ ] **Step 2: §84 — compress**

It closed **FALSE**. The entry's value is entirely its ★★★ transferable lesson — re-measure against current HEAD, not a partially-fixed baseline. Keep that verbatim; drop the measurement that produced the wrong conclusion.

- [ ] **Step 3: §85 — compress**

`**Cited from:**` — `strictmode.meta.test.tsx`. It also closed on a **false premise**. Keep verbatim: that StrictMode does double-invoke here; that the rule turns on which fiber is flagged for **placement** — not the tree, not the commit number; that a pure keyed reorder can double-invoke with nothing mounting; and the pointer to `src/app/strictmode.meta.test.tsx` as the standing instrument. Drop the investigation narrative.

★★ Do not restate the placement-flag rule in your own words. Three successive wordings of it shipped over-general. Copy the sentences that are there, or point at the meta-test.

- [ ] **Step 4: Verify, read the diff in full, commit**

```bash
node "<scratchpad>/followup-audit.mjs" snapshot "<scratchpad>/after-t6.json" > "<scratchpad>/t6.log" 2>&1; echo "EXIT=$?"
ALLOW_REMOVED=48-was node "<scratchpad>/followup-audit.mjs" compare "<scratchpad>/baseline.json" "<scratchpad>/after-t6.json"; echo "EXIT=$?"
git add docs/open-followups.md
git commit -F - <<'EOF'
docs: compress 80, 81, 84 and 85; strike through 80 and 81

84 and 85 both closed FALSE, so each keeps its retraction and its lesson and
loses the measurement that produced the wrong conclusion. 85 points at
strictmode.meta.test.tsx rather than restating the placement-flag rule.
EOF
```

---

## Task 7: Compress the index table and refresh the header's own numbers

**Files:**
- Modify: `docs/open-followups.md` (the table at lines 52–131, and the intro above it)

- [ ] **Step 1: Shrink every closed row to one clause**

Each closed row keeps `| N | ~~title~~ | origin | size |` and its `**CLOSED …**` state, followed by **one clause**. Example, §74 today spans multiple lines of prose; it becomes:

```markdown
| 74 | ~~The TimeLog refresh handlers omit a guard their button carries~~ | pre-existing, found post-0.214.0 | S | **CLOSED** — shared pure `timelog-guards.ts` predicates; all four button wirings DOM-pinned |
```

The detail that clause replaces now sits in the entry itself, which is where a reader who cares is going. Rows to shrink: 2 · 11 · 14 · 15 · 29 · 34 · 45 · 48 · 49 · 58 · 63 · 72 · 73 · 74 · 75 · 76 · 80 · 81 · 84 · 85. **Open rows are not touched.**

- [ ] **Step 2: Update §58's row to match its new split heading**

```markdown
| 58 | The axe gate can pass against a STALE dev server | 0.212.0 (Nayler) | S | **gate half CLOSED post-0.212.0** — version stamp + guard test; the sibling-worktree half is OPEN, three candidates sketched and unverified |
```

- [ ] **Step 3: Add the `48-was` disposal note under the stable-numbers paragraph**

The paragraph beginning "★ **The numbers are stable identifiers…**" gains one sentence:

```markdown
★ `48-was` was a duplicate left behind when §48 closed; it was folded into §48 on 2026-08-05 and the
label is retired. `48` keeps its meaning.
```

- [ ] **Step 4: Verify and commit**

```bash
node "<scratchpad>/followup-audit.mjs" snapshot "<scratchpad>/after-t7.json" > "<scratchpad>/t7.log" 2>&1; echo "EXIT=$?"
ALLOW_REMOVED=48-was node "<scratchpad>/followup-audit.mjs" compare "<scratchpad>/baseline.json" "<scratchpad>/after-t7.json"; echo "EXIT=$?"
git add docs/open-followups.md
git commit -F - <<'EOF'
docs: shrink the index table's twenty closed rows to one clause each

The table had stopped being an index — §72's row alone ran fifteen lines.
Open rows are untouched.
EOF
```

---

## Task 8: Resolve every citation the open entries make

Phase 2. **No open section may lose a line** — the invariant is now doing real work.

**Files:**
- Modify: `docs/open-followups.md` (open sections only)

- [ ] **Step 1: List the unresolved cites**

```bash
node "<scratchpad>/followup-audit.mjs" snapshot "<scratchpad>/after-t7.json" > "<scratchpad>/cites.log" 2>&1; echo "EXIT=$?"
```

Read `<scratchpad>/cites.log`. Each line is `§N [kind] \`tok\` — verdict`.

- [ ] **Step 2: Discard the known-benign classes FIRST — measured 2026-08-05, roughly 20 of the 50**

Flagging these would bury the real findings in noise. None of them is a defect:

| class | instances in the baseline | why it fires, and why it is fine |
|---|---|---|
| **§44's whole entry** | `graph-recurrence.ts`, `calendar-event-attendees.ts`, `use-event-calendar-push.ts`, `calendar-event-pull.ts`, `use-event-calendar-pull.ts`, `eventToGraphEvent`, `exceptionPlan`, `afterPush`, `replayExceptions` | §44 is the **unexecuted** UX-roadmap slice. Every name it holds is a design proposal for code nobody has written. Deliberate absence, whole-entry. Add one `★ Every symbol named below is proposed, not built` line at the top of §44 instead of nine flags — that is a bucket-1 repair of a *missing absence marker*, not a new claim. |
| **upstream / browser / vitest APIs** | `MutationObserver`, `asyncWrapper`, `asyncUtilTimeout`, `RandomSequencer`, `onTestFinished` | Not repo symbols. The gate handles this class with an `ALLOWLIST`; do the same here, in a plan-local list. No doc edit. |
| **deleted-on-purpose docs** | `docs/refactor-review-2026-06-19.md`, `threat-model.md`, `findings-2026-07.md` | The header's own table records these as deliberately deleted, with `git show HEAD:<path>` as the recovery route. No edit. |
| **never-built features** | `optimize_wbs` (§3) | §3's title is literally "never built". The absence marker sits outside the ±400-char window. No edit. |
| **`tech-debt-register.md` "missing"** | §53 ×2 | It resolves relative to `docs/`, which the instrument's `resolvePath` does not try for a bare basename. Instrument artefact — confirm the file exists, then no edit. |

★★★ **THE INSTRUMENT'S `file:line` CHECK IS UNRELIABLE — measured 2026-08-05, 6 of its 11 flags were FALSE POSITIVES.** Its rule is "a symbol named in the same doc sentence appears within ±15 lines of the cited line". In this register a sentence routinely names four symbols across three files, so the rule has almost no discriminating power. Confirmed false positives: §11, §33, §49 (×2), §64, §75 — in each, the cited line is exactly right and anchors a *different* symbol than the one the scan happened to search for. **§64 is the instructive one: the scan searched for `completionPercent`, which that entry's own ★★ TRANSCRIPTION WARNING exists to record as the WRONG name for that file. The tool rediscovered the error the entry documents and reported it as a defect in the entry.** §34's `index.ts` was not a citation at all — it is a module-resolution suffix list (`.ts`/`.tsx`/`index.ts`), tokenised as a filename.

★★★ **And it MISSES real decay in the other direction — six stale cites it passed.** `use-reference-data.ts:127`/`:140` are really `:133`/`:146` (§62's *live* cite — the scan flagged the same entry's *historical* cite, which was correct, and passed the broken one); `task-manager.tsx:2047` and `:2041` in §1/§2 both target `:2044`, so at least one was wrong when written; `task-manager.tsx:2158`→`:2155`; `resource-directory.tsx:442`→`:443`; `workspace-section.tsx:511-559`→`506-554`.

**So `no peer … within ±15` is a PROMPT TO LOOK, never a verdict.** The check that actually works is per-cite judgement: *does the cited line contain something the sentence asserts about that file?* A window scan cannot answer it. Never mass-apply this verdict class, and never delete a claim on its say-so — no claim in this register was found dead, every one checked survived.

**One finding the instrument cannot see, surfaced by the Task 3 cold review — resolve it here.** `abort-error.ts:14` says the change is "hardening plus one shape for **five** call sites"; §11 says "all **four** sites" throughout. One of the two is wrong, and §11's entire subject is a claim that survived three reviews. Count the call sites (`grep -rn "isAbortError" src/app`), then correct whichever is wrong — the doc is in scope here, the code comment is a one-word fix worth taking with it. This is a **bucket 1** repair: the count is provable.

**The real findings in the same baseline, for calibration:** `§62 use-resource-planner.ts:710 — line 710 > 554` (the file was split; the cite is dead), `§68 preflight.css:166 — path missing`, `§69 appearance-section.test.tsx — moved -> src/app/settings-sections/`, `§34 index.ts — moved -> src/app/next-actions/index.ts`. Four bucket-1 repairs. Expect that order of magnitude, not fifty.

- [ ] **Step 3: Sort the rest into one of three buckets, and act**

**Bucket 1 — provably repairable.** A `path — moved -> <one path>` verdict, or a symbol with exactly one unambiguous successor. Fix inline. For a `file:line` verdict, **replace the `file:line` with a symbol cite** — never with a fresh line number:

```markdown
<!-- before -->
`use-resource-planner.ts:185`
<!-- after -->
`use-resource-planner.ts` (`reportSilentFailure` branch)
```

A line number is broken by the next commit that touches the file, which is how most of these decayed.

**Bucket 2 — not provable.** A count, a behavioural claim, an "X is guarded". **Leave the claim exactly as written** and append on the following line:

```markdown
★ UNVERIFIED 2026-08-05 — `theCitedThing` no longer resolves; the claim is left as written.
```

Do not invent a replacement. This file's history is a list of falsehoods written while correcting other falsehoods.

**Bucket 3 — disproved hard enough that the item may be dead.** Flag it the same way as bucket 2, add `; the item may be dead — needs re-triage`, and **do not close it.** Closing is re-triage, which is out of scope. Collect these for the final report.

- [ ] **Step 4: Re-run the four countable claims and attach their reproduce commands**

The file's own doctrine: "a count is the easiest claim to check and the easiest to leave rotting: put the reproduce command beside it."

| § | claim | command |
|---|---|---|
| 40 | **40 sites** of `text-ui-dark-blue` with no companion | `grep -rn "text-ui-dark-blue" src/app --include=*.tsx \| wc -l` — then subtract the ones carrying a `dark:` companion on the same line |
| 55 | fourteen hand-rolled `aria-pressed` toggles | `grep -rln "aria-pressed" src/app --include=*.tsx` minus `toggle-button.tsx`'s own call sites |
| 22 | ~54 `clipText` call sites | `grep -rn "clipText(" src/app \| wc -l` |
| 7 | 17 files vs call sites for `SortResizeTh` | `grep -ro "<SortResizeTh" src/app --include=*.tsx \| grep -v "\.test\.tsx:" \| wc -l` |

For each: run the command, compare to the written number. If it matches, append the command beside the claim. If it does not, correct the number **and** append the command — a count is provable, so it is bucket 1, not bucket 2.

★ Do not read a gate's or a count's exit code through a pipe elsewhere in this task — `| wc -l` is fine because you want the count, not the status.

- [ ] **Step 5: Check every markdown link target exists**

The instrument resolves backticked paths but not `[text](target)` links, and the header carries several — `tech-debt-register.md`, `docs/security/threat-model.md`, `docs/AGENTS/`, plus four deliberately deleted docs it names in a table.

```bash
grep -oE "\]\(([^)#][^)]*)\)" docs/open-followups.md | sed -E 's/^\]\(//; s/\)$//' | sort -u > "<scratchpad>/links.txt"; echo "EXIT=$?"
```

Read `<scratchpad>/links.txt` and check each target by hand from `docs/`. A missing target is bucket 1 if the file moved, and bucket 2 otherwise — except for the four docs the header's own table records as **deliberately deleted**, which are prose, not links, and must stay named. ★ The header also forbids adding any link into `docs/superpowers/` — that tree is gitignored, so such a link is dead for everyone but this machine. Do not add one while fixing others.

- [ ] **Step 6: Verify the invariant holds — this is the step that matters**

```bash
node "<scratchpad>/followup-audit.mjs" snapshot "<scratchpad>/after-t8.json" > "<scratchpad>/t8.log" 2>&1; echo "EXIT=$?"
node "<scratchpad>/followup-audit.mjs" compare "<scratchpad>/after-t7.json" "<scratchpad>/after-t8.json"; echo "EXIT=$?"
```

Expected: `OK`, `EXIT=0`, and `unresolved-cites` **down** from Step 1's number. Any remaining unresolved cite must correspond to a `★ UNVERIFIED` flag you wrote — count them and confirm they match one-for-one.

- [ ] **Step 7: Read the diff in full, then commit**

```bash
git diff docs/open-followups.md > "<scratchpad>/t8.diff"; echo "EXIT=$?"
```

Every hunk must be an added annotation or a corrected cite. **A removed line inside an open section is a bug** — the compare would have caught a net shrink, but a one-for-one swap of a real sentence for an annotation slips past it. Read for that specifically.

```bash
git add docs/open-followups.md
git commit -F - <<'EOF'
docs: resolve the open entries' citations against HEAD

Repairs what was provable — moved paths, and file:line cites replaced by
symbol cites, since a line number is broken by the next commit that touches
the file. Everything else is flagged UNVERIFIED with the claim left exactly
as written; nothing is invented and nothing is closed.
EOF
```

---

## Task 9: Final verification and report

**Files:** none modified.

- [ ] **Step 1: Full compare against the original baseline**

```bash
node "<scratchpad>/followup-audit.mjs" snapshot "<scratchpad>/final.json" > "<scratchpad>/final.log" 2>&1; echo "EXIT=$?"
ALLOW_REMOVED=48-was node "<scratchpad>/followup-audit.mjs" compare "<scratchpad>/baseline.json" "<scratchpad>/final.json"; echo "EXIT=$?"
```

Expected: `OK`, `EXIT=0`, `unresolved-cites` down.

★★★ **The line targets throughout this plan were wrong and are REVISED — measured after groups 1 and 2.** The plan predicted closed bodies `1744 -> ~250` and a `4490 -> ~2900` file. Real: group 1 went 541 → 413 (−24%), group 2 went 249 → 233 (−6%). **Expect `closed-lines 1744 -> ~1350–1450` and `total 4490 -> ~4100–4200`.** A run that hits the original target has broken the contract.

**Why, and this is the finding worth keeping:** almost every ★★ here that *quantifies* something also points at the measurement it quantified — "the ranges recorded below", "the correction block below", "the entry below". Rule 2 mandates the lesson verbatim, Rule 6 then transitively mandates the measurement it points at, and Rule 1 forbids rewording the pointer away. So **"keep the lesson, drop the measurement" is structurally unavailable in exactly the entries whose lesson is about a stale measurement** — which is most of the valuable ones.

**Judge this pass by its first deliverable, not its fourth:** (1) every open item's citation resolved against HEAD or visibly flagged — the decay this ungated file has no other defence against; (2) an index table that is an index again; (3) closed entries reduced to resolution + lesson + inbound note; (4) a modest line reduction. Anyone measuring only (4) will call it a failure.

- [ ] **Step 2: Prove every inbound pointer still lands, by hand as well as by script**

```bash
grep -rn "open-followups" src e2e --include=*.ts --include=*.tsx > "<scratchpad>/inbound.log"; echo "EXIT=$?"
```

For each `§N` in that file, confirm `## N.` exists in the pruned doc and its body is non-empty. The script checks the heading; this checks the body is worth landing on.

- [ ] **Step 3: Markdown sanity**

```bash
grep -c "^## " docs/open-followups.md    # expect 80 — 81 minus the retired 48-was
grep -n "^| [0-9]" docs/open-followups.md | wc -l   # index rows; expect unchanged
```

- [ ] **Step 4: Confirm nothing outside the register moved**

```bash
git diff --stat main...HEAD
```

Expected: **two** files — `docs/open-followups.md`, plus a one-word comment fix in `src/app/abort-error.ts` (commit `4eb96936`). No `version.ts`, no `CHANGELOG.md` — still **no version bump** and no changelog entry.

★ **Why the src file is in scope, against this plan's original doc-only rule.** `abort-error.ts:14` said "one shape for **five** call sites" while line 13 of the same comment said "did match, at **all four** call sites" — self-contradicting two lines apart. `git log -S"five call sites"` shows `860ce6e1` wrote the identical sentence into the code and into §11, and `d88223c4` corrected it to "four" in the register and the CHANGELOG **without touching the code** (`git show --stat d88223c4` lists three files, none of them `abort-error.ts`). Four production call sites confirmed, with alias/re-export/barrel vectors ruled out. Honouring a self-imposed file boundary at the cost of leaving a self-contradicting comment in shipped code is the worse trade — but it IS a scope widening, so it is its own commit and it is called out in the final report.

- [ ] **Step 5: Report to the user**

Report, in this order:
1. line counts before/after, per group;
2. every `★ UNVERIFIED` flag written, with the § and what failed to resolve;
3. every bucket-3 item — a claim disproved hard enough that the item may be dead — as an explicit list for a separate re-triage call;
4. any count that was corrected, with its reproduce command.

- [ ] **Step 6: Stop.**

Do not push, do not open an MR, do not merge. Those happen only on an explicit instruction.

---

## Out of scope

Re-triaging the 58 open items, closing anything, ranking them, implementing any fix, adding a CI gate for this file, and touching `docs/tech-debt-register.md` (a different artifact class, owner-assigned, next sweep 2026-10-03).
