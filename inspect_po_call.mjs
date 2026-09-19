import fs from 'fs';

console.log('==================================================');
console.log('1. connection.js: db.transaction for Local SQLite (Lines 725-790)');
console.log('==================================================');
const connFile = fs.existsSync('src/db/connection.js') ? 'src/db/connection.js' : 'connection.js';
if (fs.existsSync(connFile)) {
  const lines = fs.readFileSync(connFile, 'utf8').split('\n');
  for (let i = 725; i < 790 && i < lines.length; i++) {
    console.log(`[${connFile}:${i + 1}] ${lines[i]}`);
  }
}

console.log('\n==================================================');
console.log('2. Purchasing.tsx: handleConfirmReceiveAndSettle (Lines 1040-1120)');
console.log('==================================================');
const poFile = 'src/pages/Purchasing.tsx';
if (fs.existsSync(poFile)) {
  const lines = fs.readFileSync(poFile, 'utf8').split('\n');
  for (let i = 1040; i < 1120 && i < lines.length; i++) {
    console.log(`[Purchasing.tsx:${i + 1}] ${lines[i]}`);
  }
}

console.log('\n==================================================');
console.log('3. Purchasing.tsx: Fallback Block Catch (Lines 1190-1250)');
console.log('==================================================');
if (fs.existsSync(poFile)) {
  const lines = fs.readFileSync(poFile, 'utf8').split('\n');
  for (let i = 1190; i < 1250 && i < lines.length; i++) {
    console.log(`[Purchasing.tsx:${i + 1}] ${lines[i]}`);
  }
}

process.exit(0);
