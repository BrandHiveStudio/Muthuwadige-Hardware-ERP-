import sqlite3 from 'sqlite3';
import { open } from 'sqlite';
import path from 'path';
import os from 'os';

const DB_FILE = path.join(os.homedir(), 'AppData', 'Roaming', 'ERP-Template', 'hardware.db');

async function dump() {
  console.log('Connecting to:', DB_FILE);
  const db = await open({
    filename: DB_FILE,
    driver: sqlite3.Database
  });

  console.log('--- PRODUCTS ---');
  const products = await db.all('SELECT * FROM products');
  console.log(JSON.stringify(products, null, 2));

  console.log('--- CUSTOMERS ---');
  const customers = await db.all('SELECT * FROM customers');
  console.log(JSON.stringify(customers, null, 2));

  console.log('--- SALES ---');
  const sales = await db.all('SELECT * FROM sales');
  console.log(JSON.stringify(sales, null, 2));

  await db.close();
}

dump();
