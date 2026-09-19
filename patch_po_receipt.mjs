import fs from 'fs';

console.log('--- 1. PATCHING Purchasing.tsx ---');
let poCode = fs.readFileSync('src/pages/Purchasing.tsx', 'utf8');

// Fix 1.1: Ensure fetchData maps all receive & settlement properties in both snake_case and camelCase
const oldMapTarget = `transportation_fee: Number(po.transportation_fee ?? po.transportationFee ?? po.shipping_cost ?? po.delivery_fee ?? 0),
            transportationFee: Number(po.transportation_fee ?? po.transportationFee ?? po.shipping_cost ?? po.delivery_fee ?? 0),
            date: po.created_at ? new Date(po.created_at).toLocaleDateString() : (po.date || new Date().toLocaleDateString())
          }));`;

const newMapTarget = `transportation_fee: Math.max(0, Number(po.transportation_fee ?? po.transportationFee ?? po.shipping_cost ?? po.delivery_fee ?? 0)),
            transportationFee: Math.max(0, Number(po.transportation_fee ?? po.transportationFee ?? po.shipping_cost ?? po.delivery_fee ?? 0)),
            shipping_cost: Math.max(0, Number(po.transportation_fee ?? po.transportationFee ?? po.shipping_cost ?? po.delivery_fee ?? 0)),
            settlement_mode: (po.settlement_mode || po.payment_method || po.settlementMode || 'CREDIT').toUpperCase(),
            settlementMode: (po.settlement_mode || po.payment_method || po.settlementMode || 'CREDIT').toUpperCase(),
            payment_method: (po.payment_method || po.settlement_mode || po.settlementMode || 'CREDIT').toUpperCase(),
            paymentMethod: (po.payment_method || po.settlement_mode || po.settlementMode || 'CREDIT').toUpperCase(),
            received_by: po.received_by || po.receivedBy || null,
            receivedBy: po.received_by || po.receivedBy || null,
            received_at: po.received_at || po.receivedAt || null,
            receivedAt: po.received_at || po.receivedAt || null,
            date: po.created_at ? new Date(po.created_at).toLocaleDateString() : (po.date || new Date().toLocaleDateString())
          }));`;

if (poCode.includes(oldMapTarget)) {
  poCode = poCode.replace(oldMapTarget, newMapTarget);
  console.log('✅ Updated mappedOrders in Purchasing.tsx fetchData');
} else {
  console.warn('⚠️ Could not find exact oldMapTarget in Purchasing.tsx');
}

// Fix 1.2: Bulletproof PDF shipping fee and receipt metadata
const oldPdfMeta = `const shippingFee = Number(order.shipping_cost || (order as any).transportation_fee || (order as any).delivery_fee || (order as any).transportationFee || 0);`;
const newPdfMeta = `const shippingFee = Math.max(0, Number((order as any).transportation_fee ?? (order as any).transportationFee ?? order.shipping_cost ?? (order as any).delivery_fee ?? 0));`;

if (poCode.includes(oldPdfMeta)) {
  poCode = poCode.replace(oldPdfMeta, newPdfMeta);
  console.log('✅ Updated shippingFee precedence in Purchasing.tsx downloadPO_PDF');
}

const oldPdfPayMethod = `const paymentMethod = (order.payment_method || order.settlement_type || (order as any).settlement_mode || (order as any).settlementMode || 'CREDIT').toUpperCase();`;
const newPdfPayMethod = `const paymentMethod = ((order as any).settlement_mode || (order as any).settlementMode || order.payment_method || (order as any).paymentMethod || (order as any).settlement_type || 'CREDIT').toUpperCase();`;

if (poCode.includes(oldPdfPayMethod)) {
  poCode = poCode.replace(oldPdfPayMethod, newPdfPayMethod);
  console.log('✅ Updated paymentMethod resolution in Purchasing.tsx downloadPO_PDF');
}

fs.writeFileSync('src/pages/Purchasing.tsx', poCode, 'utf8');

console.log('\n--- 2. PATCHING server.js SYNC ENQUEUE ---');
let serverCode = fs.readFileSync('server.js', 'utf8');

const oldEnqueueAnchor = `await enqueueSync(db, 'purchase_orders', po.id, 'UPSERT');`;
const newEnqueueAnchor = `await enqueueSync(db, 'purchase_orders', po.id, 'UPSERT');
        if (transSyncTxId) {
          await enqueueSync(db, 'transactions', transSyncTxId, 'UPSERT');
        }
        if (settleTxId) {
          await enqueueSync(db, 'transactions', settleTxId, 'UPSERT');
        }
        if (settleChqId) {
          await enqueueSync(db, 'cheque_registry', settleChqId, 'UPSERT');
        }`;

if (serverCode.includes(oldEnqueueAnchor) && !serverCode.includes('if (settleChqId)')) {
  serverCode = serverCode.replace(oldEnqueueAnchor, newEnqueueAnchor);
  fs.writeFileSync('server.js', serverCode, 'utf8');
  console.log('✅ Enqueued missing transactions and cheque_registry sync records in server.js');
} else {
  console.log('ℹ️ Sync enqueue anchor in server.js already patched or modified');
}

console.log('\n--- 3. SYNTAX VALIDATION ---');
process.exit(0);
