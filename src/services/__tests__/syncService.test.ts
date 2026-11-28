import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';

const savedEnv = vi.hoisted(() => {
  const keys = [
    'VERCEL',
    'VERCEL_ENV',
    'APP_ROLE',
    'IS_WEB_CLIENT',
    'DATABASE_ENGINE',
    'TURSO_DATABASE_URL',
    'TURSO_AUTH_TOKEN'
  ] as const;
  const snapshot: Record<string, string | undefined> = {};
  for (const k of keys) {
    snapshot[k] = process.env[k];
    delete process.env[k];
  }
  return snapshot;
});

import {
  ensureSyncSchema,
  enqueueSync,
  pushUpstreamChanges,
  pullDownstreamChanges,
  __resetSyncSchemaForTesting
} from '../syncService.js';

type Row = Record<string, any>;

interface TableDef {
  name: string;
  cols: string[];
  defaults: Record<string, any>;
  uniqueCols: string[];
  rows: Row[];
}

function stripQuotes(ident: string): string {
  return ident.trim().replace(/^["'`\[]|["'`\]]$/g, '');
}

function splitTopLevelCommas(str: string): string[] {
  const parts: string[] = [];
  let cur = '';
  let depth = 0;
  let quote: string | null = null;
  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    if (quote) {
      cur += ch;
      if (ch === quote && str[i - 1] !== '\\') quote = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      quote = ch;
      cur += ch;
      continue;
    }
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    else if (ch === ',' && depth === 0) {
      parts.push(cur.trim());
      cur = '';
      continue;
    }
    cur += ch;
  }
  if (cur.trim()) parts.push(cur.trim());
  return parts;
}

function splitSqlStatements(sql: string): string[] {
  const stmts: string[] = [];
  let cur = '';
  let quote: string | null = null;
  let inBeginBlock = false;
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    if (quote) {
      cur += ch;
      if (ch === quote && sql[i - 1] !== '\\') quote = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') {
      quote = ch;
      cur += ch;
      continue;
    }
    if (ch === '-' && sql[i + 1] === '-') {
      while (i < sql.length && sql[i] !== '\n') i++;
      cur += '\n';
      continue;
    }
    cur += ch;
    if (!inBeginBlock && /\bBEGIN\s*$/i.test(cur)) {
      inBeginBlock = true;
    } else if (inBeginBlock && /\bEND\s*;$/i.test(cur)) {
      inBeginBlock = false;
      stmts.push(cur.trim());
      cur = '';
    } else if (!inBeginBlock && ch === ';') {
      if (cur.trim().length > 1) stmts.push(cur.slice(0, -1).trim());
      cur = '';
    }
  }
  if (cur.trim()) stmts.push(cur.trim());
  return stmts;
}

function parseDefaultLiteral(expr: string): any {
  const trimmed = expr.trim();
  if (/^CURRENT_TIMESTAMP$/i.test(trimmed) || /^datetime\(/i.test(trimmed) || /^strftime\(/i.test(trimmed)) {
    return new Date().toISOString();
  }
  if (/^NULL$/i.test(trimmed)) return null;
  if (/^'([\s\S]*)'$/.test(trimmed)) return trimmed.slice(1, -1);
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed);
  return trimmed;
}

function createPureInMemorySqlite() {
  const tables = new Map<string, TableDef>();
  const indexes = new Map<string, Set<string>>();
  let stockAdjInsertTriggerEnabled = false;

  function getTable(name: string): TableDef | undefined {
    return tables.get(stripQuotes(name).toLowerCase());
  }

  function cloneRow(row: Row): Row {
    return { ...row };
  }

  function evalExpr(exprRaw: string, row: Row, args: any[], argIdx: { i: number }, excluded?: Row): any {
    const expr = exprRaw.trim();
    if (expr === '?') {
      const val = args[argIdx.i++];
      return val === undefined ? null : val;
    }
    if (/^NULL$/i.test(expr)) return null;
    if (/^'([\s\S]*)'$/.test(expr)) return expr.slice(1, -1);
    if (/^-?\d+(\.\d+)?$/.test(expr)) return Number(expr);
    if (/^CURRENT_TIMESTAMP$/i.test(expr) || /^datetime\(/i.test(expr) || /^strftime\(/i.test(expr)) {
      return new Date().toISOString();
    }
    const excludedMatch = expr.match(/^excluded\.(.+)$/i);
    if (excludedMatch && excluded) {
      return excluded[stripQuotes(excludedMatch[1])];
    }
    const maxMatch = expr.match(/^MAX\(([\s\S]+)\)$/i);
    if (maxMatch) {
      const inner = splitTopLevelCommas(maxMatch[1]);
      const vals = inner.map(p => Number(evalExpr(p, row, args, argIdx, excluded) ?? 0));
      return Math.max(...vals);
    }
    const coalesceMatch = expr.match(/^COALESCE\(([\s\S]+)\)$/i);
    if (coalesceMatch) {
      const inner = splitTopLevelCommas(coalesceMatch[1]);
      for (const p of inner) {
        const v = evalExpr(p, row, args, argIdx, excluded);
        if (v !== null && v !== undefined) return v;
      }
      return null;
    }
    // Simple binary addition: COALESCE(...) + ?
    let depth = 0;
    let quote: string | null = null;
    for (let i = 0; i < expr.length; i++) {
      const ch = expr[i];
      if (quote) {
        if (ch === quote && expr[i - 1] !== '\\') quote = null;
        continue;
      }
      if (ch === "'" || ch === '"' || ch === '`') { quote = ch; continue; }
      if (ch === '(') depth++;
      else if (ch === ')') depth--;
      else if (ch === '+' && depth === 0) {
        const left = Number(evalExpr(expr.slice(0, i), row, args, argIdx, excluded) ?? 0);
        const right = Number(evalExpr(expr.slice(i + 1), row, args, argIdx, excluded) ?? 0);
        return left + right;
      }
    }
    const colName = stripQuotes(expr);
    if (colName in row) return row[colName];
    return null;
  }

  function matchesWhere(whereRaw: string | undefined, row: Row, args: any[], argIdx: { i: number }): boolean {
    if (!whereRaw) return true;
    let w = whereRaw.trim();
    while (w.startsWith('(') && w.endsWith(')')) {
      let depth = 0;
      let balanced = true;
      let q: string | null = null;
      for (let i = 0; i < w.length - 1; i++) {
        const ch = w[i];
        if (q) { if (ch === q) q = null; continue; }
        if (ch === "'" || ch === '"') { q = ch; continue; }
        if (ch === '(') depth++;
        else if (ch === ')') {
          depth--;
          if (depth === 0) { balanced = false; break; }
        }
      }
      if (balanced) w = w.slice(1, -1).trim();
      else break;
    }

    // Split top-level OR
    const splitLogical = (s: string, kw: 'OR' | 'AND'): string[] => {
      const res: string[] = [];
      let cur = '';
      let depth = 0;
      let q: string | null = null;
      const re = new RegExp(`^\\s+${kw}\\s+`, 'i');
      for (let i = 0; i < s.length; i++) {
        const ch = s[i];
        if (q) { cur += ch; if (ch === q) q = null; continue; }
        if (ch === "'" || ch === '"') { q = ch; cur += ch; continue; }
        if (ch === '(') depth++;
        else if (ch === ')') depth--;
        if (depth === 0) {
          const rest = s.slice(i);
          const m = rest.match(re);
          if (m) {
            res.push(cur.trim());
            cur = '';
            i += m[0].length - 1;
            continue;
          }
        }
        cur += ch;
      }
      if (cur.trim()) res.push(cur.trim());
      return res;
    };

    const orParts = splitLogical(w, 'OR');
    if (orParts.length > 1) {
      let matched = false;
      for (const p of orParts) {
        const snap = argIdx.i;
        if (matchesWhere(p, row, args, argIdx)) {
          matched = true;
        } else {
          // ensure args index stays aligned for subsequent conditions
          const qMarks = (p.match(/\?/g) || []).length;
          argIdx.i = snap + qMarks;
        }
      }
      return matched;
    }

    const andParts = splitLogical(w, 'AND');
    if (andParts.length > 1) {
      for (const p of andParts) {
        if (!matchesWhere(p, row, args, argIdx)) {
          return false;
        }
      }
      return true;
    }

    const notExistsMatch = w.match(/^NOT\s+EXISTS\s*\(([\s\S]+)\)$/i);
    if (notExistsMatch) {
      const innerRows = executeSelect(notExistsMatch[1].trim(), args, argIdx);
      return innerRows.length === 0;
    }

    const inMatch = w.match(/^(.+?)\s+IN\s*\(([\s\S]+)\)$/i);
    if (inMatch) {
      const lhs = evalExpr(inMatch[1], row, args, argIdx);
      const itemExprs = splitTopLevelCommas(inMatch[2]);
      const vals = itemExprs.map(e => evalExpr(e, row, args, argIdx));
      return vals.some(v => v === lhs);
    }

    const ltMatch = w.match(/^(.+?)\s*<\s*(.+)$/);
    if (ltMatch && !w.includes('<=') && !w.includes('!=')) {
      const l = Number(evalExpr(ltMatch[1], row, args, argIdx) ?? 0);
      const r = Number(evalExpr(ltMatch[2], row, args, argIdx) ?? 0);
      return l < r;
    }

    const gteMatch = w.match(/^(.+?)\s*>=\s*(.+)$/);
    if (gteMatch) {
      const l = Number(evalExpr(gteMatch[1], row, args, argIdx) ?? 0);
      const r = Number(evalExpr(gteMatch[2], row, args, argIdx) ?? 0);
      return l >= r;
    }

    const eqMatch = w.match(/^(.+?)\s*=\s*(.+)$/);
    if (eqMatch) {
      const l = evalExpr(eqMatch[1], row, args, argIdx);
      const r = evalExpr(eqMatch[2], row, args, argIdx);
      return String(l ?? '') === String(r ?? '') && (l === null) === (r === null);
    }

    return true;
  }

  function executeSelect(sqlRaw: string, args: any[] = [], argIdx = { i: 0 }): Row[] {
    const sql = sqlRaw.trim().replace(/;$/, '');
    const pragmaInfo = sql.match(/^PRAGMA\s+table_info\s*\(\s*['"`]?([^'"`\)]+)['"`]?\s*\)/i);
    if (pragmaInfo) {
      const tbl = getTable(pragmaInfo[1]);
      if (!tbl) return [];
      return tbl.cols.map((name, cid) => ({ cid, name, type: 'TEXT' }));
    }
    const pragmaIdx = sql.match(/^PRAGMA\s+index_list\s*\(\s*['"`]?([^'"`\)]+)['"`]?\s*\)/i);
    if (pragmaIdx) {
      const idxSet = indexes.get(stripQuotes(pragmaIdx[1]).toLowerCase());
      return idxSet ? Array.from(idxSet).map(name => ({ name })) : [];
    }

    const masterMatch = sql.match(/^SELECT\s+name\s+FROM\s+sqlite_master\s+WHERE\s+type\s*=\s*'table'\s+AND\s+name\s*=\s*\?/i);
    if (masterMatch) {
      const tName = args[argIdx.i++];
      const tbl = getTable(String(tName || ''));
      return tbl ? [{ name: tbl.name }] : [];
    }

    const m = sql.match(/^SELECT\s+([\s\S]+?)\s+FROM\s+([^\s;]+)(?:\s+WHERE\s+([\s\S]+?))?(?:\s+ORDER\s+BY\s+([\s\S]+?))?(?:\s+LIMIT\s+(\d+))?$/i);
    if (!m) return [];

    const selectPart = m[1].trim();
    const tbl = getTable(m[2]);
    if (!tbl) return [];
    const whereClause = m[3]?.trim();
    const orderClause = m[4]?.trim();
    const limitVal = m[5] ? Number(m[5]) : null;

    const matched: Row[] = [];
    for (const r of tbl.rows) {
      const localIdx = { i: argIdx.i };
      if (matchesWhere(whereClause, r, args, localIdx)) {
        matched.push(cloneRow(r));
      }
    }
    if (whereClause) {
      const qCount = (whereClause.match(/\?/g) || []).length;
      argIdx.i += qCount;
    }

    if (orderClause) {
      const [colRaw, dirRaw] = orderClause.split(/\s+/);
      const col = stripQuotes(colRaw);
      const desc = /^DESC$/i.test(dirRaw || '');
      matched.sort((a, b) => {
        const av = String(a[col] ?? '');
        const bv = String(b[col] ?? '');
        return desc ? bv.localeCompare(av) : av.localeCompare(bv);
      });
    }

    const limited = limitVal !== null ? matched.slice(0, limitVal) : matched;

    const countMatch = selectPart.match(/^COUNT\(\*\)\s+as\s+(\w+)$/i);
    if (countMatch) {
      return [{ [countMatch[1]]: limited.length }];
    }
    if (selectPart === '1') {
      return limited.map(() => ({ '1': 1 }));
    }
    if (selectPart === '*') {
      return limited;
    }

    const cols = splitTopLevelCommas(selectPart).map(c => stripQuotes(c));
    return limited.map(r => {
      const projected: Row = {};
      for (const c of cols) projected[c] = r[c];
      return projected;
    });
  }

  function applyInsertRow(tbl: TableDef, colList: string[], values: any[], mode: 'normal' | 'ignore' | 'replace', conflictCol?: string, conflictUpdateSet?: string) {
    const newRow: Row = {};
    for (const c of tbl.cols) {
      newRow[c] = c in tbl.defaults ? tbl.defaults[c] : null;
    }
    colList.forEach((c, idx) => {
      newRow[c] = values[idx] === undefined ? null : values[idx];
    });

    const uniqueChecks = conflictCol ? [conflictCol] : tbl.uniqueCols;
    const existingIdx = tbl.rows.findIndex(existing =>
      uniqueChecks.some(u => existing[u] !== null && existing[u] !== undefined && String(existing[u]) === String(newRow[u]))
    );

    if (existingIdx >= 0) {
      if (mode === 'ignore') return 0;
      if (mode === 'replace') {
        tbl.rows[existingIdx] = newRow;
      } else if (conflictUpdateSet) {
        const target = tbl.rows[existingIdx];
        const assigns = splitTopLevelCommas(conflictUpdateSet);
        for (const assign of assigns) {
          const eqIdx = assign.indexOf('=');
          if (eqIdx === -1) continue;
          const col = stripQuotes(assign.slice(0, eqIdx));
          const rhs = assign.slice(eqIdx + 1).trim();
          const exMatch = rhs.match(/^excluded\.(.+)$/i);
          if (exMatch) {
            target[col] = newRow[stripQuotes(exMatch[1])];
          } else {
            target[col] = evalExpr(rhs, target, [], { i: 0 }, newRow);
          }
        }
      } else {
        throw new Error(`UNIQUE constraint failed on ${tbl.name}`);
      }
      return 1;
    }

    tbl.rows.push(newRow);

    if (tbl.name === 'stock_adjustments' && stockAdjInsertTriggerEnabled) {
      const pullMarkerTbl = getTable('sync_pull_marker');
      const isPulling = pullMarkerTbl && pullMarkerTbl.rows.length > 0;
      const syncQueueTbl = getTable('sync_queue');
      if (!isPulling && syncQueueTbl) {
        const sqRow: Row = {
          id: `sq_stock_adj_${newRow.id}`,
          table_name: 'stock_adjustments',
          record_id: newRow.id,
          action: 'INSERT',
          payload: JSON.stringify({
            id: newRow.id,
            product_id: newRow.product_id,
            product_name: newRow.product_name,
            old_qty: newRow.old_qty,
            new_qty: newRow.new_qty,
            type: newRow.type,
            created_at: newRow.created_at
          }),
          status: 'PENDING',
          retry_count: 0,
          error_message: null,
          created_at: new Date().toISOString()
        };
        const idx = syncQueueTbl.rows.findIndex(r => r.id === sqRow.id);
        if (idx >= 0) syncQueueTbl.rows[idx] = sqRow;
        else syncQueueTbl.rows.push(sqRow);
      }
    }

    return 1;
  }

  function executeStatement(stmtRaw: string, args: any[] = []): { changes: number; rows?: Row[] } {
    const sql = stmtRaw.trim().replace(/;$/, '');
    if (!sql) return { changes: 0 };

    if (/^CREATE\s+TRIGGER\b/i.test(sql)) {
      if (/trg_sync_stock_adj_insert/i.test(sql)) stockAdjInsertTriggerEnabled = true;
      return { changes: 0 };
    }
    if (/^DROP\s+TRIGGER\b/i.test(sql)) {
      if (/trg_sync_stock_adj_insert/i.test(sql)) stockAdjInsertTriggerEnabled = false;
      return { changes: 0 };
    }
    const createIdx = sql.match(/^CREATE\s+(?:UNIQUE\s+)?INDEX(?:\s+IF\s+NOT\s+EXISTS)?\s+([^\s]+)\s+ON\s+([^\s(]+)/i);
    if (createIdx) {
      const idxName = stripQuotes(createIdx[1]);
      const tblName = stripQuotes(createIdx[2]).toLowerCase();
      if (!indexes.has(tblName)) indexes.set(tblName, new Set());
      indexes.get(tblName)!.add(idxName);
      return { changes: 0 };
    }

    const createTbl = sql.match(/^CREATE\s+TABLE(?:\s+IF\s+NOT\s+EXISTS)?\s+([^\s(]+)\s*\(([\s\S]+)\)$/i);
    if (createTbl) {
      const tName = stripQuotes(createTbl[1]);
      if (tables.has(tName.toLowerCase())) return { changes: 0 };
      const defs = splitTopLevelCommas(createTbl[2]);
      const cols: string[] = [];
      const defaults: Record<string, any> = {};
      const uniqueCols: string[] = [];
      for (const d of defs) {
        if (/^(PRIMARY\s+KEY|UNIQUE|FOREIGN\s+KEY|CHECK)\b/i.test(d)) {
          const pkMatch = d.match(/^PRIMARY\s+KEY\s*\(([^)]+)\)/i);
          if (pkMatch) {
            const pkCols = pkMatch[1].split(',').map(stripQuotes);
            if (pkCols.length === 1) uniqueCols.push(pkCols[0]);
          }
          continue;
        }
        const tok = d.match(/^([^\s]+)\s*([\s\S]*)$/);
        if (!tok) continue;
        const cName = stripQuotes(tok[1]);
        const rest = tok[2] || '';
        cols.push(cName);
        if (/\bPRIMARY\s+KEY\b/i.test(rest) || /\bUNIQUE\b/i.test(rest)) {
          uniqueCols.push(cName);
        }
        const defMatch = rest.match(/\bDEFAULT\s+((?:'[^']*')|(?:[^\s]+(?:\([^\)]*\))?))/i);
        if (defMatch) defaults[cName] = parseDefaultLiteral(defMatch[1]);
      }
      tables.set(tName.toLowerCase(), { name: tName, cols, defaults, uniqueCols, rows: [] });
      return { changes: 0 };
    }

    const alterTbl = sql.match(/^ALTER\s+TABLE\s+([^\s]+)\s+ADD\s+COLUMN\s+([^\s]+)(?:\s+([\s\S]+))?$/i);
    if (alterTbl) {
      const tbl = getTable(alterTbl[1]);
      if (!tbl) return { changes: 0 };
      const cName = stripQuotes(alterTbl[2]);
      if (tbl.cols.includes(cName)) throw new Error(`duplicate column name: ${cName}`);
      tbl.cols.push(cName);
      const rest = alterTbl[3] || '';
      const defMatch = rest.match(/\bDEFAULT\s+((?:'[^']*')|(?:[^\s]+(?:\([^\)]*\))?))/i);
      const defVal = defMatch ? parseDefaultLiteral(defMatch[1]) : null;
      tbl.defaults[cName] = defVal;
      for (const r of tbl.rows) r[cName] = defVal;
      return { changes: 0 };
    }

    const insMatch = sql.match(
      /^INSERT(?:\s+OR\s+(IGNORE|REPLACE))?\s+INTO\s+([^\s(]+)\s*\(([^)]+)\)\s*VALUES\s*([\s\S]+?)(?:\s+ON\s+CONFLICT\s*\(([^)]+)\)\s+DO\s+UPDATE\s+SET\s+([\s\S]+))?$/i
    );
    if (insMatch) {
      const mode: 'normal' | 'ignore' | 'replace' = insMatch[1]
        ? (insMatch[1].toUpperCase() === 'IGNORE' ? 'ignore' : 'replace')
        : 'normal';
      const tbl = getTable(insMatch[2]);
      if (!tbl) throw new Error(`no such table: ${insMatch[2]}`);
      const cols = splitTopLevelCommas(insMatch[3]).map(stripQuotes);
      const tuplesRaw = splitTopLevelCommas(insMatch[4].trim());
      const argIdx = { i: 0 };
      let changes = 0;
      for (const tup of tuplesRaw) {
        const inner = tup.trim().replace(/^\(/, '').replace(/\)$/, '');
        const exprs = splitTopLevelCommas(inner);
        const vals = exprs.map(e => evalExpr(e, {}, args, argIdx));
        changes += applyInsertRow(tbl, cols, vals, mode, insMatch[5] ? stripQuotes(insMatch[5]) : undefined, insMatch[6]);
      }
      return { changes };
    }

    const updMatch = sql.match(/^UPDATE\s+([^\s]+)\s+SET\s+([\s\S]+?)(?:\s+WHERE\s+([\s\S]+))?$/i);
    if (updMatch) {
      const tbl = getTable(updMatch[1]);
      if (!tbl) return { changes: 0 };
      const assigns = splitTopLevelCommas(updMatch[2]);
      const whereClause = updMatch[3]?.trim();
      let setArgCount = 0;
      for (const a of assigns) setArgCount += (a.match(/\?/g) || []).length;
      const setArgs = args.slice(0, setArgCount);
      const whereArgs = args.slice(setArgCount);

      let changes = 0;
      for (const r of tbl.rows) {
        if (matchesWhere(whereClause, r, whereArgs, { i: 0 })) {
          const sIdx = { i: 0 };
          for (const assign of assigns) {
            const eqIdx = assign.indexOf('=');
            if (eqIdx === -1) continue;
            const col = stripQuotes(assign.slice(0, eqIdx));
            const rhs = assign.slice(eqIdx + 1).trim();
            r[col] = evalExpr(rhs, r, setArgs, sIdx);
          }
          changes++;
        }
      }
      return { changes };
    }

    const delMatch = sql.match(/^DELETE\s+FROM\s+([^\s]+)(?:\s+WHERE\s+([\s\S]+))?$/i);
    if (delMatch) {
      const tbl = getTable(delMatch[1]);
      if (!tbl) return { changes: 0 };
      const whereClause = delMatch[2]?.trim();
      const before = tbl.rows.length;
      tbl.rows = tbl.rows.filter(r => !matchesWhere(whereClause, r, args, { i: 0 }));
      return { changes: before - tbl.rows.length };
    }

    if (/^(SELECT|PRAGMA)\b/i.test(sql)) {
      return { changes: 0, rows: executeSelect(sql, args) };
    }

    return { changes: 0 };
  }

  return {
    async exec(sql: string) {
      for (const stmt of splitSqlStatements(sql)) {
        executeStatement(stmt, []);
      }
    },
    async run(sql: string, args: any[] = []) {
      const argArr = Array.isArray(args) ? args : [args];
      return executeStatement(sql, argArr);
    },
    async all(sql: string, args: any[] = []) {
      const argArr = Array.isArray(args) ? args : [args];
      return executeSelect(sql, argArr);
    },
    async get(sql: string, args: any[] = []) {
      const argArr = Array.isArray(args) ? args : [args];
      const rows = executeSelect(sql, argArr);
      return rows[0];
    }
  };
}

async function createInMemoryDb(withTriggers = false) {
  const db = createPureInMemorySqlite();
  await db.exec(`
    CREATE TABLE IF NOT EXISTS products (
      id TEXT PRIMARY KEY,
      sku TEXT UNIQUE,
      name TEXT,
      category TEXT,
      price REAL DEFAULT 0,
      selling_price REAL DEFAULT 0,
      cost_price REAL DEFAULT 0,
      stock REAL DEFAULT 0,
      stock_quantity REAL DEFAULT 0,
      min_stock REAL DEFAULT 0,
      supplier TEXT,
      unit TEXT DEFAULT 'pcs',
      barcode TEXT,
      brand TEXT,
      serial_no TEXT DEFAULT '',
      batch_code TEXT DEFAULT '',
      expiry_date TEXT,
      supplier_phone TEXT DEFAULT '',
      measure_details TEXT DEFAULT '',
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS sales (
      id TEXT PRIMARY KEY,
      invoice_no TEXT UNIQUE,
      customer_id TEXT,
      customer_name TEXT,
      items TEXT DEFAULT '[]',
      subtotal REAL DEFAULT 0,
      discount REAL DEFAULT 0,
      tax REAL DEFAULT 0,
      total_amount REAL DEFAULT 0,
      status TEXT DEFAULT 'Paid',
      payment_method TEXT DEFAULT 'Cash',
      payment_received REAL DEFAULT 0,
      balance_due REAL DEFAULT 0,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS stock_adjustments (
      id TEXT PRIMARY KEY,
      product_id TEXT,
      product_name TEXT,
      old_qty REAL DEFAULT 0,
      new_qty REAL DEFAULT 0,
      reason TEXT,
      type TEXT,
      user_email TEXT,
      branch_id TEXT,
      station_id TEXT,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS deleted_records (
      table_name TEXT NOT NULL,
      record_id TEXT NOT NULL,
      deleted_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (table_name, record_id)
    );
    CREATE TABLE IF NOT EXISTS system_settings (
      id TEXT PRIMARY KEY,
      key TEXT,
      value TEXT,
      system_wipe_timestamp TEXT,
      last_counter_sync_timestamp TEXT,
      last_sync_timestamp TEXT,
      counter_sync_status TEXT DEFAULT 'IDLE',
      counter_pending_count INTEGER DEFAULT 0
    );
    INSERT OR IGNORE INTO system_settings (id) VALUES ('global');
  `);

  if (withTriggers) {
    await db.exec(`
      CREATE TABLE IF NOT EXISTS sync_pull_marker (id INTEGER PRIMARY KEY);
      CREATE TRIGGER IF NOT EXISTS trg_sync_stock_adj_insert AFTER INSERT ON stock_adjustments
      WHEN NOT EXISTS (SELECT 1 FROM sync_pull_marker)
      BEGIN
        INSERT OR REPLACE INTO sync_queue (id, table_name, record_id, action, payload, status, created_at)
        VALUES (
          'sq_stock_adj_' || NEW.id,
          'stock_adjustments',
          NEW.id,
          'INSERT',
          json_object('id', NEW.id, 'product_id', NEW.product_id, 'product_name', NEW.product_name, 'old_qty', NEW.old_qty, 'new_qty', NEW.new_qty, 'type', NEW.type, 'created_at', NEW.created_at),
          'PENDING',
          strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        );
      END;
    `);
  }

  await ensureSyncSchema(db);
  return db;
}

async function createMockTurso() {
  const cloudDb = await createInMemoryDb(false);
  const tursoClient: any = {
    async execute(queryOrObj: any) {
      const sql = typeof queryOrObj === 'string' ? queryOrObj : queryOrObj.sql;
      const args = typeof queryOrObj === 'string' ? [] : (queryOrObj.args || []);
      const upper = sql.trim().toUpperCase();
      if (upper.startsWith('SELECT') || upper.startsWith('PRAGMA')) {
        return { rows: await cloudDb.all(sql, args) };
      }
      if (args.length > 0) {
        const r = await cloudDb.run(sql, args);
        return { rowsAffected: r?.changes || 0 };
      }
      await cloudDb.exec(sql);
      return { rowsAffected: 1 };
    },
    async batch(statements: any[]) {
      const res: any[] = [];
      for (const s of statements) {
        const sql = typeof s === 'string' ? s : s.sql;
        const args = typeof s === 'string' ? [] : (s.args || []);
        res.push(args.length > 0 ? await cloudDb.run(sql, args) : await cloudDb.exec(sql));
      }
      return res;
    },
    async transaction() {
      let closed = false;
      const queuedOps: Array<{ sql: string; args: any[] }> = [];
      return {
        async execute(q: any) {
          if (closed) throw new Error('Transaction closed');
          const sql = typeof q === 'string' ? q : q.sql;
          const args = typeof q === 'string' ? [] : (q.args || []);
          queuedOps.push({ sql, args });
          return { rowsAffected: 1 };
        },
        async commit() {
          if (closed) return;
          for (const op of queuedOps) {
            if (op.args.length > 0) await cloudDb.run(op.sql, op.args);
            else await cloudDb.exec(op.sql);
          }
          closed = true;
        },
        async rollback() {
          queuedOps.length = 0;
          closed = true;
        }
      };
    }
  };
  return { cloudDb, tursoClient };
}

describe('Two-Way Sync Pipeline (syncService.js)', () => {
  beforeEach(() => {
    delete process.env.VERCEL;
    delete process.env.VERCEL_ENV;
    delete process.env.APP_ROLE;
    delete process.env.IS_WEB_CLIENT;
    delete process.env.DATABASE_ENGINE;
    delete process.env.TURSO_DATABASE_URL;
    delete process.env.TURSO_AUTH_TOKEN;
    __resetSyncSchemaForTesting();
  });

  afterAll(() => {
    for (const [k, v] of Object.entries(savedEnv)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it('does not double-apply historical stock_adjustments deltas during downstream pull', async () => {
    const localDb = await createInMemoryDb(true);
    const { cloudDb, tursoClient } = await createMockTurso();

    await cloudDb.run(
      `INSERT INTO products (id, sku, name, stock, stock_quantity, price, measure_details, updated_at)
       VALUES ('p_sand', 'SK129', 'Sand', 1.999, 1.999, 10000, '{"conversionRate":1000}', '2026-11-28T10:00:00.000Z'),
              ('p_drill', 'PT-BOS-001', 'Bosch Drill', 2, 2, 250, '', '2026-11-28T10:34:33.709Z')`
    );
    await cloudDb.run(
      `INSERT INTO stock_adjustments (id, product_id, product_name, old_qty, new_qty, type, created_at)
       VALUES ('sa_sand_ex', 'p_sand', 'Sand', 2, 1.999, 'Sale Return Exchange', '2026-11-26T15:53:55.328Z'),
              ('sa_drill_s1', 'p_drill', 'Bosch Drill', 3, 1, 'Sale', '2026-11-28T10:06:09.499Z'),
              ('sa_drill_r1', 'p_drill', 'Bosch Drill', 0, 1, 'Sale Return Restock', '2026-11-28T10:34:33.709Z')`
    );

    await pullDownstreamChanges(localDb, tursoClient);

    const sand = await localDb.get("SELECT stock, stock_quantity, measure_details FROM products WHERE id = 'p_sand'");
    const drill = await localDb.get("SELECT stock, stock_quantity, updated_at FROM products WHERE id = 'p_drill'");
    const localAdjs = await localDb.all('SELECT id FROM stock_adjustments');

    expect(Number(sand.stock)).toBeCloseTo(1.999, 6);
    expect(Number(sand.stock_quantity)).toBeCloseTo(1.999, 6);
    expect(sand.measure_details).toBe('{"conversionRate":1000}');
    expect(Number(drill.stock)).toBe(2);
    expect(drill.updated_at).toBe('2026-11-28T10:34:33.709Z');
    expect(localAdjs).toHaveLength(3);
  });

  it('pulls online sales stock decreases and measure_details updates from cloud to desktop when newer', async () => {
    const localDb = await createInMemoryDb(true);
    const { cloudDb, tursoClient } = await createMockTurso();

    await localDb.run(
      `INSERT INTO products (id, sku, name, stock, stock_quantity, price, measure_details, updated_at)
       VALUES ('p_paint', 'PT-NIP-004', 'Nippon Paint', 10, 10, 100, '', '2026-11-28T09:00:00.000Z')`
    );
    await cloudDb.run(
      `INSERT INTO products (id, sku, name, stock, stock_quantity, price, measure_details, updated_at)
       VALUES ('p_paint', 'PT-NIP-004', 'Nippon Paint', 7, 7, 105, '{"conversionRate":4}', '2026-11-28T10:05:00.000Z')`
    );

    await pullDownstreamChanges(localDb, tursoClient);

    const localPaint = await localDb.get("SELECT stock, stock_quantity, price, measure_details, updated_at FROM products WHERE id = 'p_paint'");
    expect(Number(localPaint.stock)).toBe(7);
    expect(Number(localPaint.stock_quantity)).toBe(7);
    expect(Number(localPaint.price)).toBe(105);
    expect(localPaint.measure_details).toBe('{"conversionRate":4}');
    expect(localPaint.updated_at).toBe('2026-11-28T10:05:00.000Z');
  });

  it('preserves queued local non-master updates (sales) during downstream pull', async () => {
    const localDb = await createInMemoryDb(true);
    const { cloudDb, tursoClient } = await createMockTurso();

    await cloudDb.run(
      `INSERT INTO sales (id, invoice_no, total_amount, status, created_at)
       VALUES ('s_1', 'POS1-INV-00001', 500, 'Paid', '2026-11-28T10:00:00.000Z')`
    );
    await localDb.run(
      `INSERT INTO sales (id, invoice_no, total_amount, status, created_at)
       VALUES ('s_1', 'POS1-INV-00001', 500, 'VOIDED', '2026-11-28T10:00:00.000Z')`
    );
    await enqueueSync(localDb, 'sales', 's_1', 'UPDATE');

    await pullDownstreamChanges(localDb, tursoClient);

    const localSale = await localDb.get("SELECT status FROM sales WHERE id = 's_1'");
    expect(localSale.status).toBe('VOIDED');
  });

  it('does not overwrite concurrent cloud stock deltas when pushing both stock_adjustments and products', async () => {
    const localDb = await createInMemoryDb(true);
    const { cloudDb, tursoClient } = await createMockTurso();

    // Cloud started at 10 and had an online web sale of 2 -> cloud stock = 8
    await cloudDb.run(
      `INSERT INTO products (id, sku, name, stock, stock_quantity, price, updated_at)
       VALUES ('p_drill', 'PT-BOS-001', 'Bosch Drill', 8, 8, 250, '2026-11-28T10:01:00.000Z')`
    );

    // Offline desktop started at 10, sold 3 -> local stock = 7, queued both stock_adjustments (-3) and products UPDATE
    await localDb.run(
      `INSERT INTO products (id, sku, name, stock, stock_quantity, price, updated_at)
       VALUES ('p_drill', 'PT-BOS-001', 'Bosch Drill', 7, 7, 250, '2026-11-28T10:02:00.000Z')`
    );
    await localDb.run(
      `INSERT INTO stock_adjustments (id, product_id, product_name, old_qty, new_qty, type, created_at)
       VALUES ('sa_offline_3', 'p_drill', 'Bosch Drill', 10, 7, 'Sale', '2026-11-28T10:02:00.000Z')`
    );
    await enqueueSync(localDb, 'products', 'p_drill', 'UPDATE');

    await pushUpstreamChanges(localDb, tursoClient);
    const cloudProd = await cloudDb.get("SELECT stock, stock_quantity FROM products WHERE id = 'p_drill'");
    expect(Number(cloudProd.stock)).toBe(5);
    expect(Number(cloudProd.stock_quantity)).toBe(5);

    await pullDownstreamChanges(localDb, tursoClient);
    const localProd = await localDb.get("SELECT stock, stock_quantity FROM products WHERE id = 'p_drill'");
    expect(Number(localProd.stock)).toBe(5);
    expect(Number(localProd.stock_quantity)).toBe(5);
  });
});
