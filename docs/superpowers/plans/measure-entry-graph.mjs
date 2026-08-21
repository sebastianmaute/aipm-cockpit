// Measures the EAGER client chunk graph of the app's root client component.
//
// `next build` on this app prints no "First Load JS" table: every route is `ƒ`
// (dynamic), and Next 16 + Turbopack only emits that table for statically
// generated routes. So the route table cannot answer "does Tiptap ride the
// entry chunk?". This does, exactly.
//
// `page_client-reference-manifest.js` maps each client module to the chunk set
// required to load it. `task-manager.tsx` is the root client component of `/`,
// so its chunk list IS the eager entry graph. A module behind `next/dynamic`
// gets its own clientModules entry and its chunks drop out of the parent list —
// which is precisely the effect this slice is testing for.
//
// Sizes are uncompressed on-disk bytes, not gzip/brotli transfer size. That is
// fine for a before/after delta measured the same way twice.
import { readFileSync, existsSync, statSync } from "node:fs";

const MANIFEST = ".next/server/app/page_client-reference-manifest.js";
const ROOT_MODULE = "[project]/src/app/task-manager.tsx";
const MARKER = /prosemirror-view|ProseMirror/;

const src = readFileSync(MANIFEST, "utf8");
const json = JSON.parse(src.slice(src.indexOf('{"moduleLoading"'), src.lastIndexOf("}") + 1));
const entry = json.clientModules[ROOT_MODULE];
if (!entry) throw new Error(`ROOT_MODULE not in manifest: ${ROOT_MODULE}`);

const rows = entry.chunks
  .filter((c) => typeof c === "string" && c.endsWith(".js"))
  .map((c) => {
    const p = ".next/" + c.replace(/^\/_next\//, "");
    const size = existsSync(p) ? statSync(p).size : -1;
    const hasPm = size > 0 && MARKER.test(readFileSync(p, "utf8"));
    return { name: c.replace(/^\/_next\/static\/chunks\//, ""), size, hasPm };
  })
  .sort((a, b) => b.size - a.size);

let total = 0;
for (const r of rows) {
  total += Math.max(r.size, 0);
  console.log(
    `${(r.size / 1024).toFixed(1).padStart(9)} kB  ${r.name}${r.hasPm ? "   <-- ProseMirror" : ""}`,
  );
}
const pm = rows.filter((r) => r.hasPm);
console.log(`EAGER_TOTAL_KB=${(total / 1024).toFixed(1)}  chunks=${rows.length}`);
console.log(`PROSEMIRROR_IN_ENTRY_GRAPH=${pm.length > 0}`);
console.log(`PROSEMIRROR_KB=${(pm.reduce((s, r) => s + r.size, 0) / 1024).toFixed(1)}`);
