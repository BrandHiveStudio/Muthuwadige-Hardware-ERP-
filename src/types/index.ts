export interface Product {
  id: string;
  name: string;
  sku: string;
  category: string;
  price: number;
  costPrice: number;
  cost_price?: number;
  stock: number;
  minStock: number;
  min_stock?: number;
  supplier: string;
  unit: string;
  barcode: string;
  brand?: string;
  serialNo?: string;
  batchCode?: string;
  expiryDate?: string;
  supplierPhone?: string;
  measureDetails?: string;
  parent_product_id?: string;
  parentProductId?: string;
  is_batch?: boolean;
  isBatch?: boolean;
  batch_number?: number;
  batchNumber?: number;
}

export interface Customer {
  id: string;
  name: string;
  phone: string;
  address: string;
  nic?: string;
  email?: string;
  loyaltyPoints: number;
  totalPurchases: number;
  joinDate: string;
  credit_balance?: number;
  current_credit?: number;
  creditBalance?: number;
}

export interface Supplier {
  id: string;
  name: string;
  contact?: string;
  email?: string;
  phone?: string;
  address?: string;
  totalOrders?: number;
  balance?: number;
  payableBalance?: number;
  payable_balance?: number;
  creditTerms?: string;
  credit_terms?: string;
  nic?: string;
}

export interface SaleItem {
  productId: string;
  productName: string;
  qty: number;
  price: number;
  total: number;
  taxRate: number;
  serialNo?: string;
  batchCode?: string;
  unit?: string;
  conversionRate?: number;
  discount?: number;
  discountType?: 'percent' | 'amount';
}

export interface SaleOrder {
  id: string;
  invoiceNo: string;
  invoice_no?: string;
  customer_id: string;
  customerName: string;
  customer_name?: string;
  items: SaleItem[];
  subtotal: number;
  discount: number;
  tax: number;
  total: number;
  status: string;
  date: string;
  cashier: string;
  user_id?: string;
  user_email?: string;
  total_amount?: number;
  created_at?: string;
  tax_rate?: number;
  payment_method?: string;
  paymentMethod?: string;
  due_date?: string;
  credit_period_days?: number;
  payment_received?: number;
  transportation_fee?: number;
  transportationFee?: number;
  customer_phone?: string;
  customerPhone?: string;
  customer_address?: string;
  customerAddress?: string;
  credit_note_applied?: number;
  creditNoteApplied?: number;
  credit_note_code?: string;
  creditNoteCode?: string;
  cheque_number?: string;
  chequeNumber?: string;
  cheque_bank?: string;
  chequeBank?: string;
  cheque_date?: string;
  chequeDate?: string;
  cheque_type?: string;
  chequeType?: string;
}

export interface PurchaseItem {
  productId: string;
  productName: string;
  qty: number;
  costPrice: number;
  total: number;
  receivedProductId?: string;
  receivedSku?: string;
  isNewBatch?: boolean;
}

export interface PurchaseOrder {
  id: string;
  poNumber: string;
  supplierId: string;
  supplierName: string;
  items: PurchaseItem[];
  total: number;
  original_total?: number;
  originalTotal?: number;
  debit_note_code?: string;
  debitNoteCode?: string;
  debit_note_applied?: number;
  debitNoteApplied?: number;
  status: 'received' | 'pending' | 'cancelled';
  date: string;
  dueDate: string;
}

export interface Employee {
  id: string;
  name: string;
  role: string;
  department: string;
  email: string;
  phone: string;
  salary: number;
  joinDate: string;
  status: 'active' | 'inactive';
  attendance: number;
}

export interface Transaction {
  id: string;
  type: 'income' | 'expense' | 'contra_revenue' | 'sales_return';
  category: string;
  description: string;
  amount: number;
  date: string;
  reference: string;
}
// 1. Define all possible roles in one place (strictly restricted to Admin, Manager, Cashier)
export type UserRole = 'Admin' | 'Manager' | 'Cashier';

// 2. Update the User interface (Delete the old duplicate version)
export interface User {
  id: string;
  name: string;
  full_name?: string;
  fullName?: string;
  username?: string;
  email: string;
  role: UserRole; // Use the type defined above
  avatar: string;
  permissions?: string[] | string;
  custom_permissions?: string[] | string;
}

// 3. Ensure PageName includes all your pages and granular permission keys
export type PageName = 
  | 'dashboard' 
  | 'inventory' 
  | 'sales' 
  | 'purchasing' 
  | 'customers' 
  | 'suppliers'
  | 'reports' 
  | 'users'
  | 'database'
  | 'settings'
  | 'finance'
  | 'audit_logs'
  | 'barcode-print'
  | 'barcode_print'
  | 'barcodes'
  | 'sales_create'
  | 'sales_today'
  | 'sales_own_history'
  | 'sales_all_history'
  | 'sales_customer_history'
  | 'sales_credit_history'
  | 'sales_customer_credit'
  | 'sales_invoice_details'
  | 'sales_payment_status'
  | 'sales_returns'
  | 'credit_view_history'
  | 'credit_customer_details'
  | 'credit_create_sale'
  | 'credit_record_payment'
  | 'credit_returns'
  | 'credit_edit'
  | 'credit_delete_void';

export interface Quotation {
  id: string;
  quote_no: string;
  customer_name: string;
  customer_phone?: string;
  customer_address?: string;
  validity_period?: string;
  items: string | SaleItem[];
  subtotal?: number;
  discount_type?: 'amount' | 'percentage';
  discount_value?: number;
  discount_amount?: number;
  transportation_fee?: number;
  tax_amount?: number;
  total: number;
  status?: string;
  created_at: string;
}

export interface DeliveryNote {
  id: string;
  dn_no: string;
  customer_name: string;
  items: string; // JSON string representation of SaleItem[]
  reference_invoice: string;
  created_at: string;
}

export interface SalesReturn {
  id: string;
  returnNo?: string;
  return_no?: string;
  invoiceNo: string;
  invoice_no?: string;
  customerName?: string;
  customer_name?: string;
  customerPhone?: string;
  customer_phone?: string;
  returnedItems: SaleItem[];
  exchangeItems?: SaleItem[];
  returnMethod: 'Cash Refund' | 'Exchange' | 'Credit Note' | 'Return';
  returnAmount?: number;
  refund_amount?: number;
  grossAmount?: number;
  gross_amount?: number;
  discountAmount?: number;
  discount_amount?: number;
  total_amount?: number;
  exchangeAmount?: number;
  balanceAmount?: number;
  totalRefunded: number;
  customerPaid?: number;
  changeGiven?: number;
  creditNoteNo?: string;
  userId?: string;
  user_id?: string;
  user_email?: string;
  cashier?: string;
  cashier_name?: string;
  status?: string;
  reason?: string;
  created_at: string;
  isCredit?: boolean;
  is_credit?: boolean | number;
  differencePaymentMethod?: string;
  difference_payment_method?: string;
}

export interface CreditNote {
  id: string;
  creditNoteNo?: string;
  credit_note_no?: string;
  code?: string;
  invoiceNo?: string;
  invoice_no?: string;
  customerId?: string;
  customer_id?: string;
  customerName?: string;
  customer_name?: string;
  customerPhone?: string;
  customer_phone?: string;
  items?: SaleItem[] | string;
  amount?: number;
  value?: number;
  balanceRemaining?: number;
  balance_remaining?: number;
  status: 'active' | 'Active' | 'partially_used' | 'Partially Used' | 'fully_used' | 'Fully Used' | 'used' | 'redeemed' | 'expired' | 'voided';
  reason?: string;
  userId?: string;
  user_id?: string;
  redeemed_invoice?: string;
  created_at: string;
}

export interface CreditNoteUsage {
  id: string;
  credit_note_no: string;
  invoice_no?: string;
  customer_id?: string;
  customer_name?: string;
  customer_phone?: string;
  amount_applied: number;
  previous_balance: number;
  remaining_balance: number;
  action?: 'applied' | 'cash_refund';
  user_email?: string;
  created_at: string;
}

export type ChequeDirection = 'INWARD' | 'OUTWARD';
export type ChequeType = 'CROSSED_ACCOUNT_PAYEE' | 'CASH_BEARER';
export type ChequeStatus = 'PENDING' | 'IN_HAND' | 'DEPOSITED' | 'CLEARED' | 'BOUNCED' | 'CANCELLED';
export type ChequeReferenceType = 'SALE_INVOICE' | 'CREDIT_SETTLEMENT' | 'PURCHASE_ORDER' | 'GRN' | 'MANUAL_DEPOSIT' | 'EXPENSE';

export interface Cheque {
  id: string;
  direction: ChequeDirection;
  cheque_type: ChequeType;
  cheque_number: string;
  bank_name: string;
  branch?: string;
  cheque_date: string;
  amount: number;
  party_id?: string;
  party_name?: string;
  reference_type?: ChequeReferenceType;
  reference_id?: string;
  status: ChequeStatus;
  notes?: string;
  cleared_at?: string;
  created_by?: string;
  createdBy?: string;
  processed_by?: string;
  processedBy?: string;
  created_at?: string;
  updated_at?: string;
}

export type PurchaseReturnSettlementMode = 'SUPPLIER_DEBIT_NOTE' | 'CASH_REFUND' | 'BANK_REFUND';

export interface PurchaseReturnItem {
  id?: number;
  return_id?: string;
  returnId?: string;
  product_id?: string;
  productId?: string;
  product_name?: string;
  productName?: string;
  quantity?: number;
  qty?: number;
  unit_cost_price?: number;
  unitCostPrice?: number;
  costPrice?: number;
  subtotal?: number;
  total?: number;
}

export interface PurchaseReturn {
  id: string;
  return_number?: string;
  returnNumber?: string;
  supplier_id?: string;
  supplierId?: string;
  supplier_name?: string;
  supplierName?: string;
  purchase_order_id?: string;
  purchaseOrderId?: string;
  total_returned_cost?: number;
  totalReturnedCost?: number;
  total?: number;
  settlement_mode?: PurchaseReturnSettlementMode;
  settlementMode?: PurchaseReturnSettlementMode;
  status?: 'ACTIVE' | 'VOIDED' | 'REDEEMED' | 'PARTIALLY_REDEEMED' | string;
  balance_remaining?: number;
  balanceRemaining?: number;
  redeemed_amount?: number;
  redeemedAmount?: number;
  redeemed_in_po_number?: string;
  void_reason?: string;
  voidReason?: string;
  reason?: string;
  notes?: string;
  handled_by?: string;
  handledBy?: string;
  created_by?: string;
  created_by_name?: string;
  createdByName?: string;
  created_at?: string;
  createdAt?: string;
  updated_at?: string;
  date?: string;
  items?: PurchaseReturnItem[];
}

export interface SyncStatus {
  isWebClient: boolean;
  lastUpstreamSync: string | null;
  lastDownstreamSync: string | null;
  lastCounterSync: string | null;
  queuedCount: number;
  status: 'online' | 'offline' | 'syncing';
  // Legacy / convenience aliases
  isOnline?: boolean;
  lastSyncedAt?: string | null;
  pendingCount?: number;
  isSyncing?: boolean;
}
