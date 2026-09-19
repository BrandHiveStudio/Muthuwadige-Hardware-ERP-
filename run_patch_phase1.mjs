import fs from 'fs';

console.log('==================================================');
console.log('1. PATCHING syncService.js (Eliminating UI Freezes)');
console.log('==================================================');
const syncFile = 'src/services/syncService.js';
if (fs.existsSync(syncFile)) {
  let content = fs.readFileSync(syncFile, 'utf8');
  fs.writeFileSync(`${syncFile}.bak`, content, 'utf8');

  const oldTrigger = /export async function triggerPush\(localDb\)[\s\S]*?^}/m;
  const newTrigger = `let pushTimeout = null;
let isPushingActive = false;

export async function triggerPush(localDb) {
  if (!localDb || isWebClient) return;
  if (pushTimeout) clearTimeout(pushTimeout);

  return new Promise((resolve) => {
    pushTimeout = setTimeout(async () => {
      if (isPushingActive) return resolve();
      isPushingActive = true;
      try {
        const tursoClient = getTursoClient();
        if (tursoClient) {
          await pushUpstreamChanges(localDb, tursoClient);
        }
      } catch (err) {
        console.warn('[SyncPush] Debounced push warning:', err?.message || err);
      } finally {
        isPushingActive = false;
        resolve();
      }
    }, 1200);
  });
}`;

  if (oldTrigger.test(content)) {
    content = content.replace(oldTrigger, newTrigger);
    fs.writeFileSync(syncFile, content, 'utf8');
    console.log('✅ syncService.js successfully patched with debounced mutex triggerPush!');
  } else {
    console.log('⚠️ Could not match triggerPush pattern in syncService.js');
  }
}

console.log('\n==================================================');
console.log('2. PATCHING Finance.tsx (Inward & Outward Cheque Count)');
console.log('==================================================');
const finFile = 'src/pages/Finance.tsx';
if (fs.existsSync(finFile)) {
  let content = fs.readFileSync(finFile, 'utf8');
  fs.writeFileSync(`${finFile}.bak`, content, 'utf8');

  const oldChequeFilter = `const pending = chqs.filter((c: any) => c.direction === 'INWARD' && (c.status === 'PENDING' || c.status === 'IN_HAND'));
          setPendingChequesCount(pending.length);`;

  const newChequeFilter = `const pendingInward = chqs.filter((c: any) => (c.direction || '').toUpperCase() === 'INWARD' && (c.status === 'PENDING' || c.status === 'IN_HAND'));
          const pendingOutward = chqs.filter((c: any) => (c.direction || '').toUpperCase() === 'OUTWARD' && (c.status === 'PENDING' || c.status === 'IN_HAND'));
          setPendingChequesCount(pendingInward.length + pendingOutward.length);`;

  if (content.includes("const pending = chqs.filter((c: any) => c.direction === 'INWARD'")) {
    content = content.replace(oldChequeFilter, newChequeFilter);
    fs.writeFileSync(finFile, content, 'utf8');
    console.log('✅ Finance.tsx successfully patched to count both Inward and Outward cheques!');
  } else {
    console.log('⚠️ Could not find exact cheque filter string in Finance.tsx');
  }
}

console.log('\n==================================================');
console.log('3. LOCATING executeRevertPurchaseOrderReceipt IN server.js');
console.log('==================================================');
if (fs.existsSync('server.js')) {
  const lines = fs.readFileSync('server.js', 'utf8').split('\n');
  let startIdx = -1;
  lines.forEach((l, idx) => {
    if (l.includes('function executeRevertPurchaseOrderReceipt') || l.includes('const executeRevertPurchaseOrderReceipt =')) {
      startIdx = idx;
    }
  });

  if (startIdx !== -1) {
    console.log(`Found executeRevertPurchaseOrderReceipt starting at line ${startIdx + 1}:`);
    for (let i = startIdx; i < startIdx + 85 && i < lines.length; i++) {
      console.log(`[server.js:${i + 1}] ${lines[i]}`);
    }
  } else {
    console.log('Searching for references to executeRevertPurchaseOrderReceipt in server.js:');
    lines.forEach((l, idx) => {
      if (l.includes('executeRevertPurchaseOrderReceipt')) {
        console.log(`[server.js:${idx + 1}] ${l}`);
      }
    });
  }
}

console.log('\n==================================================');
console.log('4. LOCATING FALLBACK DIRECT OPERATIONS IN Purchasing.tsx');
console.log('==================================================');
const poFile = 'src/pages/Purchasing.tsx';
if (fs.existsSync(poFile)) {
  const lines = fs.readFileSync(poFile, 'utf8').split('\n');
  let fallbackIdx = -1;
  lines.forEach((l, idx) => {
    if (l.includes('Fallback Direct Operations')) {
      fallbackIdx = idx;
    }
  });

  if (fallbackIdx !== -1) {
    console.log(`Found Fallback Direct Operations starting at line ${fallbackIdx + 1}:`);
    for (let i = fallbackIdx; i < fallbackIdx + 45 && i < lines.length; i++) {
      console.log(`[Purchasing.tsx:${i + 1}] ${lines[i]}`);
    }
  }
}

process.exit(0);
