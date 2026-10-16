// §715 demo recorder: deletes the projects a recording creates on the throwaway Turso database,
// matched by name, from every table keyed by project_id. Other projects are left alone.
// Prints counts only. Run it before and after each take. See README.md.
import { throwaway } from './lib.mjs';

const T = throwaway();

// The project the recording creates, and the demo project chapter 7.4 opens.
const MINE = /^(Acme Website Relaunch|Customer Identity Platform \(demo\))$/;

async function call(stmts) {
  const r = await fetch('https://' + T.host + '/v2/pipeline', {
    method: 'POST',
    headers: { authorization: 'Bearer ' + T.token, 'content-type': 'application/json' },
    body: JSON.stringify({ requests: [...stmts.map((s) => ({ type: 'execute', stmt: s })), { type: 'close' }] }),
  });
  if (!r.ok) throw new Error('Turso HTTP ' + r.status);
  return (await r.json()).results;
}

(async () => {
  const [p] = await call([{ sql: 'SELECT id, name FROM projects' }]);
  const rows = p.response.result.rows.map((r) => [r[0].value, r[1].value]);
  const ids = rows.filter(([, n]) => MINE.test(n)).map(([i]) => i);
  console.log('projects', rows.length, 'mine', ids.length, 'others', rows.length - ids.length);
  if (ids.length === 0) return;
  const [tl] = await call([{ sql: "SELECT m.name FROM sqlite_master m JOIN pragma_table_info(m.name) c WHERE m.type='table' AND c.name='project_id'" }]);
  const tables = tl.response.result.rows.map((r) => r[0].value);
  const ph = ids.map(() => '?').join(',');
  const args = ids.map((v) => ({ type: 'text', value: v }));
  const stmts = [
    ...tables.map((t) => ({ sql: `DELETE FROM "${t}" WHERE project_id IN (${ph})`, args })),
    { sql: `DELETE FROM projects WHERE id IN (${ph})`, args },
  ];
  const res = await call(stmts);
  const errors = res.slice(0, stmts.length).filter((x) => x.type !== 'ok').length;
  console.log('tables', tables.length, 'errors', errors);
  const [c] = await call([{ sql: 'SELECT COUNT(*) FROM projects' }]);
  console.log('projects left', c.response.result.rows[0][0].value);
  if (errors) process.exitCode = 1;
})().catch((e) => {
  console.error('cleanup failed:', e.message);
  process.exitCode = 1;
});
