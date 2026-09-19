import fs from 'fs';

console.log('==================================================');
console.log('1. INSPECTING Purchasing.tsx: Lines 1170-1225 (Receive PO Call Flow)');
console.log('==================================================');
const poFile = 'src/pages/Purchasing.tsx';
if (fs.existsSync(poFile)) {
  const lines = fs.readFileSync(poFile, 'utf8').split('\n');
  for (let i = 1170; i < 1225 && i < lines.length; i++) {
    console.log(`[Purchasing.tsx:${i + 1}] ${lines[i]}`);
  }
}

console.log('\n==================================================');
console.log('2. INSPECTING SPLIT-TENDER IN server.js (POST /api/sales)');
console.log('==================================================');
if (fs.existsSync('server.js')) {
  const lines = fs.readFileSync('server.js', 'utf8').split('\n');
  lines.forEach((l, idx) => {
    if (l.includes('cash_sales = cash_sales +') || l.includes('shift_logs') && (l.includes('cash_sales') || l.includes('cashSales'))) {
      for (let j = Math.max(0, idx - 4); j < idx + 10 && j < lines.length; j++) {
        console.log(`[server.js:${j + 1}] ${lines[j]}`);
      }
    }
  });
}

console.log('\n==================================================');
console.log('3. INSPECTING BOUNCED CHEQUE STATUS IN server.js');
console.log('==================================================');
if (fs.existsSync('server.js')) {
  const lines = fs.readFileSync('server.js', 'utf8').split('\n');
  lines.forEach((l, idx) => {
    if (l.includes("'BOUNCED'") || l.includes('"BOUNCED"')) {
      for (let j = Math.max(0, idx - 2); j < idx + 12 && j < lines.length; j++) {
        console.log(`[server.js:${j + 1}] ${lines[j]}`);
      }
    }
  });
}

console.log('\n==================================================');
console.log('4. INSPECTING TABLE ORDER IN syncService.js (pushUpstreamChanges)');
console.log('==================================================');
const syncFile = 'src/services/syncService.js';
if (fs.existsSync(syncFile)) {
  const lines = fs.readFileSync(syncFile, 'utf8').split('\n');
  lines.forEach((l, idx) => {
    if (l.includes('const SYNC_TABLES') || l.includes('const tables =') || l.includes('sync_queue') && l.includes('ORDER BY')) {
      for (let j = Math.max(0, idx - 2); j < idx + 15 && j < lines.length; j++) {
        console.log(`[${syncFile}:${j + 1}] ${lines[j]}`);
      }
    }
  });
}

process.exit(0);
