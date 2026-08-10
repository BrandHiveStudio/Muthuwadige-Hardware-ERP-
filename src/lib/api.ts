const getDefaultApiUrl = () => {
  if (typeof window !== 'undefined') {
    // If loaded in a web browser pointing to our Express server (e.g. on a phone or client browser)
    // window.location.origin will be 'http://<host-ip>:5001' or similar.
    // If the protocol is http/https and it is not a Vite dev port (starts with 517), use the current window origin!
    const { protocol, port, origin } = window.location;
    if ((protocol === 'http:' || protocol === 'https:') && !port.startsWith('517')) {
      return `${origin}/api`;
    }
  }
  return (import.meta.env as any).VITE_API_URL || 'http://localhost:5001/api';
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
    const cleanUrl = newUrl.replace(/\/$/, ''); // strip trailing slash
    localStorage.setItem('erp_host_address', cleanUrl);
    API_URL = `${cleanUrl}/api`;
  } else {
    localStorage.removeItem('erp_host_address');
    API_URL = getDefaultApiUrl();
  }
  BASE_URL = API_URL.replace(/\/api$/, '');
};

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
      const res = await fetch(`${API_URL}/auth/login`, {
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
      const res = await fetch(`${API_URL}/auth/register`, {
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
      // Mock session retrieval for frontend user parsing
      const localUserStr = localStorage.getItem('erp_user');
      if (localUserStr) {
        const user = JSON.parse(localUserStr);
        return { data: { user }, error: null };
      }
      // If none set, fallback to a default admin for developer comfort
      const defaultUser = { id: 'u2', email: 'admin@hardware.com', role: 'admin', name: 'Steven Clark' };
      return { data: { user: defaultUser }, error: null };
    }
  },

  products: {
    getAll: async () => {
      const res = await fetch(`${API_URL}/products`);
      if (!res.ok) await handleError(res, 'Failed to fetch inventory products');
      return res.json();
    },
    save: async (data: any, id?: string) => {
      const res = await fetch(`${API_URL}/products${id ? `/${id}` : ''}`, {
        method: id ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
      if (!res.ok) await handleError(res, 'Failed to save product in local database');
      return res.json();
    },
    delete: async (id: string) => {
      const res = await fetch(`${API_URL}/products/${id}`, { method: 'DELETE' });
      if (!res.ok) await handleError(res, 'Failed to delete product from database');
      return res.json();
    }
  },

  customers: {
    getAll: async () => {
      const res = await fetch(`${API_URL}/customers`);
      if (!res.ok) throw new Error('Failed to fetch customers');
      return res.json();
    },
    save: async (data: any, id?: string) => {
      const res = await fetch(`${API_URL}/customers${id ? `/${id}` : ''}`, {
        method: id ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
      if (!res.ok) throw new Error('Failed to save customer details');
      return res.json();
    },
    delete: async (id: string) => {
      const res = await fetch(`${API_URL}/customers/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to remove customer');
      return res.json();
    }
  },

  suppliers: {
    getAll: async () => {
      const res = await fetch(`${API_URL}/suppliers`);
      if (!res.ok) throw new Error('Failed to fetch suppliers');
      return res.json();
    },
    save: async (data: any, id?: string) => {
      const res = await fetch(`${API_URL}/suppliers${id ? `/${id}` : ''}`, {
        method: id ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
      if (!res.ok) throw new Error('Failed to save supplier details');
      return res.json();
    },
    delete: async (id: string) => {
      const res = await fetch(`${API_URL}/suppliers/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to remove supplier');
      return res.json();
    }
  },

  sales: {
    getAll: async () => {
      const res = await fetch(`${API_URL}/sales`);
      if (!res.ok) throw new Error('Failed to fetch sales history');
      return res.json();
    },
    save: async (data: any) => {
      const res = await fetch(`${API_URL}/sales`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Local POS checkout failed');
      }
      return res.json();
    },
    markAsPaid: async (id: string) => {
      const res = await fetch(`${API_URL}/sales/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'paid' })
      });
      if (!res.ok) throw new Error('Failed to update sale status');
      return res.json();
    },
    void: async (id: string, userEmail: string) => {
      const res = await fetch(`${API_URL}/sales/${id}/void`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_email: userEmail })
      });
      if (!res.ok) throw new Error('Failed to void invoice');
      return res.json();
    },
    delete: async (id: string) => {
      const res = await fetch(`${API_URL}/sales/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to delete sale from database');
      return res.json();
    },
    returns: {
      getAll: async () => {
        const res = await fetch(`${API_URL}/sales/returns`);
        if (!res.ok) throw new Error('Failed to fetch sales returns history');
        return res.json();
      },
      process: async (data: any) => {
        const res = await fetch(`${API_URL}/sales/returns`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data)
        });
        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.error || 'Failed to process sales return');
        }
        return res.json();
      }
    }
  },

  purchaseOrders: {
    getAll: async () => {
      const res = await fetch(`${API_URL}/purchase-orders`);
      if (!res.ok) throw new Error('Failed to fetch purchase orders');
      return res.json();
    },
    save: async (data: any) => {
      const res = await fetch(`${API_URL}/purchase-orders`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
      if (!res.ok) throw new Error('Failed to insert purchase order');
      return res.json();
    },
    receive: async (id: string) => {
      const res = await fetch(`${API_URL}/purchase-orders/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'received' })
      });
      if (!res.ok) throw new Error('Failed to check in purchase order stock');
      return res.json();
    },
    delete: async (id: string) => {
      const res = await fetch(`${API_URL}/purchase-orders/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to delete purchase order from database');
      return res.json();
    }
  },

  employees: {
    getAll: async () => {
      const res = await fetch(`${API_URL}/employees`);
      if (!res.ok) throw new Error('Failed to load employee profiles');
      return res.json();
    },
    save: async (data: any, id?: string) => {
      const res = await fetch(`${API_URL}/employees${id ? `/${id}` : ''}`, {
        method: id ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
      if (!res.ok) throw new Error('Failed to save staff logs');
      return res.json();
    },
    delete: async (id: string) => {
      const res = await fetch(`${API_URL}/employees/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to delete staff member');
      return res.json();
    }
  },

  transactions: {
    getAll: async () => {
      const res = await fetch(`${API_URL}/transactions`);
      if (!res.ok) throw new Error('Failed to fetch financial ledger');
      return res.json();
    },
    save: async (data: any) => {
      const res = await fetch(`${API_URL}/transactions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
      if (!res.ok) throw new Error('Failed to log cash flow transaction');
      return res.json();
    },
    delete: async (id: string) => {
      const res = await fetch(`${API_URL}/transactions/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to remove transaction record');
      return res.json();
    }
  },

  settings: {
    get: async () => {
      const res = await fetch(`${API_URL}/settings`);
      if (!res.ok) throw new Error('Failed to load shop settings');
      return res.json();
    },
    save: async (data: any) => {
      const res = await fetch(`${API_URL}/settings`, {
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
      const res = await fetch(`${API_URL}/profiles`);
      if (!res.ok) throw new Error('Failed to fetch user profiles');
      return res.json();
    },
    save: async (data: any, id: string) => {
      const res = await fetch(`${API_URL}/profiles/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
      if (!res.ok) throw new Error('Failed to update profile configurations');
      return res.json();
    },
    changePassword: async (id: string, password?: string) => {
      const res = await fetch(`${API_URL}/profiles/${id}/password`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password })
      });
      if (!res.ok) throw new Error('Failed to update password');
      return res.json();
    },
    delete: async (id: string) => {
      const res = await fetch(`${API_URL}/profiles/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to delete staff user profile');
      return res.json();
    }
  },

  auditLogs: {
    getAll: async () => {
      const res = await fetch(`${API_URL}/audit_logs`);
      if (!res.ok) throw new Error('Failed to fetch audit logs');
      return res.json();
    },
    log: async (userEmail: string, action: string, details: string) => {
      const res = await fetch(`${API_URL}/audit_logs`, {
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
      const res = await fetch(`${API_URL}/quotations`);
      if (!res.ok) throw new Error('Failed to fetch quotations');
      return res.json();
    },
    getNextNumber: async () => {
      const res = await fetch(`${API_URL}/quotations/next-number`);
      if (!res.ok) throw new Error('Failed to fetch next quotation number');
      return res.json();
    },
    save: async (data: any) => {
      const res = await fetch(`${API_URL}/quotations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
      if (!res.ok) throw new Error('Failed to save quotation');
      return res.json();
    },
    delete: async (id: string) => {
      const res = await fetch(`${API_URL}/quotations/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to delete quotation');
      return res.json();
    }
  },

  deliveryNotes: {
    getAll: async () => {
      const res = await fetch(`${API_URL}/delivery_notes`);
      if (!res.ok) throw new Error('Failed to fetch delivery notes');
      return res.json();
    },
    save: async (data: any) => {
      const res = await fetch(`${API_URL}/delivery_notes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
      if (!res.ok) throw new Error('Failed to save delivery note');
      return res.json();
    },
    delete: async (id: string) => {
      const res = await fetch(`${API_URL}/delivery_notes/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to delete delivery note');
      return res.json();
    }
  },

  creditNotes: {
    getAll: async () => {
      try {
        const res = await fetch(`${API_URL}/credit-notes`);
        if (res.ok) return res.json();
      } catch (e) {}
      const res = await fetch(`${API_URL}/sales/credit-notes`);
      if (!res.ok) throw new Error('Failed to fetch credit notes');
      return res.json();
    },
    redeem: async (code: string, amountApplied: number, invoiceNo?: string) => {
      const res = await fetch(`${API_URL}/credit-notes/redeem`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, amountApplied, invoiceNo })
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to redeem credit note');
      }
      return res.json();
    },
    getUsageHistory: async (code?: string) => {
      const url = code ? `${API_URL}/credit-notes/${code}/usage` : `${API_URL}/credit-notes/usage`;
      const res = await fetch(url);
      if (!res.ok) throw new Error('Failed to fetch credit note usage history');
      return res.json();
    },
    refundCash: async (code: string, reason?: string, userEmail?: string) => {
      const res = await fetch(`${API_URL}/credit-notes/refund-cash`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, reason, userEmail })
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Failed to process cash refund for credit note');
      }
      return res.json();
    }
  },

  stockAdjustments: {
    getAll: async () => {
      const res = await fetch(`${API_URL}/stock_adjustments`);
      if (!res.ok) throw new Error('Failed to fetch stock adjustments');
      return res.json();
    },
    create: async (data: any) => {
      const res = await fetch(`${API_URL}/stock_adjustments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
      if (!res.ok) throw new Error('Failed to save stock adjustment');
      return res.json();
    }
  }
};

