// Unit tests for the open-followups gate's parsing layer.
//
// Same discipline as `doc-claims-lib.test.mjs`: every defect the sibling gate
// shipped was a regex defect, and both were found by running it against the
// real docs rather than by reading it. Each `regression:` test names what it
// pins.
import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";
import { ABSENCE_MARKERS, collectIdentifiers, isGatedSymbolName } from "./agents-symbols-lib.mjs";
import {
  ABSENCE_STATE_WORDS,
  SWEEP_SELF_FILES,
  assertedAbsentNames,
  classify,
  fencedLines,
  isClosed,
  parseEntries,
  reproCommandsIn,
  reproEntriesIn,
  stripTrailingComment,
  symbolsIn,
  toArgv,
} from "./followup-claims-lib.mjs";

const REGISTER_SAMPLE = [
  "# Open follow-ups — central register",
  "",
  "intro prose that belongs to no entry",
  "",
  "## 1. A live problem — open",
  "body of one, naming `resolveEntitySave` and `src/app/types.ts`",
  "",
  "### What is actually true",
  "a sub-heading does NOT end the entry",
  "",
  "## 2. ~~A fixed problem~~ — CLOSED post-0.212.0",
  "body of two",
  "",
  "## Decided — do not re-litigate",
  "this section is not an entry and its prose is not entry 2's body",
  "",
  "## 3. Another live one — open",
  "```bash",
  "grep -c 'foo' src/app/bar.ts",
  "```",
].join("\n");

describe("parseEntries", () => {
  const entries = parseEntries(REGISTER_SAMPLE);

  it("finds only numbered level-2 headings", () => {
    expect(entries.map((e) => e.n)).toEqual([1, 2, 3]);
  });

  it("regression: a `###` sub-heading does not end an entry", () => {
    expect(entries[0].body.join("\n")).toContain("a sub-heading does NOT end the entry");
  });

  it("regression: a non-numbered `##` section ends the entry and is not one", () => {
    // The register carries three of these. Folding their prose into the entry
    // above would attribute unrelated claims to that entry.
    expect(entries[1].body.join("\n")).not.toContain("this section is not an entry");
    expect(entries.map((e) => e.n)).not.toContain(NaN);
  });

  it("records the heading's line number for reporting", () => {
    expect(entries[0].startLine).toBe(5);
  });
});

describe("isClosed", () => {
  it("reads CLOSED and strikethrough from the heading", () => {
    expect(isClosed("A fixed problem — CLOSED post-0.212.0")).toBe(true);
    expect(isClosed("~~A fixed problem~~ — done")).toBe(true);
  });

  it("does not read the word 'closed' inside an ordinary sentence", () => {
    expect(isClosed("The popover is never closed on Escape — open")).toBe(false);
  });
});

describe("symbolsIn", () => {
  it("extracts backticked mixed-case identifiers", () => {
    expect(symbolsIn("naming `resolveEntitySave` and `x`")).toEqual(["resolveEntitySave"]);
  });

  it("regression: ignores a path — that is the citation check's job", () => {
    expect(symbolsIn("see `src/app/types.ts` for the shape")).toEqual([]);
  });
});

describe("fencedLines / reproCommandsIn", () => {
  it("returns fenced content, without the fence delimiters", () => {
    expect(fencedLines(REGISTER_SAMPLE)).toEqual(["grep -c 'foo' src/app/bar.ts"]);
  });

  it("regression: reuses the hardened fence parser, so a blockquoted fence works", () => {
    // `stripFencedBlocks` handles blockquoted, tilde and nested fences. Writing
    // a second fence parser here is how the two would drift.
    const doc = "## 9. x — open\n> ```bash\n> grep -c foo src/a.ts\n> ```";
    expect(fencedLines(doc).length).toBeGreaterThan(0);
  });

  it("keeps only allowlisted commands", () => {
    const cmds = reproCommandsIn(
      "## 9. x\n```bash\ngrep -c foo src/a.ts\nrm -rf /\nnpm run test:run\n```",
    );
    expect(cmds).toEqual(["grep -c foo src/a.ts", "npm run test:run"]);
  });

  it("★★★ never returns a command with shell metacharacters", () => {
    // These are executed. A pipe, a redirect or a `;` would be passed to a
    // shell that this harness deliberately never spawns — and a piped command
    // would report the PIPE's exit status, which is the failure mode AGENTS.md
    // records at three stars.
    const cmds = reproCommandsIn("## 9. x\n```bash\ngrep -c foo src/a.ts | wc -l\n```");
    expect(cmds).toEqual([]);
  });
});

describe("reproCommandsIn — trailing `#` comments", () => {
  const fence = (...lines) => ["## 9. x — open", "```bash", ...lines, "```"].join("\n");

  // ★★ Every line below is VERBATIM from `docs/open-followups.md`, attributed
  // by ENTRY (§N) and not by line number. ★★★ Deliberately: `check-doc-claims.mjs`
  // ratchets `path:LINE` citations across `docs/**` and the root docs, and it
  // does NOT scan `scripts/` — so a line number written here is an unratcheted
  // citation into a file this very slice inserts lines into, and AGENTS.md's
  // rule applies verbatim (an insertion invalidates every cite below it,
  // including ones written moments earlier in the same commit). The §N plus the
  // quoted string is self-verifying: grep the string.
  //
  // Enumerate today's commented lines — this is the reproduce command, and it
  // prints the COMMENTS, which the command extractor by construction cannot:
  //   node -e "const fs=require('fs');import('./scripts/followup-claims-lib.mjs').then(L=>{for(const l of L.fencedLines(fs.readFileSync('docs/open-followups.md','utf8'))){const e=L.splitTrailingComment(l.trim());if(e&&e.comment)console.log(e.comment)}})"
  //
  // A synthetic `foo # bar` fixture is exactly how this class of defect survives:
  // the sibling gate's every shipped defect was a regex defect found by running
  // it against the real docs.
  const REAL_WITH_COMMENT = [
    // §75, verbatim.
    "npx vitest run src/app/use-storage-backend.test.tsx --sequence.shuffle --sequence.seed=1  # 1 failed / 62 passed",
    "npx vitest run src/app/modern-shell.test.tsx        --sequence.shuffle --sequence.seed=1  # 3 failed / 17 passed",
    "npx vitest run src/app/use-storage-backend.test.tsx src/app/modern-shell.test.tsx         # control: 83 passed",
    // §93, verbatim.
    'grep -n  "Showing the first" src/app/export-pptx.ts src/app/doc-render-pptx.ts    # 3 lines — one is a comment',
    // §95, verbatim.
    'grep -rn ":memory:" src/app/*.test.ts        # no hits',
    'grep -n "libsql" package.json                # no hits — HTTP pipeline, not a driver',
  ];

  const REAL_WITHOUT_COMMENT = [
    "npm run build", // §54, verbatim
    "npx next start -p 3200", // (§54)
    "npx vitest run --sequence.shuffle --sequence.seed=1 --reporter=dot", // (§75)
    'npx playwright test e2e/a11y.spec.ts --project=chromium -g "Insights" --workers=1', // (§99)
    'grep -n "loadActualsCache" src/app/workspace-section.tsx', // (§122)
    'grep -n "PeopleDisclosureLabel" src/app/budget-panel-people-rows.tsx src/app/budget-panel.tsx', // (§123)
    'npx vitest run src/app/rich-text-editor.test.tsx -t "underline" --reporter=dot', // (§137)
  ];

  it("★★★ regression: no returned command carries a `#` comment", () => {
    // `#` is not in SHELL_META and the runner spawns with `shell: false`, so
    // `#`, `3`, `failed`, `/`, `17`, `passed` would all reach `npx` as literal
    // argv. There is no shell to strip them.
    const cmds = reproCommandsIn(fence(...REAL_WITH_COMMENT));
    expect(cmds).toHaveLength(REAL_WITH_COMMENT.length);
    for (const c of cmds) expect(c).not.toContain("#");
  });

  it("keeps the command part of a real commented line intact", () => {
    expect(reproCommandsIn(fence(REAL_WITH_COMMENT[0]))).toEqual([
      "npx vitest run src/app/use-storage-backend.test.tsx --sequence.shuffle --sequence.seed=1",
    ]);
    expect(reproCommandsIn(fence(REAL_WITH_COMMENT[4]))).toEqual([
      'grep -rn ":memory:" src/app/*.test.ts',
    ]);
  });

  it("leaves the register's uncommented commands byte-identical", () => {
    expect(reproCommandsIn(fence(...REAL_WITHOUT_COMMENT))).toEqual(REAL_WITHOUT_COMMENT);
  });

  it("★★ a `#` that does not begin a token is part of the argument", () => {
    // Only a BARE `#` opens a comment. Stripping on any `#` would truncate a
    // colour literal mid-argument and silently change what the command does.
    expect(reproCommandsIn(fence("grep --color=#fff -n foo src/a.ts"))).toEqual([
      "grep --color=#fff -n foo src/a.ts",
    ]);
  });

  it("★★ a `#` inside a quoted string is part of the argument", () => {
    expect(reproCommandsIn(fence("grep -n '#define' src/a.ts"))).toEqual([
      "grep -n '#define' src/a.ts",
    ]);
    expect(reproCommandsIn(fence('grep -n "#define" src/a.ts'))).toEqual([
      'grep -n "#define" src/a.ts',
    ]);
    // …and a comment AFTER a quoted `#` is still stripped.
    expect(reproCommandsIn(fence("grep -n '#define' src/a.ts   # 2 hits"))).toEqual([
      "grep -n '#define' src/a.ts",
    ]);
  });

  it("★★ drops a line whose quoting cannot be resolved", () => {
    // This list is EXECUTED. A wrongly-parsed command is worse than a missing
    // one, so an unbalanced quote is dropped rather than guessed at.
    expect(reproCommandsIn(fence('grep -n "unterminated src/a.ts # 2 hits'))).toEqual([]);
  });

  it("★★ a comment may hold shell metacharacters the command may not", () => {
    // The comment never reaches the runner, so SHELL_META is applied to the
    // STRIPPED command. Not a weakening: what executes is checked more, not
    // less. This is a REAL admission — §92 was
    // rejected outright because the `|` in its COMMENT tripped SHELL_META, so
    // a perfectly safe command was withheld.
    expect(
      reproCommandsIn(
        fence('npx vitest run src/app/document-model.test.ts -t "never snapshots"   # 1 passed | 28 skipped'),
      ),
    ).toEqual(['npx vitest run src/app/document-model.test.ts -t "never snapshots"']);
    // …while meta in the COMMAND itself is still rejected.
    expect(reproCommandsIn(fence("grep -n foo src/a.ts | wc -l  # a count"))).toEqual([]);
  });
});

describe("SWEEP_SELF_FILES", () => {
  // ★★★ THE MIRROR OF `GATE_SELF_FILES`' TESTS, AND FOR THE SAME REASON: the
  // tool cannot detect its own damage. Excluding too little makes this file's
  // verbatim register quotes vouch for the names the sweep checks; excluding too
  // much makes it scan less than it reports. Both exit 0. These tests are the
  // only detector.

  it("holds EXACTLY this sweep's three files", () => {
    // Exact membership, not "the three are in there somewhere" — a set that
    // grows too broad is invisible to every other assertion, because a real
    // source file always brings identifiers of its own.
    expect([...SWEEP_SELF_FILES].map((p) => path.basename(p)).sort()).toEqual([
      "check-followup-claims.mjs",
      "followup-claims-lib.mjs",
      "followup-claims-lib.test.mjs",
    ]);
  });

  it("names files that exist on disk", () => {
    // A typo'd or directory-named entry excludes nothing, and would surface far
    // later as a confusing leak of somebody else's fixture name.
    for (const p of SWEEP_SELF_FILES) {
      expect(fs.existsSync(p), `${p} is not on disk`).toBe(true);
      expect(fs.statSync(p).isFile(), `${p} is not a file`).toBe(true);
    }
  });

  it("★★★ every entry is load-bearing — each holds a gated name the scan lacks", () => {
    // Derived, never a sentinel list: a hardcoded name stops being unique the
    // moment an unrelated file reuses it, and the tempting repair (drop that
    // name) leaves an entry with no separating input at all. If an entry stops
    // contributing a gated name, its exclusion has become dead weight.
    const known = new Set();
    collectIdentifiers("scripts", known, SWEEP_SELF_FILES);
    for (const file of SWEEP_SELF_FILES) {
      const own = new Set();
      for (const m of fs.readFileSync(file, "utf8").matchAll(/[A-Za-z_$][A-Za-z0-9_$]*/g)) {
        if (!known.has(m[0]) && isGatedSymbolName(m[0])) own.add(m[0]);
      }
      expect(
        own.size,
        `${path.basename(file)} contributes no gated name the scan lacks — excluding it changes nothing`,
      ).toBeGreaterThan(0);
    }
  });

  it("★★ excluding them still leaves the rest of scripts/ scanned", () => {
    // An exclusion that swallows too much passes everything. Prove it scanned.
    const known = new Set();
    collectIdentifiers("scripts", known, SWEEP_SELF_FILES);
    expect(known.size).toBeGreaterThan(500);
    expect(known.has("stripFencedBlocks")).toBe(true);
  });

  it("★★★ quotes the register's own symbols back at it — the hazard, re-measured", () => {
    // This is the reproduce command for the exclusion, and it does not rot: it
    // recomputes the overlap between the gated names the OPEN entries claim and
    // the names this harness writes into the scanned tree. Every member is a
    // name whose deletion from `src/` this sweep would stop reporting, because
    // its own fixture would vouch for it — silently, at exit 0.
    //
    // ★ An EMPTY overlap would not be reassuring, it would mean this assertion
    // has stopped exercising anything, so it is asserted non-empty rather than
    // pinned to a count that moves with the register.
    const text = fs.readFileSync("docs/open-followups.md", "utf8");
    const named = new Set();
    for (const e of parseEntries(text).filter((x) => !isClosed(x.title))) {
      for (const s of symbolsIn(e.body.join("\n"))) named.add(s);
    }
    const harness = new Set();
    for (const f of SWEEP_SELF_FILES) {
      for (const m of fs.readFileSync(f, "utf8").matchAll(/[A-Za-z_$][A-Za-z0-9_$]*/g)) {
        harness.add(m[0]);
      }
    }
    const overlap = [...named].filter((n) => harness.has(n));
    expect(overlap.length, "the harness no longer quotes any gated register name").toBeGreaterThan(
      0,
    );
    // ★★ And the exclusion must actually cover them: scanning `scripts/` WITH
    // the harness included resolves every one of these names, which is exactly
    // the false vouching the exclusion removes.
    const withHarness = new Set();
    collectIdentifiers("scripts", withHarness);
    for (const n of overlap) {
      expect(withHarness.has(n), `${n} is not the hazard this test claims`).toBe(true);
    }
  });

  it("★★ `alsoExclude` actually removes names the default scan would keep", () => {
    // The parameter is the whole fix. Without this, a `collectIdentifiers` that
    // silently ignored its third argument would leave every test above green.
    const withAll = new Set();
    const withoutSelf = new Set();
    collectIdentifiers("scripts", withAll);
    collectIdentifiers("scripts", withoutSelf, SWEEP_SELF_FILES);
    expect(withAll.size).toBeGreaterThan(withoutSelf.size);
  });
});

describe("reproEntriesIn — the register's own expected outcome", () => {
  it("★★★ keeps the trailing comment instead of discarding it", () => {
    // ★★★ THIS IS WHY THE COMMENT IS RETAINED. docs/open-followups.md (§95),
    // verbatim: "grep -rn \":memory:\" src/app/*.test.ts        # no hits".
    // grep exits 1 on no match, so the register's ONLY statement that exit 1 is
    // correct here lives in the comment — thrown away, the runner reported this
    // intact evidence as rotted.
    expect(reproEntriesIn('## 9. x — open\n```bash\ngrep -rn ":memory:" src/app/*.test.ts        # no hits\n```')).toEqual([
      { cmd: 'grep -rn ":memory:" src/app/*.test.ts', comment: "# no hits" },
    ]);
  });

  it("carries an empty comment when the line has none", () => {
    expect(reproEntriesIn("## 9. x — open\n```bash\nnpm run build\n```")).toEqual([
      { cmd: "npm run build", comment: "" },
    ]);
  });
});

describe("toArgv", () => {
  // ★★★ THE MOST SAFETY-CRITICAL FUNCTION IN THE LIBRARY: it decides what
  // reaches `spawnSync`. It was module-local to the CLI — a file that reads the
  // register and `process.exit`s at import — so nothing could import it and
  // nothing tested it, while `stripTrailingComment` beside it had ten tests.

  it("tokenizes a quoted argument as ONE argument", () => {
    // docs/open-followups.md (§93), verbatim — note the DOUBLE space after
    // `-n`, which is what a naive `split(/\s+/)` and a naive `split(" ")`
    // disagree about. Splitting on whitespace instead searches for `"Showing`
    // in files named `the` and `first"`, and grep's exit 2 on the missing files
    // was reported as a reproduce command that had gone stale.
    expect(
      toArgv('grep -n  "Showing the first" src/app/export-pptx.ts src/app/doc-render-pptx.ts'),
    ).toEqual([
      "grep",
      "-n",
      "Showing the first",
      "src/app/export-pptx.ts",
      "src/app/doc-render-pptx.ts",
    ]);
  });

  it("★★ `\"\"` is a real empty argument, not nothing", () => {
    // An emptiness test instead of the `started` flag drops it silently, and
    // the child then receives a DIFFERENT command than the register shows.
    expect(toArgv('grep -c "" src/a.ts')).toEqual(["grep", "-c", "", "src/a.ts"]);
  });

  it("★★★ returns null on an unbalanced quote rather than guessing", () => {
    // This list is EXECUTED. Splitting a half-quoted line yields a command
    // nobody wrote; UNRUNNABLE is the honest report.
    expect(toArgv('grep -n "unterminated src/a.ts')).toBeNull();
    expect(toArgv("grep -n 'unterminated src/a.ts")).toBeNull();
  });

  it("returns null on a trailing backslash, which escapes nothing", () => {
    expect(toArgv("grep -n foo src/a.ts \\")).toBeNull();
  });

  it("returns null on an empty command", () => {
    expect(toArgv("   ")).toBeNull();
  });

  it("a backslash is literal inside single quotes, an escape elsewhere", () => {
    expect(toArgv("grep -n 'a\\b' src/a.ts")).toEqual(["grep", "-n", "a\\b", "src/a.ts"]);
    expect(toArgv('grep -n "a\\"b" src/a.ts')).toEqual(["grep", "-n", 'a"b', "src/a.ts"]);
  });

  it("★★★ DIFFERENTIAL: agrees with the comment splitter on where a quote span ends", () => {
    // The two carry SEPARATE implementations of the same POSIX quote model, and
    // a comment asserting they "cannot disagree" enforces nothing — this does.
    // If they part company, a `#` inside a quoted span is data to one and a
    // comment to the other, and the command that runs is not the command the
    // register shows.
    const cases = [
      'grep -n "#define" src/a.ts',
      "grep -n '#define' src/a.ts",
      'grep -n "a b" src/a.ts',
      "grep -n 'a\\b' src/a.ts",
      'grep -n "a\\"b" src/a.ts',
      'grep -n "unterminated src/a.ts',
      "grep -n 'unterminated src/a.ts",
      'grep -n "closed" then "unclosed src/a.ts',
      "grep -c foo src/a.ts",
    ];
    for (const c of cases) {
      const quotingResolves = stripTrailingComment(c) !== null;
      expect(toArgv(c) !== null, `disagreement on: ${c}`).toBe(quotingResolves);
    }
  });

  it("★ a `*` reaches the child literally — there is no shell to expand it", () => {
    expect(toArgv('grep -rn ":memory:" src/app/*.test.ts')).toEqual([
      "grep",
      "-rn",
      ":memory:",
      "src/app/*.test.ts",
    ]);
  });
});

describe("classify", () => {
  const env = {
    knownSymbols: new Set(["resolveEntitySave"]),
    resolve: (p) => (p === "src/app/types.ts" ? [p] : []),
    lineCounts: new Map([["src/app/types.ts", 900]]),
  };

  it("CLEAN when every symbol resolves and every path exists", () => {
    const [entry] = parseEntries("## 1. x — open\nnames `resolveEntitySave` in `src/app/types.ts`");
    expect(classify(entry, env).verdict).toBe("CLEAN");
  });

  it("SYMBOL_MISSING names the symbol that vanished", () => {
    // ★★ The name is deliberately INERT. `env.knownSymbols` holds exactly one
    // entry, so ANY other identifier serves as "a symbol that vanished" — the
    // fixture's flavour is free, and that freedom is a trap. A test fixture must
    // never reuse a name the docs discuss as ABSENT: doing so makes that name
    // "exist" for `check-agents-symbols.mjs`, so a future doc claiming it is
    // real would pass unchallenged. This fixture used to be the docs' canonical
    // never-existed example and masked exactly that case.
    const [entry] = parseEntries("## 1. x — open\nnames `vanishedHelper` today");
    const r = classify(entry, env);
    expect(r.verdict).toBe("SYMBOL_MISSING");
    expect(r.problems[0].detail).toBe("vanishedHelper");
  });

  it("PATH_MISSING when a named file has left the tree", () => {
    const [entry] = parseEntries("## 1. x — open\nlives in `src/app/deleted.ts`");
    expect(classify(entry, env).verdict).toBe("PATH_MISSING");
  });

  it("CITE_BROKEN when a cite is past end of file", () => {
    const [entry] = parseEntries("## 1. x — open\nsee `src/app/types.ts:5000`");
    expect(classify(entry, env).verdict).toBe("CITE_BROKEN");
  });

  it("NO_MACHINE_CLAIM when the entry asserts nothing checkable", () => {
    // Not a failure. A large share of the register is a11y and CSS-geometry
    // work that no static check can judge; saying so routes it to a probe
    // instead of pretending it passed.
    const [entry] = parseEntries("## 1. x — open\nthe spacing feels wrong on dark schemes");
    expect(classify(entry, env).verdict).toBe("NO_MACHINE_CLAIM");
  });

  it("★★ CLEAN is not a pass — it means nothing static could disprove it", () => {
    const [entry] = parseEntries("## 1. x — open\nnames `resolveEntitySave`");
    expect(classify(entry, env).needsProbe).toBe(true);
  });

  describe("CITE_THIRD_PARTY", () => {
    // ★★ Every fixture below quotes `docs/open-followups.md` verbatim. The
    // register's only unresolvable citations today are dependency internals —
    // reproduce with the classify sweep in the task notes, or:
    //   grep -n "purify.cjs.js\|lib/util/eslint.js\|version\.js" docs/open-followups.md

    it("a `node_modules/` cite is third-party, not repo debt", () => {
      // §115, verbatim prefix.
      const [entry] = parseEntries(
        "## 115. x — open\nwhich is TRUE (`node_modules/dompurify/dist/purify.cjs.js:767` — `ALLOW_DATA_ATTR =",
      );
      const r = classify(entry, env);
      expect(r.verdict).toBe("CITE_THIRD_PARTY");
      expect(r.problems.map((p) => p.kind)).toEqual(["CITE_THIRD_PARTY"]);
    });

    it("a bare dependency filename is third-party too", () => {
      // §115 and §53, verbatim.
      const [entry] = parseEntries(
        "## 53. x — open\n" +
          "`ALLOW_DATA_ATTR: false` removes the `data-*` SHORT-CIRCUIT — at `purify.cjs.js:1846` the `data-*`\n" +
          "`context.getFilename()` was removed in ESLint 10. The call at `version.js:31` is **unguarded**",
      );
      const r = classify(entry, env);
      expect(r.problems.map((p) => p.kind)).toEqual(["CITE_THIRD_PARTY", "CITE_THIRD_PARTY"]);
    });

    it("an eslint-plugin rule path is third-party", () => {
      // §53, verbatim.
      const [entry] = parseEntries(
        "## 53. x — open\n" +
          "- ★ Three further unguarded call sites exist in `eslint-plugin-react` — `lib/util/eslint.js:18`,\n" +
          "  `rules/forward-ref-uses-ref.js:60`, `rules/jsx-filename-extension.js:64` — but those rules are not",
      );
      const r = classify(entry, env);
      expect(r.problems.map((p) => p.kind)).toEqual([
        "CITE_THIRD_PARTY",
        "CITE_THIRD_PARTY",
        "CITE_THIRD_PARTY",
      ]);
    });

    it("★★ still REPORTS them — they rot on any dependency upgrade", () => {
      // The sibling gate's `thirdParty` bucket exists because one of these
      // carries a content hash in its filename, so it WILL break and nothing
      // will announce it. Classified, never dropped.
      const [entry] = parseEntries("## 115. x — open\nsee `node_modules/dompurify/dist/purify.cjs.js:767`");
      const r = classify(entry, env);
      expect(r.problems).toHaveLength(1);
      expect(r.problems[0].detail).toContain("node_modules/dompurify/dist/purify.cjs.js:767");
    });

    it("a broken REPO cite is still CITE_BROKEN", () => {
      const [entry] = parseEntries("## 1. x — open\nsee `src/app/types.ts:5000`");
      expect(classify(entry, env).verdict).toBe("CITE_BROKEN");
    });

    it("★★ never masks a real problem in the verdict", () => {
      // `problems[0].kind` would have let a third-party cite standing earlier in
      // the entry hide the repo debt behind it — the under-reporting direction.
      const [entry] = parseEntries(
        "## 1. x — open\nsee `node_modules/dompurify/dist/purify.cjs.js:767` and `src/app/types.ts:5000`",
      );
      const r = classify(entry, env);
      expect(r.problems.map((p) => p.kind)).toEqual(["CITE_THIRD_PARTY", "CITE_BROKEN"]);
      expect(r.verdict).toBe("CITE_BROKEN");
    });
  });

  describe("PATH_THIRD_PARTY", () => {
    // A dependency PATH is exactly as unresolvable-by-design as a dependency
    // CITE, and for the same reason: the resolver walks src/scripts/e2e, so
    // nothing under `node_modules/` could ever resolve. Counting it as repo debt
    // inflates the one number a human is meant to act on.

    it("a `node_modules/` path is third-party, not repo debt", () => {
      // docs/open-followups.md (§68), verbatim: the file EXISTS on disk, and the
      // register says so in the same breath — "a dependency file, never in this
      // repo". It was reported PATH_MISSING all the same.
      const [entry] = parseEntries(
        "## 68. x — open\n" +
          "Tailwind's preflight sets `border-collapse: collapse` on every `<table>` (Tailwind's own\n" +
          "`node_modules/tailwindcss/preflight.css`, the `table { … border-collapse: collapse; }` reset —\n" +
          "a dependency file, never in this repo)",
      );
      const r = classify(entry, env);
      expect(r.verdict).toBe("PATH_THIRD_PARTY");
      expect(r.problems.map((p) => p.kind)).toEqual(["PATH_THIRD_PARTY"]);
      expect(r.problems[0].detail).toContain("node_modules/tailwindcss/preflight.css");
    });

    it("★★ still REPORTS it — dependency paths rot on any upgrade", () => {
      const [entry] = parseEntries("## 68. x — open\nsee `node_modules/tailwindcss/preflight.css`");
      expect(classify(entry, env).problems).toHaveLength(1);
    });

    it("★★ never masks a real problem in the verdict", () => {
      // The same under-reporting direction CITE_THIRD_PARTY already guards. A
      // third-party path standing FIRST must not become the verdict while real
      // repo debt sits behind it.
      const [entry] = parseEntries(
        "## 68. x — open\nsee `node_modules/tailwindcss/preflight.css` and `src/app/deleted.ts`",
      );
      const r = classify(entry, env);
      expect(r.problems.map((p) => p.kind)).toEqual(["PATH_THIRD_PARTY", "PATH_MISSING"]);
      expect(r.verdict).toBe("PATH_MISSING");
    });
  });
});

describe("assertedAbsentNames", () => {
  // ★★★ THE VOCABULARY IS REUSED FROM `ABSENCE_MARKERS`; THE GRAMMAR IS NOT.
  // Measured against the real register, `markedNear`'s PROXIMITY rule does not
  // transfer to this document: at the shared 240-char window, 54 of 957 backticked
  // mentions in the 92 open entries sit near a marker and **48 of those name a
  // thing that EXISTS** — every one of which would have become a false
  // "this follow-up is done" verdict. The register packs many names onto one
  // table row, so a negation and an unrelated live symbol routinely sit ~15 chars
  // apart (§7's own row: "no `src/app/form-field.tsx` exists. | **A3** |
  // `resetAllCols` chains…"). Proximity therefore cannot attribute a negation to
  // a name here. These patterns ANCHOR instead: the marker must CAPTURE the name
  // it negates, so attribution is exact and no window constant is involved.

  it("derives its state words from the shared ABSENCE_MARKERS list", () => {
    // Not a second vocabulary. The SCREAMING members of the shared list are
    // exactly its bare state words; a word added there flows through here.
    expect(ABSENCE_STATE_WORDS.length).toBeGreaterThan(0);
    for (const w of ABSENCE_STATE_WORDS) {
      expect(ABSENCE_MARKERS.map((m) => m.toLowerCase())).toContain(w);
    }
  });

  it("reads `no <name> exists`", () => {
    // docs/open-followups.md (§7), verbatim — the A1 row of the "Still real" table.
    const prose =
      "| **A1** | `Field()` wrapper re-declared identically in `task-form-fields.tsx` + " +
      "`project-form-fields.tsx` → extract a shared `form-field.tsx` | Both files still declare " +
      "`function Field`; no `src/app/form-field.tsx` exists. |";
    expect([...assertedAbsentNames(prose).keys()]).toContain("src/app/form-field.tsx");
  });

  it("reads `<name> was deleted`", () => {
    // docs/open-followups.md (§7), verbatim.
    const prose =
      "★ The source document `docs/refactor-review-2026-06-19.md` was **deleted in the same " +
      "cleanup** — it was git-tracked, so `git show HEAD:docs/refactor-review-2026-06-19.md` returns it";
    expect([...assertedAbsentNames(prose).keys()]).toContain("docs/refactor-review-2026-06-19.md");
  });

  it("reads a list ending `are all missing`", () => {
    // docs/open-followups.md (§44), verbatim.
    const prose =
      "Three blockers remain, all re-verified 2026-07-31: `graph-recurrence.ts` / " +
      "`use-event-calendar-push.ts` / `calendar-event-pull.ts` / `use-event-calendar-pull.ts` are " +
      "all **missing**; `CalendarEntityType` (`settings-types.ts:493`) is still";
    const names = [...assertedAbsentNames(prose).keys()];
    expect(names).toEqual(
      expect.arrayContaining([
        "graph-recurrence.ts",
        "use-event-calendar-push.ts",
        "calendar-event-pull.ts",
        "use-event-calendar-pull.ts",
      ]),
    );
    // ★ The name AFTER the marker is a live claim, not part of the negated list.
    expect(names).not.toContain("CalendarEntityType");
  });

  it("★★★ does NOT read `no <name> <noun>` — in this register that means 'not used HERE'", () => {
    // This is the whole reason the shared marker list could not be lifted. All
    // four lines below are VERBATIM register prose, and every one names a symbol
    // that EXISTS; treating them as absence assertions would emit four false
    // "the follow-up is done" verdicts. Measured: the bare `no <name>` shape
    // matched 15 existing symbols across the register and only 2 genuinely
    // absent ones.
    const usageClaims = [
      // §8 — about one file's imports, not about the repo.
      "the file imports `useDismissable` and nothing else. There is no `useFocusTrap` import and never has been.",
      // §120 — about one file.
      "**There is no `signal` key in that argument object**, and the file creates no `AbortController` anywhere",
      // §12 — a scoped statement about one tool.
      "★ This is a read tool with no `isReadOnly` guard (correct — reads need none)",
      // §96 — about a document, not the codebase.
      "so a document with no `dataSection` block never loads it",
    ];
    for (const prose of usageClaims) {
      expect([...assertedAbsentNames(prose).keys()]).toEqual([]);
    }
  });

  it("★★★ does NOT read the generic prescriptive markers the shared list carries", () => {
    // `Do NOT` / `do NOT` / `not built` fired on 20 mentions across the register,
    // ALL of them existing code, because this register is full of prescriptive
    // prose. They are excluded structurally — no pattern here can use a marker
    // that does not name its own target — rather than by a curated denylist.
    const prescriptive = [
      // §55, verbatim — `ToggleButton` exists and is being recommended.
      "Thirteen controls do NOT use that primitive and were left as they were. The shared `ToggleButton`",
      // §132, verbatim — every name here is live code; only the FIX is unbuilt.
      "The real fix is an edit-side twin of `undoLabelDeleteCount`. Deliberately not built: it would relabel",
      // §28, verbatim — "a boundary that does not exist" is not about `csvToWorkspace`.
      "Closing this column needs a **post-decode hook** in `csvToWorkspace` / `markdownToWorkspace` " +
        "— but at a boundary that does not exist today",
    ];
    for (const prose of prescriptive) {
      expect([...assertedAbsentNames(prose).keys()]).toEqual([]);
    }
  });
});

describe("classify — an entry that ASSERTS a thing is absent", () => {
  const env = {
    knownSymbols: new Set(["resolveEntitySave"]),
    resolve: (p) => (p === "src/app/types.ts" ? [p] : []),
    lineCounts: new Map([["src/app/types.ts", 900]]),
  };

  // docs/open-followups.md (§7), verbatim. The absence IS the follow-up's
  // premise — the entry proposes extracting that shared file — so reporting
  // "this path is missing" as rot is backwards.
  const S7_A1 =
    "## 7. Surviving dedup seams — open\n" +
    "| **A1** | `Field()` wrapper re-declared identically in `task-form-fields.tsx` + " +
    "`project-form-fields.tsx` → extract a shared `form-field.tsx` | Both files still declare " +
    "`function Field`; no `src/app/form-field.tsx` exists. |";

  it("does not report a path the entry itself says does not exist", () => {
    const r = classify(parseEntries(S7_A1)[0], env);
    expect(r.problems.map((p) => p.detail)).not.toContain("src/app/form-field.tsx");
  });

  it("★ suppresses the bare filename the same claim negates", () => {
    // The A1 row names the file twice — once as the proposal (`form-field.tsx`)
    // and once as the verified absence (`src/app/form-field.tsx`). They are one
    // file; a suffix match keeps the two mentions from disagreeing.
    const r = classify(parseEntries(S7_A1)[0], env);
    expect(r.problems.map((p) => p.detail)).not.toContain("form-field.tsx");
  });

  it("★★★ ASSERTED_ABSENT_NOW_PRESENT once the thing appears", () => {
    // SYNTHETIC BY NECESSITY, and that is a measurement, not an omission: no
    // open entry in the register today asserts the absence of something that
    // exists (swept 2026-08-10 — 7 anchored assertions, 7 still absent). This
    // pins the verdict so it cannot silently become unreachable. The scenario is
    // the real one: someone performs §7's A1 extraction and the entry is DONE.
    const present = { ...env, resolve: (p) => (p === "src/app/form-field.tsx" ? [p] : []) };
    const r = classify(parseEntries(S7_A1)[0], present);
    expect(r.verdict).toBe("ASSERTED_ABSENT_NOW_PRESENT");
    // ★ NOT `problems[0]` — this env resolves only the one file, so the row's
    // other real filenames report PATH_MISSING ahead of it. That the verdict is
    // still the flip is the priority tier working, and asserting a position here
    // would pin the fixture's incidental shape instead of the behaviour.
    const flip = r.problems.find((p) => p.kind === "ASSERTED_ABSENT_NOW_PRESENT");
    expect(flip.detail).toContain("src/app/form-field.tsx");
  });

  it("★★★ a symbol asserted absent that now resolves flips too", () => {
    // `resolveEntitySave` is reused from this file's own env deliberately: it is
    // already a known-present name here, so the fixture introduces no new
    // identifier into the scanned tree.
    const [entry] = parseEntries("## 1. x — open\nverified: no `resolveEntitySave` exists.");
    expect(classify(entry, env).verdict).toBe("ASSERTED_ABSENT_NOW_PRESENT");
  });

  it("★★ outranks other problems in the verdict — it may mean the entry is DONE", () => {
    // "This entry no longer applies" is the most valuable thing the sweep can
    // say. A stale symbol name standing earlier must not hide it.
    const [entry] = parseEntries(
      "## 1. x — open\nnames `vanishedHelper`, and verified: no `resolveEntitySave` exists.",
    );
    const r = classify(entry, env);
    expect(r.problems.map((p) => p.kind)).toContain("SYMBOL_MISSING");
    expect(r.verdict).toBe("ASSERTED_ABSENT_NOW_PRESENT");
  });

  it("★★ a plain missing symbol is untouched by the absence logic", () => {
    // The dangerous direction is suppression. An entry with no absence assertion
    // must classify exactly as before.
    const [entry] = parseEntries("## 1. x — open\nnames `vanishedHelper` today");
    expect(classify(entry, env).verdict).toBe("SYMBOL_MISSING");
  });
});
