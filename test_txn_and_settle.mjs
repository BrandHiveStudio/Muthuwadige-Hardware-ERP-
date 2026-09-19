import fs from 'fs';

console.log('==================================================');
console.log('1. Purchasing.tsx: Lines 1120-1190 (Inside handleConfirmReceiveAndSettle)');
console.log('==================================================');
const poFile = 'src/pages/Purchasing.tsx';
if (fs.existsSync(poFile)) {
  const lines = fs.readFileSync(poFile, 'utf8').split('\n');
  for (let i = 1120; i < 1195 && i < lines.length; i++) {
    console.log(`[Purchasing.tsx:${i + 1}] ${lines[i]}`);
  }
}

console.log('\n==================================================');
console.log('2. connection.js: Lines 785-840 (End of db.transaction)');
console.log('==================================================');
const connFile = fs.existsSync('src/db/connection.js') ? 'src/db/connection.js' : 'connection.js';
if (fs.existsSync(connFile)) {
  const lines = fs.readFileSync(connFile, 'utf8').split('\n');
  for (let i = 785; i < 845 && i < lines.length; i++) {
    console.log(`[${connFile}:${i + 1}] ${lines[i]}`);
  }
}

console.log('\n==================================================');
console.log('3. How is db created in connection.js? Does it wrap .transaction?');
console.log('==================================================');
if (fs.existsSync(connFile)) {
  const lines = fs.readFileSync(connFile, 'utf8').split('\n');
  lines.forEach((l, idx) => {
    if (l.includes('transaction:') || l.includes('transaction =') || l.includes('.transaction =')) {
      console.log(`[${connFile}:${idx + 1}] ${l.trim()}`);
    }
  });
}

process.exit(0);
