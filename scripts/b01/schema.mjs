import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

export const sha256 = data => createHash('sha256').update(data).digest('hex');
export function fingerprint(file) {
  // Existing file only; no normal application initialization, DDL, or row queries.
  if (!fs.statSync(file).isFile()) throw new Error('Existing database required');
  const files = [file, file + '-wal'].filter(p => fs.existsSync(p));
  const hashes = () => files.map(p => sha256(fs.readFileSync(p)));
  const before = hashes();
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    db.exec('PRAGMA query_only=ON; BEGIN');
    const objects = db.prepare('SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY type,name').all();
    const quote = s => '"' + s.replaceAll('"', '""') + '"';
    const tables = objects.filter(o => o.type === 'table').map(o => ({
      name: o.name,
      columns: db.prepare('PRAGMA table_xinfo(' + quote(o.name) + ')').all(),
      foreignKeys: db.prepare('PRAGMA foreign_key_list(' + quote(o.name) + ')').all(),
      indexes: db.prepare('PRAGMA index_list(' + quote(o.name) + ')').all().map(i => ({
        ...i, columns: db.prepare('PRAGMA index_xinfo(' + quote(i.name) + ')').all()
      }))
    }));
    const metadata = Object.fromEntries(['schema_version', 'user_version', 'application_id', 'encoding'].map(p => [p, db.prepare('PRAGMA ' + p).get()]));
    const result = { fingerprint: sha256(JSON.stringify({ objects, tables })), counts: objects.reduce((a, o) => (a[o.type] = (a[o.type] || 0) + 1, a), {}), metadata };
    db.exec('ROLLBACK');
    db.close();
    return { ...result, filesUnchanged: JSON.stringify(before) === JSON.stringify(hashes()) };
  } catch (error) { db.close(); throw error; }
}
