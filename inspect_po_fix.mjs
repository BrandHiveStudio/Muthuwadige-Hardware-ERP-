import fs from 'fs';

console.log('==================================================');
console.log('1. Purchasing.tsx: Lines 160-220 (fetchData mapping)');
console.log('==================================================');
const poFile = 'src/pages/Purchasing.tsx';
if (fs.existsSync(poFile)) {
  const lines = fs.readFileSync(poFile, 'utf8').split('\n');
  for (let i = 160; i < 220 && i < lines.length; i++) {
    console.log(`[Purchasing.tsx:${i + 1}] ${lines[i]}`);
  }
}

console.log('\n==================================================');
console.log('2. server.js: Checking purchase_orders ALTER TABLE columns');
console.log('==================================================');
if (fs.existsSync('server.js')) {
  const lines = fs.readFileSync('server.js', 'utf8').split('\n');
  lines.forEach((l, idx) => {
    if (l.includes('ALTER TABLE purchase_orders')) {
      console.log(`[server.js:${idx + 1}] ${l.trim()}`);
    }
  });
}

process.exit(0);
