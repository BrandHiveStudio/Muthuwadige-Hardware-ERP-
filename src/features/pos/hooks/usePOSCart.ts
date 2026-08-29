import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../../../lib/supabaseClient';

export interface ParkedCart {
  id: string;
  timestamp: string;
  customer: any;
  items: any[];
  discount: number;
  transportFee: number;
  holdName?: string;
  subtotal?: number;
  tax?: number;
  totalAmount?: number;
  paymentMethod?: string;
  isGuest?: boolean;
  guestName?: string;
  guestPhone?: string;
  guestAddress?: string;
  notes?: string;
}

export function usePOSCart() {
  const [parkedInvoices, setParkedInvoices] = useState<ParkedCart[]>(() => {
    try {
      const saved = typeof window !== 'undefined' ? localStorage.getItem('erp_parked_carts') : null;
      return saved ? JSON.parse(saved) : [];
    } catch (_) {
      return [];
    }
  });

  // Sync with backend bill_holds table
  const fetchParkedInvoices = useCallback(async () => {
    try {
      const { data } = await supabase.from('bill_holds').select('*');
      if (data && Array.isArray(data)) {
        const mapped: ParkedCart[] = data.map((b: any) => {
          let parsedItems: any[] = [];
          if (typeof b.items === 'string') {
            try {
              parsedItems = JSON.parse(b.items);
            } catch (_) {
              parsedItems = [];
            }
          } else if (Array.isArray(b.items)) {
            parsedItems = b.items;
          }

          return {
            id: b.id,
            timestamp: b.created_at || new Date().toISOString(),
            customer: b.customer_id ? { id: b.customer_id, name: b.customer_name } : null,
            items: parsedItems,
            discount: Number(b.discount || 0),
            transportFee: Number(b.transportation_fee || 0),
            holdName: b.hold_name || `Hold #${b.id.slice(-4)}`,
            subtotal: Number(b.subtotal || 0),
            tax: Number(b.tax || 0),
            totalAmount: Number(b.total_amount || 0),
            isGuest: !b.customer_id,
            guestName: b.customer_name || 'Guest Customer'
          };
        });

        // Merge with local storage without duplicates
        let localSaved: ParkedCart[] = [];
        try {
          const s = localStorage.getItem('erp_parked_carts');
          if (s) localSaved = JSON.parse(s);
        } catch (_) {}

        const combined = [...mapped];
        for (const loc of localSaved) {
          if (!combined.some(c => c.id === loc.id)) {
            combined.push(loc);
          }
        }

        setParkedInvoices(combined);
        localStorage.setItem('erp_parked_carts', JSON.stringify(combined));
      }
    } catch (e) {
      console.warn('Could not fetch remote bill_holds, using local cache:', e);
    }
  }, []);

  useEffect(() => {
    fetchParkedInvoices();
  }, [fetchParkedInvoices]);

  // Hold current active bill
  const handleParkInvoice = (currentCartState: Omit<ParkedCart, 'id' | 'timestamp'> & { id?: string }) => {
    if (!currentCartState.items || !currentCartState.items.length) return null;

    const newId = currentCartState.id || `PARK-${Date.now().toString().slice(-4)}`;
    const timestamp = new Date().toISOString();

    const newPark: ParkedCart = {
      id: newId,
      timestamp,
      ...currentCartState
    };

    const updated = [newPark, ...parkedInvoices.filter(p => p.id !== newId)];
    setParkedInvoices(updated);
    localStorage.setItem('erp_parked_carts', JSON.stringify(updated));

    // Also persist to backend bill_holds table in background
    try {
      const payload = {
        id: newId,
        hold_name: currentCartState.holdName || `Hold #${newId.slice(-4)}`,
        customer_id: currentCartState.customer?.id || null,
        customer_name: currentCartState.customer?.name || currentCartState.guestName || 'Guest Customer',
        items: JSON.stringify(currentCartState.items),
        subtotal: currentCartState.subtotal || 0,
        discount: currentCartState.discount || 0,
        tax: currentCartState.tax || 0,
        total_amount: currentCartState.totalAmount || 0,
        transportation_fee: currentCartState.transportFee || 0,
        created_at: timestamp
      };
      supabase.from('bill_holds').insert([payload]).catch(() => {});
    } catch (_) {}

    return newPark;
  };

  // Restore parked bill to active POS cart
  const handleRestoreParkedInvoice = (id: string) => {
    const target = parkedInvoices.find(p => p.id === id);
    if (target) {
      const remaining = parkedInvoices.filter(p => p.id !== id);
      setParkedInvoices(remaining);
      localStorage.setItem('erp_parked_carts', JSON.stringify(remaining));

      // Remove from backend bill_holds
      try {
        supabase.from('bill_holds').delete().eq('id', id).catch(() => {});
      } catch (_) {}

      return target;
    }
    return null;
  };

  // Delete a parked invoice without restoring
  const handleDeleteParkedInvoice = (id: string) => {
    const remaining = parkedInvoices.filter(p => p.id !== id);
    setParkedInvoices(remaining);
    localStorage.setItem('erp_parked_carts', JSON.stringify(remaining));

    try {
      supabase.from('bill_holds').delete().eq('id', id).catch(() => {});
    } catch (_) {}
  };

  return {
    parkedInvoices,
    handleParkInvoice,
    handleRestoreParkedInvoice,
    handleDeleteParkedInvoice,
    fetchParkedInvoices
  };
}
