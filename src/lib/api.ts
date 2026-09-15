export function getBaseUrl(): string {
  if (typeof window === 'undefined') return 'http://localhost:5001/api';

  // 1. ELECTRON DESKTOP APP CHECK (MUST COME FIRST)
  const isElectron = Boolean((window as any).electronAPI) || 
                     window.location.protocol === 'file:' || 
                     (typeof navigator !== 'undefined' && navigator.userAgent.includes('Electron'));
  
  if (isElectron) {
    const stored = localStorage.getItem('erp_host_address') || localStorage.getItem('api_server_url') || localStorage.getItem('server_address');
    return (stored ? stored.replace(/\/+$/, '').replace(/\/api$/, '') : 'http://localhost:5001') + '/api';
  }

  // 2. LIVE WEB DEPLOYMENT (Vercel, custom domain)
  const hostname = window.location.hostname || '';
  const isLocalWeb = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '';
  
  if (!isLocalWeb) {
    return `${window.location.origin}/api`;
  }

  // 3. LOCAL DEV BROWSER (Vite on :5173 connecting to backend on :5001)
  const stored = localStorage.getItem('erp_host_address') || localStorage.getItem('api_server_url') || localStorage.getItem('server_address');
  return (stored ? stored.replace(/\/+$/, '').replace(/\/api$/, '') : 'http://localhost:5001') + '/api';
}

export let API_URL = getBaseUrl();
export let BASE_URL = API_URL.replace(/\/api$/, '');

export const setApiUrl = (newUrl: string | null) => {
  if (newUrl) {
    const cleanUrl = newUrl.replace(/\/+$/, '');
    localStorage.setItem('erp_host_address', cleanUrl);
    localStorage.setItem('api_server_url', cleanUrl);
    API_URL = cleanUrl.endsWith('/api') ? cleanUrl : `${cleanUrl}/api`;
  } else {
    localStorage.removeItem('erp_host_address');
    localStorage.removeItem('api_server_url');
    localStorage.removeItem('server_address');
    API_URL = getBaseUrl();
  }
  BASE_URL = API_URL.replace(/\/api$/, '');
};


export const getAuthHeaders = (): Record<string, string> => {
  // SECURITY: this previously defaulted to `x-user-role: 'super_admin'` whenever no user was
  // stored (e.g. a cleared/corrupted session) - since the server never verified any of these
  // headers, every unauthenticated request silently identified itself as a super admin. The
  // server now issues and verifies a real session token (see POST /api/auth/login /
  // `authenticate` in server.js) and never trusts these headers for authorization - they remain
  // only for human-readable audit-log labeling. When nothing is stored, no identity is sent at
  // all, so an unauthenticated request is correctly rejected server-side instead of impersonating
  // an admin.
  const headers: Record<string, string> = {};
  try {
    let token = localStorage.getItem('token') || sessionStorage.getItem('token') || localStorage.getItem('auth_token') || sessionStorage.getItem('erp_session_token') || localStorage.getItem('erp_session_token');
    if (token) {
      token = token.replace(/^Bearer\s+/i, '').trim();
      headers['Authorization'] = `Bearer ${token}`;
    }
    const userStr = localStorage.getItem('erp_user') || localStorage.getItem('hardware_erp_user') || sessionStorage.getItem('erp_user') || sessionStorage.getItem('hardware_erp_user');
    if (userStr) {
      const u = JSON.parse(userStr);
      if (u && (u.email || u.name || u.username)) {
        headers['x-user-email'] = u.email || '';
        headers['x-user-name'] = u.name || u.username || '';
        headers['x-user-role'] = u.role || '';
      }
    }
  } catch (_) {}
  return headers;
};

// Robust fetch helper with configurable timeout & automatic abort controller handling
export async function fetchWithTimeout(url: string, options: RequestInit = {}, timeoutMs = 30000): Promise<Response> {
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

  const authHeaders = getAuthHeaders();
  const mergedHeaders = {
    ...authHeaders,
    ...(options.headers || {})
  };

  try {
    const res = await fetch(url, {
      ...options,
      headers: mergedHeaders,
      signal: controller.signal,
      // Include HttpOnly cookies automatically on every request so the server can
      // authenticate via the secure cookie set at login, without exposing the raw
      // token to JavaScript. The Authorization Bearer header is preserved as a
      // backward-compatible fallback (e.g. Electron file:// origin, where
      // SameSite cookies are not sent).
      credentials: 'include'
    });
    // Only trigger session expiration / logout if an explicit auth verification endpoint
    // (/api/auth/me or /api/auth/verify) returns 401.
    // Auxiliary data fetches, background sync, or catalog polling errors must NEVER wipe credentials
    // or trigger premature logout during initial bootstrap.
    const isExplicitAuthCheck = url.includes('/auth/me') || url.includes('/auth/verify');
    if (res.status === 401 && isExplicitAuthCheck && typeof window !== 'undefined') {
      try {
        sessionStorage.removeItem('erp_session_token');
        localStorage.removeItem('erp_session_token');
      } catch (_) {}
      window.dispatchEvent(new Event('session-expired'));
    }
    return res;
  } catch (err: any) {
    if (err.name === 'AbortError' || controller.signal?.aborted) {
      if (options.signal?.aborted) {
        throw new Error('Request was cancelled.');
      }
      if (url.includes('/auth/login') || url.includes('/health')) {
        throw new Error('Server took too long to wake up. Please click Login again in a moment.');
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
      }, 35000);
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
    register: async (email: string, password?: string, name?: string, role?: string, permissions?: string[] | string) => {
      const res = await fetchWithTimeout(`${API_URL}/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, name, role, permissions })
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
      const localUserStr = localStorage.getItem('erp_user') || localStorage.getItem('hardware_erp_user') || sessionStorage.getItem('erp_user') || sessionStorage.getItem('hardware_erp_user');
      if (localUserStr) {
        try {
          const user = JSON.parse(localUserStr);
          if (user && user.id) {
            return { data: { user }, error: null };
          }
        } catch (_) {}
      }
      return {
        data: {
          user: {
            id: 'u2',
            email: 'admin@hardware.com',
            role: 'super_admin',
            name: 'Steven Clark',
            avatar: 'S'
          }
        },
        error: null
      };
    },
    me: async () => {
      const res = await fetchWithTimeout(`${API_URL}/auth/me`);
      if (!res.ok) await handleError(res, 'Failed to fetch current session user');
      return res.json();
    },
    verify: async () => {
      const res = await fetchWithTimeout(`${API_URL}/auth/verify`);
      if (!res.ok) await handleError(res, 'Session verification failed');
      return res.json();
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
    bulkImport: async (products: any[]) => {
      const authHeaders = getAuthHeaders();
      const res = await fetchWithTimeout(`${API_URL}/products/bulk-import`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...authHeaders
        },
        body: JSON.stringify(products)
      }, 60000);
      if (!res.ok) await handleError(res, 'Failed to bulk import products');
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
    },
    bulkImport: async (customers: any[]) => {
      const token = localStorage.getItem('token') || sessionStorage.getItem('token') || localStorage.getItem('auth_token') || sessionStorage.getItem('erp_session_token') || localStorage.getItem('erp_session_token') || '';
      const res = await fetchWithTimeout(`${API_URL}/customers/bulk-import`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {})
        },
        body: JSON.stringify(customers)
      }, 45000);
      if (!res.ok) await handleError(res, 'Failed to bulk import customers');
      return res.json();
    },
    import: async (customers: any[]) => {
      return api.customers.bulkImport(customers);
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
    bulkImport: async (suppliers: any[]) => {
      const token = localStorage.getItem('token') || sessionStorage.getItem('token') || localStorage.getItem('auth_token') || sessionStorage.getItem('erp_session_token') || localStorage.getItem('erp_session_token') || '';
      const res = await fetchWithTimeout(`${API_URL}/suppliers/bulk-import`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { 'Authorization': `Bearer ${token}` } : {})
        },
        body: JSON.stringify(suppliers)
      }, 45000);
      if (!res.ok) await handleError(res, 'Failed to bulk import suppliers');
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
    receive: async (id: string, metadata?: any) => {
      const res = await fetchWithTimeout(`${API_URL}/purchase-orders/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: 'Received',
          received_at: new Date().toISOString(),
          received_by: metadata?.received_by || 'Admin',
          payment_method: metadata?.payment_method || 'CREDIT',
          ...metadata
        })
      });
      if (!res.ok) throw new Error('Failed to check in purchase order stock');
      return res.json();
    },
    delete: async (id: string) => {
      const res = await fetchWithTimeout(`${API_URL}/purchase-orders/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to delete purchase order from database');
      return res.json();
    },
    revertReceipt: async (poRef: string) => {
      const res = await fetchWithTimeout(`${API_URL}/purchase-orders/${poRef}/revert-receipt`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ po_ref: poRef })
      });
      if (!res.ok) {
        let msg = 'Failed to revert purchase order receipt';
        try { const j = await res.json(); if (j.error || j.message) msg = j.error || j.message; } catch (_) {}
        throw new Error(msg);
      }
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
    delete: async (_id: string) => {
      throw new Error('Deleting finance/accounting transaction records is disabled for financial audit compliance.');
    }
  },

  settings: {
    get: async () => {
      const res = await fetchWithTimeout(`${API_URL}/settings`, {
        headers: {
          ...getAuthHeaders()
        }
      });
      if (!res.ok) throw new Error('Failed to load shop settings');
      return res.json();
    },
    save: async (data: any) => {
      const res = await fetchWithTimeout(`${API_URL}/settings`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          ...getAuthHeaders()
        },
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
      if (!res.ok) {
        let msg = 'Failed to update profile configurations';
        try { const j = await res.json(); if (j.error) msg = j.error; } catch (_) {}
        throw new Error(msg);
      }
      return res.json();
    },
    changePassword: async (id: string, password?: string) => {
      const res = await fetchWithTimeout(`${API_URL}/profiles/${id}/password`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password })
      });
      if (!res.ok) {
        let msg = 'Failed to update password';
        try { const j = await res.json(); if (j.error) msg = j.error; } catch (_) {}
        throw new Error(msg);
      }
      return res.json();
    },
    delete: async (id: string) => {
      const res = await fetchWithTimeout(`${API_URL}/profiles/${id}`, { method: 'DELETE' });
      if (!res.ok) {
        let msg = 'Failed to delete staff user profile';
        try { const j = await res.json(); if (j.error) msg = j.error; } catch (_) {}
        throw new Error(msg);
      }
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
    },
    create: async (data: { user_email?: string; user_name?: string; action: string; details: string; user_role?: string }) => {
      const res = await fetchWithTimeout(`${API_URL}/audit_logs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
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
  },

  creditPayments: {
    getAll: async () => {
      const res = await fetchWithTimeout(`${API_URL}/credit_payments`);
      if (!res.ok) throw new Error('Failed to fetch credit payments');
      return res.json();
    },
    getBySale: async (saleId: string) => {
      const res = await fetchWithTimeout(`${API_URL}/credit_payments/sale/${saleId}`);
      if (!res.ok) throw new Error('Failed to fetch credit payments for sale');
      return res.json();
    },
    save: async (data: any) => {
      const res = await fetchWithTimeout(`${API_URL}/credit_payments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
      if (!res.ok) throw new Error('Failed to save credit payment');
      return res.json();
    }
  },

  creditSettlements: {
    getAll: async () => {
      const res = await fetchWithTimeout(`${API_URL}/credit_payments`);
      if (!res.ok) throw new Error('Failed to fetch credit settlements');
      return res.json();
    },
    save: async (data: any) => {
      const res = await fetchWithTimeout(`${API_URL}/credit_payments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
      if (!res.ok) throw new Error('Failed to save credit settlement');
      return res.json();
    }
  },

  cheques: {
    getAll: async (params?: { direction?: string; status?: string; party_id?: string; start_date?: string; end_date?: string }) => {
      const query = params ? new URLSearchParams(params as any).toString() : '';
      const url = query ? `${API_URL}/cheques?${query}` : `${API_URL}/cheques`;
      const res = await fetchWithTimeout(url);
      if (!res.ok) throw new Error('Failed to fetch cheques');
      return res.json();
    },
    create: async (data: any) => {
      const res = await fetchWithTimeout(`${API_URL}/cheques`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
      if (!res.ok) {
        let msg = 'Failed to create cheque';
        try { const j = await res.json(); if (j.error) msg = j.error; } catch (_) {}
        throw new Error(msg);
      }
      return res.json();
    },
    updateStatus: async (id: string, payload: { status: string; notes?: string; user_email?: string }) => {
      const res = await fetchWithTimeout(`${API_URL}/cheques/${id}/status`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (!res.ok) {
        let msg = 'Failed to update cheque status';
        try { const j = await res.json(); if (j.error) msg = j.error; } catch (_) {}
        throw new Error(msg);
      }
      return res.json();
    },
    undoStatus: async (chequeId: string, revertTo: 'IN_HAND' | 'PENDING' = 'IN_HAND') => {
      const res = await fetchWithTimeout(`${API_URL}/cheques/${chequeId}/undo`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ revert_to: revertTo })
      });
      if (!res.ok) {
        let msg = 'Failed to revert cheque status';
        try { const j = await res.json(); if (j.error || j.message) msg = j.error || j.message; } catch (_) {}
        throw new Error(msg);
      }
      return res.json();
    }
  },

  purchaseReturns: {
    getAll: async () => {
      const res = await fetchWithTimeout(`${API_URL}/purchase-returns`);
      if (!res.ok) throw new Error('Failed to fetch purchase returns');
      return res.json();
    },
    create: async (data: any) => {
      const res = await fetchWithTimeout(`${API_URL}/purchase-returns`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
      if (!res.ok) {
        let msg = 'Failed to create purchase return';
        try { const j = await res.json(); if (j.error) msg = j.error; } catch (_) {}
        throw new Error(msg);
      }
      return res.json();
    },
    void: async (returnNo: string, voidReason?: string) => {
      const res = await fetchWithTimeout(`${API_URL}/purchase-returns/${returnNo}/void`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ void_reason: voidReason || 'Accidental / User Mistake' })
      });
      if (!res.ok) {
        let msg = 'Failed to void purchase return';
        try { const j = await res.json(); if (j.error || j.message) msg = j.error || j.message; } catch (_) {}
        throw new Error(msg);
      }
      return res.json();
    }
  },

  purchasing: {
    receivePo: async (data: {
      po_id: string;
      po_number?: string;
      status?: string;
      received_at?: string;
      received_by?: string;
      payment_method?: string;
      settlement_mode: 'CREDIT' | 'CASH' | 'BANK' | 'CHEQUE';
      payment_date?: string;
      reference?: string;
      notes?: string;
      cheque_number?: string;
      bank_name?: string;
      cheque_date?: string;
      user_email?: string;
    }) => {
      const res = await fetchWithTimeout(`${API_URL}/purchasing/receive-po`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
      if (!res.ok) {
        let msg = 'Failed to receive and settle purchase order';
        try { const j = await res.json(); if (j.error) msg = j.error; } catch (_) {}
        throw new Error(msg);
      }
      return res.json();
    },
    createReturn: async (data: any) => {
      const res = await fetchWithTimeout(`${API_URL}/purchasing/return`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
      });
      if (!res.ok) {
        let msg = 'Failed to process purchase return';
        try { const j = await res.json(); if (j.error) msg = j.error; } catch (_) {}
        throw new Error(msg);
      }
      return res.json();
    },
    revertPo: async (poRef: string) => {
      const res = await fetchWithTimeout(`${API_URL}/purchase-orders/${poRef}/revert-receipt`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ po_ref: poRef })
      });
      if (!res.ok) {
        let msg = 'Failed to revert purchase order receipt';
        try { const j = await res.json(); if (j.error || j.message) msg = j.error || j.message; } catch (_) {}
        throw new Error(msg);
      }
      return res.json();
    }
  },

  sync: {
    getStatus: async () => {
      const res = await fetchWithTimeout(`${API_URL}/sync/status`);
      if (!res.ok) throw new Error('Failed to fetch sync status');
      return res.json();
    },
    triggerSync: async () => {
      const res = await fetchWithTimeout(`${API_URL}/sync/trigger`, { method: 'POST' });
      if (!res.ok) throw new Error('Failed to trigger sync');
      return res.json();
    },
    pullDownstream: async () => {
      const res = await fetchWithTimeout(`${API_URL}/sync/pull`, { method: 'POST' });
      if (!res.ok) throw new Error('Failed to pull downstream updates');
      return res.json();
    },
    acknowledgeReset: async () => {
      try {
        const res = await fetchWithTimeout(`${API_URL}/sync/acknowledge-reset`, { method: 'POST' });
        if (!res.ok) return { success: false };
        return res.json();
      } catch (err) {
        return { success: false, error: (err as any)?.message };
      }
    }
  },

  rpc: async (name: string, args?: any) => {
    const res = await fetchWithTimeout(`${API_URL}/rpc/${name}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(args || {})
    });
    const data = await res.json();
    if (!res.ok || (data && data.success === false)) {
      throw new Error(data?.message || data?.error || `Failed to execute RPC: ${name}`);
    }
    return data;
  }
};
