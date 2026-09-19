import fs from 'fs';

console.log('==================================================');
console.log('1. INSPECTING /api/purchasing/receive-po (server.js)');
console.log('==================================================');
if (fs.existsSync('server.js')) {
  const lines = fs.readFileSync('server.js', 'utf8').split('\n');
  for (let i = 9415; i < 9530 && i < lines.length; i++) {
    console.log(`[server.js:${i + 1}] ${lines[i]}`);
  }
}

console.log('\n==================================================');
console.log('2. INSPECTING ScannerContext.tsx (lines 115-165)');
console.log('==================================================');
if (fs.existsSync('src/context/ScannerContext.tsx')) {
  const lines = fs.readFileSync('src/context/ScannerContext.tsx', 'utf8').split('\n');
  for (let i = 115; i < 165 && i < lines.length; i++) {
    console.log(`[ScannerContext.tsx:${i + 1}] ${lines[i]}`);
  }
}

console.log('\n==================================================');
console.log('3. INSPECTING PUT /api/products/:id (server.js)');
console.log('==================================================');
if (fs.existsSync('server.js')) {
  const lines = fs.readFileSync('server.js', 'utf8').split('\n');
  for (let i = 4200; i < 4265 && i < lines.length; i++) {
    console.log(`[server.js:${i + 1}] ${lines[i]}`);
  }
}

process.exit(0);
