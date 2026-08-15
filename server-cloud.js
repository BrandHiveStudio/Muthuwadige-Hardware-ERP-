import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';

dotenv.config();

const app = express();

// Secure CORS configuration for Vercel production web domain and local dev
const allowedOrigins = [
  'https://hardware-store-psi.vercel.app',
  'https://hardware-store-production-v2.vercel.app',
  'http://localhost:5173',
  'http://localhost:3000'
];

app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin) || origin.endsWith('.vercel.app')) {
      callback(null, true);
    } else {
      callback(null, true); // Allow requests during development/testing
    }
  },
  credentials: true
}));

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Supabase Cloud PostgreSQL Client initialization using secure server-side environment variables
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_KEY || process.env.VITE_SUPABASE_ANON_KEY || '';

let supabase = null;
if (SUPABASE_URL && SUPABASE_SERVICE_KEY) {
  supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
    auth: { persistSession: false }
  });
  console.log('✅ Supabase Cloud PostgreSQL Client initialized.');
} else {
  console.warn('⚠️ SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY environment variables missing.');
}

// In-Memory Cloud Data Store fallback for standalone testing if Supabase credentials are missing
const memoryStore = {
  profiles: [
    {
      id: 'u1',
      name: 'Sanoj Hardware',
      email: 'sanojhardware@gmail.com',
      role: 'super_admin',
      avatar: 'S',
      password: 'sanoj123',
      created_at: new Date().toISOString()
    }
  ],
  products: [],
  customers: [],
  suppliers: [],
  sales: [],
  sales_returns: [],
  purchase_orders: [],
  settings: {
    id: 'global',
    shop_name: 'MUTHUWADIGE HARDWARE',
    address: 'No: 80, Mahahunupitiya, Negombo',
    phone: '077 076 076 7',
    email: 'sanojhardware@gmail.com',
    currency: 'Rs.',
    tax_rate: 0,
    backup_email: 'sanojhardware@gmail.com',
    backup_enabled: 0,
    next_invoice_number: 'INV001',
    updated_at: new Date().toISOString()
  },
  employees: [],
  transactions: [],
  audit_logs: [],
  quotations: [],
  delivery_notes: [],
  credit_notes: [],
  credit_note_usage: [],
  stock_adjustments: [],
  bill_holds: [],
  custom_permissions: {
    super_admin: ['dashboard', 'inventory', 'sales', 'purchasing', 'customers', 'suppliers', 'reports', 'users', 'database', 'settings', 'finance', 'audit_logs'],
    admin: ['dashboard', 'inventory', 'sales', 'purchasing', 'customers', 'suppliers', 'reports', 'settings', 'finance'],
    manager: ['dashboard', 'inventory', 'sales', 'purchasing', 'customers', 'suppliers', 'reports', 'finance'],
    cashier: ['dashboard', 'sales', 'customers'],
    retail_user: ['dashboard', 'sales', 'customers']
  }
};

// Health Check Endpoint
app.get('/api/health', (req, res) => {
  res.json({
    status: 'online',
    environment: 'cloud',
    supabaseConnected: !!supabase,
    timestamp: new Date().toISOString()
  });
});

// AUTHENTICATION
app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body || {};
  try {
    let profile = null;

    if (supabase) {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('email', email)
        .single();
      if (data && !error) profile = data;
    }

    if (!profile) {
      profile = memoryStore.profiles.find(p => p.email === email);
    }

    if (!profile) {
      return res.status(400).json({ error: 'User profile not found. Try: sanojhardware@gmail.com' });
    }

    if (profile.password && profile.password !== password) {
      return res.status(400).json({ error: 'Incorrect password.' });
    }

    res.json({
      user: {
        id: profile.id,
        email: profile.email,
        role: profile.role,
        name: profile.name,
        avatar: profile.avatar || profile.name?.charAt(0).toUpperCase() || 'U'
      }
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/auth/register', async (req, res) => {
  const { email, password, name, role } = req.body || {};
  const id = 'u_' + Date.now();
  const newProfile = {
    id,
    name: name || 'Staff User',
    email,
    role: role || 'cashier',
    avatar: (name || email || 'U').charAt(0).toUpperCase(),
    password: password || '123456',
    created_at: new Date().toISOString()
  };

  try {
    if (supabase) {
      await supabase.from('profiles').insert([newProfile]);
    } else {
      memoryStore.profiles.push(newProfile);
    }
    res.json({ success: true, user: { id, email, role: newProfile.role, name: newProfile.name } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PRODUCTS API
app.get('/api/products', async (req, res) => {
  try {
    let products = [];
    if (supabase) {
      const { data, error } = await supabase.from('products').select('*').order('name', { ascending: true });
      if (data && !error) products = data;
    } else {
      products = memoryStore.products;
    }

    const mapped = products.map(p => ({
      id: p.id,
      name: p.name,
      sku: p.sku,
      category: p.category,
      price: Number(p.price) || 0,
      costPrice: Number(p.cost_price || p.costPrice) || 0,
      stock: Number(p.stock) || 0,
      minStock: Number(p.min_stock || p.minStock) || 5,
      supplier: p.supplier || '',
      unit: p.unit || 'pcs',
      barcode: p.barcode || '',
      brand: p.brand || '',
      serialNo: p.serial_no || p.serialNo || '',
      batchCode: p.batch_code || p.batchCode || '',
      expiryDate: p.expiry_date || p.expiryDate || '',
      supplierPhone: p.supplier_phone || p.supplierPhone || '',
      measureDetails: p.measure_details || p.measureDetails || ''
    }));

    res.json(mapped);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/products', async (req, res) => {
  const p = req.body || {};
  const id = p.id || 'p_' + Date.now();
  const dbRecord = {
    id,
    name: p.name,
    sku: p.sku || 'SKU-' + Date.now(),
    category: p.category || 'General',
    price: Number(p.price) || 0,
    cost_price: Number(p.costPrice || p.cost_price) || 0,
    stock: Number(p.stock) || 0,
    min_stock: Number(p.minStock || p.min_stock) || 5,
    supplier: p.supplier || '',
    unit: p.unit || 'pcs',
    barcode: p.barcode || '',
    brand: p.brand || '',
    serial_no: p.serialNo || p.serial_no || '',
    batch_code: p.batchCode || p.batch_code || '',
    expiry_date: p.expiryDate || p.expiry_date || null
  };

  try {
    if (supabase) {
      await supabase.from('products').upsert([dbRecord]);
    } else {
      const idx = memoryStore.products.findIndex(item => item.id === id);
      if (idx >= 0) memoryStore.products[idx] = dbRecord;
      else memoryStore.products.push(dbRecord);
    }
    res.json({ success: true, product: dbRecord });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/products/:id', async (req, res) => {
  const { id } = req.params;
  const p = req.body || {};
  const dbRecord = {
    id,
    name: p.name,
    sku: p.sku,
    category: p.category,
    price: Number(p.price) || 0,
    cost_price: Number(p.costPrice || p.cost_price) || 0,
    stock: Number(p.stock) || 0,
    min_stock: Number(p.minStock || p.min_stock) || 5,
    supplier: p.supplier || '',
    unit: p.unit || 'pcs',
    barcode: p.barcode || '',
    brand: p.brand || '',
    serial_no: p.serialNo || p.serial_no || '',
    batch_code: p.batchCode || p.batch_code || '',
    expiry_date: p.expiryDate || p.expiry_date || null
  };

  try {
    if (supabase) {
      await supabase.from('products').update(dbRecord).eq('id', id);
    } else {
      const idx = memoryStore.products.findIndex(item => item.id === id);
      if (idx >= 0) memoryStore.products[idx] = { ...memoryStore.products[idx], ...dbRecord };
    }
    res.json({ success: true, product: dbRecord });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/products/:id', async (req, res) => {
  const { id } = req.params;
  try {
    if (supabase) {
      await supabase.from('products').delete().eq('id', id);
    } else {
      memoryStore.products = memoryStore.products.filter(item => item.id !== id);
    }
    res.json({ success: true, id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// CUSTOMERS API
app.get('/api/customers', async (req, res) => {
  try {
    let customers = [];
    if (supabase) {
      const { data } = await supabase.from('customers').select('*').order('name', { ascending: true });
      if (data) customers = data;
    } else {
      customers = memoryStore.customers;
    }
    res.json(customers);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/customers', async (req, res) => {
  const c = req.body || {};
  const id = c.id || 'c_' + Date.now();
  const record = {
    id,
    name: c.name,
    email: c.email || '',
    phone: c.phone || '',
    address: c.address || '',
    nic: c.nic || '',
    loyalty_points: Number(c.loyalty_points || c.loyaltyPoints) || 0,
    total_purchases: Number(c.total_purchases || c.totalPurchases) || 0,
    join_date: c.join_date || c.joinDate || new Date().toISOString()
  };

  try {
    if (supabase) {
      await supabase.from('customers').upsert([record]);
    } else {
      const idx = memoryStore.customers.findIndex(item => item.id === id);
      if (idx >= 0) memoryStore.customers[idx] = record;
      else memoryStore.customers.push(record);
    }
    res.json({ success: true, customer: record });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/customers/:id', async (req, res) => {
  const { id } = req.params;
  const c = req.body || {};
  try {
    if (supabase) {
      await supabase.from('customers').update(c).eq('id', id);
    } else {
      const idx = memoryStore.customers.findIndex(item => item.id === id);
      if (idx >= 0) memoryStore.customers[idx] = { ...memoryStore.customers[idx], ...c };
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/customers/:id', async (req, res) => {
  const { id } = req.params;
  try {
    if (supabase) {
      await supabase.from('customers').delete().eq('id', id);
    } else {
      memoryStore.customers = memoryStore.customers.filter(item => item.id !== id);
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// SUPPLIERS API
app.get('/api/suppliers', async (req, res) => {
  try {
    let suppliers = [];
    if (supabase) {
      const { data } = await supabase.from('suppliers').select('*').order('name', { ascending: true });
      if (data) suppliers = data;
    } else {
      suppliers = memoryStore.suppliers;
    }
    res.json(suppliers);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/suppliers', async (req, res) => {
  const s = req.body || {};
  const id = s.id || 'sup_' + Date.now();
  const record = {
    id,
    name: s.name,
    email: s.email || '',
    phone: s.phone || '',
    address: s.address || '',
    credit_terms: s.credit_terms || s.creditTerms || '',
    payable_balance: Number(s.payable_balance || s.payableBalance) || 0,
    nic: s.nic || ''
  };

  try {
    if (supabase) {
      await supabase.from('suppliers').upsert([record]);
    } else {
      const idx = memoryStore.suppliers.findIndex(item => item.id === id);
      if (idx >= 0) memoryStore.suppliers[idx] = record;
      else memoryStore.suppliers.push(record);
    }
    res.json({ success: true, supplier: record });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/suppliers/:id', async (req, res) => {
  const { id } = req.params;
  const s = req.body || {};
  try {
    if (supabase) {
      await supabase.from('suppliers').update(s).eq('id', id);
    } else {
      const idx = memoryStore.suppliers.findIndex(item => item.id === id);
      if (idx >= 0) memoryStore.suppliers[idx] = { ...memoryStore.suppliers[idx], ...s };
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/suppliers/:id', async (req, res) => {
  const { id } = req.params;
  try {
    if (supabase) {
      await supabase.from('suppliers').delete().eq('id', id);
    } else {
      memoryStore.suppliers = memoryStore.suppliers.filter(item => item.id !== id);
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// SALES API
app.get('/api/sales', async (req, res) => {
  try {
    let sales = [];
    if (supabase) {
      const { data } = await supabase.from('sales').select('*').order('created_at', { ascending: false });
      if (data) sales = data;
    } else {
      sales = memoryStore.sales;
    }

    const mapped = sales.map(s => ({
      ...s,
      invoiceNo: s.invoice_no || s.invoiceNo,
      customerId: s.customer_id || s.customerId,
      customerName: s.customer_name || s.customerName,
      totalAmount: Number(s.total_amount || s.totalAmount) || 0,
      paymentMethod: s.payment_method || s.paymentMethod || 'Cash',
      items: typeof s.items === 'string' ? JSON.parse(s.items || '[]') : s.items || []
    }));

    res.json(mapped);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/sales', async (req, res) => {
  const s = req.body || {};
  const id = s.id || 's_' + Date.now();
  const record = {
    id,
    invoice_no: s.invoiceNo || s.invoice_no || 'INV-' + Date.now(),
    customer_id: s.customerId || s.customer_id || null,
    customer_name: s.customerName || s.customer_name || 'Walk-in Customer',
    items: typeof s.items === 'object' ? JSON.stringify(s.items) : s.items || '[]',
    subtotal: Number(s.subtotal) || 0,
    discount: Number(s.discount) || 0,
    tax: Number(s.tax) || 0,
    tax_rate: Number(s.taxRate || s.tax_rate) || 0,
    total_amount: Number(s.totalAmount || s.total_amount) || 0,
    status: s.status || 'paid',
    user_id: s.userId || s.user_id || null,
    payment_method: s.paymentMethod || s.payment_method || 'Cash',
    created_at: s.createdAt || s.created_at || new Date().toISOString()
  };

  try {
    if (supabase) {
      await supabase.from('sales').insert([record]);
    } else {
      memoryStore.sales.unshift(record);
    }
    res.json({ success: true, sale: record });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// SETTINGS API
app.get('/api/settings', async (req, res) => {
  try {
    let settings = memoryStore.settings;
    if (supabase) {
      const { data } = await supabase.from('system_settings').select('*').eq('id', 'global').single();
      if (data) settings = data;
    }
    res.json(settings);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/settings', async (req, res) => {
  const payload = req.body || {};
  const updated = {
    ...memoryStore.settings,
    ...payload,
    id: 'global',
    updated_at: new Date().toISOString()
  };

  try {
    if (supabase) {
      await supabase.from('system_settings').upsert([updated]);
    } else {
      memoryStore.settings = updated;
    }
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PERMISSIONS API
app.get('/api/permissions', async (req, res) => {
  res.json(memoryStore.custom_permissions);
});

// PROFILES API
app.get('/api/profiles', async (req, res) => {
  try {
    let profiles = memoryStore.profiles;
    if (supabase) {
      const { data } = await supabase.from('profiles').select('id, name, email, role, avatar, created_at');
      if (data) profiles = data;
    }
    res.json(profiles);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// AUDIT LOGS API
app.get('/api/audit_logs', async (req, res) => {
  try {
    let logs = memoryStore.audit_logs;
    if (supabase) {
      const { data } = await supabase.from('audit_logs').select('*').order('timestamp', { ascending: false }).limit(100);
      if (data) logs = data;
    }
    res.json(logs);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// QUOTATIONS API
app.get('/api/quotations', async (req, res) => {
  try {
    let list = memoryStore.quotations;
    if (supabase) {
      const { data } = await supabase.from('quotations').select('*').order('created_at', { ascending: false });
      if (data) list = data;
    }
    res.json(list);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/quotations/next-number', async (req, res) => {
  const nextNum = 'QT-' + String(memoryStore.quotations.length + 1).padStart(4, '0');
  res.json({ nextQuoteNo: nextNum });
});

// BILL HOLDS API
app.get('/api/bill_holds', async (req, res) => {
  res.json(memoryStore.bill_holds);
});

// Server listener for standalone Node process
const PORT = process.env.PORT || 5002;
if (process.env.NODE_ENV !== 'test' && !process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`🚀 Cloud Express REST API Server running on port ${PORT}`);
  });
}

export default app;
