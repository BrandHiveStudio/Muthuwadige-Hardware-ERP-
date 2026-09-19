import fs from 'fs';

console.log('==================================================');
console.log('1. INSPECTING /api/purchasing/receive-po (Lines 9530-9660)');
console.log('==================================================');
if (fs.existsSync('server.js')) {
  const lines = fs.readFileSync('server.js', 'utf8').split('\n');
  for (let i = 9530; i < 9660 && i < lines.length; i++) {
    console.log(`[server.js:${i + 1}] ${lines[i]}`);
  }
}

console.log('\n==================================================');
console.log('2. SEARCHING FOR app.put ON PRODUCTS IN server.js');
console.log('==================================================');
if (fs.existsSync('server.js')) {
  const lines = fs.readFileSync('server.js', 'utf8').split('\n');
  lines.forEach((line, idx) => {
    if (line.includes("app.put") && line.includes("product")) {
      console.log(`[server.js:${idx + 1}] ${line.trim()}`);
      for (let j = idx; j < idx + 35 && j < lines.length; j++) {
        console.log(`  [server.js:${j + 1}] ${lines[j]}`);
      }
    }
  });
}

console.log('\n==================================================');
console.log('3. INSPECTING REVERT RECEIPT IN server.js (Lines 10325-10400)');
console.log('==================================================');
if (fs.existsSync('server.js')) {
  const lines = fs.readFileSync('server.js', 'utf8').split('\n');
  for (let i = 10325; i < 10400 && i < lines.length; i++) {
    console.log(`[server.js:${i + 1}] ${lines[i]}`);
  }
}

console.log('\n==================================================');
console.log('4. INSPECTING SYNC INTERVAL IN syncService.js (Lines 1420-1460)');
console.log('==================================================');
const syncFile = 'src/services/syncService.js';
if (fs.existsSync(syncFile)) {
  const lines = fs.readFileSync(syncFile, 'utf8').split('\n');
  for (let i = 1420; i < 1460 && i < lines.length; i++) {
    console.log(`[syncService.js:${i + 1}] ${lines[i]}`);
  }
}

process.exit(0);
