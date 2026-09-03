-- ============================================================
-- SUPABASE / POSTGRESQL MIGRATION: REVERSAL & VOID ENGINE
-- Description: Transactional stored procedures (RPC functions)
--              for rolling back purchase returns, cheque statuses,
--              and received purchase orders.
-- ============================================================

-- Ensure helper columns exist if not already present
ALTER TABLE purchase_returns ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'ACTIVE';
ALTER TABLE purchase_returns ADD COLUMN IF NOT EXISTS void_reason TEXT;
ALTER TABLE purchase_returns ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS received_at TIMESTAMPTZ;
ALTER TABLE purchase_orders ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

ALTER TABLE cheques ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();

-- ============================================================
-- 1. VOID / REVERT PURCHASE RETURN (Debit Notes)
-- ============================================================
CREATE OR REPLACE FUNCTION void_purchase_return(
  p_return_no TEXT,
  p_void_reason TEXT DEFAULT 'Accidental / User Mistake'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_pr RECORD;
  v_item RECORD;
BEGIN
  -- 1. Fetch return details
  SELECT * INTO v_pr 
  FROM purchase_returns 
  WHERE return_no = p_return_no OR id = p_return_no OR return_number = p_return_no;
  
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'message', 'Purchase return record not found.');
  END IF;

  IF v_pr.status = 'VOIDED' THEN
    RETURN jsonb_build_object('success', false, 'message', 'This return voucher is already voided.');
  END IF;

  -- 2. Restore stock for all items in the return batch
  FOR v_item IN (
    SELECT * FROM purchase_return_items 
    WHERE return_id = v_pr.id OR return_no = p_return_no
  ) LOOP
    UPDATE products 
    SET stock = stock + v_item.quantity 
    WHERE id = v_item.product_id;
  END LOOP;

  -- 3. Reverse financial settlement
  IF v_pr.settlement_mode = 'CASH_REFUND' OR v_pr.settlement_mode = 'Cash Refund' OR v_pr.settlement_mode = 'BANK_REFUND' THEN
    -- Remove the cash/bank income transaction
    DELETE FROM transactions 
    WHERE (reference = p_return_no OR reference = v_pr.return_number OR description ILIKE '%' || p_return_no || '%');
  ELSIF v_pr.settlement_mode = 'SUPPLIER_CREDIT' OR v_pr.settlement_mode = 'Supplier Debit Note' OR v_pr.settlement_mode = 'SUPPLIER_DEBIT_NOTE' THEN
    -- Add the payable liability back to supplier balance
    UPDATE suppliers 
    SET payable_balance = COALESCE(payable_balance, 0) + COALESCE(v_pr.total_returned_cost, v_pr.total_amount, 0)
    WHERE id = v_pr.supplier_id;
  END IF;

  -- 4. Mark status as VOIDED
  UPDATE purchase_returns 
  SET status = 'VOIDED', void_reason = p_void_reason, updated_at = NOW()
  WHERE id = v_pr.id;

  RETURN jsonb_build_object('success', true, 'message', 'Purchase return successfully voided and balances restored.');
END;
$$;

-- ============================================================
-- 2. UNDO ACCIDENTAL CHEQUE CLEARANCE / BOUNCE
-- ============================================================
CREATE OR REPLACE FUNCTION undo_cheque_status(
  p_cheque_id TEXT,
  p_revert_to TEXT DEFAULT 'IN_HAND' -- 'IN_HAND' or 'PENDING'
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_cheque RECORD;
  v_target_status TEXT;
BEGIN
  v_target_status := COALESCE(p_revert_to, 'IN_HAND');

  SELECT * INTO v_cheque 
  FROM cheques 
  WHERE id = p_cheque_id OR cheque_no = p_cheque_id OR cheque_number = p_cheque_id;
  
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'message', 'Cheque not found.');
  END IF;

  -- If it was cleared, remove the corresponding cash/bank transaction
  IF v_cheque.status = 'CLEARED' THEN
    DELETE FROM transactions 
    WHERE reference = v_cheque.cheque_number OR reference = v_cheque.cheque_no 
       OR description ILIKE '%' || COALESCE(v_cheque.cheque_number, v_cheque.cheque_no) || '%';
  END IF;

  -- If it was bounced and created a penalty or unsettled credit, roll it back
  IF v_cheque.status = 'BOUNCED' THEN
    DELETE FROM transactions 
    WHERE (reference = v_cheque.cheque_number OR reference = v_cheque.cheque_no) 
      AND category ILIKE '%Penalty%';
  END IF;

  -- Update status back to initial state
  UPDATE cheques 
  SET status = v_target_status, updated_at = NOW() 
  WHERE id = v_cheque.id;

  RETURN jsonb_build_object('success', true, 'message', 'Cheque status reverted successfully.');
END;
$$;

-- ============================================================
-- 3. VOID / REVERT RECEIVED PURCHASE ORDER
-- ============================================================
CREATE OR REPLACE FUNCTION revert_purchase_order_receipt(
  p_po_ref TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_po RECORD;
  v_item RECORD;
BEGIN
  SELECT * INTO v_po 
  FROM purchase_orders 
  WHERE po_reference = p_po_ref OR po_number = p_po_ref OR id = p_po_ref;
  
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'message', 'Purchase order not found.');
  END IF;

  IF UPPER(v_po.status) != 'RECEIVED' THEN
    RETURN jsonb_build_object('success', false, 'message', 'Only received purchase orders can be reverted.');
  END IF;

  -- 1. Deduct stock that was received (from JSON items or relational items)
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'purchase_order_items') THEN
    FOR v_item IN (SELECT * FROM purchase_order_items WHERE po_id = v_po.id) LOOP
      UPDATE products 
      SET stock = GREATEST(0, stock - v_item.quantity) 
      WHERE id = v_item.product_id;
    END LOOP;
  END IF;

  -- 2. Deduct the supplier payable liability
  UPDATE suppliers 
  SET payable_balance = GREATEST(0, COALESCE(payable_balance, 0) - COALESCE(v_po.total, v_po.grand_total, 0))
  WHERE id = v_po.supplier_id OR name = v_po.supplier_name;

  -- 3. Remove linked purchase transaction if logged
  DELETE FROM transactions 
  WHERE reference = COALESCE(v_po.po_number, v_po.po_reference, v_po.id)
     OR description ILIKE '%' || COALESCE(v_po.po_number, v_po.po_reference, v_po.id) || '%';

  -- 4. Reset PO status to PENDING
  UPDATE purchase_orders 
  SET status = 'pending', received_at = NULL, updated_at = NOW()
  WHERE id = v_po.id;

  RETURN jsonb_build_object('success', true, 'message', 'PO receipt reverted to PENDING and stock/payables restored.');
END;
$$;
