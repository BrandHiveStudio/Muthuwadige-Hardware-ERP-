import fs from 'fs';

console.log('==================================================');
console.log('1. server.js: Locating POST /api/sales & shift_logs logic');
console.log('==================================================');
if (fs.existsSync('server.js')) {
  const content = fs.readFileSync('server.js', 'utf8');
  const lines = content.split('\n');
  lines.forEach((l, idx) => {
    if (l.includes("app.post('/api/sales'") || l.includes('app.post("/api/sales"')) {
      console.log(`Found POST /api/sales at line ${idx + 1}`);
      for (let j = idx; j < idx + 60 && j < lines.length; j++) {
        if (lines[j].includes('shift_logs') || lines[j].includes('cash_sales') || lines[j].includes('tender') || lines[j].includes('split') || lines[j].includes('UPDATE shift_logs')) {
          console.log(`  [server.js:${j + 1}] ${lines[j].trim()}`);
        }
      }
    }
  });

  // Also search for any "UPDATE shift_logs" in the entire server.js
  console.log('\n--- All UPDATE shift_logs occurrences in server.js ---');
  lines.forEach((l, idx) => {
    if (l.includes('UPDATE shift_logs')) {
      for (let j = Math.max(0, idx - 2); j < idx + 8 && j < lines.length; j++) {
        console.log(`  [server.js:${j + 1}] ${lines[j].trim()}`);
      }
    }
  });
}

console.log('\n==================================================');
console.log('2. syncService.js: How sync_queue constructs Turso statements (Lines 690-760)');
console.log('==================================================');
const syncFile = 'src/services/syncService.js';
if (fs.existsSync(syncFile)) {
  const lines = fs.readFileSync(syncFile, 'utf8').split('\n');
  for (let i = 690; i < 760 && i < lines.length; i++) {
    console.log(`[syncService.js:${i + 1}] ${lines[i]}`);
  }
}

console.log('\n==================================================');
console.log('3. Sales.tsx: Searching for Credit Settlement / Unpaid Invoices Filter');
console.log('==================================================');
const salesFile = 'src/pages/Sales.tsx';
if (fs.existsSync(salesFile)) {
  const content = fs.readFileSync(salesFile, 'utf8');
  const lines = content.split('\n');
  lines.forEach((l, idx) => {
    if (l.includes("'Non Paid'") || l.includes('"Non Paid"') || (l.includes('.status') && l.includes('pending') && l.includes('credit'))) {
      console.log(`  [Sales.tsx:${idx + 1}] ${l.trim()}`);
    }
  });
}

process.exit(0);
