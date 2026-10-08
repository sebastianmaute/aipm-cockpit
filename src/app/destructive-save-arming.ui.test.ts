import { readFileSync, readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { SLICE_POLICY } from "./workspace-slice-policy";

/**
 * The UI half of the destructive-save arming invariant (docs/open-followups.md §293).
 *
 * `destructive-save-arming.test.ts` walks `TOOL_DEFS`, so every AI removal tool
 * must carry an arming decision. The UI surface has no such declaration, and a
 * hand-kept list of delete routes was rejected (2026-08-30 spec: whoever forgets
 * the arming call forgets the list line too, and nothing forces a new handler to
 * join it). This file DISCOVERS the routes from the code instead: every call to
 * a counted slice's setter whose argument contains a `.filter(` — the shape of a
 * removal — must sit in a function that calls `allowDestructiveSave`, or carry a
 * written reason in `UNARMED_BY_DESIGN`. A new filter-delete therefore fails here
 * until someone decides, which a registry could never force.
 *
 * ★★★ ITS BOUND. Only that SHAPE is seen. A removal written another way passes
 * unseen: a list computed elsewhere and handed to the setter (`commitBuckets`
 * in `use-budget-buckets.ts`), `setX([])`, a splice, a generic setter such as
 * the undo runner's, or a counted slice's setter handed down under another name. Those stay a by-hand review, as §293 records. And "the
 * enclosing function calls it" is a PRESENCE check, not an ordering or branch
 * check — whether the arm fires on the right path is each route's own test.
 *
 * ★ The setters are derived from `SLICE_POLICY`'s counted slices, so a newly
 * counted slice is scanned the day it is counted. Parsed with the TypeScript
 * parser, never a regex (`src/test/strip-comments.ts` records why).
 */

const APP = join(process.cwd(), "src", "app");
const ARM = "allowDestructiveSave";

/** A filter-into-setter site whose function deliberately does not arm, keyed
 *  `file#function#setter`. The reason must say why no arm is needed THERE. */
const UNARMED_BY_DESIGN: Readonly<Record<string, string>> = {
  "use-task-row-handlers.ts#onDelete#setTasks":
    "One confirmed row, and isMassDeletion needs prev - cur >= 5, so it cannot trip the guard; an arm would only " +
    "hand the bypass to the next save (§323, pinned in is-workspace-empty.test.ts).",
  "use-resource-directory.ts#purgeCalendarFor#setAbsences":
    "A helper, not a route: its two callers, handleDeleteResource and handleBulkDeleteResources, arm.",
  "use-resource-directory.ts#purgeCalendarFor#setShifts":
    "A helper, not a route: its two callers, handleDeleteResource and handleBulkDeleteResources, arm.",
  "use-reference-data.ts#onReorderDisciplines#setDisciplines":
    "A reorder: the filter drops only ids missing from prev, and the drag list passes every row's id.",
  "use-reference-data.ts#onReorderGrades#setGrades":
    "A reorder: the filter drops only ids missing from prev, and the drag list passes every row's id.",
};

interface Site { key: string; file: string; fn: string; setter: string; line: number; armed: boolean }

function countedSetters(): Set<string> {
  return new Set(
    Object.entries(SLICE_POLICY)
      .filter(([, p]) => p.counted)
      .map(([slice]) => `set${slice[0]!.toUpperCase()}${slice.slice(1)}`),
  );
}

function calleeName(call: ts.CallExpression): string | undefined {
  const e = call.expression;
  if (ts.isIdentifier(e)) return e.text;
  if (ts.isPropertyAccessExpression(e)) return e.name.text;
  return undefined;
}

function contains(node: ts.Node, pred: (n: ts.Node) => boolean): boolean {
  let found = false;
  const visit = (n: ts.Node): void => {
    if (found) return;
    if (pred(n)) { found = true; return; }
    ts.forEachChild(n, visit);
  };
  visit(node);
  return found;
}

const isFilterCall = (n: ts.Node): boolean =>
  ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && n.expression.name.text === "filter";
/** `allowDestructiveSave()`, `x.allowDestructiveSave?.()`, or the ref a hook keeps it in,
 *  `allowDestructiveSaveRef.current?.()`. Never `allowDestructiveSaveAnyway`, the user's own
 *  save-anyway, which is not a route arming itself. */
function isArmCall(n: ts.Node): boolean {
  if (!ts.isCallExpression(n)) return false;
  if (calleeName(n) === ARM) return true;
  const e = n.expression;
  return ts.isPropertyAccessExpression(e) && e.name.text === "current" && /(^|\.)allowDestructiveSaveRef$/.test(e.expression.getText());
}

/** The name a function is known by: its declaration, the variable or property it
 *  is assigned to (through a `useCallback`/`useMemo` wrapper), or the JSX prop it
 *  is passed as. Undefined for an unnamed inner callback, so the walk goes on up. */
function functionName(fn: ts.Node): string | undefined {
  if (ts.isFunctionDeclaration(fn) || ts.isMethodDeclaration(fn)) return fn.name?.getText();
  // Climb through every call the function is an ARGUMENT of (`useCallback(fn, deps)`,
  // `guardEdit(fn)`, …) to the name the result is bound to.
  let node: ts.Node = fn;
  let p: ts.Node = fn.parent;
  while (ts.isCallExpression(p) && p.arguments.some((a) => a === node)) {
    node = p;
    p = p.parent;
  }
  if (ts.isVariableDeclaration(p) && ts.isIdentifier(p.name)) return p.name.text;
  if (ts.isPropertyAssignment(p)) return p.name.getText();
  if (ts.isJsxExpression(p) && ts.isJsxAttribute(p.parent)) return p.parent.name.getText();
  return undefined;
}

/** A site named for a component (PascalCase) or the module: judged by that whole
 *  scope, where any arm would pass it, so it is refused rather than judged. */
const isUnresolved = (s: Site): boolean => s.fn === "<module>" || /^[A-Z]/.test(s.fn);

/** Every filter-into-counted-setter site in one source. Pure, so the fixture
 *  cases below can feed it text. */
function scanSource(file: string, text: string, setters: ReadonlySet<string>): Site[] {
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const sites: Site[] = [];
  const visit = (n: ts.Node): void => {
    if (ts.isCallExpression(n)) {
      const setter = calleeName(n);
      if (setter && setters.has(setter) && n.arguments.some((a) => contains(a, isFilterCall))) {
        let fn: ts.Node | undefined = n.parent;
        let name: string | undefined;
        for (; fn; fn = fn.parent) {
          if (ts.isFunctionLike(fn) && (name = functionName(fn))) break;
        }
        const fnName = name ?? "<module>";
        sites.push({
          key: `${file}#${fnName}#${setter}`,
          file,
          fn: fnName,
          setter,
          line: sf.getLineAndCharacterOfPosition(n.getStart()).line + 1,
          armed: contains(fn ?? sf, isArmCall),
        });
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return sites;
}

function scanApp(): Site[] {
  const setters = countedSetters();
  const files = (readdirSync(APP, { recursive: true }) as string[])
    .filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f))
    .sort();
  return files.flatMap((f) =>
    scanSource(relative(APP, join(APP, f)).split(sep).join("/"), readFileSync(join(APP, f), "utf8"), setters),
  );
}

describe("scanSource (the scanner itself)", () => {
  const setters = new Set(["setTasks", "setRaid"]);
  const scan = (src: string) => scanSource("x.tsx", src, setters);

  it("finds a filter-delete in a useCallback and names it by its variable", () => {
    const [site] = scan(`const del = useCallback((id) => { setTasks((p) => p.filter((t) => t.id !== id)); }, []);`);
    expect(site).toMatchObject({ fn: "del", setter: "setTasks", armed: false });
  });

  it("counts an optional or member arming call anywhere in that function", () => {
    expect(scan(`function del(id) { setTasks((p) => p.filter(Boolean)); allowDestructiveSave?.(); }`)[0]!.armed).toBe(true);
    expect(scan(`const del = (id) => { deps.allowDestructiveSave(); ws.setTasks((p) => p.filter(Boolean)); };`)[0]!.armed).toBe(true);
    expect(scan(`const del = useCallback(() => { allowDestructiveSaveRef.current?.(); setTasks((p) => p.filter(Boolean)); }, []);`)[0]!.armed).toBe(true);
  });

  it("does not count the user's own save-anyway call as an arm", () => {
    expect(scan(`function del() { allowDestructiveSaveAnyway(); setTasks((p) => p.filter(Boolean)); }`)[0]!.armed).toBe(false);
  });

  it("walks past an unnamed inner callback to the named handler", () => {
    const [site] = scan(`const onClear = () => { confirmThen(() => { setRaid((p) => p.filter(Boolean)); }); allowDestructiveSave(); };`);
    expect(site).toMatchObject({ fn: "onClear", armed: true });
  });

  // ★★ Review finding: `onClearUnlinked: guardEdit(() => { … })` left the arrow
  //   unnamed, the walk climbed to the COMPONENT, and an arm anywhere in the
  //   component then "armed" this site — deleting its own arm stayed green.
  it("names a handler passed through a wrapper call, and judges only its own body", () => {
    const [site] = scan(
      `function Comp() { allowDestructiveSaveRef.current?.(); const h = { onClear: guardEdit(() => { setRaid((p) => p.filter(Boolean)); }) }; }`,
    );
    expect(site).toMatchObject({ fn: "onClear", armed: false });
  });

  it("refuses a site that only resolves to its component", () => {
    const [site] = scan(`function Comp() { useEffect(() => { setTasks((p) => p.filter(Boolean)); }); }`);
    expect(site!.fn).toBe("Comp");
    expect(isUnresolved(site!)).toBe(true);
  });

  it("names an inline JSX handler by its prop", () => {
    const [site] = scan(`const el = <X onRemove={() => setTasks((p) => p.filter(Boolean))} />;`);
    expect(site!.fn).toBe("onRemove");
  });

  it("ignores an edit, an unlisted setter, and a filter outside the setter's argument", () => {
    expect(scan(`function e() { setTasks((p) => p.map((t) => t)); setOther((p) => p.filter(Boolean)); const k = a.filter(Boolean); setTasks(k); }`)).toEqual([]);
  });
});

describe("destructive-save arming, UI surface (§293)", () => {
  const sites = scanApp();

  // ANTI-VACUITY: a broken walk or an empty setter set would pass every check below.
  it("scans the counted setters and finds the known removal sites", () => {
    expect(countedSetters().size).toBeGreaterThanOrEqual(13);
    expect(sites.length).toBeGreaterThanOrEqual(15);
    expect(sites.map((s) => s.key)).toContain("use-raid-items.ts#handleDeleteRaidItem#setRaid");
    // The unbounded route behind a wrapper call (guardEdit), judged by its own body.
    expect(sites.filter((s) => s.key.startsWith("task-manager.tsx#onClearUnlinked#")).map((s) => s.armed)).toEqual([true, true]);
  });

  // A site that resolves to a component (PascalCase) or the module is judged by
  // that whole scope, where any arm passes it: refuse it rather than pass it.
  it("every site resolves to a named handler, not a component or the module", () => {
    const unresolved = sites.filter(isUnresolved).map((s) => `${s.file}:${s.line} ${s.fn}`);
    expect(unresolved).toEqual([]);
  });

  it("every filter-delete on a counted slice arms, or says why not", () => {
    const missing = sites
      .filter((s) => !s.armed && !(s.key in UNARMED_BY_DESIGN))
      .map((s) => `${s.file}:${s.line} ${s.fn} → ${s.setter}`);
    expect(missing, "arm with allowDestructiveSave, or add a reasoned UNARMED_BY_DESIGN entry").toEqual([]);
  });

  it("every UNARMED_BY_DESIGN entry names a live, unarmed site", () => {
    const unarmed = new Set(sites.filter((s) => !s.armed).map((s) => s.key));
    expect(Object.keys(UNARMED_BY_DESIGN).filter((k) => !unarmed.has(k))).toEqual([]);
  });
});
