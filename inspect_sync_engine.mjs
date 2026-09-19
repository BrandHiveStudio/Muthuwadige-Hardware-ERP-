import fs from 'fs';

const code = fs.readFileSync('src/services/syncService.js', 'utf8');
const lines = code.split(/\r?\n/);

console.log('================================================================');
console.log(' 1. PULL / DOWNLOAD TABLE LISTS IN syncService.js               ');
console.log('================================================================');
lines.forEach((line, idx) => {
  if (
    line.includes('pullTable') ||
    line.includes('pullMasterData') ||
    line.includes('pullFromCloud') ||
    line.includes('syncDown') ||
    line.includes('pullAll') ||
    line.includes('tablesToPull') ||
    line.includes('PULL_ORDER')
  ) {
    for (let j = Math.max(0, idx - 4); j < idx + 18 && j < lines.length; j++) {
      console.log(`[${j + 1}] ${lines[j]}`);
    }
    console.log('---');
  }
});

console.log('================================================================');
console.log(' 2. PUSH / UPLOAD DISPATCH IN syncService.js                     ');
console.log('================================================================');
lines.forEach((line, idx) => {
  if (
    line.includes('switch (tableName') ||
    line.includes('switch (table') ||
    line.includes('switch (entityType') ||
    line.includes('processSyncQueue') ||
    line.includes('pushToTurso') ||
    line.includes('pushRecord')
  ) {
    for (let j = Math.max(0, idx - 2); j < idx + 25 && j < lines.length; j++) {
      console.log(`[${j + 1}] ${lines[j]}`);
    }
    console.log('---');
  }
});
