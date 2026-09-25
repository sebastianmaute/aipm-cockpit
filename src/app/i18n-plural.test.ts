import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, beforeAll } from "vitest";
import { loadI18n, tPlural } from "./i18n";

describe("tPlural", () => {
  beforeAll(async () => {
    // The DE dictionary is lazy — an assertion on German output before this
    // resolves silently reads the EN fallback and passes for the wrong reason.
    await loadI18n("de");
  });

  it("selects the singular key only for a count of exactly one", () => {
    expect(tPlural("en-US", "activityEntriesLogged", 1, 1)).toBe("1 entry logged");
    expect(tPlural("en-US", "activityEntriesLogged", 2, 2)).toBe("2 entries logged");
  });

  // ★ ZERO is the assertion that discriminates the implementations. A naive
  // `count === 1 ?` and a correct Intl.PluralRules both pass the 1-vs-2 case
  // above; a `count > 1 ?` implementation passes it too and gets ZERO wrong.
  it("treats zero as the plural form, not the singular", () => {
    expect(tPlural("en-US", "activityEntriesLogged", 0, 0)).toBe("0 entries logged");
    expect(tPlural("de", "activityEntriesLogged", 0, 0)).toBe("0 Einträge protokolliert");
  });

  // ★★★ NEGATIVE ONE IS THE OTHER DISCRIMINATOR, AND THE HELPER SHIPPED
  // GETTING IT WRONG. CLDR's plural operands use the ABSOLUTE integer part, so
  // `new Intl.PluralRules(l).select(-1)` is "one" in all three locales while
  // the `count === 1` ternary this replaced gave the plural. The singular
  // forms hardcode the digit, so the minus sign was silently DELETED: an
  // overdue steering info-reminder at daysLeft === -1 rendered identically to
  // one due tomorrow. Found by cold review, 2026-09-07.
  // ★★ Assert -1 AND -2. Only -1 is affected (-2 is already "other"), so a
  // test written at -3 — the value a reader reaches for when checking
  // "negatives" — passes against the unfixed helper. -2 is the control that
  // proves this test is testing the boundary and not negatives in general.
  it("treats a negative count as the plural form, at the -1 boundary", () => {
    expect(tPlural("en-US", "activityEntriesLogged", -1, -1)).toBe("-1 entries logged");
    expect(tPlural("de", "activityEntriesLogged", -1, -1)).toBe("-1 Einträge protokolliert");
    expect(tPlural("en-US", "activityEntriesLogged", -2, -2)).toBe("-2 entries logged");
  });

  it("selects the German singular, which is a different stem, not a suffix drop", () => {
    expect(tPlural("de", "activityEntriesLogged", 1, 1)).toBe("1 Eintrag protokolliert");
    expect(tPlural("de", "activityEntriesLogged", 2, 2)).toBe("2 Einträge protokolliert");
  });

  // ★ This does NOT pin dictionary choice — `enGB` is `{ ...enUS }` with no
  // overrides, so it cannot distinguish "read enUS" from "read enGB and got
  // the same string". It pins that tPlural's form-selection works for the
  // "en-GB" locale tag.
  it("selects correctly for en-GB, which renders the same strings as en-US today", () => {
    expect(tPlural("en-GB", "activityEntriesLogged", 1, 1)).toBe("1 entry logged");
  });

  // ★ The count is NOT injected as {0}. THREE of the converted keys carry the
  // count in another slot (`chatAttachmentSummary` and
  // `chatAttachmentSummarySkipped` at `{1}`, `actionCommitteeInfoWhy` at `{2}`),
  // so args are forwarded verbatim and the call site passes the number wherever
  // it belongs. ★★ This said "Two" until 2026-09-08, inheriting the pair from
  // `tPlural`'s own docstring, which had named two EXAMPLES; see that docstring
  // for why the enumeration has to be done at the call sites.
  it("forwards args verbatim rather than injecting the count", () => {
    expect(tPlural("en-US", "timelogTestOk", 1, 1, "read")).toBe("Connected — 1 user, scope: read");
    expect(tPlural("en-US", "timelogTestOk", 3, 3, "read")).toBe("Connected — 3 users, scope: read");
  });
});

describe("plural key pairing", () => {
  // ★ Source scan, not a dictionary import: the assertion is about the KEY SET
  // as written, and reading it off the module would make a stranded singular
  // indistinguishable from a live one.
  // ★★ SCOPED TO THE `enUS` LITERAL, not the whole file. A bare `/^ {2}(\w+):/`
  // over `i18n.ts` also matches the two-space-indented PARAMETER NAMES in the
  // `t`/`tPlural` signatures (`lang`, `key`, `count`, `baseKey`). Harmless
  // today — none ends in `One` and none is the base of a real singular — but a
  // future `…One` key whose base collided with a parameter name would make
  // `stranded` pass falsely, which is the one thing this test is for.
  const src = readFileSync("src/app/i18n.ts", "utf8");
  const srcLines = src.split(/\r?\n/);
  const enUsStart = srcLines.findIndex((l) => l.startsWith("const enUS = {"));
  const enUsEnd = srcLines.findIndex((l, i) => i > enUsStart && l === "} as const;");
  // Non-vacuity control for the SPAN itself: a renamed declaration or a changed
  // closer would silently yield an empty slice, and every assertion below would
  // then pass over nothing.
  expect(enUsStart).toBeGreaterThanOrEqual(0);
  expect(enUsEnd).toBeGreaterThan(enUsStart + 1000);
  const keys = srcLines
    .slice(enUsStart + 1, enUsEnd)
    .flatMap((l) => {
      const m = /^ {2}([a-zA-Z0-9]+):/.exec(l);
      return m ? [m[1]] : [];
    });

  it("gives every singular key a plural sibling", () => {
    const singulars = keys.filter((k) => k.endsWith("One"));
    // Non-vacuity control: if this scan ever returns an empty set the test
    // below passes over nothing, so assert the population first. Measured
    // 42 singulars at the time this floor was raised (2026-09-07) — 30
    // leaves headroom for the population to shrink somewhat without
    // silently weakening this control back to vacuity.
    expect(singulars.length).toBeGreaterThan(30);
    const stranded = singulars.filter((k) => !keys.includes(k.slice(0, -3)));
    expect(stranded).toEqual([]);
  });

  /**
   * ★★★ THE REGISTER SAID THIS COULD NOT BE GATED, AND IT CAN. `docs/open-followups.md`
   * §415 exception D was the class where a key HAS a `…One` sibling and a call
   * site still reaches the base through a plain `t()` — the shape of BOTH live
   * defects this slice fixed. Its own text said nothing in the branch or in CI
   * detects it and the next slice should be assumed to reintroduce it. A cold
   * reviewer refuted that on 2026-09-07 by writing the scan, so here it is.
   *
   * ★★ It WOULD have caught both: at `525313da~1`, `activityEntriesLoggedOne`
   * and `timelogTestOkOne` already existed while `activity-log-panel.tsx` and
   * `timelog-settings.tsx` still called plain `t()` on the bases.
   *
   * ★★ THE ALLOWLIST IS THE WHOLE RISK, so it is asserted in BOTH directions:
   * an un-allowlisted violation fails, AND an allowlisted key that no longer
   * violates fails too. Without the second half the list silently accumulates
   * dead entries, and a dead entry is a hole — the next call site to use that
   * key is exempt for a reason that stopped being true.
   *
   * ★ Line-level, not file-level: the check drops any line that mentions
   * `tPlural`, which is what makes the variable-base call sites below pass on
   * their own line while their bare key literal is still visible to the scan.
   */
  it("routes every paired base key through tPlural, outside a documented exception", () => {
    // Each entry is a base key that legitimately reaches `t()` today.
    // ★ Keep the REASON beside the key — this list is the thing that rots.
    // ★★★ KEYED PER key@FILE, NOT PER KEY. A per-KEY allowlist exempts a base
    // key EVERYWHERE: with `storageConvertConfirm` exempted for the `confirmKey`
    // ternary, a brand-new file calling `t(lang, "storageConvertConfirm", n)`
    // stays green. 13 of the 42 pairs were globally exempt before this. The
    // file is the right granularity — a line number rots on any insertion.
    // ★ Keep the REASON beside each entry; this list is the thing that rots.
    const EXCEPTIONS: Record<string, string> = {
      // §415 exception A — i18n-free ENGINES with no `Lang` in scope. They emit
      // `{key, params}` for a surface to render much later, and pick the form
      // with a `count === 1` ternary over the two key NAMES.
      "actionChangeAggTitle@src/app/next-actions/providers/change-pending.ts": "i18n-free engine emits a key",
      "actionCommitteeInfoWhy@src/app/next-actions/providers/committee-info.ts": "i18n-free engine emits a key",
      "actionRaidWhyReviewStale@src/app/next-actions/providers/raid.ts": "i18n-free engine emits a key",
      "actionWorkloadWhyOverload@src/app/next-actions/providers/workload.ts": "i18n-free engine emits a key",
      // §415 exception B — FIXED. These four entries were two, both labelled
      // LIVE DEFECT: the singulars were authored in both languages and nothing
      // selected them, because each key is reached through
      // `ACTIVITY_KIND_TO_KEY` — a Record handed to a generic `t()` renderer —
      // and the activity log rendered "AI planned 1 allocation cells".
      // ★★ THE ENTRIES DID NOT GO AWAY WITH THE DEFECT, AND THAT IS THE POINT
      // OF A key@FILE LIST. Both keys still appear as bare literals in two
      // dispatch tables that cannot call `tPlural` on their own line: the
      // kind→key Record here, and `ACTIVITY_PLURAL` in `activity-message.ts`,
      // which is where the selection now happens. Same class as the
      // `SKIP_REASON_KEY` and `seg()` entries below — a table, not a call.
      // ★ What proves the defect is fixed is `activity-message.test.ts`, not
      // this list. A shorter allowlist would have been the WRONG signal here.
      "activityAiAllocationPlan@src/app/activity-log.ts": "kind→key dispatch Record; selection lives in activity-message.ts",
      "activityAiRaciSuggest@src/app/activity-log.ts": "kind→key dispatch Record; selection lives in activity-message.ts",
      "activityAiAllocationPlan@src/app/activity-message.ts": "ACTIVITY_PLURAL table; tPlural is called from it",
      "activityAiRaciSuggest@src/app/activity-message.ts": "ACTIVITY_PLURAL table; tPlural is called from it",
      // Variable-base helper: `seg(n, base)` calls tPlural one line above, so
      // only the bare key literal is visible on these lines.
      "diagnosticsUnitError@src/app/diagnostics-panel.tsx": "variable-base seg() helper",
      "diagnosticsUnitWarn@src/app/diagnostics-panel.tsx": "variable-base seg() helper",
      // Union + Record, rendered through tPlural at the lookup site.
      "raciSuggestSkipped@src/app/raci-suggest-modal.tsx": "SkipMessageKey union + SKIP_REASON_KEY map",
      "raciSuggestSkippedAccountable@src/app/raci-suggest-modal.tsx": "SkipMessageKey union + map",
      "raciSuggestSkippedInvalidRole@src/app/raci-suggest-modal.tsx": "SkipMessageKey union + map",
      "raciSuggestSkippedHandover@src/app/raci-suggest-modal.tsx": "SkipMessageKey union + map",
      // `confirmKey` ternary picks the base; tPlural renders it on the next line.
      "storageConvertConfirm@src/app/use-storage-file-ops.ts": "confirmKey ternary",
      "storageTursoLeaveWarn@src/app/use-storage-file-ops.ts": "confirmKey ternary",
    };

    const bases = keys
      .filter((k) => k.endsWith("One"))
      .map((k) => k.slice(0, -3))
      .filter((b) => keys.includes(b));
    expect(bases.length).toBeGreaterThan(30);

    // ★★ TWO MATCHERS, and only one of them takes exemptions.
    //  - CALL FORM `t(<lang>, "base")` is exception D itself: a paired key
    //    rendered through plain `t()`. It is ALWAYS a defect, so it has NO
    //    allowlist and must be empty.
    //  - BARE LITERAL is the wider net: unions, Records, key-picking ternaries.
    //    Those are mostly legitimate, so they carry the per-site allowlist —
    //    but the net is kept because it is the only thing that keeps §415 B's
    //    two live defects visible.
    const callForm = (b: string) =>
      new RegExp(String.raw`\bt\(\s*[A-Za-z_$][\w.$]*\s*,\s*"` + b + `"`);

    const files: string[] = [];
    const walk = (dir: string) => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const p = path.join(dir, e.name);
        if (e.isDirectory()) walk(p);
        else if (
          /\.tsx?$/.test(e.name) &&
          !/\.test\.tsx?$/.test(e.name) &&
          !/^i18n(\.de)?\.ts$/.test(e.name)
        ) {
          files.push(p);
        }
      }
    };
    walk("src/app");
    expect(files.length).toBeGreaterThan(500);

    // ★★★ POSITIVE CONTROLS, RUN BEFORE THE MEASUREMENT. A scan that matches
    // nothing passes everything, and both floors above only prove the scan READ
    // something — not that the matcher can still fire. Assert each matcher on a
    // synthetic line, and assert the call-form one does NOT fire on a mention.
    const probeKey = bases[0];
    expect(callForm(probeKey).test(`const s = t(lang, "${probeKey}", n);`)).toBe(true);
    expect(callForm(probeKey).test(`const K = { a: "${probeKey}" } as const;`)).toBe(false);

    // ★★★ PRECOMPUTED PER BASE, NOT PER LINE — AND INLINING THIS BACK INTO THE
    // LOOP REINTRODUCES A TIMEOUT, not merely a slower test. The scan is
    // O(scanned lines x bases). MEASURED 2026-09-08: 989 files, 187,767
    // scanned lines, 42 paired bases — so constructing the RegExp and the
    // quoted needle inside the innermost loop cost ~7.9 MILLION `new RegExp`
    // calls per run. That ate most of the 20s budget.
    // ★★ DO NOT read the `> 500` floor above as the file COUNT — an earlier
    // revision of this comment did exactly that and understated the work by
    // ~2x ("~500 files … four million"). It is an anti-vacuity floor, not a
    // measurement. Re-derive both with:
    //   node -e "const fs=require('fs'),p=require('path');const f=[];const w=d=>{for(const e of fs.readdirSync(d,{withFileTypes:true})){const q=p.join(d,e.name);if(e.isDirectory())w(q);else if(/\.tsx?$/.test(e.name)&&!/\.test\.tsx?$/.test(e.name)&&!/^i18n(\.de)?\.ts$/.test(e.name))f.push(q)}};w('src/app');let n=0;for(const x of f)n+=fs.readFileSync(x,'utf8').split(/\r?\n/).length;console.log(f.length,n)"
    // MEASURED on 2026-09-08, in isolation:
    //   before  tests 6.58s  (total 7.81s)
    //   after   tests 1.42s  (total 2.99s)
    // Reproduce either number with:
    //   npx vitest run src/app/i18n-plural.test.ts --reporter=dot
    // and read the `Duration` line's `tests` figure.
    // ★★ IT READ AS A FLAKE AND WAS NOT ONE. Before the hoist this test hit
    // `Test timed out in 20000ms` on THREE consecutive full-suite runs — twice
    // under `test:run`, once under `test:shuffle` — while passing in isolation
    // every time. Two of those three runs had nothing else competing for the
    // machine, which is what rules out contention: ~4M constructions is a
    // CAUSE, not a load symptom, and a faster runner only moves it back under
    // the line rather than removing it. A timeout also prints no assertion
    // text, so it reads like a broken suite rather than a slow one.
    // ★★ Hoisting changes no behaviour — same regexes, same needles, same
    // inputs — and the positive controls above still prove each matcher can
    // fire. That pairing is load-bearing: a hoist that quietly stopped the
    // scan matching would be strictly worse than the timeout it fixes, so it
    // was mutation-proved by injecting `t(lang, "bulkEditTitle", n)` into a
    // source file and confirming this test goes red naming that file and line.
    const matchers = bases.map((b) => ({ base: b, needle: `"${b}"`, re: callForm(b) }));

    const bareOffenders = new Map<string, string[]>();
    const callOffenders = new Map<string, string[]>();
    for (const f of files) {
      const rel = f.split(path.sep).join("/");
      readFileSync(f, "utf8")
        .split(/\r?\n/)
        .forEach((line, i) => {
          if (line.includes("tPlural")) return;
          for (const { base: b, needle, re } of matchers) {
            if (line.includes(needle)) {
              const k = `${b}@${rel}`;
              bareOffenders.set(k, [...(bareOffenders.get(k) ?? []), `${rel}:${i + 1}`]);
            }
            if (re.test(line)) {
              callOffenders.set(`${b}@${rel}`, [...(callOffenders.get(`${b}@${rel}`) ?? []), `${rel}:${i + 1}`]);
            }
          }
        });
    }

    // Exception D itself. No exemptions, ever.
    expect(
      [...callOffenders].map(([k, at]) => `${k} @ ${at.join(", ")}`),
      "a paired key is rendered through plain t() — convert the call site to tPlural",
    ).toEqual([]);

    const undocumented = [...bareOffenders].filter(([k]) => !(k in EXCEPTIONS));
    expect(
      undocumented.map(([k, at]) => `${k} @ ${at.join(", ")}`),
      "a key with a singular sibling is named outside tPlural in a file that is " +
        "not exempted — convert it, or add `key@file` to EXCEPTIONS with the reason",
    ).toEqual([]);

    // ★★ The other direction: a stale exemption is a HOLE, not clutter.
    const stale = Object.keys(EXCEPTIONS).filter((k) => !bareOffenders.has(k));
    expect(
      stale,
      "these key@file pairs no longer name the key — drop them from EXCEPTIONS, " +
        "or the next call site in that file is silently exempt",
    ).toEqual([]);
  });
});
