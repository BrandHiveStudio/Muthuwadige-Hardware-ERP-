import fs from 'fs';

console.log('==================================================');
console.log('1. REVERT RECEIPT BUTTON VISIBILITY CONDITION');
console.log('==================================================');
if (fs.existsSync('src/pages/Purchasing.tsx')) {
  const lines = fs.readFileSync('src/pages/Purchasing.tsx', 'utf8').split('\n');
  // Print lines 2330 to 2365 (around line 2348)
  for (let i = 2320; i <= 2365 && i < lines.length; i++) {
    console.log(`[Purchasing.tsx:${i + 1}] ${lines[i]}`);
  }
}

console.log('\n==================================================');
console.log('2. PO SETTLE & RECEIVE HANDLER (CHEQUE & AUDIT LOGS)');
console.log('==================================================');
if (fs.existsSync('src/pages/Purchasing.tsx')) {
  const lines = fs.readFileSync('src/pages/Purchasing.tsx', 'utf8').split('\n');
  // Find where receiving / settling executes (around 1150-1280)
  for (let i = 1150; i <= 1270 && i < lines.length; i++) {
    console.log(`[Purchasing.tsx:${i + 1}] ${lines[i]}`);
  }
}

console.log('\n==================================================');
console.log('3. PDF GENERATOR LAYOUT IN Purchasing.tsx');
console.log('==================================================');
if (fs.existsSync('src/pages/Purchasing.tsx')) {
  const lines = fs.readFileSync('src/pages/Purchasing.tsx', 'utf8').split('\n');
  // Find the PDF generation function
  for (let i = 680; i <= 760 && i < lines.length; i++) {
    console.log(`[Purchasing.tsx:${i + 1}] ${lines[i]}`);
  }
}

console.log('\n==================================================');
console.log('4. BACKEND RPC: revert_purchase_order_receipt & CHEQUES');
console.log('==================================================');
if (fs.existsSync('server.js')) {
  const serverContent = fs.readFileSync('server.js', 'utf8');
  const serverLines = serverContent.split('\n');
  
  console.log('Checking for revert_purchase_order_receipt in server.js:');
  serverLines.forEach((l, idx) => {
    if (l.includes('revert_purchase_order_receipt')) {
      console.log(`[server.js:${idx + 1}] ${l.trim()}`);
    }
  });

  console.log('\nChecking for outward cheque handling in server.js:');
  serverLines.forEach((l, idx) => {
    if (l.includes("type = 'outward'") || l.includes('cheque_type') || l.includes("type: 'outward'")) {
      console.log(`[server.js:${idx + 1}] ${l.trim()}`);
    }
  });
}

console.log('\n==================================================');
console.log('5. EVENT LOOP LAG / HIGH FREQUENCY POLLING');
console.log('==================================================');
const checkFiles = ['src/context/ScannerContext.tsx', 'src/components/Header.tsx', 'src/services/syncService.js'];
for (const file of checkFiles) {
  if (fs.existsSync(file)) {
    const content = fs.readFileSync(file, 'utf8');
    const lines = content.split('\n');
    lines.forEach((l, idx) => {
      if (l.includes('setInterval') || l.includes('setTimeout')) {
        console.log(`[${file}:${idx + 1}] ${l.trim()}`);
      }
    });
  }
}

process.exit(0);
