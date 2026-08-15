const getDefaultApiUrl = () => {
  if (typeof window !== 'undefined') {
    const { protocol, port, origin } = window.location;
    if (protocol === 'file:') {
      return 'http://localhost:5001/api';
    }
    if (port.startsWith('517')) {
      return 'http://localhost:5001/api';
    }
    const envUrl = (import.meta.env as any)?.VITE_API_URL;
    if (envUrl) {
      return envUrl;
    }
    if (protocol === 'http:' || protocol === 'https:') {
      return `${origin}/api`;
    }
  }
  return (import.meta.env as any)?.VITE_API_URL || 'http://localhost:5001/api';
};

const getStoredHost = () => {
  if (typeof window !== 'undefined') {
    return localStorage.getItem('erp_host_address');
  }
  return null;
};

export let API_URL = getStoredHost() 
  ? `${getStoredHost()}/api` 
  : getDefaultApiUrl();

export let BASE_URL = API_URL.replace(/\/api$/, '');

export const setApiUrl = (newUrl: string | null) => {
  if (newUrl) {
    const cleanUrl = newUrl.replace(/\/$/, '');
    localStorage.setItem('erp_host_address', cleanUrl);
    API_URL = `${cleanUrl}/api`;
  } else {
    localStorage.removeItem('erp_host_address');
    API_URL = getDefaultApiUrl();
  }
  BASE_URL = API_URL.replace(/\/api$/, '');
};

// Robust fetch helper with configurable timeout & automatic abort controller handling
export async function fetchWithTimeout(url: string, options: RequestInit = {}, timeoutMs = 15000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  let callerAbortHandler: (() => void) | null = null;
  if (options.signal) {
    if (options.signal.aborted) {
      controller.abort();
    } else {
      callerAbortHandler = () => controller.abort();
      options.signal.addEventListener('abort', callerAbortHandler);
    }
  }

  try {
    const res = await fetch(url, {
      ...options,
      signal: controller.signal
    });
    return res;
  } catch (err: any) {
    if (err.name === 'AbortError' || controller.signal?.aborted) {
      if (options.signal?.aborted) {
        throw new Error('Request was cancelled.');
      }
      throw new Error(`Request timed out after ${Math.round(timeoutMs / 1000)}s. Please check server connection.`);
    }
    if (err.message && err.message.toLowerCase().includes('failed to fetch')) {
      throw new Error('Server connection error. Please verify the host server is running.');
    }
    throw err;
  } finally {
    clearTimeout(timer);
    if (options.signal && callerAbortHandler) {
      options.signal.removeEventListener('abort', callerAbortHandler);
    }
  }
}

async function handleError(res: Response, fallback: string): Promise<never> {
  let message = fallback;
  try {
    if (res.headers.get('content-type')?.includes('application/json')) {
      const err = await res.json();
      if (err && err.error) {
        message = err.error;
      }
    } else {
      message = `${fallback} (Status code: ${res.status})`;
    }
  } catch (_) {}
  throw new Error(message);
}

export const api = {
  auth: {
    login: async (email: string, password?: string) => {
      const res = await fetchWithTimeout(`${API_URL}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });
      if (!res.ok) {
        let message = 'Authentication failed';
        try {
          if (res.headers.get('content-type')?.includes('application/json')) {
            const err = await res.json();
            message = err.error || message;
          } else {
            message = `Server connection error (Status ${res.status}). Verify your Host Server configuration.`;
          }
        } catch (_) {}
        throw new Error(message);
      }
      
      let data;
      try {
        if (res.headers.get('content-type')?.includes('application/json')) {
          data = await res.json();
        } else {
          throw new Error('Server did not return a valid JSON response.');
        }
      } catch (e: any) {
        throw new Error(e.message || 'Failed to parse authentication response.');
      }
      return { data, error: null };
    },
    register: async (email: string, password?: string, name?: string, role?: string) => {
      const res = await fetchWithTimeout(`${API_URL}/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, name, role })
      });
      if (!res.ok) {
        let message = 'Registration failed';
        try {
          if (res.headers.get('content-type')?.includes('application/json')) {
            const err = await res.json();
            message = err.error || message;
          } else {
            message = `Server connection error (Status ${res.status})`;
          }
        } catch (_) {}
        throw new Error(message);
      }
      
      let data;
      try {
        if (res.headers.get('content-type')?.includes('application/json')) {
          data = await res.json();
        } else {
          throw new Error('Server did not return a valid JSON response.');
        }
      } catch (e: any) {
        throw new Error(e.message || 'Failed to parse registration response.');
      }
      return { data, error: null };
    },
    getUser: async () => {
      const localUserStr = localStorage.getItem('erp_user');
      if (localUserStr) {
        try {
          const user = JSON.parse(localUserStr);
          return { data: { user }, error: null };
        } catch (_) {}
      }
      const defaultUser = { id: 'u2', email: 'admin@hardware.com', role: 'admin', name: 'Steven Clark' };
      return { data: { user: defaultUser }, error: null };
    }
  },

  products: {
    getAll: async () => {
      const res = await fetchWithTimeout(`${API_URL}/products`);
      if (!res.ok) await handleError(res, 'Failed to fetch inventory products');
      return res.json();
    },
    save: async (data: any, id?: string) => {
      const res = await fetchWithTimeout(`${API_URL}/products${id ? `/${id}` : ''}`, {
        method: id ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
      if (!res.ok) await handleError(res, 'Failed to save product in local database');
      return res.json();
    },
    delete: async (id: string) => {
      const res = await fetchWithTimeout(`${API_URL}/products/${id}`, { method: 'DELETE' });
      if (!res.ok) await handleError(res, 'Failed to delete product from database');
      return res.json();
    }
  },

  customers: {
    getAll: async () => {
      const res = await fetchWithTimeout(`${API_URL}/customers`);
      if (!res.ok) throw new Error('Failed to fetch customers');
      return res.json();
    },
    save: async (data: any, id?: string) => {
      const res = await fetchWithTimeout(`${API_URL}/customers${id ? `/${id}` : ''}`, {
        method: id ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
      if (!res.ok) throw new Error('Failed to save customer details');
      return res.json();
    },
    delete: async (id: string) => {
      const res = await fetchWithTimeout(`${API_URL}/customers/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to remove customer');
      return res.json();
    }
  },

  suppliers: {
    getAll: async () => {
      const res = await fetchWithTimeout(`${API_URL}/suppliers`);
      if (!res.ok) throw new Error('Failed to fetch suppliers');
      return res.json();
    },
    save: async (data: any, id?: string) => {
      const res = await fetchWithTimeout(`${API_URL}/suppliers${id ? `/${id}` : ''}`, {
        method: id ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
      if (!res.ok) throw new Error('Failed to save supplier details');
      return res.json();
    },
    delete: async (id: string) => {
      const res = await fetchWithTimeout(`${API_URL}/suppliers/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to remove supplier');
      return res.json();
    }
  },

  sales: {
    getAll: async () => {
      const res = await fetchWithTimeout(`${API_URL}/sales`);
      if (!res.ok) throw new Error('Failed to fetch sales history');
      return res.json();
    },
    save: async (data: any) => {
      const res = await fetchWithTimeout(`${API_URL}/sales`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
      if (!res.ok) {
        let message = 'Local POS checkout failed';
        try {
          const err = await res.json();
          message = err.error || message;
        } catch (_) {}
        throw new Error(message);
      }
      return res.json();
    },
    markAsPaid: async (id: string) => {
      const res = await fetchWithTimeout(`${API_URL}/sales/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'paid' })
      });
      if (!res.ok) throw new Error('Failed to update sale status');
      return res.json();
    },
    void: async (id: string, userEmail: string) => {
      const res = await fetchWithTimeout(`${API_URL}/sales/${id}/void`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_email: userEmail })
      });
      if (!res.ok) throw new Error('Failed to void invoice');
      return res.json();
    },
    delete: async (id: string) => {
      const res = await fetchWithTimeout(`${API_URL}/sales/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to delete sale from database');
      return res.json();
    },
    returns: {
      getAll: async () => {
        const res = await fetchWithTimeout(`${API_URL}/sales/returns`);
        if (!res.ok) throw new Error('Failed to fetch sales returns history');
        return res.json();
      },
      process: async (data: any) => {
        const res = await fetchWithTimeout(`${API_URL}/sales/returns`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data)
        });
        if (!res.ok) {
          let message = 'Failed to process sales return';
          try {
            const err = await res.json();
            message = err.error || message;
          } catch (_) {}
          throw new Error(message);
        }
        return res.json();
      },
      delete: async (id: string) => {
        const res = await fetchWithTimeout(`${API_URL}/sales/returns/${id}`, {
          method: 'DELETE'
        });
        if (!res.ok) {
          let message = 'Failed to delete sales return';
          try {
            const err = await res.json();
            message = err.error || message;
          } catch (_) {}
          throw new Error(message);
        }
        return res.json();
      }
    }
  },

  purchaseOrders: {
    getAll: async () => {
      const res = await fetchWithTimeout(`${API_URL}/purchase-orders`);
      if (!res.ok) throw new Error('Failed to fetch purchase orders');
      return res.json();
    },
    save: async (data: any) => {
      const res = await fetchWithTimeout(`${API_URL}/purchase-orders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
      if (!res.ok) throw new Error('Failed to insert purchase order');
      return res.json();
    },
    receive: async (id: string) => {
      const res = await fetchWithTimeout(`${API_URL}/purchase-orders/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'received' })
      });
      if (!res.ok) throw new Error('Failed to check in purchase order stock');
      return res.json();
    },
    delete: async (id: string) => {
      const res = await fetchWithTimeout(`${API_URL}/purchase-orders/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to delete purchase order from database');
      return res.json();
    }
  },

  employees: {
    getAll: async () => {
      const res = await fetchWithTimeout(`${API_URL}/employees`);
      if (!res.ok) throw new Error('Failed to load employee profiles');
      return res.json();
    },
    save: async (data: any, id?: string) => {
      const res = await fetchWithTimeout(`${API_URL}/employees${id ? `/${id}` : ''}`, {
        method: id ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
      if (!res.ok) throw new Error('Failed to save staff logs');
      return res.json();
    },
    delete: async (id: string) => {
      const res = await fetchWithTimeout(`${API_URL}/employees/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to delete staff member');
      return res.json();
    }
  },

  transactions: {
    getAll: async () => {
      const res = await fetchWithTimeout(`${API_URL}/transactions`);
      if (!res.ok) throw new Error('Failed to fetch financial ledger');
      return res.json();
    },
    save: async (data: any) => {
      const res = await fetchWithTimeout(`${API_URL}/transactions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
      if (!res.ok) throw new Error('Failed to log cash flow transaction');
      return res.json();
    },
    delete: async (id: string) => {
      const res = await fetchWithTimeout(`${API_URL}/transactions/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to remove transaction record');
      return res.json();
    }
  },

  settings: {
    get: async () => {
      const res = await fetchWithTimeout(`${API_URL}/settings`);
      if (!res.ok) throw new Error('Failed to load shop settings');
      return res.json();
    },
    save: async (data: any) => {
      const res = await fetchWithTimeout(`${API_URL}/settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
      if (!res.ok) throw new Error('Failed to commit system configurations');
      return res.json();
    }
  },

  profiles: {
    getAll: async () => {
      const res = await fetchWithTimeout(`${API_URL}/profiles`);
      if (!res.ok) throw new Error('Failed to fetch user profiles');
      return res.json();
    },
    save: async (data: any, id: string) => {
      const res = await fetchWithTimeout(`${API_URL}/profiles/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
      if (!res.ok) throw new Error('Failed to update profile configurations');
      return res.json();
    },
    changePassword: async (id: string, password?: string) => {
      const res = await fetchWithTimeout(`${API_URL}/profiles/${id}/password`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password })
      });
      if (!res.ok) throw new Error('Failed to update password');
      return res.json();
    },
    delete: async (id: string) => {
      const res = await fetchWithTimeout(`${API_URL}/profiles/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to delete staff user profile');
      return res.json();
    }
  },

  auditLogs: {
    getAll: async () => {
      const res = await fetchWithTimeout(`${API_URL}/audit_logs`);
      if (!res.ok) throw new Error('Failed to fetch audit logs');
      return res.json();
    },
    log: async (userEmail: string, action: string, details: string) => {
      const res = await fetchWithTimeout(`${API_URL}/audit_logs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_email: userEmail, action, details })
      });
      if (!res.ok) throw new Error('Failed to log audit details');
      return res.json();
    }
  },

  quotations: {
    getAll: async () => {
      const res = await fetchWithTimeout(`${API_URL}/quotations`);
      if (!res.ok) throw new Error('Failed to fetch quotations');
      return res.json();
    },
    getNextNumber: async () => {
      const res = await fetchWithTimeout(`${API_URL}/quotations/next-number`);
      if (!res.ok) throw new Error('Failed to fetch next quotation number');
      return res.json();
    },
    save: async (data: any) => {
      const res = await fetchWithTimeout(`${API_URL}/quotations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
      if (!res.ok) throw new Error('Failed to save quotation');
      return res.json();
    },
    delete: async (id: string) => {
      const res = await fetchWithTimeout(`${API_URL}/quotations/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to delete quotation');
      return res.json();
    }
  },

  deliveryNotes: {
    getAll: async () => {
      const res = await fetchWithTimeout(`${API_URL}/delivery_notes`);
      if (!res.ok) throw new Error('Failed to fetch delivery notes');
      return res.json();
    },
    save: async (data: any) => {
      const res = await fetchWithTimeout(`${API_URL}/delivery_notes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
      if (!res.ok) throw new Error('Failed to save delivery note');
      return res.json();
    },
    delete: async (id: string) => {
      const res = await fetchWithTimeout(`${API_URL}/delivery_notes/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to delete delivery note');
      return res.json();
    }
  },

  creditNotes: {
    getAll: async () => {
      try {
        const res = await fetchWithTimeout(`${API_URL}/credit-notes`, {}, 8000);
        if (res.ok) return res.json();
      } catch (e) {}
      const res = await fetchWithTimeout(`${API_URL}/sales/credit-notes`);
      if (!res.ok) throw new Error('Failed to fetch credit notes');
      return res.json();
    },
    redeem: async (code: string, amountApplied: number, invoiceNo?: string) => {
      const res = await fetchWithTimeout(`${API_URL}/credit-notes/redeem`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, amountApplied, invoiceNo })
      });
      if (!res.ok) {
        let message = 'Failed to redeem credit note';
        try {
          const err = await res.json();
          message = err.error || message;
        } catch (_) {}
        throw new Error(message);
      }
      return res.json();
    },
    getUsageHistory: async (code?: string) => {
      const url = code ? `${API_URL}/credit-notes/${code}/usage` : `${API_URL}/credit-notes/usage`;
      const res = await fetchWithTimeout(url);
      if (!res.ok) throw new Error('Failed to fetch credit note usage history');
      return res.json();
    },
    refundCash: async (code: string, reason?: string, userEmail?: string) => {
      const res = await fetchWithTimeout(`${API_URL}/credit-notes/refund-cash`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, reason, userEmail })
      });
      if (!res.ok) {
        let message = 'Failed to process cash refund for credit note';
        try {
          const err = await res.json();
          message = err.error || message;
        } catch (_) {}
        throw new Error(message);
      }
      return res.json();
    }
  },

  stockAdjustments: {
    getAll: async () => {
      const res = await fetchWithTimeout(`${API_URL}/stock_adjustments`);
      if (!res.ok) throw new Error('Failed to fetch stock adjustments');
      return res.json();
    },
    create: async (data: any) => {
      const res = await fetchWithTimeout(`${API_URL}/stock_adjustments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
      if (!res.ok) throw new Error('Failed to save stock adjustment');
      return res.json();
    }
  }
};
