// Execute actual route callbacks without importing server.js or starting ERP services.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import ts from 'typescript';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import { installNetworkBoundary } from './b02/network.mjs';

installNetworkBoundary();
process.env.NODE_ENV = 'test';
process.env.APP_ROLE = 'test';
process.env.DATABASE_ENGINE = 'sqlite';
for (const key of ['VERCEL', 'IS_WEB_CLIENT', 'TURSO_DATABASE_URL', 'TURSO_AUTH_TOKEN', 'APPDATA', 'USER_DATA_PATH', 'ELECTRON_RUN_AS_NODE']) delete process.env[key];

const { default: db, __setLocalSqliteDbForTesting, __resetForTesting } = await import('../src/db/connection.js');
const { ensureSyncSchema, enqueueSync } = await import('../src/services/syncService.js');

const source = ts.createSourceFile('server.js', fs.readFileSync(new URL('../server.js', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
const auditSource = source.statements.find(s => ts.isFunctionDeclaration(s) && s.name?.text === 'logAudit').getText(source);
const logAudit = new Function('db', 'enqueueSync', `${auditSource}; return logAudit;`)(db, enqueueSync);

function handlerFor(route) {
  const statement = source.statements.find(s => ts.isExpressionStatement(s) && ts.isCallExpression(s.expression)
    && s.expression.expression.getText(source) === 'app.post' && s.expression.arguments[0]?.text === route);
  assert.ok(statement, `Actual registered route ${route} must exist`);
  const handler = statement.expression.arguments.at(-1).getText(source);
  return new Function('db', 'ensureSyncSchema', 'enqueueSync', 'logAudit', `return (${handler});`)(db, ensureSyncSchema, enqueueSync, logAudit);
}

const createCreditNoteRoute = handlerFor('/api/sales/credit-notes');
const aliasCreditNoteRoute = handlerFor('/api/credit-notes');

let memory;
let schema;
const tables = ['credit_notes', 'customers', 'profiles', 'audit_logs', 'sync_queue'];
const snapshot = async () => Object.fromEntries(await Promise.all(tables.map(async name => [name, await memory.all(`SELECT * FROM ${name} ORDER BY id`)])));

test.beforeEach(async () => {
  __resetForTesting();
  memory = await open({ filename: ':memory:', driver: sqlite3.Database });
  __setLocalSqliteDbForTesting(memory);
  await memory.exec(`
    CREATE TABLE credit_notes (
      id TEXT PRIMARY KEY,
      credit_note_no TEXT UNIQUE,
      code TEXT,
      invoice_no TEXT,
      customer_id TEXT,
      customer_name TEXT,
      customer_phone TEXT,
      items TEXT,
      amount REAL,
      value REAL,
      balance_remaining REAL,
      status TEXT,
      reason TEXT,
      user_id TEXT,
      created_at TEXT
    );
    CREATE TABLE customers (
      id TEXT PRIMARY KEY,
      name TEXT,
      phone TEXT,
      email TEXT,
      current_debt REAL DEFAULT 0,
      credit_limit REAL DEFAULT 0
    );
    CREATE TABLE profiles (
      id TEXT PRIMARY KEY,
      email TEXT,
      username TEXT,
      name TEXT,
      full_name TEXT,
      role TEXT
    );
    CREATE TABLE audit_logs (
      id TEXT PRIMARY KEY,
      user_email TEXT,
      action TEXT,
      details TEXT,
      timestamp TEXT,
      user_name TEXT,
      user_role TEXT
    );
    INSERT INTO customers (id, name, phone) VALUES ('cust-101', 'Perera Hardware', '0771234567');
    INSERT INTO profiles (id, email, username, name, role) VALUES ('prof-1', 'cashier@muthuwadige.com', 'cashier1', 'Cashier User', 'cashier');
  `);
  await ensureSyncSchema(db);
  schema = await memory.all('SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY type,name');
  assert.equal(db.isTurso(), false);
});

test.afterEach(async () => {
  assert.deepEqual(await memory.all('SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY type,name'), schema);
  await memory.close();
  __resetForTesting();
});

async function invoke(handler, body) {
  const response = {
    statusCode: 200,
    status(code) { this.statusCode = code; return this; },
    json(payload) {
      assert.equal(db.isInTransaction(), false, 'HTTP response must occur only after transaction finalization');
      this.body = payload;
      return this;
    }
  };
  await handler({ body }, response);
  return response;
}

// 1. Successful direct credit-note creation
test('Requirement 1 & 12: Successful direct credit-note creation via /api/sales/credit-notes and /api/credit-notes', async () => {
  const res1 = await invoke(createCreditNoteRoute, {
    customerName: 'Saman Silva',
    amount: 500,
    reason: 'Damaged Goods Return'
  });
  assert.equal(res1.statusCode, 200);
  assert.equal(res1.body.success, true);
  assert.ok(res1.body.id.startsWith('cn_'));
  assert.ok(res1.body.creditNoteNo.startsWith('CN-'));
  assert.equal(res1.body.amount, 500);

  // Alias endpoint verification
  const res2 = await invoke(aliasCreditNoteRoute, {
    customerName: 'Kamal Gunaratne',
    amount: 300,
    reason: 'Overcharge Correction'
  });
  assert.equal(res2.statusCode, 200);
  assert.equal(res2.body.success, true);
  assert.equal(res2.body.amount, 300);

  const rows = await memory.all('SELECT * FROM credit_notes ORDER BY created_at');
  assert.equal(rows.length, 2);
  assert.equal(rows[0].customer_name, 'Saman Silva');
  assert.equal(rows[1].customer_name, 'Kamal Gunaratne');
});

// 2. Correct credit-note amount and balance calculations
test('Requirement 2: Correct credit-note amount, value, and balance_remaining calculations', async () => {
  const res = await invoke(createCreditNoteRoute, {
    customerName: 'Nimal Perera',
    amount: 750,
    reason: 'Defective item credit'
  });
  assert.equal(res.statusCode, 200);
  const row = await memory.get('SELECT * FROM credit_notes WHERE id = ?', [res.body.id]);
  assert.equal(row.amount, 750);
  assert.equal(row.value, 750);
  assert.equal(row.balance_remaining, 750);
  assert.equal(row.status, 'Active');

  // Also test fallback to value if amount is not explicitly provided
  const res2 = await invoke(createCreditNoteRoute, {
    customerName: 'Sunil Shantha',
    value: 420
  });
  assert.equal(res2.statusCode, 200);
  const row2 = await memory.get('SELECT * FROM credit_notes WHERE id = ?', [res2.body.id]);
  assert.equal(row2.amount, 420);
  assert.equal(row2.value, 420);
  assert.equal(row2.balance_remaining, 420);
});

// 3. Correct customer association and customer_name defect resolution
test('Requirement 3: Fix customer_name defect and resolve name from customerId or payload safely', async () => {
  // Case A: snake_case customer_name provided in payload
  const resA = await invoke(createCreditNoteRoute, {
    customer_name: 'Bandara Store',
    customer_phone: '0719876543',
    amount: 150
  });
  assert.equal(resA.statusCode, 200);
  const rowA = await memory.get('SELECT * FROM credit_notes WHERE id = ?', [resA.body.id]);
  assert.equal(rowA.customer_name, 'Bandara Store');
  assert.equal(rowA.customer_phone, '0719876543');

  // Case B: customerId provided without customerName -> resolved from customers table
  const resB = await invoke(createCreditNoteRoute, {
    customerId: 'cust-101',
    amount: 250
  });
  assert.equal(resB.statusCode, 200);
  const rowB = await memory.get('SELECT * FROM credit_notes WHERE id = ?', [resB.body.id]);
  assert.equal(rowB.customer_id, 'cust-101');
  assert.equal(rowB.customer_name, 'Perera Hardware'); // Resolved from DB
  assert.equal(rowB.customer_phone, '0771234567');     // Resolved from DB

  // Case C: Neither customerName nor customerId provided -> defaults safely to 'Guest Customer' without ReferenceError
  const resC = await invoke(createCreditNoteRoute, {
    amount: 100
  });
  assert.equal(resC.statusCode, 200);
  const rowC = await memory.get('SELECT * FROM credit_notes WHERE id = ?', [resC.body.id]);
  assert.equal(rowC.customer_name, 'Guest Customer');
});

// 4. Required financial and audit records
test('Requirement 4: Audit log entry created inside the managed transaction', async () => {
  const res = await invoke(createCreditNoteRoute, {
    customerName: 'Audit Test Customer',
    amount: 600,
    userEmail: 'cashier@muthuwadige.com'
  });
  assert.equal(res.statusCode, 200);

  const logs = await memory.all('SELECT * FROM audit_logs');
  assert.equal(logs.length, 1);
  assert.equal(logs[0].action, 'CREATE_CREDIT_NOTE');
  assert.equal(logs[0].user_email, 'cashier@muthuwadige.com');
  assert.ok(logs[0].details.includes(res.body.creditNoteNo));
  assert.ok(logs[0].details.includes('Audit Test Customer'));
  assert.ok(logs[0].details.includes('600'));
});

// 5. Required synchronization queue entries
test('Requirement 5: Synchronization queue entry created for credit_notes with INSERT action', async () => {
  const res = await invoke(createCreditNoteRoute, {
    customerName: 'Sync Test Customer',
    amount: 350
  });
  assert.equal(res.statusCode, 200);

  const queue = await memory.all("SELECT * FROM sync_queue WHERE table_name = 'credit_notes'");
  assert.equal(queue.length, 1);
  assert.equal(queue[0].record_id, res.body.id);
  assert.equal(queue[0].action, 'INSERT');
  assert.equal(queue[0].status, 'PENDING');
  const payload = JSON.parse(queue[0].payload);
  assert.equal(payload.id, res.body.id);
  assert.equal(payload.amount, 350);
});

// 6. Failure during credit-note insertion triggers complete rollback
test('Requirement 6: Failure during credit-note insertion rolls back complete transaction', async () => {
  const before = await snapshot();
  const original = memory.run.bind(memory);
  memory.run = async (sql, ...args) => {
    if (sql.includes('INSERT INTO credit_notes')) throw new Error('Simulated credit_notes insertion failure');
    return original(sql, ...args);
  };
  try {
    const res = await invoke(createCreditNoteRoute, { customerName: 'Fail CN', amount: 200 });
    assert.equal(res.statusCode, 500);
  } finally {
    memory.run = original;
  }
  assert.deepEqual(await snapshot(), before);
});

// 7. Failure during audit write triggers complete rollback
test('Requirement 7: Failure during audit log write rolls back complete transaction', async () => {
  const before = await snapshot();
  const original = memory.run.bind(memory);
  memory.run = async (sql, ...args) => {
    if (sql.includes('INSERT INTO audit_logs')) throw new Error('Simulated audit log failure');
    return original(sql, ...args);
  };
  try {
    const res = await invoke(createCreditNoteRoute, { customerName: 'Fail Audit', amount: 200 });
    assert.equal(res.statusCode, 500);
  } finally {
    memory.run = original;
  }
  assert.deepEqual(await snapshot(), before);
});

// 8. Failure during required queue insertion triggers complete rollback
test('Requirement 8: Failure during queue insertion rolls back complete transaction', async () => {
  const before = await snapshot();
  const original = memory.run.bind(memory);
  memory.run = async (sql, ...args) => {
    if (sql.includes('INSERT OR REPLACE INTO sync_queue') && args[0]?.[1] === 'credit_notes') {
      throw new Error('Simulated sync queue failure');
    }
    return original(sql, ...args);
  };
  try {
    const res = await invoke(createCreditNoteRoute, { customerName: 'Fail Queue', amount: 200 });
    assert.equal(res.statusCode, 500);
  } finally {
    memory.run = original;
  }
  assert.deepEqual(await snapshot(), before);
});

// 9. Failure during COMMIT triggers complete rollback with no partial records
test('Requirement 9: Failure during COMMIT rolls back all records with no partial state', async () => {
  const before = await snapshot();
  const original = memory.run.bind(memory);
  memory.run = async (sql, ...args) => {
    if (sql === 'COMMIT') throw new Error('Simulated COMMIT disk I/O error');
    return original(sql, ...args);
  };
  try {
    const res = await invoke(createCreditNoteRoute, { customerName: 'Fail Commit', amount: 500 });
    assert.equal(res.statusCode, 500);
  } finally {
    memory.run = original;
  }
  assert.deepEqual(await snapshot(), before);
});

// 10. Duplicate-request behavior (idempotency)
test('Requirement 10: Idempotent replay for duplicate request with same candidate ID or credit_note_no', async () => {
  const payload = {
    id: 'cn_fixed_test_id_123',
    customerName: 'Repeat Customer',
    amount: 450
  };
  const first = await invoke(createCreditNoteRoute, payload);
  assert.equal(first.statusCode, 200);
  assert.equal(first.body.id, 'cn_fixed_test_id_123');

  const countAfterFirst = (await memory.all('SELECT * FROM credit_notes')).length;
  assert.equal(countAfterFirst, 1);

  // Replay exact same request
  const second = await invoke(createCreditNoteRoute, payload);
  assert.equal(second.statusCode, 200);
  assert.equal(second.body.id, 'cn_fixed_test_id_123');
  assert.equal(second.body.idempotent_replay, true);

  const countAfterSecond = (await memory.all('SELECT * FROM credit_notes')).length;
  assert.equal(countAfterSecond, 1, 'No duplicate record must be created');
});

// 11. Concurrent creation requests
test('Requirement 11: Concurrent creation requests safely allocate unique credit notes without collision', async () => {
  const requests = Array.from({ length: 5 }, (_, i) => ({
    customerName: `Concurrent Customer ${i + 1}`,
    amount: 100 * (i + 1)
  }));

  const responses = await Promise.all(requests.map(req => invoke(createCreditNoteRoute, req)));
  for (const res of responses) {
    assert.equal(res.statusCode, 200);
    assert.equal(res.body.success, true);
  }

  const ids = responses.map(r => r.body.id);
  const creditNoteNos = responses.map(r => r.body.creditNoteNo);

  assert.equal(new Set(ids).size, 5, 'All credit note IDs must be unique');
  assert.equal(new Set(creditNoteNos).size, 5, 'All credit note numbers must be unique');

  const inDb = await memory.all('SELECT * FROM credit_notes');
  assert.equal(inDb.length, 5);
});

// 12. Existing API success and error contracts
test('Requirement 12: Negative amount returns HTTP 400 and makes no database writes', async () => {
  const before = await snapshot();
  const res = await invoke(createCreditNoteRoute, {
    customerName: 'Invalid Customer',
    amount: -100
  });
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.error, 'Credit Note amount cannot be negative.');
  assert.deepEqual(await snapshot(), before);
});
