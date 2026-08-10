// Unit tests for the open-followups gate's parsing layer.
//
// Same discipline as `doc-claims-lib.test.mjs`: every defect the sibling gate
// shipped was a regex defect, and both were found by running it against the
// real docs rather than by reading it. Each `regression:` test names what it
// pins.
import { describe, expect, it } from "vitest";
import {
  classify,
  fencedLines,
  isClosed,
  parseEntries,
  reproCommandsIn,
  symbolsIn,
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

  // ★★ Every line below is VERBATIM from `docs/open-followups.md`; the register
  // line number is named per case. Reproduce the full extraction with:
  //   node -e "const fs=require('fs');import('./scripts/followup-claims-lib.mjs').then(L=>{
  //     for(const e of L.parseEntries(fs.readFileSync('docs/open-followups.md','utf8')))
  //       for(const c of L.reproCommandsIn(e.body.join('\n'))) console.log(c)})"
  // A synthetic `foo # bar` fixture is exactly how this class of defect survives:
  // the sibling gate's every shipped defect was a regex defect found by running
  // it against the real docs.
  const REAL_WITH_COMMENT = [
    // docs/open-followups.md:3970-3972 (§75)
    "npx vitest run src/app/use-storage-backend.test.tsx --sequence.shuffle --sequence.seed=1  # 1 failed / 62 passed",
    "npx vitest run src/app/modern-shell.test.tsx        --sequence.shuffle --sequence.seed=1  # 3 failed / 17 passed",
    "npx vitest run src/app/use-storage-backend.test.tsx src/app/modern-shell.test.tsx         # control: 83 passed",
    // docs/open-followups.md:5013 (§93)
    'grep -n  "Showing the first" src/app/export-pptx.ts src/app/doc-render-pptx.ts    # 3 lines — one is a comment',
    // docs/open-followups.md:5080-5081 (§95)
    'grep -rn ":memory:" src/app/*.test.ts        # no hits',
    'grep -n "libsql" package.json                # no hits — HTTP pipeline, not a driver',
  ];

  const REAL_WITHOUT_COMMENT = [
    "npm run build", // :3200-ish (§54)
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
    // less. This is a REAL admission — docs/open-followups.md:4972 (§92) was
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
      // docs/open-followups.md:6860 (§115), verbatim prefix.
      const [entry] = parseEntries(
        "## 115. x — open\nwhich is TRUE (`node_modules/dompurify/dist/purify.cjs.js:767` — `ALLOW_DATA_ATTR =",
      );
      const r = classify(entry, env);
      expect(r.verdict).toBe("CITE_THIRD_PARTY");
      expect(r.problems.map((p) => p.kind)).toEqual(["CITE_THIRD_PARTY"]);
    });

    it("a bare dependency filename is third-party too", () => {
      // docs/open-followups.md:6875 (§115) and :2295 (§53), verbatim.
      const [entry] = parseEntries(
        "## 53. x — open\n" +
          "`ALLOW_DATA_ATTR: false` removes the `data-*` SHORT-CIRCUIT — at `purify.cjs.js:1846` the `data-*`\n" +
          "`context.getFilename()` was removed in ESLint 10. The call at `version.js:31` is **unguarded**",
      );
      const r = classify(entry, env);
      expect(r.problems.map((p) => p.kind)).toEqual(["CITE_THIRD_PARTY", "CITE_THIRD_PARTY"]);
    });

    it("an eslint-plugin rule path is third-party", () => {
      // docs/open-followups.md:2348-2349 (§53), verbatim.
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
});
