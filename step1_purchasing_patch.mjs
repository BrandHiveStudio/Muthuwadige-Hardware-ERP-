import fs from 'fs';

console.log('==================================================');
console.log('1. PATCHING Purchasing.tsx (Revert Button & PDF)');
console.log('==================================================');

const poFile = 'src/pages/Purchasing.tsx';
if (fs.existsSync(poFile)) {
  fs.copyFileSync(poFile, `${poFile}.bak`);
  let content = fs.readFileSync(poFile, 'utf8');

  // Fix A: Revert button visibility for ALL received & completed POs
  const oldRevertCheck = `{(order.status || '').toLowerCase() === 'received' && (`;
  const newRevertCheck = `{['received', 'completed', 'paid'].includes((order.status || '').toLowerCase()) && (`;
  
  if (content.includes(oldRevertCheck)) {
    content = content.replace(oldRevertCheck, newRevertCheck);
    console.log('✅ Updated Revert Receipt button condition to support all settled statuses.');
  } else {
    console.log('⚠️ Revert condition pattern differed, inspecting current state.');
  }

  // Fix B: PO PDF overlapping layout (finalY vs curY) and status check
  const oldPdfCheck = `if ((order.status || '').toLowerCase() === 'received') {`;
  const newPdfCheck = `if (['received', 'completed', 'paid'].includes((order.status || '').toLowerCase())) {`;
  if (content.includes(oldPdfCheck)) {
    content = content.replace(oldPdfCheck, newPdfCheck);
    console.log('✅ Updated PO PDF receipt confirmation to include completed/paid statuses.');
  }

  // Fix C: Prevent PDF text collision between summary box and notes
  const oldNotesPos = `doc.text("NOTES", 15, finalY + 5);`;
  if (content.includes(oldNotesPos)) {
    content = content.replace(
      `doc.setFontSize(9);
    doc.setTextColor(218, 165, 32); 
    doc.text("NOTES", 15, finalY + 5);
    
    doc.setTextColor(100, 100, 100);
    doc.setFont('helvetica', 'normal');
    doc.text("Please deliver all items on or before the expected delivery date.", 15, finalY + 12);
    doc.setFont('helvetica', 'bold');
    doc.text("Thank you for your partnership!", 15, finalY + 19);`,
      `const safeStartY = Math.max(finalY + 5, curY + 8);
    doc.setFontSize(9);
    doc.setTextColor(218, 165, 32); 
    doc.text("NOTES", 15, safeStartY);
    
    doc.setTextColor(100, 100, 100);
    doc.setFont('helvetica', 'normal');
    doc.text("Please deliver all items on or before the expected delivery date.", 15, safeStartY + 7);
    doc.setFont('helvetica', 'bold');
    doc.text("Thank you for your partnership!", 15, safeStartY + 14);`
    );

    // Adjust Receipt Confirmation Y position relative to safeStartY
    content = content.replace(
      `doc.text("RECEIPT CONFIRMATION", 15, finalY + 27);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      doc.setTextColor(80, 80, 80);
      doc.text(\`Received: \${receivedDate} | By: \${receivedBy} | Settlement: \${paymentMethod}\`, 15, finalY + 33);`,
      `doc.text("RECEIPT CONFIRMATION", 15, safeStartY + 22);
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(8);
      doc.setTextColor(80, 80, 80);
      doc.text(\`Received: \${receivedDate} | By: \${receivedBy} | Settlement: \${paymentMethod}\`, 15, safeStartY + 28);`
    );
    console.log('✅ Repositioned PDF Notes and Receipt Confirmation using dynamic safeStartY.');
  }

  fs.writeFileSync(poFile, content, 'utf8');
  console.log('✅ Purchasing.tsx successfully updated.');
} else {
  console.log('❌ Purchasing.tsx not found.');
}

console.log('\n==================================================');
console.log('2. INSPECTING SCANNER POLLING LOOP (Freeze Culprit)');
console.log('==================================================');
const scannerFile = 'src/context/ScannerContext.tsx';
if (fs.existsSync(scannerFile)) {
  const lines = fs.readFileSync(scannerFile, 'utf8').split('\n');
  for (let i = 240; i < 290 && i < lines.length; i++) {
    console.log(`[ScannerContext.tsx:${i + 1}] ${lines[i]}`);
  }
}

console.log('\n==================================================');
console.log('3. INSPECTING PO RECEIVE ENDPOINT (server.js)');
console.log('==================================================');
const serverFile = 'server.js';
if (fs.existsSync(serverFile)) {
  const lines = fs.readFileSync(serverFile, 'utf8').split('\n');
  lines.forEach((line, idx) => {
    if (line.includes('/api/purchase-orders') && (line.includes('receive') || line.includes('put') || line.includes('post'))) {
      console.log(`[server.js:${idx + 1}] ${line.trim()}`);
    }
    if (line.includes('receivePo') || line.includes('receive-po')) {
      console.log(`[server.js:${idx + 1}] ${line.trim()}`);
    }
  });
}

process.exit(0);
