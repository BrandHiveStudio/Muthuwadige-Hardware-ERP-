import fs from 'fs';

console.log('--- PATCHING server.js SYNC QUEUE AT LINE 9680 ---');
let serverCode = fs.readFileSync('server.js', 'utf8');

const targetLine = `        // 6. Enqueue Sync inside managed transaction
        await enqueueSync(db, 'purchase_orders', po.id, 'UPSERT');`;

const patchedBlock = `        // 6. Enqueue Sync inside managed transaction
        await enqueueSync(db, 'purchase_orders', po.id, 'UPSERT');
        if (suppSyncId) {
          await enqueueSync(db, 'suppliers', suppSyncId, 'UPSERT');
        }
        if (transSyncTxId) {
          await enqueueSync(db, 'transactions', transSyncTxId, 'UPSERT');
        }
        if (settleTxId) {
          await enqueueSync(db, 'transactions', settleTxId, 'UPSERT');
        }
        if (settleChqId) {
          await enqueueSync(db, 'cheque_registry', settleChqId, 'UPSERT');
        }`;

if (serverCode.includes(targetLine)) {
  serverCode = serverCode.replace(targetLine, patchedBlock);
  fs.writeFileSync('server.js', serverCode, 'utf8');
  console.log('✅ Successfully patched line 9680 with all sync enqueue records!');
} else {
  console.warn('⚠️ Target line not found via literal match, attempting regex replacement...');
  const rx = /\/\/\s*6\.\s*Enqueue Sync inside managed transaction\r?\n\s*await enqueueSync\(db,\s*'purchase_orders',\s*po\.id,\s*'UPSERT'\);/;
  if (rx.test(serverCode)) {
    serverCode = serverCode.replace(rx, patchedBlock);
    fs.writeFileSync('server.js', serverCode, 'utf8');
    console.log('✅ Successfully patched via regex!');
  } else {
    console.error('❌ Could not match enqueueSync target in server.js.');
  }
}

process.exit(0);
