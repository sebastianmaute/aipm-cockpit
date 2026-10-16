// §715 demo recorder: deletes the projects a recording creates on the throwaway Turso database,
// matched by name, from every table keyed by project_id. Other projects are left alone.
// Prints counts only. Run it before and after each take. See README.md.
import { throwaway } from './lib.mjs';

const T = throwaway();

// The project the recording creates, and the demo project chapter 7.4 opens.
const MINE = /^(Acme Website Relaunch|Customer Identity Platform \(demo\))$/;

// Runs statements as one pipeline and returns each statement's result, ok or error.
async function pipeline(stmts) {
  const r = await fetch('https://' + T.host + '/v2/pipeline', {
    method: 'POST',
    headers: { authorization: 'Bearer ' + T.token, 'content-type': 'application/json' },
    body: JSON.stringify({ requests: [...stmts.map((s) => ({ type: 'execute', stmt: s })), { type: 'close' }] }),
  });
  if (!r.ok) throw new Error('Turso HTTP ' + r.status);
  return (await r.json()).results.slice(0, stmts.length);
}

// Runs one statement and returns its rows; an error result throws with the database's message.
async function query(sql) {
  const [x] = await pipeline([{ sql }]);
  if (x.type !== 'ok') throw new Error('Turso: ' + (x.error?.message ?? 'statement failed'));
  return x.response.result.rows;
}

const failed = (results) => results.filter((x) => x.type !== 'ok').length;

async function main() {
  let rows;
  try {
    rows = (await query('SELECT id, name FROM projects')).map((r) => [r[0].value, r[1].value]);
  } catch (e) {
    // A database the app has never written to has no tables yet: nothing to clean.
    if (/no such table/i.test(e.message)) { console.log('projects 0'); return; }
    throw e;
  }
  const ids = rows.filter(([, n]) => MINE.test(n)).map(([i]) => i);
  console.log('projects', rows.length, 'mine', ids.length, 'others', rows.length - ids.length);
  if (ids.length === 0) return;

  const tables = (await query(
    "SELECT m.name FROM sqlite_master m JOIN pragma_table_info(m.name) c WHERE m.type='table' AND c.name='project_id'",
  )).map((r) => r[0].value).filter((t) => t !== 'projects');
  const ph = ids.map(() => '?').join(',');
  const args = ids.map((v) => ({ type: 'text', value: v }));
  const quote = (t) => '"' + t.replace(/"/g, '""') + '"';

  // Child rows first. The project rows go only once every child delete succeeded: matching starts
  // from the project name, so child rows left behind a deleted project could never be found again.
  const childErrors = failed(await pipeline(
    tables.map((t) => ({ sql: `DELETE FROM ${quote(t)} WHERE project_id IN (${ph})`, args })),
  ));
  console.log('tables', tables.length, 'errors', childErrors);
  if (childErrors) throw new Error('child deletes failed; projects kept so a re-run can find them');
  if (failed(await pipeline([{ sql: `DELETE FROM projects WHERE id IN (${ph})`, args }]))) {
    throw new Error('deleting the project rows failed');
  }
  const [[left]] = await query('SELECT COUNT(*) FROM projects');
  console.log('projects left', left.value);
}

main().catch((e) => {
  console.error('cleanup failed:', e.message);
  process.exitCode = 1;
});
