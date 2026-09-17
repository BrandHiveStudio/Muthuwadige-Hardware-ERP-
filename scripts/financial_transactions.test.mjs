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
  assert.ok(statement, 'Actual registered route must exist');
  const handler = statement.expression.arguments.at(-1).getText(source);
  return new Function('db', 'ensureSyncSchema', 'enqueueSync', 'logAudit', `return (${handler});`)(db, ensureSyncSchema, enqueueSync, logAudit);
}
const refund = handlerFor('/api/credit-notes/refund-cash');
let memory;
let schema;
const tables = ['credit_notes', 'credit_note_usage', 'transactions', 'audit_logs', 'sync_queue', 'profiles'];
const snapshot = async () => Object.fromEntries(await Promise.all(tables.map(async name => [name, await memory.all(`SELECT * FROM ${name} ORDER BY id`)])));
test.beforeEach(async () => {
  __resetForTesting();
  memory = await open({ filename: ':memory:', driver: sqlite3.Database });
  __setLocalSqliteDbForTesting(memory);
  await memory.exec(`
    CREATE TABLE credit_notes (id TEXT PRIMARY KEY, credit_note_no TEXT, code TEXT, amount REAL, value REAL,
      balance_remaining REAL, status TEXT, customer_id TEXT, customer_name TEXT, customer_phone TEXT);
    CREATE TABLE transactions (id TEXT PRIMARY KEY, type TEXT, category TEXT, description TEXT, amount REAL, date TEXT, reference TEXT, user_id TEXT);
    CREATE TABLE credit_note_usage (id TEXT PRIMARY KEY, credit_note_no TEXT, invoice_no TEXT, customer_id TEXT,
      customer_name TEXT, customer_phone TEXT, amount_applied REAL, previous_balance REAL, remaining_balance REAL,
      action TEXT, user_email TEXT, created_at TEXT);
    CREATE TABLE profiles (id TEXT PRIMARY KEY, email TEXT, username TEXT, name TEXT, full_name TEXT, role TEXT);
    CREATE TABLE audit_logs (id TEXT PRIMARY KEY, user_email TEXT, action TEXT, details TEXT, timestamp TEXT, user_name TEXT, user_role TEXT);
    INSERT INTO credit_notes VALUES ('cn-test','CN-TEST','CN-TEST',150,150,75,'Partially Used','c-test','Test Customer','');
    INSERT INTO credit_notes VALUES ('unrelated','CN-OTHER','CN-OTHER',90,90,90,'Active','other','Other','');
  `);
  await ensureSyncSchema(db); // Existing lifecycle, solely on this in-memory fixture.
  schema = await memory.all('SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY type,name');
  assert.equal(db.isTurso(), false);
});
test.afterEach(async () => {
  assert.deepEqual(await memory.all('SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY type,name'), schema);
  await memory.close();
  __resetForTesting();
});
async function invoke(handler, body) {
  const response = { statusCode: 200, status(code) { this.statusCode = code; return this; }, json(payload) {
    assert.equal(db.isInTransaction(), false, 'HTTP response must be after transaction finalization');
    this.body = payload; return this;
  } };
  await handler({ body }, response);
  return response;
}
test('cash refund commits existing amount, ledger, usage, audit and all queue records', async () => {
  const other = await memory.get("SELECT * FROM credit_notes WHERE id = 'unrelated'");
  const response = await invoke(refund, { code: 'CN-TEST' });
  assert.equal(response.statusCode, 200);
  assert.equal(response.body.refundedAmount, 75);
  const state = await snapshot();
  const note = state.credit_notes.find(n => n.id === 'cn-test');
  assert.equal(note.balance_remaining, 0);
  assert.equal(note.status, 'Fully Used');
  assert.deepEqual(state.credit_notes.find(n => n.id === 'unrelated'), other);
  assert.equal(state.transactions.length, 1);
  assert.equal(state.transactions[0].amount, 75);
  assert.equal(state.transactions[0].type, 'expense');
  assert.equal(state.transactions[0].category, 'Credit Note Cash Refund');
  assert.equal(state.transactions[0].reference, 'CN-TEST');
  assert.equal(state.credit_note_usage.length, 1);
  assert.equal(state.credit_note_usage[0].amount_applied, 75);
  assert.equal(state.credit_note_usage[0].previous_balance, 75);
  assert.equal(state.credit_note_usage[0].remaining_balance, 0);
  assert.equal(state.credit_note_usage[0].action, 'cash_refund');
  assert.equal(state.audit_logs.length, 1);
  assert.deepEqual(state.sync_queue.map(q => q.table_name).sort(), ['audit_logs', 'credit_note_usage', 'credit_notes', 'transactions']);
  for (const entry of state.sync_queue) {
    assert.equal(entry.status, 'PENDING');
    assert.equal(JSON.parse(entry.payload).id, entry.record_id);
  }
});
test('cash refund validation preserves API status and makes no writes', async () => {
  const before = await snapshot();
  assert.equal((await invoke(refund, {})).statusCode, 400);
  assert.equal((await invoke(refund, { code: 'missing' })).statusCode, 404);
  assert.deepEqual(await snapshot(), before);
});
for (const failAt of ['UPDATE credit_notes', 'INSERT INTO transactions', 'INSERT INTO credit_note_usage', 'INSERT INTO audit_logs', 'credit_notes-queue', 'transactions-queue', 'credit_note_usage-queue', 'COMMIT', 'BEGIN TRANSACTION']) {
  test(`cash refund rolls back all records on ${failAt} failure`, async () => {
    const before = await snapshot();
    const original = memory.run.bind(memory);
    memory.run = async (sql, ...args) => {
      const queueTable = failAt.endsWith('-queue') ? failAt.slice(0, -6) : null;
      if ((!queueTable && sql.startsWith(failAt)) || (queueTable && sql.includes('INSERT OR REPLACE INTO sync_queue') && args[0]?.[1] === queueTable)) throw new Error('Injected failure');
      return original(sql, ...args);
    };
    try { assert.equal((await invoke(refund, { code: 'CN-TEST' })).statusCode, 500); }
    finally { memory.run = original; }
    assert.deepEqual(await snapshot(), before);
  });
}
test('concurrent/retried refund has exactly one financial effect', async () => {
  const responses = await Promise.all([invoke(refund, { code: 'CN-TEST' }), invoke(refund, { code: 'CN-TEST' })]);
  assert.deepEqual(responses.map(r => r.statusCode).sort(), [200, 404]);
  const beforeRetry = await snapshot();
  assert.equal((await invoke(refund, { code: 'CN-TEST' })).statusCode, 404);
  assert.deepEqual(await snapshot(), beforeRetry);
  assert.equal(beforeRetry.transactions.length, 1);
  assert.equal(beforeRetry.credit_note_usage.length, 1);
});
