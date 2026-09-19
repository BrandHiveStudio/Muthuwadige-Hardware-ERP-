import fs from 'fs';
import { execSync } from 'child_process';

console.log('==================================================');
console.log('1. TYPESCRIPT COMPILE STATUS');
console.log('==================================================');
try {
  const tscOut = execSync('npx tsc --noEmit', { encoding: 'utf8' });
  console.log('✅ TypeScript compilation clean (0 errors)');
} catch (err) {
  console.log('❌ TypeScript Errors Found:');
  console.log(err.stdout ? err.stdout.slice(0, 1500) : err.message);
}

console.log('\n==================================================');
console.log('2. INSPECTING server.js AROUND LINE 10535 (Sync freeze culprit)');
console.log('==================================================');
if (fs.existsSync('server.js')) {
  const lines = fs.readFileSync('server.js', 'utf8').split('\n');
  for (let i = 10520; i < 10550 && i < lines.length; i++) {
    console.log(`[server.js:${i + 1}] ${lines[i]}`);
  }
}

console.log('\n==================================================');
console.log('3. INSPECTING triggerPush IN server.js');
console.log('==================================================');
if (fs.existsSync('server.js')) {
  const lines = fs.readFileSync('server.js', 'utf8').split('\n');
  lines.forEach((line, idx) => {
    if (line.includes('function triggerPush') || line.includes('const triggerPush =')) {
      for (let j = idx; j < idx + 25 && j < lines.length; j++) {
        console.log(`[server.js:${j + 1}] ${lines[j]}`);
      }
    }
  });
}

process.exit(0);
