import fs from 'fs';

console.log('==================================================');
console.log('1. INVENTORY: handleSave() IMPLEMENTATION');
console.log('==================================================');
if (fs.existsSync('src/pages/Inventory.tsx')) {
  const lines = fs.readFileSync('src/pages/Inventory.tsx', 'utf8').split('\n');
  let capturing = false;
  let count = 0;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes('const handleSave =') || lines[i].includes('async function handleSave')) {
      capturing = true;
    }
    if (capturing) {
      console.log(`[Inventory.tsx:${i + 1}] ${lines[i]}`);
      count++;
      if (count > 65) break; // Capture first 65 lines of save logic
    }
  }
}

console.log('\n==================================================');
console.log('2. SERVER: PUT /api/products/:id IMPLEMENTATION');
console.log('==================================================');
if (fs.existsSync('server.js')) {
  const lines = fs.readFileSync('server.js', 'utf8').split('\n');
  let capturing = false;
  let count = 0;
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes("app.put('/api/products/:id'") || lines[i].includes('app.put("/api/products/:id"')) {
      capturing = true;
    }
    if (capturing) {
      console.log(`[server.js:${i + 1}] ${lines[i]}`);
      count++;
      if (lines[i].includes('res.json(') || lines[i].includes('res.status(') || count > 55) {
        if (count > 25) break;
      }
    }
  }
}

console.log('\n==================================================');
console.log('3. PURCHASING: REVERT & SETTLE BUTTONS IN Purchasing.tsx');
console.log('==================================================');
if (fs.existsSync('src/pages/Purchasing.tsx')) {
  const content = fs.readFileSync('src/pages/Purchasing.tsx', 'utf8');
  const lines = content.split('\n');
  lines.forEach((line, i) => {
    if (
      line.toLowerCase().includes('revert') ||
      line.includes('cheque') && (line.includes('outward') || line.includes('payable') || line.includes('registry')) ||
      line.includes('transport') ||
      line.includes('received_by') ||
      line.includes('receivedBy')
    ) {
      console.log(`[Purchasing.tsx:${i + 1}] ${line.trim()}`);
    }
  });
}

console.log('\n==================================================');
console.log('4. FREEZE ROOT-CAUSE: SYNC CYCLE INVOCATIONS');
console.log('==================================================');
if (fs.existsSync('server.js')) {
  const lines = fs.readFileSync('server.js', 'utf8').split('\n');
  lines.forEach((line, i) => {
    if (line.includes('runSyncCycle(') || line.includes('setInterval(') && line.includes('sync')) {
      console.log(`[server.js:${i + 1}] ${line.trim()}`);
    }
  });
}

process.exit(0);
