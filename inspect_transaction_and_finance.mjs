import fs from 'fs';

console.log('==================================================');
console.log('1. INSPECTING db.transaction IN connection.js');
console.log('==================================================');
const connFile = fs.existsSync('src/db/connection.js') ? 'src/db/connection.js' : 'connection.js';
if (fs.existsSync(connFile)) {
  const content = fs.readFileSync(connFile, 'utf8');
  const lines = content.split('\n');
  lines.forEach((l, idx) => {
    if (l.includes('transaction(') || l.includes('transaction =')) {
      for (let j = Math.max(0, idx - 2); j < idx + 30 && j < lines.length; j++) {
        console.log(`[${connFile}:${j + 1}] ${lines[j]}`);
      }
    }
  });
}

console.log('\n==================================================');
console.log('2. SEARCHING FOR triggerPush ACROSS ALL JS FILES');
console.log('==================================================');
const filesToSearch = ['server.js', 'src/services/syncService.js', 'src/db/connection.js'];
for (const file of filesToSearch) {
  if (fs.existsSync(file)) {
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    lines.forEach((l, idx) => {
      if (l.includes('triggerPush')) {
        console.log(`[${file}:${idx + 1}] ${l.trim()}`);
      }
    });
  }
}

console.log('\n==================================================');
console.log('3. INSPECTING api.purchasing.receivePo in api.ts');
console.log('==================================================');
const apiFile = 'src/lib/api.ts';
if (fs.existsSync(apiFile)) {
  const lines = fs.readFileSync(apiFile, 'utf8').split('\n');
  lines.forEach((l, idx) => {
    if (l.includes('receivePo') || l.includes('receive-po')) {
      for (let j = Math.max(0, idx - 5); j < idx + 20 && j < lines.length; j++) {
        console.log(`[api.ts:${j + 1}] ${lines[j]}`);
      }
    }
  });
}

console.log('\n==================================================');
console.log('4. INSPECTING FINANCE CHEQUE QUERY IN Finance.tsx');
console.log('==================================================');
const finFiles = ['src/pages/Finance.tsx', 'src/pages/Cheques.tsx'];
for (const file of finFiles) {
  if (fs.existsSync(file)) {
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    lines.forEach((l, idx) => {
      if (l.includes('cheque_registry') || l.includes('api.cheques') || l.includes('direction') || l.includes('OUTWARD')) {
        console.log(`[${file}:${idx + 1}] ${l.trim()}`);
      }
    });
  }
}

process.exit(0);
