import fs from 'fs';

console.log('==================================================');
console.log('1. INSPECTING triggerPush IN syncService.js (Lines 1395-1440)');
console.log('==================================================');
const syncFile = 'src/services/syncService.js';
if (fs.existsSync(syncFile)) {
  const lines = fs.readFileSync(syncFile, 'utf8').split('\n');
  for (let i = 1395; i < 1445 && i < lines.length; i++) {
    console.log(`[${syncFile}:${i + 1}] ${lines[i]}`);
  }
}

console.log('\n==================================================');
console.log('2. INSPECTING CHEQUE INSERTION IN receive-po (server.js Lines 9630-9675)');
console.log('==================================================');
if (fs.existsSync('server.js')) {
  const lines = fs.readFileSync('server.js', 'utf8').split('\n');
  for (let i = 9630; i < 9675 && i < lines.length; i++) {
    console.log(`[server.js:${i + 1}] ${lines[i]}`);
  }
}

console.log('\n==================================================');
console.log('3. INSPECTING revert_purchase_order_receipt IN server.js (Lines 8670-8730)');
console.log('==================================================');
if (fs.existsSync('server.js')) {
  const lines = fs.readFileSync('server.js', 'utf8').split('\n');
  for (let i = 8670; i < 8730 && i < lines.length; i++) {
    console.log(`[server.js:${i + 1}] ${lines[i]}`);
  }
}

console.log('\n==================================================');
console.log('4. INSPECTING fetchData IN Purchasing.tsx (Lines 160-230)');
console.log('==================================================');
const poFile = 'src/pages/Purchasing.tsx';
if (fs.existsSync(poFile)) {
  const lines = fs.readFileSync(poFile, 'utf8').split('\n');
  for (let i = 160; i < 230 && i < lines.length; i++) {
    console.log(`[${poFile}:${i + 1}] ${lines[i]}`);
  }
}

console.log('\n==================================================');
console.log('5. INSPECTING PDF TOTALS & DETAILS IN Purchasing.tsx (Lines 580-625)');
console.log('==================================================');
if (fs.existsSync(poFile)) {
  const lines = fs.readFileSync(poFile, 'utf8').split('\n');
  for (let i = 580; i < 625 && i < lines.length; i++) {
    console.log(`[${poFile}:${i + 1}] ${lines[i]}`);
  }
}

console.log('\n==================================================');
console.log('6. INSPECTING CHEQUE QUERY IN Finance.tsx (Lines 95-135)');
console.log('==================================================');
const finFile = 'src/pages/Finance.tsx';
if (fs.existsSync(finFile)) {
  const lines = fs.readFileSync(finFile, 'utf8').split('\n');
  for (let i = 95; i < 135 && i < lines.length; i++) {
    console.log(`[${finFile}:${i + 1}] ${lines[i]}`);
  }
}

process.exit(0);
