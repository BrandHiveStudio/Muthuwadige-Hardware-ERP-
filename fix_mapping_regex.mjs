import fs from 'fs';

console.log('==================================================');
console.log('1. PATCHING mappedOrders IN Purchasing.tsx VIA REGEX');
console.log('==================================================');
let poCode = fs.readFileSync('src/pages/Purchasing.tsx', 'utf8');

// Regex targeting the mappedOrders array mapping block
const mapRegex = /const mappedOrders = poData\.map\(\(po: any\) => \(\{[\s\S]*?date: po\.created_at \?[\s\S]*?\}\)\);/;

const replacementMap = `const mappedOrders = poData.map((po: any) => ({
            ...po,
            poNumber: po.po_number !== undefined ? po.po_number : po.poNumber,
            supplierName: po.supplier_name !== undefined ? po.supplier_name : po.supplierName,
            dueDate: po.due_date !== undefined ? po.due_date : po.dueDate,
            transportation_fee: Math.max(0, Number(po.transportation_fee ?? po.transportationFee ?? po.shipping_cost ?? po.delivery_fee ?? 0)),
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

if (mapRegex.test(poCode)) {
  poCode = poCode.replace(mapRegex, replacementMap);
  fs.writeFileSync('src/pages/Purchasing.tsx', poCode, 'utf8');
  console.log('✅ Successfully matched and patched mappedOrders in Purchasing.tsx');
} else {
  console.warn('⚠️ Regex did not match. Showing current lines 185-202:');
  const lines = poCode.split(/\r?\n/);
  for (let i = 184; i < 205 && i < lines.length; i++) {
    console.log(`[${i + 1}] ${lines[i]}`);
  }
}

console.log('\n==================================================');
console.log('2. VERIFYING server.js SYNC ENQUEUE AROUND LINE 9680');
console.log('==================================================');
const serverCode = fs.readFileSync('server.js', 'utf8');
const sLines = serverCode.split(/\r?\n/);
sLines.forEach((line, idx) => {
  if (line.includes("enqueueSync(db, 'purchase_orders', po.id")) {
    for (let j = Math.max(0, idx - 2); j < idx + 14 && j < sLines.length; j++) {
      console.log(`[server.js:${j + 1}] ${sLines[j]}`);
    }
  }
});

process.exit(0);
