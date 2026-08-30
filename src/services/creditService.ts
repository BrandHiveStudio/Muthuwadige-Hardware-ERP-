import { supabase } from '../lib/supabaseClient';

export interface CreditSettlementPayload {
  id?: string;
  sale_id?: string;
  invoice_id?: string;
  invoice_no?: string;
  customer_id?: string;
  customer_name?: string;
  amount?: number;
  amount_paid?: number;
  remaining_balance?: number;
  payment_method?: 'Cash' | 'Card' | 'Bank' | string;
  payment_date?: string;
  notes?: string;
  created_by?: string;
  recorded_by?: string;
  created_at?: string;
  [key: string]: any;
}

export interface CurrentUserSession {
  id?: string;
  name?: string;
  username?: string;
  email?: string;
  role?: string;
}

/**
 * Resolves the display/author name from the active session user.
 * When operating under the baseline Super Admin account, attributes to 'Sanoj Hardware'.
 * When a dedicated secondary staff account is logged in, attributes to that staff member's name.
 */
export function resolveAuthorName(currentUser?: CurrentUserSession | null): string {
  const active = currentUser || (() => {
    try {
      if (typeof window !== 'undefined') {
        const stored =
          localStorage.getItem('erp_user') ||
          localStorage.getItem('hardware_erp_user') ||
          sessionStorage.getItem('erp_user') ||
          sessionStorage.getItem('hardware_erp_user');
        if (stored) return JSON.parse(stored);
      }
    } catch (_) {}
    return null;
  })();

  const isSuperAdmin = !active || 
    active.email === 'admin@hardware.com' || 
    active.email === 'sanojhardware@gmail.com' ||
    (active.role || '').toLowerCase() === 'super_admin' || 
    (active.role || '').toLowerCase() === 'super admin' ||
    active.id === 'u1' || 
    active.id === 'u2' || 
    active.id === 'admin_super';

  if (isSuperAdmin) {
    return 'Sanoj Hardware';
  }

  if (active?.name && active.name.trim()) return active.name.trim();
  if (active?.fullName && active.fullName.trim()) return active.fullName.trim();
  if (active?.username && active.username.trim()) return active.username.trim();
  return 'Sanoj Hardware';
}

/**
 * Records a credit settlement payment in the database, ensuring both
 * the settlement record (credit_payments / credit_settlements) and
 * the financial cash flow log (transactions) use the active session author.
 */
export async function recordCreditSettlement(
  payload: CreditSettlementPayload,
  currentUser?: CurrentUserSession | null
) {
  // Replace fallback string with active session username
  const authorName = resolveAuthorName(currentUser);

  const amount = Number(
    payload.amount !== undefined
      ? payload.amount
      : payload.amount_paid !== undefined
      ? payload.amount_paid
      : 0
  );
  const invNo = payload.invoice_no || payload.invoice_id || 'INV';
  const saleId = payload.sale_id || payload.invoice_id || invNo;
  const paymentMethod = payload.payment_method || 'Cash';
  const paymentDate = payload.payment_date || new Date().toISOString();
  const createdAt = payload.created_at || new Date().toISOString();
  const dateOnly = (paymentDate || createdAt).substring(0, 10);
  const isPartial = (payload.remaining_balance || 0) > 0.01;

  const settlementRecord = {
    id: payload.id || 'cp_' + Date.now() + '_' + Math.random().toString(36).substring(2, 6),
    sale_id: saleId,
    invoice_no: invNo,
    customer_id: payload.customer_id || null,
    customer_name: payload.customer_name || null,
    amount_paid: amount,
    remaining_balance: Number(payload.remaining_balance || 0),
    payment_method: paymentMethod,
    payment_date: paymentDate,
    recorded_by: authorName,
    created_by: authorName,
    cashier: authorName,
    created_at: createdAt,
    notes: payload.notes || `Credit settlement for invoice ${invNo}`
  };

  // 1. Insert into credit_payments (which automatically and atomically records the ledger transaction in server.js)
  const cpRes = await supabase.from('credit_payments').insert([settlementRecord]);

  return {
    success: !cpRes.error,
    settlementRecord,
    error: cpRes.error
  };
}
