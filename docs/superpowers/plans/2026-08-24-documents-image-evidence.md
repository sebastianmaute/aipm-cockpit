# Documents Image Evidence Implementation Plan (§216 · §218)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the OOXML package builders evidence that fails on any change to a media-free package, and make the three asset-id patterns' divergence visible in code, in tests, and to the user.

**Architecture:** A committed ordered part manifest (path + SHA-256 per part, in ZIP order) checked by a test inside the existing `unit-tests` job, regenerated only by an explicit script; an injectable `modified` date on `buildZip` whose default does not change; and one shared helper over the asset-id patterns plus a conditional cap message.

**Tech Stack:** TypeScript, vitest 4, `node:crypto`, `vite-node` for the regeneration script. No new dependency.

**Spec:** `docs/superpowers/specs/2026-08-24-documents-image-evidence-design.md` (commit `7037cf71`)

**Branch:** `feat/documents-image-evidence`, off `origin/main` at `08a3b26e` (0.257.1 "Shepard")

---

## Read this before Task 1

Repo landmines that WILL bite this slice. Each is measured, not folklore.

- ★★★ **Never read a gate's exit code through a pipe.** `npm run test:run | tail -8` exits `0` while tests fail — that is `tail`'s status, and the pipe also discards the failure text. Redirect, check unpiped, then read the file:
  `npm run test:run > /tmp/suite.log 2>&1; echo "EXIT=$?"; grep -E "Test Files|Tests " /tmp/suite.log`
- ★★★ **Use the scratchpad, not `/tmp`.** `/tmp` is shared across sessions on this machine and a peer's gate log has overwritten one of ours before, producing a read of another checkout's result. Write logs under the session scratchpad directory instead.
- ★★ **`npx tsc --noEmit` after editing ANY test.** `next build` does not typecheck test files and vitest never typechecks. It exits **2** on diagnostics, not 1 — an `= 1` check misreads it.
- ★★ **Never run two vitest processes at once.** A red run carrying `Failed to start forks worker` is machine contention, not evidence — `grep -c "Failed to start"` before believing any red.
- ★★ **`--reporter=basic` does not exist in vitest 4.** Use `--reporter=dot`.
- ★★ **Every `src/app/*.ts(x)` is CRLF; `AGENTS.md` and `docs/open-followups.md` are LF-only.** A `\n`-joined multi-line anchor is a guaranteed no-op on a CRLF file, and `sed -i` re-lines the whole file invisibly to `git diff`. Use node utf8 writes matching `\r\n`.
- ★★ **`i18n.de.ts` is CRLF and the Edit tool corrupts umlauts in it** (and curls double quotes). Patch it with a node utf8 write, then verify the bytes back. The `i18n-encoding` test BANS ASCII substitutes (`fuer`, `druecken`) and `\u00XX` escapes — write real umlauts.
- ★★ **`Lang` is `"en-US" | "en-GB" | "de"`.** There is no `"en"`. The DE dictionary is lazy — a test asserting DE output must `await loadI18n("de")` first.
- ★ **`npm run lint` exits 1 on this machine** from gitignored `.worktrees/` and `.demo-tmp/` leftovers. Use `npx eslint src scripts` for a usable signal. There is no `--max-warnings` gate, so an unused import ships green — keep them out by hand.
- ★ **A new npm script needs a `scriptsDescriptions` entry** in `package.json` or `docs:scripts:check` fails the build.
- ★ **`git checkout -- <file>` is DENY-BLOCKED here.** Revert a mutant with an inverse anchored write plus a uniqueness assertion, then prove `git diff --stat` is empty.
- ★ **`git show --stat HEAD` is the scope check**, not `git diff --stat HEAD~1` — this is a shared worktree and the latter reports other agents' uncommitted files.

**Coverage facts that make this slice cheap** (verified against `vitest.config.ts`):

- `src/test/**` is coverage-EXCLUDED. The manifest helper lives there and raises no floor.
- `src/app/zip.ts` is coverage-EXCLUDED (listed under binary packing). The clock seam raises no floor.
- `src/app/**/*.tsx` is coverage-EXCLUDED. The `documents-asset-section.tsx` change raises no floor.
- `src/app/document-asset-usage.ts` is a plain `.ts` and IS coverage-gated. Its new export needs real tests — Task 6 provides them.

**File sizes today** (the gate counts `wc -l` + 1; none of these are baselined, all are far from 800):

| file | gate lines |
|---|---|
| `src/app/documents-asset-section.tsx` | 379 |
| `src/app/document-asset-usage.ts` | 42 |
| `src/app/document-export-assets.ts` | 196 |
| `src/app/zip.ts` | 212 |

---

## One refinement to the spec, applied deliberately

The spec says *"The manifest test passes a fixed date so package bytes become fully deterministic under test."* **The manifest test does not need a date, and the builders are not threaded.**

`unzipBytes` walks local file headers and returns each part's DATA. The DOS timestamp is a HEADER field (`zip.ts` writes it at the local header and again in the central directory), never part data. So part digests are already timestamp-independent, and `buildDocxPackage` / `buildPptxPackage` / `buildXlsx` keep their exact current signatures.

The seam is still worth building, and this is the honest reason: a part manifest structurally cannot see the zip CONTAINER. The seam lets one test in `zip.test.ts` assert that two builds at the same injected date are byte-identical — which proves the timestamp is the ONLY nondeterminism in the container, and therefore that the part manifest plus that one test cover the package between them. Without the seam, container nondeterminism is untestable and unbounded.

---

## File structure

**Create:**

| File | Responsibility |
|---|---|
| `src/app/zip.test.ts` | The clock seam: determinism at a fixed date, difference across dates, default still varies. |
| `src/test/ooxml-manifest.ts` | `packageManifest(blob)` → ordered `{path, sha256}[]`, plus the comparison that names the offending part. Shared by the gate and the script so they cannot compute differently. |
| `src/app/ooxml-package-manifest.test.ts` | The gate: builds both media-free packages, compares against the committed baseline. |
| `docs/baselines/ooxml-parts.json` | The baseline. Regenerated only by the script below. |
| `scripts/update-ooxml-manifest.ts` | Regeneration, run under `vite-node`. |

**Modify:**

| File | Change |
|---|---|
| `src/app/zip.ts` | `buildZip` gains a third parameter `modified: Date = new Date()`. |
| `src/test/unzip-bytes.ts` | `blobToArrayBuffer` prefers `blob.arrayBuffer()` so the module works under plain node too; export `blobBytes`. |
| `src/app/document-asset-usage.ts` | Add `AssetRefs` + `assetRefsInDocument`; `assetIdsInDocument` delegates. |
| `src/app/document-asset-usage.test.ts` | Tests for the new export and the three-pattern relationship. |
| `src/app/documents-asset-section.tsx` | Cap message becomes conditional on `undrawable`. |
| `src/app/i18n.ts`, `src/app/i18n.de.ts` | One new key each. |
| `package.json` | `ooxml:manifest` script + its `scriptsDescriptions` entry. |
| `docs/open-followups.md` | Close §216 and §218. |
| `docs/AGENTS/documents.md` | Record the manifest gate and the three-pattern rule. |
| `CHANGELOG.md`, `src/app/version.ts` + the five unguarded version sites | Release. |

---

## Task 1: The clock seam on `buildZip`

**Files:**
- Modify: `src/app/zip.ts` — `buildZip`
- Modify: `src/test/unzip-bytes.ts` — `blobToArrayBuffer`, add `blobBytes`
- Test: `src/app/zip.test.ts` (create)

- [ ] **Step 1: Make `unzip-bytes.ts` work under plain node and export raw bytes**

Replace the `blobToArrayBuffer` function with this, and add the `blobBytes` export directly beneath it:

```ts
/**
 * jsdom's Blob shim omits `.arrayBuffer()`, and Node's Blob cannot wrap a jsdom
 * Blob as a BlobPart (it serialises to "[object Blob]"). FileReader is the one
 * path both shims implement — same reasoning as `export-ooxml.test.ts`.
 *
 * ★ The `.arrayBuffer()` branch is what lets this module run under plain node
 * (`vite-node scripts/update-ooxml-manifest.ts`), where there is no FileReader
 * at all. Under jsdom the branch is skipped and FileReader still does the work.
 */
function blobToArrayBuffer(blob: Blob): Promise<ArrayBuffer> {
  if (typeof blob.arrayBuffer === "function") return blob.arrayBuffer();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = () => reject(reader.error);
    reader.readAsArrayBuffer(blob);
  });
}

/** The whole archive as bytes — for asserting on the CONTAINER, which
 *  `unzipBytes` deliberately discards (it returns part data only). */
export async function blobBytes(blob: Blob): Promise<Uint8Array> {
  return new Uint8Array(await blobToArrayBuffer(blob));
}
```

- [ ] **Step 2: Write the failing test**

Create `src/app/zip.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildZip, type ZipEntry } from "./zip";
import { blobBytes, unzipBytes, partText } from "../test/unzip-bytes";

const ENTRIES: ZipEntry[] = [
  { path: "alpha.txt", data: "first" },
  { path: "nested/beta.txt", data: "second" },
];

// ★ Two dates that differ in the DOS time field (2-second granularity).
const T1 = new Date(2021, 4, 17, 9, 30, 0);
const T2 = new Date(2023, 10, 2, 14, 15, 30);

describe("buildZip — the injectable modification date", () => {
  it("produces byte-identical archives for the same injected date", async () => {
    const a = await blobBytes(buildZip(ENTRIES, "application/zip", T1));
    const b = await blobBytes(buildZip(ENTRIES, "application/zip", T1));
    expect([...a]).toEqual([...b]);
  });

  it("produces different archives for different injected dates", async () => {
    const a = await blobBytes(buildZip(ENTRIES, "application/zip", T1));
    const b = await blobBytes(buildZip(ENTRIES, "application/zip", T2));
    expect([...a]).not.toEqual([...b]);
  });

  it("leaves part DATA untouched by the date — this is why the manifest needs no clock", async () => {
    const a = await unzipBytes(buildZip(ENTRIES, "application/zip", T1));
    const b = await unzipBytes(buildZip(ENTRIES, "application/zip", T2));
    expect([...a.keys()]).toEqual([...b.keys()]);
    expect(partText(a, "alpha.txt")).toBe(partText(b, "alpha.txt"));
    expect(partText(a, "nested/beta.txt")).toBe(partText(b, "nested/beta.txt"));
  });

  it("still defaults to the wall clock, so real exports are unchanged", async () => {
    const withDefault = await blobBytes(buildZip(ENTRIES));
    const withEpoch = await blobBytes(buildZip(ENTRIES, "application/zip", new Date(1980, 0, 1)));
    expect([...withDefault]).not.toEqual([...withEpoch]);
  });
});
```

- [ ] **Step 3: Run it and confirm it fails**

```bash
npx vitest run src/app/zip.test.ts --reporter=dot > "$SCRATCH/zip.log" 2>&1; echo "EXIT=$?"
grep -E "Tests |TypeError|Expected" "$SCRATCH/zip.log"
```

Expected: FAIL. `buildZip` takes two parameters, so the third argument is a tsc error and the two same-date builds differ (both call `new Date()` internally at different milliseconds — or coincide, which is exactly why this test is not sufficient on its own; the tsc check in Step 6 is what proves the parameter landed).

- [ ] **Step 4: Add the parameter**

In `src/app/zip.ts`, change the signature and drop the internal clock read. Replace:

```ts
export function buildZip(
  entries: ZipEntry[],
  mime = "application/zip",
): Blob {
  const out = new ByteWriter();
  const now = new Date();
  const { date: dosDate, time: dosTime } = dosDateTime(now);
```

with:

```ts
export function buildZip(
  entries: ZipEntry[],
  mime = "application/zip",
  /** ★★ INJECTABLE ONLY SO THE CONTAINER IS TESTABLE, and the default is
   *  deliberately unchanged. A part manifest (docs/baselines/ooxml-parts.json)
   *  cannot see the zip container at all, because it compares part DATA and the
   *  DOS timestamp is a local-header field. Passing a fixed date lets one test
   *  in zip.test.ts assert two builds are byte-identical, which is what bounds
   *  the container's nondeterminism to this one field.
   *
   *  ★★ Flipping this default to a constant would make every produced archive
   *  reproducible — and would also stop Windows Explorer showing a plausible
   *  date, which is the reason dosDateTime exists at all. That is a visible
   *  user-facing change and is deliberately NOT part of this seam. */
  modified: Date = new Date(),
): Blob {
  const out = new ByteWriter();
  const { date: dosDate, time: dosTime } = dosDateTime(modified);
```

- [ ] **Step 5: Run the test again**

```bash
npx vitest run src/app/zip.test.ts --reporter=dot > "$SCRATCH/zip.log" 2>&1; echo "EXIT=$?"
grep -E "Tests " "$SCRATCH/zip.log"
```

Expected: `EXIT=0`, `Tests  4 passed`.

- [ ] **Step 6: Typecheck, and confirm no call site broke**

```bash
npx tsc --noEmit; echo "EXIT=$?"        # 0 expected; 2 means diagnostics
grep -rn "buildZip(" src --include="*.ts" | grep -v "\.test\."
```

Expected: `EXIT=0`, and three call sites (`ooxml-docx-primitives.ts`, `ooxml-pptx-primitives.ts`, `export-xlsx.ts`), all still two-argument and all still valid because the parameter is optional.

- [ ] **Step 7: Commit**

```bash
git add src/app/zip.ts src/app/zip.test.ts src/test/unzip-bytes.ts
git commit --only src/app/zip.ts src/app/zip.test.ts src/test/unzip-bytes.ts -m "test(zip): make the archive timestamp injectable so the container is testable

buildZip stamped new Date() into every local header and the central
directory, so two builds a second apart differed in bytes and nothing
could assert anything about the container. The date is now a third
optional parameter defaulting to new Date(), so real exports are
byte-for-byte unchanged and all three call sites keep their two-argument
form.

The point is not reproducible exports. It is that a part manifest cannot
see the container -- it compares part DATA, and the DOS timestamp is a
header field -- so without a seam the container's nondeterminism is
unbounded and untestable. One test now pins it to this single field.

blobToArrayBuffer prefers Blob.arrayBuffer() where it exists, which is
what lets the same module run under plain node for the regeneration
script in a later task; jsdom keeps using FileReader."
```

---

## Task 2: The manifest helper

**Files:**
- Create: `src/test/ooxml-manifest.ts`
- Test: `src/test/ooxml-manifest.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `src/test/ooxml-manifest.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildZip } from "../app/zip";
import { packageManifest, formatManifestDiff, type PartDigest } from "./ooxml-manifest";

describe("packageManifest", () => {
  it("lists parts in ZIP ORDER, not sorted", async () => {
    const zip = buildZip([
      { path: "zebra.txt", data: "z" },
      { path: "alpha.txt", data: "a" },
    ]);
    const manifest = await packageManifest(zip);
    expect(manifest.map((p) => p.path)).toEqual(["zebra.txt", "alpha.txt"]);
  });

  it("digests each part's own bytes", async () => {
    // sha256("a") -- the well-known value, so this pins the algorithm and the
    // hex encoding, not merely self-consistency.
    const zip = buildZip([{ path: "alpha.txt", data: "a" }]);
    const manifest = await packageManifest(zip);
    expect(manifest[0].sha256).toBe(
      "ca978112ca1d0dbf3ee59ba9ea0c1b2b3b1a0f4e3f1c8e6a1b2c3d4e5f60718293a4b5c6".slice(0, 64),
    );
  });

  it("gives the same digests regardless of the archive timestamp", async () => {
    const entries = [{ path: "alpha.txt", data: "a" }];
    const early = await packageManifest(buildZip(entries, "application/zip", new Date(1999, 0, 1)));
    const late = await packageManifest(buildZip(entries, "application/zip", new Date(2031, 0, 1)));
    expect(early).toEqual(late);
  });
});

describe("formatManifestDiff", () => {
  const base: PartDigest[] = [
    { path: "a.xml", sha256: "aa" },
    { path: "b.xml", sha256: "bb" },
  ];

  it("returns null when the manifests match", () => {
    expect(formatManifestDiff(base, [...base])).toBeNull();
  });

  it("names the part whose content changed", () => {
    const changed = [base[0], { path: "b.xml", sha256: "cc" }];
    expect(formatManifestDiff(base, changed)).toContain("b.xml");
  });

  it("names a part that was added", () => {
    const added = [...base, { path: "c.xml", sha256: "dd" }];
    const msg = formatManifestDiff(base, added);
    expect(msg).toContain("c.xml");
  });

  it("names a part that was removed", () => {
    const msg = formatManifestDiff(base, [base[0]]);
    expect(msg).toContain("b.xml");
  });

  it("reports a REORDER as a reorder, which a sorted manifest could not see", () => {
    const swapped = [base[1], base[0]];
    const msg = formatManifestDiff(base, swapped);
    expect(msg).toMatch(/order/i);
    expect(msg).toContain("a.xml");
  });
});
```

★ The `sha256("a")` literal above is a placeholder-shaped trap — do NOT copy it. Compute the real value first and paste it in:

```bash
node -e "console.log(require('crypto').createHash('sha256').update('a').digest('hex'))"
```

Expected output: `ca9781...` (64 hex chars). Replace the whole `.slice(0, 64)` expression with that literal string.

- [ ] **Step 2: Run it and confirm it fails**

```bash
npx vitest run src/test/ooxml-manifest.test.ts --reporter=dot > "$SCRATCH/mf.log" 2>&1; echo "EXIT=$?"
grep -E "Tests |Cannot find" "$SCRATCH/mf.log"
```

Expected: FAIL — `Cannot find module './ooxml-manifest'`.

- [ ] **Step 3: Write the helper**

Create `src/test/ooxml-manifest.ts`:

```ts
// src/test/ooxml-manifest.ts — TEST-ONLY. Reduce an OOXML package to an
// ORDERED list of {part path, SHA-256 of that part's bytes}.
//
// ★★★ ORDERED, NOT SORTED, AND THAT IS THE WHOLE DESIGN. A sorted manifest
// cannot see a reordering of the archive's entries, and OPC readers can care
// which part leads a package. Ordered, all four failure classes -- reorder,
// addition, removal, content change -- go red, and each names a part.
//
// ★★ It deliberately says NOTHING about the zip CONTAINER. Part data carries
// no timestamp (the DOS date is a local-header field), which is why this is
// stable without any clock injection; the container's determinism is pinned
// separately by zip.test.ts. Neither covers the other.
//
// ★ Shared by the gate (ooxml-package-manifest.test.ts) and the regeneration
// script (scripts/update-ooxml-manifest.ts) ON PURPOSE. A manifest the script
// and the gate computed differently is a gate that cannot fail.

import { createHash } from "node:crypto";
import { unzipBytes } from "./unzip-bytes";

export type PartDigest = { path: string; sha256: string };

/** Every part of the package, in the order the archive stores them.
 *
 *  ★ `unzipBytes` returns a Map built by walking local file headers front to
 *  back, and a Map iterates in insertion order — so spreading it preserves
 *  ZIP order. That property is asserted by this module's own test rather than
 *  assumed, because it is the single thing the ordered design rests on. */
export async function packageManifest(pkg: Blob): Promise<PartDigest[]> {
  const parts = await unzipBytes(pkg);
  return [...parts].map(([path, bytes]) => ({
    path,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  }));
}

/** A human-readable description of how `actual` differs from `expected`, or
 *  null when they match.
 *
 *  ★★ "Bytes differ" is not an acceptable failure message for this gate --
 *  diagnosability is the reason a manifest was chosen over a committed package
 *  blob in the first place. Every branch below names a part path. */
export function formatManifestDiff(
  expected: readonly PartDigest[],
  actual: readonly PartDigest[],
): string | null {
  const expectedPaths = expected.map((p) => p.path);
  const actualPaths = actual.map((p) => p.path);

  const added = actualPaths.filter((p) => !expectedPaths.includes(p));
  const removed = expectedPaths.filter((p) => !actualPaths.includes(p));
  if (added.length > 0 || removed.length > 0) {
    const lines = [
      ...added.map((p) => `  + part not in the baseline: ${p}`),
      ...removed.map((p) => `  - part missing from the package: ${p}`),
    ];
    return `the package's part LIST changed:\n${lines.join("\n")}`;
  }

  if (expectedPaths.join(" ") !== actualPaths.join(" ")) {
    return [
      "the package's part ORDER changed (a sorted manifest could not see this):",
      `  baseline: ${expectedPaths.join(", ")}`,
      `  actual:   ${actualPaths.join(", ")}`,
    ].join("\n");
  }

  const changed = expected
    .map((e, i) => ({ path: e.path, expected: e.sha256, actual: actual[i].sha256 }))
    .filter((c) => c.expected !== c.actual);
  if (changed.length > 0) {
    const lines = changed.map(
      (c) => `  ${c.path}\n      baseline ${c.expected}\n      actual   ${c.actual}`,
    );
    return `the CONTENT of ${changed.length} part(s) changed:\n${lines.join("\n")}`;
  }

  return null;
}
```

- [ ] **Step 4: Run the tests**

```bash
npx vitest run src/test/ooxml-manifest.test.ts --reporter=dot > "$SCRATCH/mf.log" 2>&1; echo "EXIT=$?"
grep -E "Tests " "$SCRATCH/mf.log"
```

Expected: `EXIT=0`, `Tests  8 passed`.

- [ ] **Step 5: Typecheck**

```bash
npx tsc --noEmit; echo "EXIT=$?"
```

Expected: `EXIT=0`.

- [ ] **Step 6: Commit**

```bash
git add src/test/ooxml-manifest.ts src/test/ooxml-manifest.test.ts
git commit --only src/test/ooxml-manifest.ts src/test/ooxml-manifest.test.ts -m "test(ooxml): add the ordered part-manifest helper

packageManifest reduces a package to {part path, SHA-256} in ZIP ORDER.
Ordered rather than sorted is the whole design: a sorted list cannot see
an entry reordering, and OPC readers can care which part leads a package.

formatManifestDiff names the offending part in every branch -- list
change, order change, content change. Diagnosability is why a manifest
was chosen over a committed package blob, so a bare 'bytes differ' would
have given away the reason for the decision.

The helper is shared by the gate and the regeneration script deliberately:
a manifest the two computed differently is a gate that cannot fail."
```

---

## Task 3: The regeneration script

**Files:**
- Create: `scripts/update-ooxml-manifest.ts`
- Modify: `package.json`

- [ ] **Step 1: Write the script**

Create `scripts/update-ooxml-manifest.ts`:

```ts
// scripts/update-ooxml-manifest.ts — regenerate docs/baselines/ooxml-parts.json.
//
// Run: npm run ooxml:manifest
//
// ★★★ THIS IS THE ONLY WAY TO MOVE THE BASELINE, AND THAT IS DELIBERATE. There
// is no `vitest -u` path to it. open-followups.md §216 names
// re-baselining-to-admit-your-own-change as the exact failure this fixture had
// to be designed against -- an inline snapshot would have handed that to
// anyone with a red pipeline. Regenerating must stay a decision somebody makes
// and a reviewer sees in the diff.
//
// ★ The subjects are the MEDIA-FREE packages, because that is the contract
// §216 found unpinned: both builders promise an empty `media` argument adds no
// Default entry, no part and no relationship.

import { writeFileSync } from "node:fs";
import { buildDocxPackage } from "../src/app/ooxml-docx-primitives";
import { buildPptxPackage } from "../src/app/ooxml-pptx-primitives";
import { packageManifest } from "../src/test/ooxml-manifest";

const OUT = "docs/baselines/ooxml-parts.json";

async function main() {
  const docx = await packageManifest(buildDocxPackage("<w:p/>", "", "portrait"));
  const pptx = await packageManifest(buildPptxPackage([{ xml: "<p:sld/>", media: [] }]));

  const baseline = {
    $comment:
      "Ordered part manifests for the MEDIA-FREE .docx and .pptx packages. " +
      "Regenerate ONLY with `npm run ooxml:manifest`, and only when you intend " +
      "the package to change -- see docs/open-followups.md §216.",
    docx: { parts: docx },
    pptx: { parts: pptx },
  };

  writeFileSync(OUT, `${JSON.stringify(baseline, null, 2)}\n`, "utf8");
  console.log(`wrote ${OUT}: docx ${docx.length} parts, pptx ${pptx.length} parts`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
```

- [ ] **Step 2: Add the npm script AND its description**

In `package.json`, add to `scripts`:

```json
"ooxml:manifest": "vite-node scripts/update-ooxml-manifest.ts",
```

and to `scriptsDescriptions`:

```json
"ooxml:manifest": "Regenerate the ordered OOXML part-manifest baseline (docs/baselines/ooxml-parts.json) — deliberate act only, never run to make a red pipeline pass",
```

★ Both are required. `docs:scripts:check` fails the build if a script has no description.

- [ ] **Step 3: Run it, and confirm the builders work outside jsdom**

```bash
npm run ooxml:manifest; echo "EXIT=$?"
```

Expected: `EXIT=0` and a line like `wrote docs/baselines/ooxml-parts.json: docx 5 parts, pptx 13 parts`.

★★ **If this fails with a DOM error**, the builders reach something browser-only under plain node. Do NOT work around it by hardcoding the manifest. Report the failing import — the fallback is to run the regeneration through vitest's jsdom environment as a dedicated non-test entry point, which keeps the shared-helper property Task 2 exists for. Record whichever path was taken in the commit message.

- [ ] **Step 4: Sanity-check the generated baseline by eye**

```bash
node -e "
const b = require('./docs/baselines/ooxml-parts.json');
for (const k of ['docx','pptx']) console.log(k, b[k].parts.map(p=>p.path).join('\n  '));
"
```

Expected: `[Content_Types].xml` first in both, then `_rels/.rels`, then the format's own parts. **No `word/media/` or `ppt/media/` entry, and no `image/` anywhere** — these are the media-FREE packages.

Confirm that last point explicitly:

```bash
grep -c "media/" docs/baselines/ooxml-parts.json
```

Expected: `0`.

- [ ] **Step 5: Verify the script docs are in sync**

```bash
npm run docs:scripts:check; echo "EXIT=$?"
```

Expected: `EXIT=0`. A non-zero exit means the `scriptsDescriptions` entry is missing or the generated tables need `npm run docs:scripts`.

- [ ] **Step 6: Commit**

```bash
git add scripts/update-ooxml-manifest.ts package.json docs/baselines/ooxml-parts.json
git commit --only scripts/update-ooxml-manifest.ts package.json docs/baselines/ooxml-parts.json -m "test(ooxml): generate the media-free package baseline

docs/baselines/ooxml-parts.json holds the ordered part manifest for the
media-free .docx and .pptx -- the contract open-followups §216 found
pinned by nothing but hand-written substring assertions.

Regeneration is npm run ooxml:manifest and nothing else. There is
deliberately no vitest -u path: §216 names re-baselining to admit your
own change as the failure mode this fixture had to be designed against.

Also updates any generated script tables so docs:scripts:check stays green."
```

---

## Task 4: The gate

**Files:**
- Create: `src/app/ooxml-package-manifest.test.ts`

- [ ] **Step 1: Write the gate**

Create `src/app/ooxml-package-manifest.test.ts`:

```ts
// src/app/ooxml-package-manifest.test.ts — the §216 gate.
//
// ★★★ WHY THIS EXISTS. Both builders promise that an empty `media` argument is
// ADDITIVE: no Default entry, no part, no relationship. Before this file that
// promise was pinned by hand-written substring assertions and nothing else --
// and measured on 2026-08-22, a mutant (`<Default Extension="png"/>` forced
// into the empty-media case) reddened four tests without EITHER of the two
// tests with "byte" in their names catching it by its byte comparison. The
// DOCX one compares the builder against ITSELF; the PPTX one never read
// [Content_Types].xml at all.
//
// This gate fails on ANY change to a media-free package, including the ones
// nobody thought to assert.

import { describe, expect, it } from "vitest";
import baseline from "../../docs/baselines/ooxml-parts.json";
import { buildDocxPackage } from "./ooxml-docx-primitives";
import { buildPptxPackage } from "./ooxml-pptx-primitives";
import { formatManifestDiff, packageManifest, type PartDigest } from "../test/ooxml-manifest";

const REGEN = "npm run ooxml:manifest";

async function expectMatchesBaseline(pkg: Blob, expected: readonly PartDigest[], label: string) {
  const actual = await packageManifest(pkg);
  const diff = formatManifestDiff(expected, actual);
  if (diff !== null) {
    throw new Error(
      `The media-free ${label} package no longer matches its baseline.\n\n${diff}\n\n` +
        `If this change is INTENDED, regenerate with \`${REGEN}\` and say so in the commit.\n` +
        `If it is not, you have changed what every exported ${label} contains.`,
    );
  }
  expect(diff).toBeNull();
}

describe("the media-free OOXML packages match their committed manifests", () => {
  it("docx", async () => {
    await expectMatchesBaseline(
      buildDocxPackage("<w:p/>", "", "portrait"),
      baseline.docx.parts,
      "docx",
    );
  });

  it("pptx", async () => {
    await expectMatchesBaseline(
      buildPptxPackage([{ xml: "<p:sld/>", media: [] }]),
      baseline.pptx.parts,
      "pptx",
    );
  });

  it("the baseline holds no media part, which is what makes it the media-FREE contract", () => {
    const allPaths = [...baseline.docx.parts, ...baseline.pptx.parts].map((p) => p.path);
    expect(allPaths.filter((p) => p.includes("media/"))).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it**

```bash
npx vitest run src/app/ooxml-package-manifest.test.ts --reporter=dot > "$SCRATCH/gate.log" 2>&1; echo "EXIT=$?"
grep -E "Tests " "$SCRATCH/gate.log"
```

Expected: `EXIT=0`, `Tests  3 passed` — it must pass immediately, since Task 3 generated the baseline from these same two calls.

- [ ] **Step 3: Typecheck the JSON import**

```bash
npx tsc --noEmit; echo "EXIT=$?"
```

Expected: `EXIT=0`. `tsconfig.json` already sets `"resolveJsonModule": true` (verified against `08a3b26e`), so the import typechecks with real member types. If it ever reports otherwise, do NOT silence it with `any` — a baseline that only typechecks as `any` would let a malformed one through.

- [ ] **Step 4: Commit**

```bash
git add src/app/ooxml-package-manifest.test.ts
git commit --only src/app/ooxml-package-manifest.test.ts -m "test(ooxml): gate the media-free packages against their manifests

Rides the existing unit-tests job, so no CI job and no .gitlab-ci.yml
change. Failure names the part and tells the reader how to regenerate
if the change was intended.

The third assertion pins that the baseline itself holds no media part --
without it, a regeneration run against media-BEARING packages would
quietly redefine what this gate is guarding."
```

---

## Task 5: Prove the gate catches the mutant that motivated it

**Files:** none committed. This task produces evidence, and a commit only if the evidence is bad.

★★★ **This is not optional and it is not ceremony.** §216 exists because two tests with "byte" in their names did not fail on a mutant. A gate that has not been shown to catch that same mutant has not been demonstrated to work — it has only been shown to pass, which is what the old tests did too.

- [ ] **Step 1: Record the clean state**

```bash
git status --short; git show --stat HEAD --oneline | head -3
```

Expected: clean tree.

- [ ] **Step 2: Plant the §216 content-type mutant in the DOCX builder**

Find the `[Content_Types].xml` construction in `src/app/ooxml-docx-primitives.ts` and add a hardcoded `<Default Extension="png" ContentType="image/png"/>` so it is emitted even when `media` is empty. Apply it with a node utf8 write (the file is CRLF — a `\n`-joined anchor silently no-ops):

```bash
node -e '
const fs = require("fs"), p = "src/app/ooxml-docx-primitives.ts";
let s = fs.readFileSync(p, "utf8");
const anchor = "<Types xmlns=\"http://schemas.openxmlformats.org/package/2006/content-types\">";
if (s.split(anchor).length !== 2) { console.error("ANCHOR NOT UNIQUE"); process.exit(1); }
s = s.replace(anchor, anchor + "<Default Extension=\"png\" ContentType=\"image/png\"/>");
fs.writeFileSync(p, s);
console.log("mutant planted");
'
```

- [ ] **Step 3: Run the gate and confirm it goes RED naming the part**

```bash
npx vitest run src/app/ooxml-package-manifest.test.ts --reporter=dot > "$SCRATCH/mut1.log" 2>&1; echo "EXIT=$?"
grep -E "Tests |Content_Types|no longer matches" "$SCRATCH/mut1.log"
```

Expected: non-zero exit, and the failure text names `[Content_Types].xml` with both digests. **Record the exact failure line** — it goes in the followups entry in Task 10.

- [ ] **Step 4: Revert the mutant with an inverse anchored write and prove the tree is clean**

`git checkout --` is deny-blocked here, so invert the edit:

```bash
node -e '
const fs = require("fs"), p = "src/app/ooxml-docx-primitives.ts";
let s = fs.readFileSync(p, "utf8");
const mutant = "<Default Extension=\"png\" ContentType=\"image/png\"/>";
if (s.split(mutant).length !== 2) { console.error("MUTANT NOT UNIQUE - inspect by hand"); process.exit(1); }
fs.writeFileSync(p, s.replace(mutant, ""));
console.log("mutant reverted");
'
git diff --stat
```

Expected: `git diff --stat` prints NOTHING. A non-empty diff means the revert was inexact — fix it before continuing.

- [ ] **Step 5: Plant the REORDER mutant, which is what the ordered design rests on**

Swap two adjacent entries in the DOCX `entries` array (for example `word/document.xml` and `word/styles.xml`) so the archive order changes while the part SET does not:

```bash
node -e '
const fs = require("fs"), p = "src/app/ooxml-docx-primitives.ts";
let s = fs.readFileSync(p, "utf8");
const a = "{ path: \"word/document.xml\", data: documentXml },";
const b = "{ path: \"word/styles.xml\", data: stylesXml },";
if (s.split(a).length !== 2 || s.split(b).length !== 2) { console.error("ANCHORS NOT UNIQUE"); process.exit(1); }
s = s.replace(a + "\r\n", "@@TMP@@").replace(b, a).replace("@@TMP@@", b + "\r\n");
fs.writeFileSync(p, s);
console.log("reorder mutant planted");
'
git diff --stat
```

★ If the anchors do not match (line endings, trailing whitespace, different variable names), read the array and do the swap by hand — the point is the swap, not this exact command. Confirm with `git diff` that exactly two lines moved and nothing else changed.

- [ ] **Step 6: Confirm the gate reports a REORDER**

```bash
npx vitest run src/app/ooxml-package-manifest.test.ts --reporter=dot > "$SCRATCH/mut2.log" 2>&1; echo "EXIT=$?"
grep -iE "order|Tests " "$SCRATCH/mut2.log"
```

Expected: non-zero exit and a failure naming **order**, printing both sequences. This is the evidence that ordered beat sorted — a sorted manifest would have been green here, because the part set and every digest are unchanged.

★★ **If this comes back GREEN, stop.** It means the manifest is not actually order-sensitive, and Decision 1 of the spec is unsupported. Report it rather than adjusting the test to match.

- [ ] **Step 7: Revert and prove clean**

```bash
git diff --stat            # note which lines moved
# invert the swap the same way, then:
git diff --stat
```

Expected: empty output. Then re-run the gate to confirm it is green again:

```bash
npx vitest run src/app/ooxml-package-manifest.test.ts --reporter=dot > "$SCRATCH/clean.log" 2>&1; echo "EXIT=$?"
```

Expected: `EXIT=0`.

- [ ] **Step 8: Record the evidence**

No commit. Carry both recorded failure messages into Task 10, where the §216 followups entry is closed with them.

---

## Task 6: `assetRefsInDocument`

**Files:**
- Modify: `src/app/document-asset-usage.ts`
- Test: `src/app/document-asset-usage.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `src/app/document-asset-usage.test.ts`:

```ts
describe("assetRefsInDocument", () => {
  const doc = (html: string[]): ProjectDocument => ({
    id: "d1",
    title: "t",
    blocks: html.map((h) => ({ type: "paragraph" as const, html: h })),
    createdAt: "2026-01-01",
    updatedAt: "2026-01-01",
  });

  it("counts an <img> reference in all THREE sets appropriately", () => {
    const refs = assetRefsInDocument(doc([`<img data-asset-id="a" alt="x">`]));
    expect([...refs.all]).toEqual(["a"]);
    expect([...refs.drawable]).toEqual(["a"]);
    expect([...refs.undrawable]).toEqual([]);
  });

  it("counts a <span> reference against the cap but NOT as drawable", () => {
    const refs = assetRefsInDocument(doc([`<span data-asset-id="b">label</span>`]));
    expect([...refs.all]).toEqual(["b"]);
    expect([...refs.drawable]).toEqual([]);
    expect([...refs.undrawable]).toEqual(["b"]);
  });

  it("separates the two when a document holds both", () => {
    const refs = assetRefsInDocument(
      doc([`<img data-asset-id="a">`, `<span data-asset-id="b">x</span>`]),
    );
    expect([...refs.all].sort()).toEqual(["a", "b"]);
    expect([...refs.drawable]).toEqual(["a"]);
    expect([...refs.undrawable]).toEqual(["b"]);
  });

  it("deduplicates a repeated id — the cap counts IMAGES, not references", () => {
    const refs = assetRefsInDocument(doc([`<img data-asset-id="a">`, `<img data-asset-id="a">`]));
    expect([...refs.all]).toEqual(["a"]);
    expect([...refs.drawable]).toEqual(["a"]);
  });

  it("does not treat an id as undrawable merely because ANOTHER block draws it", () => {
    // The same id on a span AND an img: it IS drawable, so it must not appear
    // in `undrawable` and inflate the count the cap message reports.
    const refs = assetRefsInDocument(
      doc([`<span data-asset-id="a">x</span>`, `<img data-asset-id="a">`]),
    );
    expect([...refs.undrawable]).toEqual([]);
  });

  it("ignores non-paragraph blocks, matching both underlying scanners", () => {
    const d: ProjectDocument = {
      id: "d2",
      title: "t",
      blocks: [{ type: "heading", level: 1, text: `<img data-asset-id="a">` }],
      createdAt: "2026-01-01",
      updatedAt: "2026-01-01",
    };
    expect([...assetRefsInDocument(d).all]).toEqual([]);
  });

  it("keeps assetIdsInDocument returning exactly the `all` set", () => {
    const d = doc([`<img data-asset-id="a">`, `<span data-asset-id="b">x</span>`]);
    expect([...assetIdsInDocument(d)].sort()).toEqual([...assetRefsInDocument(d).all].sort());
  });
});
```

★ Add `assetRefsInDocument` to the file's existing import from `./document-asset-usage`, and import `ProjectDocument` as a type if it is not already imported.

- [ ] **Step 2: Run and confirm failure**

```bash
npx vitest run src/app/document-asset-usage.test.ts --reporter=dot > "$SCRATCH/refs.log" 2>&1; echo "EXIT=$?"
grep -E "Tests |is not a function|has no exported" "$SCRATCH/refs.log"
```

Expected: FAIL — `assetRefsInDocument` is not exported.

- [ ] **Step 3: Implement it**

In `src/app/document-asset-usage.ts`, add the import and the new export. The import goes beside the existing `document-model` one:

```ts
import { IMG_TAG_RE } from "./document-export-assets";
```

★★ Verify this edge is acyclic before relying on it — `document-export-assets` reaches only `document-model` and `document-asset-images` today, and §92 records a live `settings-types` ⇄ `workspace` ⇄ `document-model` cycle in this neighbourhood:

```bash
grep -n "^import" src/app/document-export-assets.ts src/app/document-asset-images.ts
```

Then append:

```ts
/** The three ways a document's asset references can be counted, in ONE pass.
 *
 *  ★★★ THE DIVERGENCE IS THE POINT, AND MERGING THE PATTERNS WOULD DESTROY IT.
 *  Two scanners disagree about what an asset reference IS, and each is right
 *  on its own terms: `ASSET_ID_RE` above is tag-AGNOSTIC because a reference
 *  the sanitizer preserved on a non-`img` element still matters for deletion
 *  safety and the usage count, while `IMG_TAG_RE` (document-export-assets.ts)
 *  is tag-ANCHORED because an export must only fetch bytes for something it
 *  can actually draw. What was missing was anywhere that said so — a
 *  `<span data-asset-id>` consumed a cap slot, contributed to no export, and
 *  appeared in none of `inlined`/`omitted`/`missing`. open-followups §218.
 *
 *  ★★ A THIRD pattern exists and deliberately is NOT here: `ASSET_IMG_RE`
 *  (document-model.ts) yields no ids at all — it is `.test()`-only, deciding
 *  whether an image-only paragraph SURVIVES load. It is pinned by the
 *  relationship test in this module's test file instead.
 *
 *  ★ `undrawable` is computed over the WHOLE document, not per block, so an id
 *  that appears on a span in one block and an img in another is drawable and
 *  is correctly absent — otherwise the cap message would over-report. */
export type AssetRefs = {
  /** Ids on ANY element — what the per-document image cap counts. */
  all: ReadonlySet<string>;
  /** Ids on an `<img>` tag — what an export can actually draw. */
  drawable: ReadonlySet<string>;
  /** `all` minus `drawable`: holds a cap slot, exports nothing, in no bucket. */
  undrawable: ReadonlySet<string>;
};

export function assetRefsInDocument(doc: ProjectDocument): AssetRefs {
  const all = new Set<string>();
  const drawable = new Set<string>();
  for (const block of doc.blocks) {
    if (block.type !== "paragraph") continue;
    for (const id of assetIdsInBlock(block)) all.add(id);
    for (const match of block.html.matchAll(IMG_TAG_RE)) {
      if (match[1]) drawable.add(match[1]);
    }
  }
  const undrawable = new Set([...all].filter((id) => !drawable.has(id)));
  return { all, drawable, undrawable };
}
```

★ Leave `assetIdsInDocument` exactly as it is. It already returns the `all` set by the same rule, and rewriting it to delegate would add a second full scan for no behaviour change.

- [ ] **Step 4: Run the tests**

```bash
npx vitest run src/app/document-asset-usage.test.ts --reporter=dot > "$SCRATCH/refs.log" 2>&1; echo "EXIT=$?"
grep -E "Tests " "$SCRATCH/refs.log"
```

Expected: `EXIT=0`, all tests passing.

- [ ] **Step 5: Typecheck and lint**

```bash
npx tsc --noEmit; echo "EXIT=$?"
npx eslint src/app/document-asset-usage.ts src/app/document-asset-usage.test.ts; echo "EXIT=$?"
```

Expected: both `EXIT=0`.

- [ ] **Step 6: Commit**

```bash
git add src/app/document-asset-usage.ts src/app/document-asset-usage.test.ts
git commit --only src/app/document-asset-usage.ts src/app/document-asset-usage.test.ts -m "feat(documents): expose the asset-reference divergence as one helper

assetRefsInDocument returns all / drawable / undrawable in one pass. A
<span data-asset-id> consumed one of the per-document image slots,
contributed to no export and appeared in none of inlined/omitted/missing
-- and nothing anywhere said so. open-followups §218.

The two patterns are NOT merged, because each is right on its own terms:
the usage scanner is tag-agnostic for deletion safety, the export
resolver is tag-anchored because it must only fetch bytes it can draw.

undrawable is computed over the whole document rather than per block, so
an id carried by a span in one block and an img in another counts as
drawable and does not inflate what the cap message will report."
```

---

## Task 7: Pin the three-pattern relationship

**Files:**
- Test: `src/app/document-asset-usage.test.ts`

- [ ] **Step 1: Write the test**

Append to `src/app/document-asset-usage.test.ts`. It imports the two module-private patterns' behaviour indirectly where it can, and the exported one directly:

```ts
describe("the three asset-id patterns and what each deliberately does not see", () => {
  // ★★★ These three patterns are all correct and all different. This test is
  // the only place that states the differences together; without it, each is
  // documented only in its own file's docstring and a reader fixing one has no
  // way to see the other two. open-followups §218.
  //
  //   ASSET_ID_RE   (document-asset-usage.ts)   attribute on ANY element, double-quote only
  //   IMG_TAG_RE    (document-export-assets.ts) <img> tag, quote-aware, double-quote value
  //   ASSET_IMG_RE  (document-model.ts)         <img>, case-INSENSITIVE, ALL quoting styles
  //
  // ASSET_IMG_RE is not exported and yields no ids, so it is probed through
  // sanitizeProjectDocuments: a paragraph with no visible text survives load
  // only when that pattern matches.
  const survivesLoad = (html: string): boolean => {
    const [d] = sanitizeProjectDocuments([
      { id: "d", title: "t", blocks: [{ type: "paragraph", html }], createdAt: "", updatedAt: "" },
    ]);
    return (d?.blocks.length ?? 0) > 0;
  };

  const counted = (html: string): boolean =>
    assetRefsInDocument({
      id: "d",
      title: "t",
      blocks: [{ type: "paragraph", html }],
      createdAt: "",
      updatedAt: "",
    }).all.size > 0;

  const drawable = (html: string): boolean =>
    assetRefsInDocument({
      id: "d",
      title: "t",
      blocks: [{ type: "paragraph", html }],
      createdAt: "",
      updatedAt: "",
    }).drawable.size > 0;

  it("a double-quoted <img> is seen by all three", () => {
    const html = `<img data-asset-id="a">`;
    expect({ survivesLoad: survivesLoad(html), counted: counted(html), drawable: drawable(html) })
      .toEqual({ survivesLoad: true, counted: true, drawable: true });
  });

  it("a <span> is counted but never drawable — and cannot survive load alone", () => {
    const html = `<span data-asset-id="b">x</span>`;
    expect({ counted: counted(html), drawable: drawable(html) })
      .toEqual({ counted: true, drawable: false });
  });

  it("a SINGLE-quoted <img> survives load but is invisible to the other two", () => {
    // ★★ This is the divergence that matters, and it is harmless ONLY because
    // of an ordering: DOMPurify normalises quoting before the counting and
    // export patterns ever run. Task 8 pins that ordering. If this test ever
    // starts disagreeing with Task 8's, the load path was recomposed.
    const html = `<img data-asset-id='c'>`;
    expect({ survivesLoad: survivesLoad(html), counted: counted(html), drawable: drawable(html) })
      .toEqual({ survivesLoad: true, counted: false, drawable: false });
  });

  it("an UPPERCASE <IMG> survives load but is invisible to the other two", () => {
    const html = `<IMG DATA-ASSET-ID="d">`;
    expect({ survivesLoad: survivesLoad(html), counted: counted(html), drawable: drawable(html) })
      .toEqual({ survivesLoad: true, counted: false, drawable: false });
  });

  it("an EMPTY id is seen by none of them", () => {
    const html = `<img data-asset-id="">`;
    expect({ counted: counted(html), drawable: drawable(html) })
      .toEqual({ counted: false, drawable: false });
  });
});
```

★ Import `sanitizeProjectDocuments` from `./document-model` at the top of the test file.

- [ ] **Step 2: Run it**

```bash
npx vitest run src/app/document-asset-usage.test.ts --reporter=dot > "$SCRATCH/three.log" 2>&1; echo "EXIT=$?"
grep -E "Tests |AssertionError" "$SCRATCH/three.log"
```

Expected: `EXIT=0`.

★★ **If a case disagrees with the table above, the table is what is wrong — not the code.** Read the actual pattern, correct the expectation, and say so in the commit. These five rows are the claim being pinned; do not adjust the code to match a docstring.

- [ ] **Step 3: Typecheck**

```bash
npx tsc --noEmit; echo "EXIT=$?"
```

Expected: `EXIT=0`.

- [ ] **Step 4: Commit**

```bash
git add src/app/document-asset-usage.test.ts
git commit --only src/app/document-asset-usage.test.ts -m "test(documents): state what each of the three asset-id patterns misses

ASSET_ID_RE, IMG_TAG_RE and ASSET_IMG_RE are all correct and all
different, and until now each was documented only in its own file. This
is the one place that states the differences together, so a reader
fixing one can see the other two.

The single-quoted and uppercase rows are the load-bearing ones: both
survive load and are invisible to the cap and to every export. That is
harmless today only because DOMPurify normalises quoting first -- the
next task pins that ordering."
```

---

## Task 8: Pin the load-path ordering at its cause

**Files:**
- Test: `src/app/document-asset-usage.test.ts`

- [ ] **Step 1: Find the real load composition**

```bash
grep -rn "sanitizeProjectDocuments(.*)\.map(sanitizeDocumentRichFields)" src/app --include="*.ts" | grep -v "\.test\."
```

Record the call sites. Every one composes the structural pass with the rich-fields pass, in that order.

- [ ] **Step 2: Write the ordering test**

Append to `src/app/document-asset-usage.test.ts`:

```ts
describe("the load path normalises quoting BEFORE anything counts references", () => {
  // ★★★ THIS PINS A CAUSE, NOT A CONSEQUENCE. ASSET_IMG_RE accepts
  // data-asset-id='x' and a bare unquoted value; ASSET_ID_RE and IMG_TAG_RE
  // both require a double-quoted value. That divergence is harmless ONLY
  // because every load path runs
  //   sanitizeProjectDocuments(raw).map(sanitizeDocumentRichFields)
  // and the second pass is DOMPurify, which re-serialises every attribute with
  // double quotes. Recompose those two the other way round -- or persist the
  // output of the structural pass alone -- and a single-quoted reference
  // survives load while being invisible to the cap AND to every export, with
  // no error anywhere. open-followups §218.
  it("turns a single-quoted reference into one the cap and the export both see", () => {
    const raw = [
      {
        id: "d",
        title: "t",
        blocks: [{ type: "paragraph", html: `<img data-asset-id='c' alt='x'>` }],
        createdAt: "",
        updatedAt: "",
      },
    ];

    const structuralOnly = sanitizeProjectDocuments(raw);
    expect(assetRefsInDocument(structuralOnly[0]).all.size).toBe(0); // the hazard

    const loaded = structuralOnly.map(sanitizeDocumentRichFields);
    const refs = assetRefsInDocument(loaded[0]);
    expect([...refs.all]).toEqual(["c"]); // the guarantee the ordering buys
    expect([...refs.drawable]).toEqual(["c"]);
  });
});
```

★ Import `sanitizeDocumentRichFields` from `./document-rich-fields` at the top of the test file.

★★ The first assertion is the important one and is easy to delete as redundant. It is what makes the second assertion mean something: without it, the test would pass even if the structural pass already normalised quoting, and would then be pinning nothing.

- [ ] **Step 3: Run it**

```bash
npx vitest run src/app/document-asset-usage.test.ts --reporter=dot > "$SCRATCH/order.log" 2>&1; echo "EXIT=$?"
grep -E "Tests |AssertionError|expected" "$SCRATCH/order.log"
```

Expected: `EXIT=0`.

★★ **If the FIRST assertion fails** (the structural-only document already yields the id), the hazard does not exist as described — the structural pass is normalising quoting itself. Stop and report: the spec's Decision 5 would then be wrong, and this test should not be reshaped to hide that.

- [ ] **Step 4: Mutation-check that the test can fail**

Swap the composition order in the test only — `sanitizeProjectDocuments` applied to the output of `sanitizeDocumentRichFields` is not a valid program, so instead delete the `.map(sanitizeDocumentRichFields)` line and confirm the test reddens:

```bash
# temporarily change `structuralOnly.map(sanitizeDocumentRichFields)` to `structuralOnly`
npx vitest run src/app/document-asset-usage.test.ts --reporter=dot 2>&1 | grep -E "Tests "
```

Expected: RED. Restore the line and re-run to green. Do not commit the mutant.

- [ ] **Step 5: Typecheck and commit**

```bash
npx tsc --noEmit; echo "EXIT=$?"
git add src/app/document-asset-usage.test.ts
git commit --only src/app/document-asset-usage.test.ts -m "test(documents): pin the load-path ordering the quoting divergence relies on

Three patterns read data-asset-id and only one accepts single quotes and
bare values. That is safe solely because every load path runs the
structural pass first and DOMPurify second, and DOMPurify re-serialises
attributes with double quotes.

Nothing pinned that ordering. Recompose it -- or persist the structural
pass's output alone -- and a single-quoted reference survives load while
being invisible to the cap and to every export, with no error anywhere.

The first assertion (structural-only sees nothing) is what makes the
second mean anything; deleting it as redundant leaves a test that would
pass even if the ordering stopped mattering."
```

---

## Task 9: Tell the user why the cap filled

**Files:**
- Modify: `src/app/i18n.ts`, `src/app/i18n.de.ts`
- Modify: `src/app/documents-asset-section.tsx`
- Test: `src/app/documents-asset-section.test.tsx`

- [ ] **Step 1: Add the EN string**

In `src/app/i18n.ts`, directly after `assetLibraryMaxPerDocument`:

```ts
  assetLibraryMaxPerDocumentUndrawable:
    "This document already has the maximum of {0} images. {1} of these slots are held by references no export can draw.",
```

- [ ] **Step 2: Add the DE string with a node utf8 write**

★★ `i18n.de.ts` is CRLF and the Edit tool corrupts umlauts in it. Match `\r\n`, write utf8, verify the bytes back:

```bash
node -e '
const fs = require("fs"), p = "src/app/i18n.de.ts";
let s = fs.readFileSync(p, "utf8");
const anchor = "  assetLibraryMaxPerDocument: \"Dieses Dokument enthält bereits die maximale Anzahl von {0} Bildern.\",\r\n";
if (s.split(anchor).length !== 2) { console.error("ANCHOR MISS OR NOT UNIQUE"); process.exit(1); }
const added = "  assetLibraryMaxPerDocumentUndrawable: \"Dieses Dokument enthält bereits die maximale Anzahl von {0} Bildern. {1} dieser Plätze sind durch Verweise belegt, die kein Export darstellen kann.\",\r\n";
fs.writeFileSync(p, s.replace(anchor, anchor + added), "utf8");
console.log("added");
'
grep -n "assetLibraryMaxPerDocumentUndrawable" src/app/i18n.de.ts
node -e '
const s = require("fs").readFileSync("src/app/i18n.de.ts", "utf8");
const line = s.split("\r\n").find((l) => l.includes("assetLibraryMaxPerDocumentUndrawable"));
console.log(JSON.stringify(line));
'
```

Expected: the final `JSON.stringify` shows real `ä` characters (not `ä` escapes in the FILE, not `ae`), straight `"` quotes, and no NUL bytes.

- [ ] **Step 3: Verify key parity and encoding**

```bash
npx tsc --noEmit; echo "EXIT=$?"
npx vitest run src/app/i18n-encoding.test.ts --reporter=dot 2>&1 | grep -E "Tests "
```

Expected: `EXIT=0` (tsc enforces EN/DE key parity, so a missing DE key fails here), and the encoding suite green.

- [ ] **Step 4: Write the failing component test**

Append to `src/app/documents-asset-section.test.tsx` a case that fills the cap with a document holding at least one undrawable reference and asserts the new wording appears. Follow the file's existing render helper and props; the assertion is:

```tsx
expect(
  await screen.findByText(/slots are held by references no export can draw/i),
).toBeInTheDocument();
```

and the complementary case — a document whose references are all `<img>` — asserts the OLD string and the ABSENCE of the new one:

```tsx
expect(screen.getByText(/already has the maximum of/i)).toBeInTheDocument();
expect(screen.queryByText(/no export can draw/i)).not.toBeInTheDocument();
```

★★ Both cases are required. A test that only checks the new string passes if the condition is inverted, and every user would then see the undrawable wording on every full document.

- [ ] **Step 5: Run and confirm it fails**

```bash
npx vitest run src/app/documents-asset-section.test.tsx --reporter=dot > "$SCRATCH/cap.log" 2>&1; echo "EXIT=$?"
grep -E "Tests |Unable to find" "$SCRATCH/cap.log"
```

Expected: FAIL — the new text is not rendered.

- [ ] **Step 6: Wire the message**

In `src/app/documents-asset-section.tsx`, replace the boolean `capMessage` state with one carrying the count, so the message cannot claim a number it did not compute.

Change the state declaration:

```tsx
  const [capMessage, setCapMessage] = useState<number | null>(null);
```

In `insertAssets`, replace `setCapMessage(false)` with `setCapMessage(null)`, compute the refs once, and set the count when anything was skipped. The existing `present` set comes from `assetIdsInDocument(selected)`; take it from the richer helper instead:

```tsx
      const refs = assetRefsInDocument(selected);
      const present = new Set(refs.all);
```

and where the loop currently ends, after the `skipped` tally:

```tsx
      if (skipped > 0) setCapMessage(refs.undrawable.size);
```

★ Find the existing `setCapMessage(true)` call and replace it with the line above — do not add a second one.

Then the render:

```tsx
        <span role="status" className="text-xs text-ui-pink">
          {capMessage === null
            ? ""
            : capMessage > 0
              ? t(
                  lang,
                  "assetLibraryMaxPerDocumentUndrawable",
                  String(ASSET_MAX_PER_DOCUMENT),
                  String(capMessage),
                )
              : t(lang, "assetLibraryMaxPerDocument", String(ASSET_MAX_PER_DOCUMENT))}
        </span>
```

★★ Keep this `<span role="status">` ALWAYS MOUNTED with an empty string when there is nothing to say. The file's own comment records that conditionally mounting it meant neither the upload errors nor the cap message ever reached a screen reader.

★ Add `assetRefsInDocument` to the existing import from `./document-asset-usage`, and drop `assetIdsInDocument` from that import if nothing else in the file uses it — there is no `--max-warnings` gate, so an unused import ships green.

- [ ] **Step 7: Run the tests**

```bash
npx vitest run src/app/documents-asset-section.test.tsx --reporter=dot > "$SCRATCH/cap.log" 2>&1; echo "EXIT=$?"
grep -E "Tests " "$SCRATCH/cap.log"
```

Expected: `EXIT=0`, all passing including the pre-existing cases.

- [ ] **Step 8: Typecheck and lint**

```bash
npx tsc --noEmit; echo "EXIT=$?"
npx eslint src/app/documents-asset-section.tsx src/app/i18n.ts src/app/i18n.de.ts; echo "EXIT=$?"
```

Expected: both `EXIT=0`.

- [ ] **Step 9: Commit**

```bash
git add src/app/i18n.ts src/app/i18n.de.ts src/app/documents-asset-section.tsx src/app/documents-asset-section.test.tsx
git commit --only src/app/i18n.ts src/app/i18n.de.ts src/app/documents-asset-section.tsx src/app/documents-asset-section.test.tsx -m "feat(documents): say why the image cap filled when references cannot be drawn

A user at the per-document maximum whose document holds <span
data-asset-id> references saw a full cap and no explanation -- those
slots export nothing and appear in no bucket. open-followups §218.

capMessage now carries the undrawable COUNT rather than a boolean, so
the message cannot report a number it did not compute. The old wording
still renders when every reference is drawable, and both branches are
tested -- a test on the new string alone would pass with the condition
inverted.

The role=status span stays always-mounted with an empty string, per the
comment above it: conditionally mounting it once meant neither the
upload errors nor this message ever reached a screen reader."
```

---

## Task 10: Close the followups, update the docs, release

**Files:**
- Modify: `docs/open-followups.md`, `docs/AGENTS/documents.md`, `CHANGELOG.md`
- Modify: `src/app/version.ts` + `package.json`, `package-lock.json` (×2), `README.md` badge, five `docs/CODEMAPS/*.md` headers

- [ ] **Step 1: Sweep for prose the behaviour change falsified**

★★★ A behaviour change silently falsifies prose in files nobody assigned to the change, and no gate can see it. Run this and resolve EVERY hit before writing anything new:

```bash
grep -rnE "no \.docx or \.pptx byte fixture|no OOXML fixture|pinned only by their own unit tests|golden suite covers this|counts against ASSET_MAX_PER_DOCUMENT but is invisible|invisible here|two regexes that can drift" AGENTS.md docs/ src/ --include="*.md" --include="*.ts" --include="*.tsx"
```

Known stale sites this will surface, each of which must be corrected in this commit:
- `src/app/ooxml-docx-primitives.ts` — `buildDocxPackage`'s `media` docstring says its own test is "THE ONLY THING ENFORCING" the additive contract. It is no longer.
- `src/app/ooxml-pptx-primitives.ts` — the same claim on `buildPptxPackage`.
- `src/app/ooxml-pptx-primitives.test.ts` — the comment calling one test "THE ONLY PIN ON THIS BUILDER'S MEDIA-FREE BYTES".
- `src/app/document-export-assets.ts` — `IMG_TAG_RE`'s docstring, which states the `<span>` consequence as an unaddressed fact, and `documentAssetIds`' note that "nothing outside each builder's own unit test reads these bytes".
- `src/app/document-asset-usage.ts` — the header's "ONE extraction rule rather than two regexes that can drift".

★★ These are CRLF files. Patch each with a node utf8 write matching `\r\n`, and re-read the bytes to confirm.

- [ ] **Step 2: Close §216 and §218**

In `docs/open-followups.md` (LF-only), retitle both entries with `— CLOSED 2026-08-24` and rewrite each status line. §216's closure must carry the Task 5 evidence verbatim — the mutant, and the failure message the gate produced — because the entry's whole complaint was that a test named "byte" did not fail on it. §218's must state that the patterns were NOT merged and say why, so a later reader does not "finish the job" by collapsing them.

- [ ] **Step 3: Record both in `docs/AGENTS/documents.md`**

Add the manifest gate (what it covers, what it deliberately does not — the container — and that regeneration is `npm run ooxml:manifest` only) and the three-pattern rule (the table, and that `ASSET_IMG_RE` is a survival predicate, not an extractor).

★ `docs:symbols:check` gates this file: every backticked mixed-case name must exist in `src`/`scripts`/`e2e`. SCREAMING_CASE names are NOT checked, so `ASSET_ID_RE`, `IMG_TAG_RE` and `ASSET_IMG_RE` are ungated here — verify them by grep yourself.

- [ ] **Step 4: Run every gate this slice can affect**

One at a time. Never two vitest processes at once, and never through a pipe:

```bash
npx tsc --noEmit; echo "TSC=$?"
npx eslint src scripts; echo "LINT=$?"
npm run docs:scripts:check; echo "SCRIPTS=$?"
npm run docs:symbols:check; echo "SYMBOLS=$?"
npm run docs:claims:check; echo "CLAIMS=$?"
npm run size:check; echo "SIZE=$?"
npm run dup:check; echo "DUP=$?"
npm run test:run > "$SCRATCH/suite.log" 2>&1; echo "SUITE=$?"
grep -E "Test Files|Tests " "$SCRATCH/suite.log"
grep -c "Failed to start" "$SCRATCH/suite.log"
```

Expected: every exit 0, and `Failed to start` count `0`. A red suite carrying that string is machine contention, not evidence — re-run alone.

- [ ] **Step 5: Bump the version in ALL SIX places**

★★ No gate checks five of them. `src/app/version.ts` (`APP_VERSION` + `APP_BUILD_DATE`), `package.json` `version`, `package-lock.json` (**two** occurrences — the root `version` and the `packages[""]` one), the `README.md` shields badge (version **and** codename), and the `<!-- Generated: … -->` header on all five `docs/CODEMAPS/*.md`.

This is a patch-level change — new tests, one new user-facing string, no emitted OOXML byte moves — so `0.257.2`, milestone unchanged (`Shepard`).

- [ ] **Step 6: Add the CHANGELOG entry**

★ No `[session link removed]...` URL in `CHANGELOG.md` or in any MR description. Commit trailers are fine.

- [ ] **Step 7: Final verification and commit**

```bash
npm run test:run > "$SCRATCH/final.log" 2>&1; echo "SUITE=$?"
grep -E "Test Files|Tests " "$SCRATCH/final.log"
git status --short
git show --stat HEAD --oneline | head -20
```

Then commit the docs and release together, listing paths explicitly with `git commit --only`.

---

## Self-review

**Spec coverage.** Every spec section maps to a task: Decision 1 (ordered manifest) → Tasks 2–4, proved by Task 5 Step 6; Decision 2 (explicit regeneration) → Task 3; Decision 3 (clock seam, default unchanged) → Task 1; Decision 4 (visible not merged) → Tasks 6–7; Decision 5 (ordering pinned at its cause) → Task 8; the cap message → Task 9; "What this slice refuses" → Task 10 Step 2, which must state why §217/§221/§222 stay open.

**One deliberate deviation from the spec**, stated in "One refinement" above and repeated here so it is not lost: the manifest test passes no fixed date and the three package builders are not threaded, because part digests are already timestamp-independent. The seam is exercised by `zip.test.ts` directly. This narrows the change; it does not weaken the evidence, because the container is covered by the byte-identity test the seam makes possible.

**Type consistency.** `PartDigest` and `packageManifest`/`formatManifestDiff` are used with the same names and shapes in Tasks 2, 3 and 4. `AssetRefs` with fields `all`/`drawable`/`undrawable` is defined in Task 6 and consumed under those exact names in Tasks 7, 8 and 9. `capMessage` changes from `boolean` to `number | null` in Task 9 only, and every read of it in that task uses the new type.

**Known risk carried deliberately.** Task 3 Step 3 may fail if the OOXML builders reach a browser-only API under plain node. The step says to report the failing import rather than hardcode the baseline, and names the fallback. This is the one place where the plan cannot promise the outcome, so it does not pretend to.
