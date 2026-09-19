import fs from 'fs';

console.log('==================================================');
console.log('1. server.js: executeRevertPurchaseOrderReceipt RETURN VALUE (Lines 10245-10275)');
console.log('==================================================');
if (fs.existsSync('server.js')) {
  const lines = fs.readFileSync('server.js', 'utf8').split('\n');
  for (let i = 10240; i < 10275 && i < lines.length; i++) {
    console.log(`[server.js:${i + 1}] ${lines[i]}`);
  }
}

console.log('\n==================================================');
console.log('2. src/lib/api.ts: API_URL definition (Lines 1-35)');
console.log('==================================================');
const apiFile = 'src/lib/api.ts';
if (fs.existsSync(apiFile)) {
  const lines = fs.readFileSync(apiFile, 'utf8').split('\n');
  for (let i = 0; i < 35 && i < lines.length; i++) {
    console.log(`[${apiFile}:${i + 1}] ${lines[i]}`);
  }
}

console.log('\n==================================================');
console.log('3. Searching for supabase.rpc implementation across src/');
console.log('==================================================');
function searchDir(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = `${dir}/${entry.name}`;
    if (entry.isDirectory() && entry.name !== 'node_modules' && entry.name !== '.git' && entry.name !== 'dist') {
      searchDir(fullPath);
    } else if (entry.isFile() && (entry.name.endsWith('.ts') || entry.name.endsWith('.js'))) {
      const content = fs.readFileSync(fullPath, 'utf8');
      if (content.includes('rpc(') || content.includes('rpc:')) {
        console.log(`Found rpc reference in: ${fullPath}`);
        const lines = content.split('\n');
        lines.forEach((l, idx) => {
          if (l.includes('rpc(') || l.includes('rpc:')) {
            console.log(`  [Line ${idx + 1}] ${l.trim()}`);
          }
        });
      }
    }
  }
}
searchDir('src');

process.exit(0);
