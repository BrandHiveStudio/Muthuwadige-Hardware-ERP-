import fs from 'fs';

console.log('==================================================');
console.log('1. INSPECTING server.js lines 9660-9740 (End of receive-po & Audit Log)');
console.log('==================================================');
if (fs.existsSync('server.js')) {
  const lines = fs.readFileSync('server.js', 'utf8').split('\n');
  for (let i = 9660; i < 9735 && i < lines.length; i++) {
    console.log(`[server.js:${i + 1}] ${lines[i]}`);
  }
}

console.log('\n==================================================');
console.log('2. CHEQUE TABLE USAGE: cheques VS cheque_registry');
console.log('==================================================');
if (fs.existsSync('server.js')) {
  const lines = fs.readFileSync('server.js', 'utf8').split('\n');
  lines.forEach((l, idx) => {
    if (l.includes("FROM cheques") || l.includes("FROM cheque_registry") || l.includes("app.get('/api/cheques'")) {
      console.log(`[server.js:${idx + 1}] ${l.trim()}`);
    }
  });
}

console.log('\n==================================================');
console.log('3. INSPECTING server.js lines 4550-4600 (Real PUT /api/products/:id query)');
console.log('==================================================');
if (fs.existsSync('server.js')) {
  const lines = fs.readFileSync('server.js', 'utf8').split('\n');
  for (let i = 4548; i < 4600 && i < lines.length; i++) {
    console.log(`[server.js:${i + 1}] ${lines[i]}`);
  }
}

console.log('\n==================================================');
console.log('4. ALL CALLS TO runSyncCycle IN server.js');
console.log('==================================================');
if (fs.existsSync('server.js')) {
  const lines = fs.readFileSync('server.js', 'utf8').split('\n');
  lines.forEach((l, idx) => {
    if (l.includes('runSyncCycle(')) {
      console.log(`[server.js:${idx + 1}] ${l.trim()}`);
    }
  });
}

console.log('\n==================================================');
console.log('5. SQLITE PRAGMAS IN connection.js');
console.log('==================================================');
const connFiles = ['connection.js', 'src/db/connection.js', 'server/connection.js', 'db/connection.js'];
for (const f of connFiles) {
  if (fs.existsSync(f)) {
    const lines = fs.readFileSync(f, 'utf8').split('\n');
    lines.forEach((l, idx) => {
      if (l.includes('PRAGMA') || l.includes('timeout') || l.includes('busy')) {
        console.log(`[${f}:${idx + 1}] ${l.trim()}`);
      }
    });
  }
}

process.exit(0);
