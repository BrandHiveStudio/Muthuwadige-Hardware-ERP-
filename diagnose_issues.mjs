import fs from 'fs';
import path from 'path';

console.log('==================================================');
console.log('AUDIT 1: PRODUCT BARCODE UPDATE LOGIC');
console.log('==================================================');

// Search server.js or backend routes for PUT / PATCH / UPDATE on products
const serverFiles = ['server.js', 'server/index.js', 'src/server.js', 'electron-main.js'];
for (const file of serverFiles) {
  if (fs.existsSync(file)) {
    const content = fs.readFileSync(file, 'utf8');
    const lines = content.split('\n');
    lines.forEach((line, idx) => {
      if (line.includes('/api/products') || line.includes('UPDATE products') || (line.includes('barcode') && line.includes('products'))) {
        console.log(`[${file}:${idx + 1}] ${line.trim()}`);
      }
    });
  }
}

// Search frontend for product update call (Inventory.tsx)
const invFiles = ['src/pages/Inventory.tsx', 'src/components/ProductModal.tsx', 'src/services/api.ts'];
for (const file of invFiles) {
  if (fs.existsSync(file)) {
    const content = fs.readFileSync(file, 'utf8');
    const lines = content.split('\n');
    lines.forEach((line, idx) => {
      if (line.includes('barcode') && (line.includes('set') || line.includes('update') || line.includes('PUT') || line.includes('api'))) {
        console.log(`[${file}:${idx + 1}] ${line.trim()}`);
      }
    });
  }
}

console.log('\n==================================================');
console.log('AUDIT 2: SCANNER PAIRING & IP DETECTION LOGIC');
console.log('==================================================');

// Search for network interface detection or scanner QR pairing URL generation
const allFiles = [
  'server.js',
  'src/pages/Sales.tsx',
  'src/components/MobileScannerModal.tsx',
  'src/components/ScannerModal.tsx',
  'src/services/scannerService.ts'
];

for (const file of allFiles) {
  if (fs.existsSync(file)) {
    const content = fs.readFileSync(file, 'utf8');
    const lines = content.split('\n');
    lines.forEach((line, idx) => {
      if (
        line.includes('networkInterfaces') ||
        line.includes('169.254') ||
        line.includes('pairing') ||
        line.includes('scanner') && (line.includes('url') || line.includes('http') || line.includes('ip'))
      ) {
        console.log(`[${file}:${idx + 1}] ${line.trim()}`);
      }
    });
  }
}

// Check how product barcode is defined in SQLite schema
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
const appDataDbPath = path.join(process.env.APPDATA || '', 'Muthuwadige Hardware ERP', 'hardware.db');
if (fs.existsSync(appDataDbPath)) {
  const db = await open({ filename: appDataDbPath, driver: sqlite3.Database });
  const productCols = await db.all("PRAGMA table_info(products)");
  console.log('\nProducts Table Columns in local DB:');
  console.log(productCols.map(c => `${c.name} (${c.type})`).join(', '));
  
  const samplePaint = await db.get("SELECT id, name, barcode, sku FROM products WHERE name LIKE '%Nippon%' OR name LIKE '%Weatherbond%' LIMIT 1");
  console.log('\nCurrent Database Record for Weatherbond Paint:');
  console.log(samplePaint);
  await db.close();
}

process.exit(0);
