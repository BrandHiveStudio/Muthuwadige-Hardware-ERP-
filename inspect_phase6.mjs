import fs from 'fs';

console.log('==================================================');
console.log('1. server.js: SHIFT_LOGS UPDATE IN /api/sales');
console.log('==================================================');
if (fs.existsSync('server.js')) {
  const content = fs.readFileSync('server.js', 'utf8');
  const lines = content.split('\n');
  lines.forEach((l, idx) => {
    if ((l.includes('UPDATE shift_logs') || l.includes('shift_logs')) && (l.includes('cash_sales') || l.includes('expected_cash'))) {
      for (let j = Math.max(0, idx - 4); j < idx + 12 && j < lines.length; j++) {
        console.log(`[server.js:${j + 1}] ${lines[j]}`);
      }
    }
  });
}

console.log('\n==================================================');
console.log('2. server.js: LINES 8915-8965 (BOUNCED CHEQUE HANDLING)');
console.log('==================================================');
if (fs.existsSync('server.js')) {
  const lines = fs.readFileSync('server.js', 'utf8').split('\n');
  for (let i = 8914; i < 8965 && i < lines.length; i++) {
    console.log(`[server.js:${i + 1}] ${lines[i]}`);
  }
}

console.log('\n==================================================');
console.log('3. Sales.tsx: LINES 3360-3385 (UNPAID CREDIT FILTER)');
console.log('==================================================');
const salesFile = 'src/pages/Sales.tsx';
if (fs.existsSync(salesFile)) {
  const lines = fs.readFileSync(salesFile, 'utf8').split('\n');
  for (let i = 3360; i < 3385 && i < lines.length; i++) {
    console.log(`[Sales.tsx:${i + 1}] ${lines[i]}`);
  }
}

process.exit(0);
