const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3');
const { createClient } = require('@libsql/client');
require('dotenv').config();

async function inspect() {
  console.log('=== INSPECTION OF CURRENT DATABASES ===');

  // 1. Workspace SQLite
  const wsDbPath = path.resolve('hardware.db');
  console.log('\n[1] Workspace DB:', wsDbPath, 'Exists:', fs.existsSync(wsDbPath));
  if (fs.existsSync(wsDbPath)) {
    const db = new sqlite3.Database(wsDbPath);
    const tables = await new Promise((res, rej) => {
      db.all("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name", (err, rows) => {
        if (err) rej(err); else res(rows);
      });
    });
    console.log('Tables in Workspace DB:', tables.map(t => t.name));
    for (const t of tables) {
      if (t.name.startsWith('sqlite_')) continue;
      const count = await new Promise(res => {
        db.get(`SELECT COUNT(*) as c FROM "${t.name}"`, (err, r) => res(err ? 'ERR: ' + err.message : r.c));
      });
      console.log(`  - ${t.name}: ${count} rows`);
    }

    const users = await new Promise(res => db.all("SELECT id, email, role, name FROM users", (err, r) => res(r || [])));
    console.log('Workspace Users:', users);
    const profiles = await new Promise(res => db.all("SELECT id, email, role, name FROM profiles", (err, r) => res(r || [])));
    console.log('Workspace Profiles:', profiles);

    db.close();
  }

  // 2. AppData SQLite
  const appDataDb = path.join(
    process.env.APPDATA || 'C:\\Users\\lipca\\AppData\\Roaming',
    'Muthuwadige Hardware ERP',
    'hardware.db'
  );
  console.log('\n[2] AppData DB:', appDataDb, 'Exists:', fs.existsSync(appDataDb));
  if (fs.existsSync(appDataDb)) {
    const db = new sqlite3.Database(appDataDb);
    const tables = await new Promise((res, rej) => {
      db.all("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name", (err, rows) => {
        if (err) rej(err); else res(rows);
      });
    });
    console.log('Tables in AppData DB:', tables.map(t => t.name));
    for (const t of tables) {
      if (t.name.startsWith('sqlite_')) continue;
      const count = await new Promise(res => {
        db.get(`SELECT COUNT(*) as c FROM "${t.name}"`, (err, r) => res(err ? 'ERR: ' + err.message : r.c));
      });
      console.log(`  - ${t.name}: ${count} rows`);
    }

    const users = await new Promise(res => db.all("SELECT id, email, role, name FROM users", (err, r) => res(r || [])));
    console.log('AppData Users:', users);
    const profiles = await new Promise(res => db.all("SELECT id, email, role, name FROM profiles", (err, r) => res(r || [])));
    console.log('AppData Profiles:', profiles);

    db.close();
  }

  // 3. Turso Cloud
  if (process.env.TURSO_DATABASE_URL && process.env.TURSO_AUTH_TOKEN) {
    console.log('\n[3] Turso Cloud URL:', process.env.TURSO_DATABASE_URL);
    try {
      const turso = createClient({
        url: process.env.TURSO_DATABASE_URL,
        authToken: process.env.TURSO_AUTH_TOKEN
      });
      const tRes = await turso.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name");
      const tursoTables = tRes.rows.map(r => r.name);
      console.log('Tables in Turso Cloud:', tursoTables);
      for (const name of tursoTables) {
        if (String(name).startsWith('sqlite_')) continue;
        try {
          const cRes = await turso.execute(`SELECT COUNT(*) as c FROM "${name}"`);
          console.log(`  - ${name}: ${cRes.rows[0].c} rows`);
        } catch (e) {
          console.log(`  - ${name}: ERR (${e.message})`);
        }
      }

      const tUsers = await turso.execute("SELECT id, email, role, name FROM users");
      console.log('Turso Users:', tUsers.rows);
      const tProfiles = await turso.execute("SELECT id, email, role, name FROM profiles");
      console.log('Turso Profiles:', tProfiles.rows);
    } catch (e) {
      console.error('Turso connection error:', e.message);
    }
  }
}

inspect().catch(console.error);
