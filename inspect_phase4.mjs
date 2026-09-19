import fs from 'fs';

console.log('==================================================');
console.log('1. INSPECTING RPC ROUTE IN server.js (Lines 10360-10385)');
console.log('==================================================');
if (fs.existsSync('server.js')) {
  const lines = fs.readFileSync('server.js', 'utf8').split('\n');
  for (let i = 10360; i < 10385 && i < lines.length; i++) {
    console.log(`[server.js:${i + 1}] ${lines[i]}`);
  }
}

console.log('\n==================================================');
console.log('2. INSPECTING supabase.rpc IN src/lib/supabaseClient.ts (Lines 345-375)');
console.log('==================================================');
const sbFile = 'src/lib/supabaseClient.ts';
if (fs.existsSync(sbFile)) {
  const lines = fs.readFileSync(sbFile, 'utf8').split('\n');
  for (let i = 345; i < 375 && i < lines.length; i++) {
    console.log(`[${sbFile}:${i + 1}] ${lines[i]}`);
  }
}

console.log('\n==================================================');
console.log('3. INSPECTING shift_logs SCHEMA & MIGRATION IN server.js');
console.log('==================================================');
if (fs.existsSync('server.js')) {
  const lines = fs.readFileSync('server.js', 'utf8').split('\n');
  lines.forEach((l, idx) => {
    if (l.includes('CREATE TABLE IF NOT EXISTS shift_logs') || l.includes('ALTER TABLE shift_logs')) {
      for (let j = Math.max(0, idx - 2); j < idx + 20 && j < lines.length; j++) {
        console.log(`[server.js:${j + 1}] ${lines[j]}`);
      }
    }
  });
}

console.log('\n==================================================');
console.log('4. INSPECTING BOUNCED CHEQUE STATUS SETTING IN server.js (Lines 7430-7455)');
console.log('==================================================');
if (fs.existsSync('server.js')) {
  const lines = fs.readFileSync('server.js', 'utf8').split('\n');
  for (let i = 7430; i < 7455 && i < lines.length; i++) {
    console.log(`[server.js:${i + 1}] ${lines[i]}`);
  }
}

console.log('\n==================================================');
console.log('5. CHECKING scanner_signals CLEANUP IN server.js');
console.log('==================================================');
if (fs.existsSync('server.js')) {
  const content = fs.readFileSync('server.js', 'utf8');
  if (content.includes('DELETE FROM scanner_signals')) {
    console.log('✅ scanner_signals auto-cleanup query already exists in server.js');
  } else {
    console.log('⚠️ No scanner_signals auto-cleanup found in server.js');
  }
}

process.exit(0);
