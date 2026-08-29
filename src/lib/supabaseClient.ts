import { api, API_URL, fetchWithTimeout } from './api';

// This is a plug-and-play adapter that mimics the official Supabase Client.
// It intercepts all queries from the app and routes them to our local SQLite Express Server.
// This allows the app to run locally without changing a single line of database code in the 10+ pages!

const defaultAdmin = {
  id: 'u2',
  email: 'admin@hardware.com',
  role: 'admin',
  name: 'Steven Clark',
  avatar: 'S'
};

// Database routing helper
const fetchTable = async (table: string, type?: string, filter?: { col: string; val: any }) => {
  try {
    let data: any = [];
    if (table === 'products') {
      data = await api.products.getAll();
    } else if (table === 'customers') {
      data = await api.customers.getAll();
    } else if (table === 'suppliers') {
      data = await api.suppliers.getAll();
    } else if (table === 'sales') {
      data = await api.sales.getAll();
    } else if (table === 'purchase_orders') {
      data = await api.purchaseOrders.getAll();
    } else if (table === 'employees') {
      data = await api.employees.getAll();
    } else if (table === 'transactions') {
      data = await api.transactions.getAll();
    } else if (table === 'profiles') {
      data = await api.profiles.getAll();
    } else if (table === 'system_settings') {
      data = await api.settings.get();
    } else if (table === 'sales_returns') {
      data = await api.sales.returns.getAll();
    } else if (table === 'credit_notes') {
      data = await api.creditNotes.getAll();
    } else {
      const res = await fetchWithTimeout(`${API_URL}/${table}`);
      if (res.ok) data = await res.json();
    }

    // Apply client-side filters if needed
    if (filter) {
      if (Array.isArray(data)) {
        data = data.filter(item => item[filter.col] === filter.val);
      }
    }

    if (type === 'single') {
      return { data: Array.isArray(data) ? data[0] || null : data, error: null };
    }

    return { data, error: null };
  } catch (err: any) {
    console.error(`[Mock DB] Error fetching table ${table}:`, err);
    return { data: null, error: err };
  }
};

const insertTable = async (table: string, payload: any) => {
  try {
    let result: any = null;
    if (table === 'products') {
      result = await api.products.save(payload);
    } else if (table === 'customers') {
      result = await api.customers.save(payload);
    } else if (table === 'suppliers') {
      result = await api.suppliers.save(payload);
    } else if (table === 'sales') {
      result = await api.sales.save(payload);
    } else if (table === 'purchase_orders') {
      result = await api.purchaseOrders.save(payload);
    } else if (table === 'employees') {
      result = await api.employees.save(payload);
    } else if (table === 'transactions') {
      result = await api.transactions.save(payload);
    } else if (table === 'sales_returns') {
      result = await api.sales.returns.process(payload);
    } else {
      const res = await fetchWithTimeout(`${API_URL}/${table}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (res.ok) result = await res.json();
    }

    return { data: result, error: null };
  } catch (err: any) {
    console.error(`[Mock DB] Error inserting into table ${table}:`, err);
    return { data: null, error: err };
  }
};

const updateTable = async (table: string, payload: any, val: any) => {
  try {
    let result: any = null;
    // val is usually the primary key id
    if (table === 'products') {
      result = await api.products.save(payload, val);
    } else if (table === 'customers') {
      result = await api.customers.save(payload, val);
    } else if (table === 'suppliers') {
      result = await api.suppliers.save(payload, val);
    } else if (table === 'sales') {
      if (payload.status === 'paid') {
        result = await api.sales.markAsPaid(val);
      } else {
        // Fallback or full update not supported yet
        const res = await fetchWithTimeout(`${API_URL}/sales/${val}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        result = await res.json();
      }
    } else if (table === 'purchase_orders') {
      if (payload.status === 'received') {
        result = await api.purchaseOrders.receive(val);
      } else {
        const res = await fetchWithTimeout(`${API_URL}/purchase-orders/${val}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        result = await res.json();
      }
    } else if (table === 'employees') {
      result = await api.employees.save(payload, val);
    } else if (table === 'profiles') {
      result = await api.profiles.save(payload, val);
    } else if (table === 'system_settings') {
      result = await api.settings.save(payload);
    } else {
      const res = await fetchWithTimeout(`${API_URL}/${table}/${val}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (res.ok) result = await res.json();
    }

    return { data: result, error: null };
  } catch (err: any) {
    console.error(`[Mock DB] Error updating table ${table}:`, err);
    return { data: null, error: err };
  }
};

const deleteTable = async (table: string, val: any) => {
  try {
    let result: any = null;
    if (table === 'products') {
      result = await api.products.delete(val);
    } else if (table === 'customers') {
      result = await api.customers.delete(val);
    } else if (table === 'suppliers') {
      result = await api.suppliers.delete(val);
    } else if (table === 'employees') {
      result = await api.employees.delete(val);
    } else if (table === 'transactions') {
      return { data: null, error: new Error('Deleting finance/accounting transaction records is disabled for financial audit compliance.') };
    } else if (table === 'sales') {
      result = await api.sales.delete(val);
    } else if (table === 'profiles') {
      result = await api.profiles.delete(val);
    } else if (table === 'purchase_orders') {
      result = await api.purchaseOrders.delete(val);
    } else {
      const res = await fetchWithTimeout(`${API_URL}/${table}/${val}`, { method: 'DELETE' });
      if (res.ok) result = await res.json();
    }

    return { data: result, error: null };
  } catch (err: any) {
    console.error(`[Mock DB] Error deleting from table ${table}:`, err);
    return { data: null, error: err };
  }
};

export const supabase: any = {
  auth: {
    getUser: async () => {
      const localUserStr = localStorage.getItem('erp_user') || localStorage.getItem('hardware_erp_user');
      if (localUserStr) {
        try {
          const user = JSON.parse(localUserStr);
          return { data: { user }, error: null };
        } catch(e) {}
      }
      return { data: { user: null }, error: null };
    },

    signInWithPassword: async ({ email, password }: any) => {
      try {
        const { data, error } = await api.auth.login(email, password);
        if (error) throw error;
        localStorage.setItem('erp_user', JSON.stringify(data.user));
        return { data: { user: data.user }, error: null };
      } catch (err: any) {
        return { data: { user: null }, error: err };
      }
    },

    signUp: async ({ email, password, options }: any) => {
      try {
        const name = options?.data?.full_name || 'Staff Member';
        const role = options?.data?.role || 'cashier';
        const { data, error } = await api.auth.register(email, password, name, role);
        if (error) throw error;
        return { data: { user: data.user }, error: null };
      } catch (err: any) {
        return { data: { user: null }, error: err };
      }
    },

    signOut: async () => {
      localStorage.removeItem('erp_user');
      return { error: null };
    }
  },

  from: (table: string) => {
    return {
      select: (fields?: string) => {
        const selectChain = {
          order: (col?: string, opts?: any) => {
            return {
              single: () => fetchTable(table, 'single'),
              maybeSingle: () => fetchTable(table, 'single'),
              then: (onfulfilled: any) => fetchTable(table).then(onfulfilled)
            };
          },
          eq: (col: string, val: any) => {
            return {
              single: () => fetchTable(table, 'single', { col, val }),
              maybeSingle: () => fetchTable(table, 'single', { col, val }),
              then: (onfulfilled: any) => fetchTable(table, 'filter', { col, val }).then(onfulfilled)
            };
          },
          single: () => fetchTable(table, 'single'),
          maybeSingle: () => fetchTable(table, 'single'),
          then: (onfulfilled: any) => fetchTable(table).then(onfulfilled)
        };
        return selectChain;
      },

      insert: (records: any[]) => {
        return {
          select: () => {
            return {
              single: () => insertTable(table, records[0]),
              maybeSingle: () => insertTable(table, records[0]),
              then: (onfulfilled: any) => insertTable(table, records[0]).then(onfulfilled)
            };
          },
          then: (onfulfilled: any) => insertTable(table, records[0]).then(onfulfilled)
        };
      },

      update: (payload: any) => {
        return {
          eq: (col: string, val: any) => {
            return {
              then: (onfulfilled: any) => updateTable(table, payload, val).then(onfulfilled)
            };
          }
        };
      },

      upsert: (records: any[]) => {
        return {
          then: (onfulfilled: any) => {
            if (table === 'system_settings') {
              return api.settings.save(records[0]).then(onfulfilled);
            }

            return insertTable(table, records[0]).then(onfulfilled);
          }
        };
      },

      delete: () => {
        return {
          eq: (col: string, val: any) => {
            return {
              then: (onfulfilled: any) => deleteTable(table, val).then(onfulfilled)
            };
          }
        };
      }
    };
  },

  // Mock RPC support
  rpc: async (name: string, args?: any) => {
    console.log(`[Mock DB] RPC Triggered: ${name} with args`, args);
    return { data: null, error: { message: 'RPC not available on local SQLite' } };
  }
};