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
 * Since 2026-10-08 a removal SHAPE is any of: a `.filter(` or `.splice(` in the
 * setter's value, a value or updater that results in `[]`, or a local variable
 * initialised by a `.filter(`/`.splice(` and handed to the setter. Since batch 21
 * also a COMMITTER: a setter handed a parameter of its own function, so a list
 * computed by any caller passes through it (`commitBuckets` in
 * `use-budget-buckets.ts` is the one today; `isParameterHandOff` says what it
 * does not see).
 *
 * ★★★ ITS BOUND. A removal written another way passes unseen: a committer that
 * copies its parameter into a local before handing it on, a committer whose
 * parameter is destructured, a setter handed a parameter of an OUTER function, a
 * rebuild accumulator (`const next = []` plus a push per kept row) that skips a
 * row, a conditional clear (`setX(cond ? [] : p)`), a local declared in an OUTER
 * function (the lookup reads the nearest function only, and takes the first
 * same-named declaration in it, nested closures included), a generic setter such
 * as the undo runner's, or a counted slice's setter handed down under another name. Those stay a by-hand review, as §293 records. And "the
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
 *  `file#function#setter`. The reason must say why no arm is needed THERE, and
 *  `sites` is how many unarmed sites the key covers: a second filter-delete added
 *  under an exempt key then fails until someone reviews it and raises the count. */
const UNARMED_BY_DESIGN: Readonly<Record<string, { sites: number; reason: string }>> = {
  "use-task-row-handlers.ts#onDelete#setTasks": {
    sites: 1,
    reason:
      "One confirmed row, and isMassDeletion needs prev - cur >= 5, so it cannot trip the guard; an arm would only " +
      "hand the bypass to the next save (§323, pinned in is-workspace-empty.test.ts).",
  },
  "use-resource-directory.ts#purgeCalendarFor#setAbsences": {
    sites: 1,
    reason: "A helper, not a route: its two callers, handleDeleteResource and handleBulkDeleteResources, arm.",
  },
  "use-resource-directory.ts#purgeCalendarFor#setShifts": {
    sites: 1,
    reason: "A helper, not a route: its two callers, handleDeleteResource and handleBulkDeleteResources, arm.",
  },
  "use-reference-data.ts#onReorderDisciplines#setDisciplines": {
    sites: 1,
    reason: "A reorder: the filter drops only ids missing from prev, and the drag list passes every row's id.",
  },
  "use-reference-data.ts#onReorderGrades#setGrades": {
    sites: 1,
    reason: "A reorder: the filter drops only ids missing from prev, and the drag list passes every row's id.",
  },
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

const isMethodCall = (name: string) => (n: ts.Node): boolean =>
  ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression) && n.expression.name.text === name;
const isFilterCall = isMethodCall("filter");
const isSpliceCall = isMethodCall("splice");
const isEmptyArray = (n: ts.Node): boolean => ts.isArrayLiteralExpression(n) && n.elements.length === 0;

/** Strip parentheses and `as`/`satisfies`/`!` wrappers, so `([] as Task[])` reads as `[]`. */
function unwrap(n: ts.Expression): ts.Expression {
  for (;;) {
    if (ts.isParenthesizedExpression(n) || ts.isAsExpression(n) || ts.isSatisfiesExpression(n) || ts.isNonNullExpression(n)) n = n.expression;
    else return n;
  }
}

/** The value an expression or an updater arrow RESULTS in: `[]`, `() => []`, `(p) => { return []; }`. */
function resultsInEmptyArray(arg: ts.Expression): boolean {
  const e = unwrap(arg);
  if (isEmptyArray(e)) return true;
  if (ts.isArrowFunction(e) || ts.isFunctionExpression(e)) {
    if (!ts.isBlock(e.body)) return isEmptyArray(unwrap(e.body));
    return contains(e.body, (n) => ts.isReturnStatement(n) && !!n.expression && isEmptyArray(unwrap(n.expression)));
  }
  return false;
}

/** The SHAPES of a removal this scan sees in a value: a `.filter(`, a `.splice(`, or a result of `[]`. */
const isRemovalValue = (v: ts.Expression): boolean =>
  contains(v, isFilterCall) || contains(v, isSpliceCall) || resultsInEmptyArray(v);

/** The initializer of `name`'s `const`/`let` declaration in the nearest function scope around `from`. */
function localInitializer(from: ts.Node, name: string): ts.Expression | undefined {
  let scope: ts.Node | undefined = from.parent;
  while (scope && !ts.isFunctionLike(scope) && !ts.isSourceFile(scope)) scope = scope.parent;
  if (!scope) return undefined;
  let init: ts.Expression | undefined;
  contains(scope, (n) => {
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.name.text === name && n.initializer) { init = n.initializer; return true; }
    return false;
  });
  return init;
}

/** A removal handed to the setter: its argument has a removal shape, or is a local
 *  variable initialised by a `.filter(` or `.splice(` (`const kept = prev.filter(…); setX(kept)`).
 *  ★ A local initialised to `[]` is NOT counted: that is the rebuild accumulator
 *  (`const next = []` then a push per kept row, as in `use-jira-sync.ts`), and whether it
 *  drops a row depends on the loop, which this scan cannot read. */
function isRemovalArgument(arg: ts.Expression): boolean {
  if (isRemovalValue(arg)) return true;
  const e = unwrap(arg);
  if (!ts.isIdentifier(e)) return false;
  const init = localInitializer(arg, e.text);
  return !!init && (contains(init, isFilterCall) || contains(init, isSpliceCall));
}

/** A COMMITTER: the setter is handed a parameter of the function it sits in
 *  (`function commitBuckets(next) { …; setBudgets(next); }`). Whatever list a
 *  caller computes — a `.filter(` in another file included — reaches the slice
 *  through here, so the committer is judged as a removal route itself. Its
 *  callers are not followed: the committer is the one place every one of them
 *  passes through. ★ Only a plain identifier parameter of the NEAREST function
 *  counts; a destructured one, or a local alias of a parameter, is not seen.
 *  ★ It fails CLOSED on an inline callback's parameter: `onChange={(next) =>
 *  setTasks(next)}` counts as a committer, and since it resolves to its component
 *  it is refused with no exemption path. Give it a named handler. None today. */
function isParameterHandOff(arg: ts.Expression): boolean {
  const e = unwrap(arg);
  if (!ts.isIdentifier(e)) return false;
  let fn: ts.Node | undefined = arg.parent;
  while (fn && !ts.isFunctionLike(fn)) fn = fn.parent;
  return !!fn && fn.parameters.some((p) => ts.isIdentifier(p.name) && p.name.text === e.text);
}
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
 *  is assigned to (through any call it is an argument of, such as `useCallback` or
 *  `guardEdit`), or the JSX prop it is passed as. Undefined for an unnamed inner
 *  callback, so the walk goes on up. ★ A local result can name it too
 *  (`const r = ids.map(() => setX(…filter…))` names the site `r`): that fails
 *  CLOSED, as an unarmed `r`, so read such a red as a naming miss, not a missing arm. */
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

/** A site named for a component (PascalCase), a hook (`useX`) or the module: judged by
 *  that whole scope, where any arm would pass it, so it is refused rather than judged.
 *  A refused site has no exemption path: give the delete a named handler instead. */
const isUnresolved = (s: Site): boolean => s.fn === "<module>" || /^([A-Z]|use[A-Z0-9])/.test(s.fn);

/** Every filter-into-counted-setter site in one source. Pure, so the fixture
 *  cases below can feed it text. */
function scanSource(file: string, text: string, setters: ReadonlySet<string>): Site[] {
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const sites: Site[] = [];
  const visit = (n: ts.Node): void => {
    if (ts.isCallExpression(n)) {
      const setter = calleeName(n);
      if (setter && setters.has(setter) && n.arguments.some((a) => isRemovalArgument(a) || isParameterHandOff(a))) {
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

  // ★ Review finding: a hook body is a scope too. An unnamed effect in a hook that
  //   arms in ANOTHER handler would otherwise be judged armed.
  it("refuses a site that only resolves to its hook", () => {
    const [site] = scan(
      `export function useFoo() { const del = useCallback(() => { allowDestructiveSave(); }, []); useEffect(() => { setRaid((p) => p.filter(Boolean)); }, []); }`,
    );
    expect(site).toMatchObject({ fn: "useFoo", armed: true });
    expect(isUnresolved(site!)).toBe(true);
  });

  it("names an inline JSX handler by its prop", () => {
    const [site] = scan(`const el = <X onRemove={() => setTasks((p) => p.filter(Boolean))} />;`);
    expect(site!.fn).toBe("onRemove");
  });

  it("ignores an edit, an unlisted setter, a filter outside the setter's value, and a rebuild accumulator", () => {
    expect(scan(`function e() { setTasks((p) => p.map((t) => t)); setOther((p) => p.filter(Boolean)); const k = a.filter(Boolean); setTasks(p); }`)).toEqual([]);
    expect(scan(`function e() { const next = []; for (const r of rows) next.push(r); setTasks(next); }`)).toEqual([]);
    expect(scan(`function e() { setTasks((p) => p.length ? p : []); }`)).toEqual([]);
  });

  // §293, widened 2026-10-08: the other written shapes of a removal.
  it.each([
    ["a clear to []", `function clear() { setTasks([]); }`],
    ["a clear through a cast", `function clear() { setTasks([] as Task[]); }`],
    ["an updater returning []", `function clear() { setTasks(() => []); }`],
    ["an updater block returning []", `function clear() { setTasks((p) => { log(p); return []; }); }`],
    ["a splice", `function del(i) { setTasks((p) => { const c = [...p]; c.splice(i, 1); return c; }); }`],
    ["a local filtered list", `function del(id) { const kept = tasks.filter((t) => t.id !== id); setTasks(kept); }`],
    ["a local spliced list", `function del(i) { const gone = rows.splice(i, 1); setTasks(gone); }`],
    ["a committer handed its own parameter", `function commit(next) { setTasks(next); }`],
    ["a committer's parameter through a cast", `const commit = (next) => { setTasks(next as Task[]); };`],
  ])("finds %s", (_label, src) => {
    expect(scan(src).map((x) => x.setter)).toEqual(["setTasks"]);
  });

  it("judges a committer by its own body, and ignores a parameter of an OUTER function", () => {
    expect(scan(`function commit(next) { if (gone) allowDestructiveSave?.(); setTasks(next); }`)[0]).toMatchObject({ fn: "commit", armed: true });
    expect(scan(`function outer(next) { const h = () => { setTasks(next); }; }`)).toEqual([]);
  });
});

describe("destructive-save arming, UI surface (§293)", () => {
  const sites = scanApp();

  // ANTI-VACUITY: a broken walk or an empty setter set would pass every check below.
  it("scans the counted setters and finds the known removal sites", () => {
    expect(countedSetters().size).toBeGreaterThanOrEqual(13);
    expect(sites.length).toBeGreaterThanOrEqual(15);
    expect(sites.map((s) => s.key)).toContain("use-raid-items.ts#handleDeleteRaidItem#setRaid");
    // A clear to `[]`, seen since the 2026-10-08 widening, not by any `.filter(`.
    expect(sites.find((s) => s.key === "use-bulk-operations.ts#handleClearAll#setTasks")?.armed).toBe(true);
    // The unbounded route behind a wrapper call (guardEdit), judged by its own body.
    expect(sites.filter((s) => s.key.startsWith("task-manager.tsx#onClearUnlinked#")).map((s) => s.armed)).toEqual([true, true]);
    // A committer, seen since batch 21: any caller's list reaches setBudgets through it.
    expect(sites.find((s) => s.key === "use-budget-buckets.ts#commitBuckets#setBudgets")?.armed).toBe(true);
  });

  // A site that resolves to a component (PascalCase), a hook (`useX`) or the module is
  // judged by that whole scope, where any arm passes it: refuse it rather than pass it.
  it("every site resolves to a named handler, not a component, a hook or the module", () => {
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

  // An exemption is keyed by file#function#setter, so a SECOND filter-delete added to an
  // exempt function would share the key; the count makes it a deliberate edit.
  it("every UNARMED_BY_DESIGN entry covers exactly the sites it counts", () => {
    const off = Object.entries(UNARMED_BY_DESIGN)
      .map(([key, entry]) => ({ key, counted: entry.sites, found: sites.filter((s) => !s.armed && s.key === key).length }))
      .filter((e) => e.counted !== e.found);
    expect(off).toEqual([]);
  });
});
