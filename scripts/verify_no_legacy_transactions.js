#!/usr/bin/env node
/**
 * ============================================================================
 * MUTHUWADIGE HARDWARE ERP — TRANSACTION SAFETY RELEASE GATE
 * File: scripts/verify_no_legacy_transactions.js
 * ============================================================================
 *
 * STATIC RELEASE VERIFICATION SCRIPT
 *
 * Purpose:
 * Prevents packaging, building or deploying any client installer when
 * unmanaged raw database transactions or legacy helper functions remain
 * in application source code.
 *
 * Checks:
 * 1. Legacy transaction helper usage / definitions:
 *    - beginTxn(...)
 *    - commitTxn(...)
 *    - rollbackTxn(...)
 *    - safeRollback(...)
 * 2. Unmanaged raw transaction statements on any database variable:
 *    - db.run('BEGIN TRANSACTION'), activeDb.run('BEGIN TRANSACTION'), etc.
 *    - db.exec('BEGIN TRANSACTION'), database.exec('COMMIT'), etc.
 *    - Multiline SQL, different quote styles (', ", `)
 *    - Standalone transaction string literals ('BEGIN', 'BEGIN TRANSACTION', 'COMMIT', 'ROLLBACK')
 * 3. Narrow Adapter Exception:
 *    - src/db/connection.js and src/db/connection.ts contain legitimate internal
 *      transaction lifecycle statements inside transaction(callback) and string
 *      guards in validation interceptors.
 *
 * Exit codes:
 *   0 = Clean. Zero legacy transaction operations found.
 *   1 = Blocked. Legacy transactions detected; release packaging halted.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

// Helper functions to strip comments while preserving character layout and line numbers
function stripCommentsPreservingLayout(code) {
  let result = '';
  let inString = false;
  let stringChar = null;
  let inLineComment = false;
  let inBlockComment = false;
  let isEscaped = false;

  for (let i = 0; i < code.length; i++) {
    const char = code[i];
    const nextChar = i + 1 < code.length ? code[i + 1] : '';

    if (inLineComment) {
      if (char === '\n') {
        inLineComment = false;
        result += '\n';
      } else {
        result += ' ';
      }
      continue;
    }

    if (inBlockComment) {
      if (char === '*' && nextChar === '/') {
        inBlockComment = false;
        result += '  ';
        i++;
      } else if (char === '\n') {
        result += '\n';
      } else {
        result += ' ';
      }
      continue;
    }

    if (inString) {
      result += char;
      if (isEscaped) {
        isEscaped = false;
      } else if (char === '\\') {
        isEscaped = true;
      } else if (char === stringChar) {
        inString = false;
        stringChar = null;
      }
      continue;
    }

    // Outside comments and strings
    if (char === '/' && nextChar === '/') {
      inLineComment = true;
      result += '  ';
      i++;
      continue;
    }

    if (char === '/' && nextChar === '*') {
      inBlockComment = true;
      result += '  ';
      i++;
      continue;
    }

    if (char === '"' || char === "'" || char === '`') {
      inString = true;
      stringChar = char;
      isEscaped = false;
      result += char;
      continue;
    }

    result += char;
  }

  return result;
}

// Detection patterns
const HELPER_REGEX = /\b(beginTxn|commitTxn|rollbackTxn|safeRollback)\s*\(/g;
const RAW_METHOD_TXN_REGEX = /\b([a-zA-Z0-9_$]+)\s*!?\s*\.\s*(?:run|exec|execute|all|get|query)\s*\(\s*([`'"])\s*(BEGIN(?:\s+TRANSACTION)?|COMMIT(?:\s+TRANSACTION)?|ROLLBACK(?:\s+TRANSACTION)?)\s*;?\s*\2/gi;
const STANDALONE_TXN_STRING_REGEX = /([`'"])\s*(BEGIN(?:\s+TRANSACTION)?|COMMIT(?:\s+TRANSACTION)?|ROLLBACK(?:\s+TRANSACTION)?)\s*;?\s*\1/gi;

/**
 * Narrow exception rule for adapter internals in src/db/connection.js / connection.ts.
 * Only legitimate adapter internals are exempted.
 */
function isLegitimateAdapterStatement(relPath, snippet, rawLine) {
  const normPath = relPath.replace(/\\/g, '/');
  if (normPath !== 'src/db/connection.js' && normPath !== 'src/db/connection.ts') {
    return false;
  }

  // Exempt internal connection transaction runner operations:
  // localSqliteDb.run('BEGIN TRANSACTION'), localSqliteDb.run('COMMIT'), localSqliteDb.run('ROLLBACK')
  if (/localSqliteDb!?\s*\.\s*run\s*\(\s*['"`](BEGIN TRANSACTION|COMMIT|ROLLBACK)['"`]\s*\)/.test(rawLine)) {
    return true;
  }

  // Exempt internal Turso client transaction commit/rollback
  if (/txn\s*\.\s*(?:commit|rollback)\s*\(/.test(rawLine) || /activeTursoTxn\s*\.\s*rollback\s*\(/.test(rawLine)) {
    return true;
  }

  // Exempt string validation guards (e.g. trimmed === 'BEGIN' ...)
  if (/trimmed\s*===|includes\s*\(|===.*(?:'BEGIN'|"BEGIN"|`BEGIN`|'COMMIT'|"COMMIT"|`COMMIT`|'ROLLBACK'|"ROLLBACK"|`ROLLBACK`)/.test(rawLine)) {
    return true;
  }

  return false;
}

/**
 * Scan a single file for legacy transaction operations.
 */
export function scanFile(filePath, projectRoot = rootDir) {
  const relPath = path.relative(projectRoot, filePath).replace(/\\/g, '/');
  const rawCode = fs.readFileSync(filePath, 'utf8');
  const cleanCode = stripCommentsPreservingLayout(rawCode);
  const rawLines = rawCode.split('\n');
  const cleanLines = cleanCode.split('\n');
  const findings = [];

  // 1. Helper function calls / definitions
  cleanLines.forEach((line, idx) => {
    let match;
    HELPER_REGEX.lastIndex = 0;
    while ((match = HELPER_REGEX.exec(line)) !== null) {
      const rawLine = rawLines[idx] || '';
      findings.push({
        file: relPath,
        line: idx + 1,
        category: 'LEGACY_HELPER',
        detail: `Invocation or definition of legacy transaction helper: ${match[1]}()`,
        snippet: rawLine.trim()
      });
    }
  });

  // 2. Raw database transaction method calls (e.g. db.run('BEGIN TRANSACTION'))
  let mMatch;
  RAW_METHOD_TXN_REGEX.lastIndex = 0;
  while ((mMatch = RAW_METHOD_TXN_REGEX.exec(cleanCode)) !== null) {
    const lineNum = cleanCode.slice(0, mMatch.index).split('\n').length;
    const rawLine = rawLines[lineNum - 1] || '';
    const snippet = mMatch[0].replace(/\s+/g, ' ');

    if (!isLegitimateAdapterStatement(relPath, snippet, rawLine)) {
      findings.push({
        file: relPath,
        line: lineNum,
        category: 'UNMANAGED_RAW_METHOD',
        detail: `Unmanaged database transaction call '${snippet}' on variable '${mMatch[1]}'`,
        snippet: rawLine.trim()
      });
    }
  }

  // 3. Standalone transaction string literals (e.g. const sql = 'BEGIN TRANSACTION')
  let sMatch;
  STANDALONE_TXN_STRING_REGEX.lastIndex = 0;
  while ((sMatch = STANDALONE_TXN_STRING_REGEX.exec(cleanCode)) !== null) {
    const lineNum = cleanCode.slice(0, sMatch.index).split('\n').length;
    const rawLine = rawLines[lineNum - 1] || '';
    const snippet = sMatch[0].trim();

    // Avoid duplicate report if already captured by RAW_METHOD_TXN_REGEX
    const alreadyCaptured = findings.some(f => f.line === lineNum && f.category === 'UNMANAGED_RAW_METHOD');
    if (!alreadyCaptured && !isLegitimateAdapterStatement(relPath, snippet, rawLine)) {
      findings.push({
        file: relPath,
        line: lineNum,
        category: 'UNMANAGED_TXN_STRING',
        detail: `Raw transaction string literal ${snippet}`,
        snippet: rawLine.trim()
      });
    }
  }

  return findings;
}

/**
 * Recursively discover all relevant application files.
 */
function discoverApplicationFiles(dir, fileList = []) {
  const IGNORED_DIRS = new Set([
    'node_modules',
    '.git',
    'dist',
    'release-dist',
    'scratch',
    'build',
    'Reports',
    'backups',
    'certs',
    'archive'
  ]);

  const ALLOWED_EXTENSIONS = new Set(['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs']);

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!IGNORED_DIRS.has(entry.name)) {
        discoverApplicationFiles(fullPath, fileList);
      }
    } else if (ALLOWED_EXTENSIONS.has(path.extname(entry.name))) {
      fileList.push(fullPath);
    }
  }
  return fileList;
}

/**
 * Main execution
 */
export function runReleaseGate({ silent = false, scanScripts = false } = {}) {
  const filesToScan = discoverApplicationFiles(rootDir).filter(f => {
    const rel = path.relative(rootDir, f).replace(/\\/g, '/');
    if (!scanScripts && rel.startsWith('scripts/')) {
      // Exclude maintenance scripts from blocking release gate unless explicitly requested
      return false;
    }
    return true;
  });

  if (!silent) {
    console.log('======================================================================');
    console.log('🔒 MUTHUWADIGE HARDWARE ERP — TRANSACTION SAFETY RELEASE GATE');
    console.log('======================================================================');
    console.log(`Auditing ${filesToScan.length} application files across codebase...\n`);
  }

  let totalViolations = 0;
  const violationsByFile = {};

  for (const file of filesToScan) {
    const findings = scanFile(file, rootDir);
    if (findings.length > 0) {
      const rel = path.relative(rootDir, file).replace(/\\/g, '/');
      violationsByFile[rel] = findings;
      totalViolations += findings.length;
    }
  }

  if (!silent) {
    if (totalViolations > 0) {
      console.error(`❌ RELEASE SAFETY GATE FAILED: Found ${totalViolations} unmanaged transaction operations!\n`);
      for (const [file, findings] of Object.entries(violationsByFile)) {
        console.error(`📄 ${file} (${findings.length} violation${findings.length > 1 ? 's' : ''}):`);
        for (const f of findings) {
          console.error(`   [Line ${f.line.toString().padStart(5)}] [${f.category}] ${f.detail}`);
          console.error(`     Snippet: ${f.snippet}`);
        }
        console.error('');
      }

      console.error('🛑 BUILD & PACKAGING HALTED:');
      console.error('   The application contains unmanaged legacy database transactions or');
      console.error('   legacy transaction helper invocations.');
      console.error('   Every business transaction must be migrated to unified db.transaction(callback)');
      console.error('   before an installer or release package can be produced.');
      console.error('======================================================================\n');
    } else {
      console.log('✅ RELEASE SAFETY GATE PASSED:');
      console.log('   All application files comply with the unified db.transaction(callback) architecture.');
      console.log('   Zero unmanaged raw transaction strings or legacy helpers detected.');
      console.log('======================================================================\n');
    }
  }

  return {
    success: totalViolations === 0,
    totalViolations,
    violationsByFile,
    scannedFilesCount: filesToScan.length
  };
}

// Direct CLI invocation
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const result = runReleaseGate();
  process.exit(result.success ? 0 : 1);
}
