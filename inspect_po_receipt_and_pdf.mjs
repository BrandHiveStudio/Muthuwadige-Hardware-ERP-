import fs from 'fs';

console.log('==================================================');
console.log('1. server.js: receive-po Return/Response (Lines 9670-9720)');
console.log('==================================================');
if (fs.existsSync('server.js')) {
  const lines = fs.readFileSync('server.js', 'utf8').split('\n');
  for (let i = 9670; i < 9720 && i < lines.length; i++) {
    console.log(`[server.js:${i + 1}] ${lines[i]}`);
  }
}

console.log('\n==================================================');
console.log('2. server.js: revert_purchase_order_receipt RPC Route');
console.log('==================================================');
if (fs.existsSync('server.js')) {
  const lines = fs.readFileSync('server.js', 'utf8').split('\n');
  lines.forEach((l, idx) => {
    if (l.includes('revert_purchase_order_receipt') || l.includes('revert-po')) {
      for (let j = Math.max(0, idx - 2); j < idx + 30 && j < lines.length; j++) {
        console.log(`[server.js:${j + 1}] ${lines[j]}`);
      }
    }
  });
}

console.log('\n==================================================');
console.log('3. Purchasing.tsx: downloadPO_PDF Totals Block (Lines 625-700)');
console.log('==================================================');
const poFile = 'src/pages/Purchasing.tsx';
if (fs.existsSync(poFile)) {
  const lines = fs.readFileSync(poFile, 'utf8').split('\n');
  for (let i = 625; i < 700 && i < lines.length; i++) {
    console.log(`[Purchasing.tsx:${i + 1}] ${lines[i]}`);
  }
}

process.exit(0);
