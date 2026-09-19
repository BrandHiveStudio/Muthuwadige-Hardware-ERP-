import fs from 'fs';

console.log('==================================================');
console.log('1. server.js: Lines 10200-10250 (executeRevertPurchaseOrderReceipt Cheque Handling)');
console.log('==================================================');
if (fs.existsSync('server.js')) {
  const lines = fs.readFileSync('server.js', 'utf8').split('\n');
  for (let i = 10199; i < 10250 && i < lines.length; i++) {
    console.log(`[server.js:${i + 1}] ${lines[i]}`);
  }
}

console.log('\n==================================================');
console.log('2. Purchasing.tsx: Lines 725-765 (PDF Signature / Bottom Section)');
console.log('==================================================');
const poFile = 'src/pages/Purchasing.tsx';
if (fs.existsSync(poFile)) {
  const lines = fs.readFileSync(poFile, 'utf8').split('\n');
  for (let i = 725; i < 765 && i < lines.length; i++) {
    console.log(`[Purchasing.tsx:${i + 1}] ${lines[i]}`);
  }
}

console.log('\n==================================================');
console.log('3. src/lib/api.ts: Checking api.purchasing.receivePo definition');
console.log('==================================================');
const apiFile = 'src/lib/api.ts';
if (fs.existsSync(apiFile)) {
  const lines = fs.readFileSync(apiFile, 'utf8').split('\n');
  lines.forEach((l, idx) => {
    if (l.includes('receivePo') || l.includes('receive-po')) {
      for (let j = Math.max(0, idx - 2); j < idx + 10 && j < lines.length; j++) {
        console.log(`[${apiFile}:${j + 1}] ${lines[j]}`);
      }
    }
  });
}

process.exit(0);
