import fs from 'fs';
import path from 'path';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import { createClient } from '@libsql/client';

function loadEnv() {
  const envPaths = [
    path.join(process.cwd(), '.env'),
    path.join(process.env.APPDATA || '', 'Muthuwadige Hardware ERP', '.env')
  ];
  let url = process.env.TURSO_DATABASE_URL;
  let token = process.env.TURSO_AUTH_TOKEN;
  for (const p of envPaths) {
    if (fs.existsSync(p)) {
      const lines = fs.readFileSync(p, 'utf8').split('\n');
      for (const line of lines) {
        const trimmed = line.trim();
        if (trimmed.startsWith('#') || !trimmed.includes('=')) continue;
        const [k, ...rest] = trimmed.split('=');
        const v = rest.join('=').trim().replace(/^['"]|['"]$/g, '');
        if (k.trim() === 'TURSO_DATABASE_URL' && !url) url = v;
        if (k.trim() === 'TURSO_AUTH_TOKEN' && !token) token = v;
      }
    }
  }
  return { url, token };
}

async function fixParity() {
  console.log('================================================================');
  console.log('  1. MIGRATING MISSING SCHEMAS BETWEEN LOCAL AND TURSO CLOUD   ');
  console.log('================================================================');

  const { url, token } = loadEnv();
  const localDb = await open({ filename: './hardware.db', driver: sqlite3.Database });
  const turso = createClient({ url, authToken: token });

  // A. Replicate missing tables to Turso (expenses, debit_notes)
  const tablesToTurso = ['expenses', 'debit_notes'];
  for (const tbl of tablesToTurso) {
    const row = await localDb.get(`SELECT sql FROM sqlite_master WHERE type='table' AND name=?`, [tbl]);
    if (row && row.sql) {
      console.log(`Creating table [${tbl}] on Turso Cloud...`);
      try {
        await turso.execute(row.sql);
        console.log(`✅ Table [${tbl}] created successfully on Turso!`);
      } catch (err) {
        console.warn(`Note on [${tbl}]:`, err.message);
      }
    } else {
      console.warn(`Table [${tbl}] schema not found in local sqlite_master.`);
    }
  }

  // B. Replicate missing scanner_signals to Local SQLite
  try {
    const res = await turso.execute(`SELECT sql FROM sqlite_master WHERE type='table' AND name='scanner_signals'`);
    if (res.rows && res.rows[0] && res.rows[0].sql) {
      console.log('Creating table [scanner_signals] in local SQLite...');
      await localDb.exec(String(res.rows[0].sql));
      console.log('✅ Table [scanner_signals] created locally!');
    }
  } catch (err) {
    console.warn('Note on [scanner_signals]:', err.message);
  }

  console.log('\n================================================================');
  console.log('  2. INSPECTING syncService.js TABLE ARRAYS                     ');
  console.log('================================================================');
  if (fs.existsSync('src/services/syncService.js')) {
    const code = fs.readFileSync('src/services/syncService.js', 'utf8');
    const lines = code.split(/\r?\n/);
    lines.forEach((l, idx) => {
      if (l.includes('SYNC_TABLES') || l.includes('TABLES_TO_PULL') || l.includes('PULL_TABLES') || l.includes('TABLES =')) {
        for (let j = Math.max(0, idx - 1); j < idx + 25 && j < lines.length; j++) {
          console.log(`[syncService.js:${j + 1}] ${lines[j]}`);
        }
      }
    });
  }

  await localDb.close();
}

fixParity().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); });
