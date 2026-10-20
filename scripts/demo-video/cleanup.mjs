// §715 demo recorder: deletes what a take leaves on the throwaway Turso database, so every take starts
// clean and no take depends on another. That is:
// - the recorder's projects, matched by name, from every table keyed by project_id, and the projects a
//   take created itself (ch2-connect's first project, which Claude names), noted by id in CREATED;
// - the recorder's global rows: scheduled jobs and the next-actions learning history, which are
//   portfolio-wide tables (not workspace data) that ai-scheduled and ai-weights fill.
// Other projects are left alone. Prints counts only. `record.mjs` runs it before every take; it also
// runs on its own: `node scripts/demo-video/cleanup.mjs`. See README.md.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { OUT, pipeline, query } from './lib.mjs';

// The demo project every take creates; the Acme project of the old recorder, so its leftovers go too.
const MINE = /^(Acme Website Relaunch|Customer Identity Platform \(demo\))$/;

// The global tables the recorder writes to. The throwaway database belongs to the recorder (it never
// runs beside the live e2e specs), so they are cleared whole.
const GLOBAL_TABLES = ['scheduled_jobs', 'action_learning'];

// The ids of the projects takes created. Written by noteCreatedProject, cleared once cleanup deleted them.
const CREATED = path.join(OUT, 'created-projects.json');

function readCreated() {
  try {
    const v = JSON.parse(fs.readFileSync(CREATED, 'utf8'));
    return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

/** Notes a project a take created, so the next cleanup deletes it although its name is Claude's. */
export function noteCreatedProject(id) {
  const ids = readCreated();
  if (ids.includes(id)) return;
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(CREATED, JSON.stringify([...ids, id]));
}

/** The recorder's projects among `rows` ([id, name]): the demo by name, a take's created project by id. */
export function recorderProjectIds(rows, created) {
  const noted = new Set(created);
  return rows.filter(([id, name]) => MINE.test(name) || noted.has(id)).map(([id]) => id);
}

const quote = (t) => '"' + t.replace(/"/g, '""') + '"';

/** The cleanup's statements, as ordered batches: child rows first, then the project rows (only once
 *  every child delete succeeded — matching starts from the project name, so child rows left behind a
 *  deleted project could never be found again), then the global tables. */
export function cleanupStatements(ids, tables) {
  const globals = GLOBAL_TABLES.map((t) => ({ sql: `DELETE FROM ${quote(t)}` }));
  if (ids.length === 0) return [globals];
  const ph = ids.map(() => '?').join(',');
  const args = ids.map((v) => ({ type: 'text', value: v }));
  return [
    tables.map((t) => ({ sql: `DELETE FROM ${quote(t)} WHERE project_id IN (${ph})`, args })),
    globals,
    [{ sql: `DELETE FROM projects WHERE id IN (${ph})`, args }],
  ];
}

// A table that was never created (the app has not used that store on this database) is not an error.
const failed = (results) => results.filter((x) => x.type !== 'ok' && !/no such table/i.test(x.error?.message ?? '')).length;

export async function cleanup() {
  let rows;
  try {
    rows = (await query('SELECT id, name FROM projects')).map((r) => [r[0].value, r[1].value]);
  } catch (e) {
    // A database the app has never written to has no tables yet: nothing to clean.
    if (/no such table/i.test(e.message)) rows = [];
    else throw e;
  }
  const ids = recorderProjectIds(rows, readCreated());
  console.log('projects', rows.length, 'mine', ids.length, 'others', rows.length - ids.length);
  const tables = ids.length === 0 ? [] : (await query(
    "SELECT m.name FROM sqlite_master m JOIN pragma_table_info(m.name) c WHERE m.type='table' AND c.name='project_id'",
  )).map((r) => r[0].value).filter((t) => t !== 'projects');
  const batches = cleanupStatements(ids, tables);
  for (const [i, batch] of batches.entries()) {
    const errors = failed(await pipeline(batch));
    if (errors) {
      throw new Error(i === 0 ? 'child deletes failed; projects kept so a re-run can find them' : 'a cleanup batch failed');
    }
  }
  fs.rmSync(CREATED, { force: true });
  console.log('tables', tables.length, 'globals', GLOBAL_TABLES.length);
  return { projects: rows.length, mine: ids.length };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  cleanup().catch((e) => {
    console.error('cleanup failed:', e.message);
    process.exitCode = 1;
  });
}
