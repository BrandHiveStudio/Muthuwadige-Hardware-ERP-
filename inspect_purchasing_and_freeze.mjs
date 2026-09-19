import fs from 'fs';

console.log('==================================================');
console.log('1. INSPECTING /api/purchasing/receive-po ENTRY & PARAMETERS (server.js)');
console.log('==================================================');
if (fs.existsSync('server.js')) {
  const lines = fs.readFileSync('server.js', 'utf8').split('\n');
  lines.forEach((l, idx) => {
    if (l.includes("app.post('/api/purchasing/receive-po'") || l.includes('app.post("/api/purchasing/receive-po"')) {
      for (let j = idx; j < idx + 60 && j < lines.length; j++) {
        console.log(`[server.js:${j + 1}] ${lines[j]}`);
      }
    }
  });
}

console.log('\n==================================================');
console.log('2. SEARCHING FOR "Revert" BUTTON CONDITIONS IN Purchasing.tsx');
console.log('==================================================');
const poFile = 'src/pages/Purchasing.tsx';
if (fs.existsSync(poFile)) {
  const lines = fs.readFileSync(poFile, 'utf8').split('\n');
  lines.forEach((l, idx) => {
    if (l.includes('Revert') || l.includes('revert-receipt') || l.includes('executeRevert')) {
      for (let j = Math.max(0, idx - 4); j < idx + 12 && j < lines.length; j++) {
        console.log(`[Purchasing.tsx:${j + 1}] ${lines[j]}`);
      }
    }
  });
}

console.log('\n==================================================');
console.log('3. INSPECTING PO/INVOICE PDF GENERATION IN Purchasing.tsx');
console.log('==================================================');
if (fs.existsSync(poFile)) {
  const lines = fs.readFileSync(poFile, 'utf8').split('\n');
  lines.forEach((l, idx) => {
    if (l.includes('const downloadPO_PDF') || l.includes('const generatePO_PDF')) {
      for (let j = idx; j < idx + 50 && j < lines.length; j++) {
        console.log(`[Purchasing.tsx:${j + 1}] ${lines[j]}`);
      }
    }
  });
}

console.log('\n==================================================');
console.log('4. SEARCHING FOR PO LEDGER IN Purchasing.tsx');
console.log('==================================================');
if (fs.existsSync(poFile)) {
  const lines = fs.readFileSync(poFile, 'utf8').split('\n');
  lines.forEach((l, idx) => {
    if (l.includes('Ledger') || l.includes('ledger') || l.includes('supplier_ledger')) {
      console.log(`[Purchasing.tsx:${idx + 1}] ${l.trim()}`);
    }
  });
}

console.log('\n==================================================');
console.log('5. SEARCHING FOR RECENT POLLING LOOPS / INTERVALS (Freezing Culprits)');
console.log('==================================================');
const scannerFile = 'src/context/ScannerContext.tsx';
if (fs.existsSync(scannerFile)) {
  const lines = fs.readFileSync(scannerFile, 'utf8').split('\n');
  lines.forEach((l, idx) => {
    if (l.includes('setInterval') || l.includes('poll') || l.includes('scanner_signals')) {
      for (let j = Math.max(0, idx - 2); j < idx + 10 && j < lines.length; j++) {
        console.log(`[ScannerContext.tsx:${j + 1}] ${lines[j]}`);
      }
    }
  });
}

process.exit(0);
