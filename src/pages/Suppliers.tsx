import React, { useState, useEffect, useRef, useMemo } from 'react';
import * as XLSX from 'xlsx';
import {
  SearchIcon,
  PlusIcon,
  TruckIcon,
  DollarSignIcon,
  EditIcon,
  EyeIcon,
  Trash2Icon,
  Loader2Icon,
  CalendarIcon,
  CheckCircleIcon,
  MessageCircleIcon
} from 'lucide-react';
import { Modal } from '../components/Modal';
import { supabase } from '../lib/supabaseClient';
import { useCurrency } from '../context/CurrencyContext';

interface Supplier {
  id: string;
  name: string;
  email: string;
  phone: string;
  address: string;
  creditTerms: string;
  payableBalance: number;
  createdAt: string;
  nic?: string;
}

const emptySupplier: Omit<Supplier, 'id' | 'createdAt'> = {
  name: '',
  email: '',
  phone: '',
  address: '',
  creditTerms: 'Net 30',
  payableBalance: 0,
  nic: ''
};

export function Suppliers() {
  const { currency, exchangeRate = 300 } = useCurrency();
  const symbol = 'Rs.';

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingSupplier, setEditingSupplier] = useState<Supplier | null>(null);
  const [viewSupplier, setViewSupplier] = useState<Supplier | null>(null);
  const [supplierToDelete, setSupplierToDelete] = useState<Supplier | null>(null);
  const [formData, setFormData] = useState<Omit<Supplier, 'id' | 'createdAt'>>(emptySupplier);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [selectedSupplierIds, setSelectedSupplierIds] = useState<string[]>([]);

  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(null), 4000);
      return () => clearTimeout(timer);
    }
  }, [toast]);

  const fetchData = async () => {
    setIsLoading(true);
    try {
      const { data } = await supabase
        .from('suppliers')
        .select('*');
      
      if (data) {
        const mapped = data.map((s: any) => ({
          id: s.id,
          name: s.name,
          email: s.email || '',
          phone: s.phone || '',
          address: s.address || '',
          creditTerms: s.creditTerms || s.credit_terms || 'Net 30',
          payableBalance: s.payableBalance !== undefined ? s.payableBalance : s.payable_balance || 0,
          nic: s.nic || '',
          createdAt: s.createdAt || s.created_at || ''
        }));
        setSuppliers(mapped);
      }
    } catch (error) {
      console.error("Error loading suppliers:", error);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    const handleRefresh = () => fetchData();
    window.addEventListener('refresh-all-data', handleRefresh);
    window.addEventListener('refresh-suppliers', handleRefresh);
    return () => {
      window.removeEventListener('refresh-all-data', handleRefresh);
      window.removeEventListener('refresh-suppliers', handleRefresh);
    };
  }, []);

  const convert = (val: number) => val;

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return suppliers;
    return suppliers.filter(
      (s) =>
        s.name.toLowerCase().includes(q) ||
        (s.nic && s.nic.toLowerCase().includes(q)) ||
        s.phone.includes(q)
    );
  }, [suppliers, search]);

  const activeSuppliersCount = suppliers.length;

  const openAdd = () => {
    setEditingSupplier(null);
    setFormData(emptySupplier);
    setShowAddModal(true);
  };

  const openEdit = (supplier: Supplier) => {
    setEditingSupplier(supplier);
    setFormData({
      name: supplier.name,
      email: supplier.email,
      phone: supplier.phone,
      address: supplier.address,
      creditTerms: supplier.creditTerms,
      payableBalance: supplier.payableBalance,
      nic: supplier.nic || ''
    });
    setShowAddModal(true);
  };



  const handleSave = async () => {
    if (!formData.name || formData.name.trim().length < 2) {
      setToast({ message: "Supplier name must be at least 2 characters.", type: 'error' });
      return;
    }

    try {
      const dbPayload = {
        name: formData.name,
        email: formData.email,
        phone: formData.phone,
        address: formData.address,
        credit_terms: formData.creditTerms,
        payable_balance: formData.payableBalance,
        nic: formData.nic
      };

      if (editingSupplier) {
        const { error } = await supabase.from('suppliers').update(dbPayload).eq('id', editingSupplier.id);
        if (error) throw error;
        setToast({ message: "Supplier updated successfully", type: 'success' });
      } else {
        const { error } = await supabase.from('suppliers').insert([dbPayload]);
        if (error) throw error;
        setToast({ message: "Supplier registered successfully", type: 'success' });
      }

      fetchData();
      window.dispatchEvent(new CustomEvent('suppliers-updated'));
      window.dispatchEvent(new CustomEvent('refresh-inventory'));
      window.dispatchEvent(new CustomEvent('refresh-dashboard'));
      setShowAddModal(false);
    } catch (error: any) {
      setToast({ message: "Error saving supplier: " + error.message, type: 'error' });
    }
  };



  const handleDelete = async (id: string) => {
    const { error } = await supabase.from('suppliers').delete().eq('id', id);
    if (error) {
      setToast({ message: error.message, type: 'error' });
    } else {
      setToast({ message: "Supplier permanently deleted", type: 'success' });
      setSelectedSupplierIds((prev) => prev.filter((sId) => sId !== id));
      fetchData();
    }
    setSupplierToDelete(null);
  };

  const handleImportExcel = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      setIsLoading(true);
      const buffer = await file.arrayBuffer();
      const wb = XLSX.read(buffer, { type: 'array', raw: false });
      if (!wb.SheetNames || wb.SheetNames.length === 0) {
        setToast({ message: "Invalid or corrupt file: No sheets found.", type: 'error' });
        setIsLoading(false);
        if (e.target) e.target.value = '';
        return;
      }

        const wsname = wb.SheetNames[0];
        const ws = wb.Sheets[wsname];
        const rawRows = XLSX.utils.sheet_to_json(ws, { defval: '', raw: false }) as any[];

        if (!rawRows || rawRows.length === 0) {
          setToast({ message: "The selected file contains no records.", type: 'error' });
          return;
        }

        setIsLoading(true);

        let imported = 0;
        let failed = 0;

        const cleanKey = (s: string) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

        const getValueByKeys = (rowObj: any, possibleKeys: string[]) => {
          if (!rowObj || typeof rowObj !== 'object') return '';
          const keys = Object.keys(rowObj);
          for (const pKey of possibleKeys) {
            const targetClean = cleanKey(pKey);
            const matchedKey = keys.find(k => cleanKey(k) === targetClean);
            if (matchedKey && rowObj[matchedKey] !== undefined && rowObj[matchedKey] !== null) {
              const val = String(rowObj[matchedKey]).trim();
              if (val !== '' && val !== 'null' && val !== 'undefined' && val !== '—' && val !== '-') {
                return val;
              }
            }
          }
          return '';
        };

        for (let idx = 0; idx < rawRows.length; idx++) {
          const row = rawRows[idx];

          let name = getValueByKeys(row, [
            'supplier name', 'supplier_name', 'supplier', 'company', 'name', 'vendor',
            'vendor_name', 'vendor name', 'suppliername'
          ]);
          if (!name) {
            name = `Supplier #${idx + 1}`;
          }

          let phone = getValueByKeys(row, [
            'phone', 'phone number', 'phone_number', 'contact', 'contact_no', 'mobile',
            'tel', 'telephone', 'supplierphone', 'phonenumber'
          ]);
          if (/^\d{9}$/.test(phone)) {
            phone = '0' + phone;
          }

          const email = getValueByKeys(row, ['email', 'email_address', 'mail', 'supplieremail', 'supplier_email']);
          const address = getValueByKeys(row, ['address', 'supplier_address', 'supplieraddress', 'location', 'city', 'street']);
          const nic = getValueByKeys(row, ['nic', 'brn', 'reg no', 'reg_no', 'registration', 'registration_no', 'nic_number', 'nicnumber', 'nationalid']);
          const creditTerms = getValueByKeys(row, ['credit terms', 'credit_terms', 'terms', 'payment terms', 'payment_terms']) || 'Net 30';
          
          const rawPayable = getValueByKeys(row, ['payable balance', 'payable_balance', 'balance', 'owed', 'amount_owed']);
          const payableBalance = parseFloat(rawPayable) || 0;

          const dbPayload = {
            name,
            email,
            phone,
            address,
            credit_terms: creditTerms,
            payable_balance: payableBalance,
            nic
          };

          const { error } = await supabase.from('suppliers').insert([dbPayload]);
          if (error) {
            const { error: updateError } = await supabase.from('suppliers').update(dbPayload).eq('name', name);
            if (updateError) {
              failed++;
            } else {
              imported++;
            }
          } else {
            imported++;
          }
        }

        setToast({ 
          message: `Successfully imported/updated ${imported} suppliers! (Failed: ${failed})`, 
          type: imported > 0 ? 'success' : 'error' 
        });

        await fetchData();
        window.dispatchEvent(new CustomEvent('suppliers-updated'));
        window.dispatchEvent(new CustomEvent('refresh-inventory'));
        window.dispatchEvent(new CustomEvent('refresh-dashboard'));
      } catch (err: any) {
        setToast({ message: "Excel import error: " + err.message, type: 'error' });
      } finally {
        setIsLoading(false);
        if (e.target) e.target.value = '';
      }
  };

  const allFilteredSelected = filtered.length > 0 && filtered.every((s) => selectedSupplierIds.includes(s.id));

  const handleToggleSelectAll = () => {
    if (allFilteredSelected) {
      setSelectedSupplierIds((prev) => prev.filter((id) => !filtered.some((s) => s.id === id)));
    } else {
      setSelectedSupplierIds((prev) => Array.from(new Set([...prev, ...filtered.map((s) => s.id)])));
    }
  };

  const handleToggleSelectSupplier = (supplierId: string) => {
    setSelectedSupplierIds((prev) =>
      prev.includes(supplierId)
        ? prev.filter((id) => id !== supplierId)
        : [...prev, supplierId]
    );
  };

  const handleBulkDelete = async () => {
    if (selectedSupplierIds.length === 0) return;
    (window as any).showConfirm(
      `Are you sure you want to delete the ${selectedSupplierIds.length} selected suppliers?`,
      async () => {
        setIsLoading(true);
        try {
          for (const supplierId of selectedSupplierIds) {
            await supabase.from('suppliers').delete().eq('id', supplierId);
          }
          setToast({ message: "Selected suppliers deleted successfully", type: 'success' });
          setSelectedSupplierIds([]);
          fetchData();
        } catch (err: any) {
          setToast({ message: "Failed to delete: " + err.message, type: 'error' });
        } finally {
          setIsLoading(false);
        }
      },
      "Delete Selected Suppliers"
    );
  };

  return (
    <div className="p-4 sm:p-6 space-y-6 animate-in fade-in duration-500 text-left">
      {/* Stats Cards */}
      <div className="grid grid-cols-1 gap-5">
        {/* Total Suppliers */}
        <div className="bg-[#464646] rounded-2xl shadow-xl p-5 border border-slate-700/10 hover:translate-y-[-2px] transition-all duration-300 relative overflow-hidden group">
          <div className="absolute top-0 right-0 w-32 h-32 bg-white/5 rounded-full -mr-16 -mt-16 blur-xl group-hover:scale-110 transition-transform duration-500"></div>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-[10px] font-black text-slate-300 uppercase tracking-widest">Total Suppliers</p>
              <p className="text-3xl font-black text-white mt-1.5">{activeSuppliersCount}</p>
            </div>
            <div className="w-12 h-12 bg-white/10 text-white rounded-xl flex items-center justify-center shadow-lg">
              <TruckIcon className="w-6 h-6" />
            </div>
          </div>
          <div className="mt-3 flex items-center gap-1.5 text-[11px] font-bold text-slate-300">
            <span className="w-1.5 h-1.5 rounded-full bg-[#DAA520] animate-ping"></span>
            <span>Registered stock suppliers</span>
          </div>
        </div>
      </div>

      {/* Control Actions Panel */}
      <div className="bg-white rounded-xl border border-slate-100 shadow-sm p-4 flex flex-col xl:flex-row gap-3">
        <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 flex-1 group focus-within:ring-2 focus-within:ring-[#DAA520]/20 transition-all">
          <SearchIcon className="w-4 h-4 text-slate-400 group-focus-within:text-[#DAA520]" />
          <input type="text" placeholder="Find suppliers by company name, NIC or phone..." value={search} onChange={(e) => setSearch(e.target.value)} className="bg-transparent text-sm text-slate-700 outline-none w-full" />
        </div>
        <input
          type="file"
          ref={fileInputRef}
          onChange={handleImportExcel}
          className="hidden"
          accept=".xlsx, .xls, .csv"
        />
        <button 
          onClick={() => fileInputRef.current?.click()} 
          className="flex items-center justify-center gap-2 bg-[#464646] hover:bg-[#363636] text-white px-6 py-2 rounded-xl text-sm font-black uppercase tracking-widest transition-all shadow-lg"
        >
          <PlusIcon className="w-4 h-4" /> Import Suppliers
        </button>
        <button onClick={openAdd} className="flex items-center justify-center gap-2 bg-[#DAA520] hover:bg-[#B8860B] text-white px-6 py-2 rounded-xl text-sm font-black uppercase tracking-widest transition-all shadow-lg shadow-[#DAA520]/20">
          <PlusIcon className="w-4 h-4" /> Add Supplier
        </button>
        {selectedSupplierIds.length > 0 && (
          <button onClick={handleBulkDelete} className="flex items-center justify-center gap-2 bg-red-600 hover:bg-red-700 text-white px-6 py-2 rounded-xl text-sm font-black uppercase tracking-widest transition-all shadow-lg shadow-red-600/20 shrink-0">
            <Trash2Icon className="w-4 h-4" /> Delete Selected
          </button>
        )}
      </div>

      {/* Table Section */}
      <div className="bg-white rounded-2xl border border-slate-100 shadow-lg overflow-hidden text-left">
        {/* Table Header with gradient */}
        <div className="bg-gradient-to-r from-slate-800 to-slate-900 px-6 py-4 flex items-center justify-between">
          <div>
            <h3 className="text-sm font-black text-white">Suppliers Registry</h3>
            <p className="text-[10px] text-slate-400 font-semibold mt-0.5">Manage partner suppliers, contact files, credit terms, and payable balances</p>
          </div>
          <span className="px-3 py-1.5 bg-[#DAA520]/20 text-[#DAA520] text-xs font-black rounded-full border border-[#DAA520]/30">
            {filtered.length} Suppliers
          </span>
        </div>
        <div className="overflow-x-auto">
          {isLoading ? (
            <div className="p-20 text-center text-slate-500">
              <Loader2Icon className="animate-spin w-8 h-8 text-[#DAA520] mx-auto mb-4" />
              <p className="font-bold">Syncing Suppliers Directory...</p>
            </div>
          ) : (
            <table className="w-full text-sm text-left">
              <thead className="bg-slate-50 border-b border-slate-100 text-[10px] font-black text-slate-400 uppercase tracking-widest">
                <tr>
                  <th className="px-6 py-4 text-center w-[50px]">
                    <input
                      type="checkbox"
                      checked={allFilteredSelected}
                      onChange={handleToggleSelectAll}
                      className="rounded border-gray-300 text-[#DAA520] focus:ring-[#DAA520] cursor-pointer w-4 h-4"
                    />
                  </th>
                  <th className="px-6 py-4">Supplier</th>
                  <th className="px-6 py-4">Phone</th>
                  <th className="px-6 py-4">NIC</th>
                  <th className="px-6 py-4 text-center">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {filtered.map((supplier) => (
                  <tr key={supplier.id} className="hover:bg-amber-50/30 transition-colors group">
                    <td className="px-6 py-4 text-center">
                      <input
                        type="checkbox"
                        checked={selectedSupplierIds.includes(supplier.id)}
                        onChange={() => handleToggleSelectSupplier(supplier.id)}
                        className="rounded border-gray-300 text-[#DAA520] focus:ring-[#DAA520] cursor-pointer w-4 h-4"
                      />
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-gradient-to-br from-[#DAA520] to-[#8B6914] text-white rounded-xl flex items-center justify-center font-black text-sm uppercase shadow-md shadow-amber-100">
                          {supplier.name.charAt(0)}
                        </div>
                        <div>
                          <p className="font-black text-slate-900">{supplier.name}</p>
                          <p className="text-[10px] text-gray-400 font-semibold">{supplier.address}</p>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4 text-slate-600 font-medium">{supplier.phone || '—'}</td>
                    <td className="px-6 py-4 text-slate-600 font-medium">{supplier.nic || '—'}</td>
                    <td className="px-6 py-4 text-center">
                      <div className="flex items-center justify-center gap-2">
                        <button onClick={() => setViewSupplier(supplier)} className="p-2.5 rounded-xl bg-slate-50 text-slate-600 hover:bg-slate-200 border border-slate-100 transition-all shadow-sm" title="View Profile"><EyeIcon className="w-4 h-4" /></button>
                        <button onClick={() => openEdit(supplier)} className="p-2.5 rounded-xl bg-blue-50 text-blue-600 hover:bg-blue-200 border border-blue-100 transition-all shadow-sm" title="Edit Profile"><EditIcon className="w-4 h-4" /></button>
                        <button onClick={() => setSupplierToDelete(supplier)} className="p-2.5 rounded-xl bg-red-50 text-red-600 hover:bg-red-500 hover:text-white border border-red-100 transition-all shadow-sm shadow-red-500/10" title="Delete Profile"><Trash2Icon className="w-4 h-4" /></button>
                      </div>
                    </td>
                  </tr>
                ))}
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={5} className="text-center py-12 text-slate-400 font-bold">
                      No suppliers registered in this directory.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Add/Edit Modal */}
      <Modal isOpen={showAddModal} onClose={() => setShowAddModal(false)} title={editingSupplier ? 'Update Supplier Profile' : 'Register New Supplier'} size="lg">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-5 p-1 text-left">
          <div className="sm:col-span-2">
            <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Company / Supplier Name *</label>
            <input type="text" value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })} className="w-full px-4 py-2.5 border border-slate-200 rounded-xl text-sm focus:ring-2 focus:ring-[#DAA520] outline-none transition-all" required />
          </div>
          <div>
            <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Phone Number</label>
            <input type="text" value={formData.phone} onChange={(e) => setFormData({ ...formData, phone: e.target.value })} className="w-full px-4 py-2.5 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-[#DAA520] transition-all" />
          </div>
          <div>
            <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">NIC</label>
            <input type="text" value={formData.nic || ''} onChange={(e) => setFormData({ ...formData, nic: e.target.value })} className="w-full px-4 py-2.5 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-[#DAA520] transition-all" />
          </div>
          <div className="sm:col-span-2">
            <label className="block text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">Physical Address</label>
            <input type="text" value={formData.address} onChange={(e) => setFormData({ ...formData, address: e.target.value })} className="w-full px-4 py-2.5 border border-slate-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-[#DAA520] transition-all" />
          </div>
        </div>
        <div className="flex justify-end gap-3 mt-8 pt-4 border-t border-slate-100">
          <button onClick={() => setShowAddModal(false)} className="px-6 py-2.5 text-sm font-bold text-slate-400 hover:text-slate-600 transition-colors uppercase tracking-widest">Cancel</button>
          <button onClick={handleSave} className="px-8 py-2.5 text-sm bg-[#DAA520] hover:bg-[#B8860B] text-white rounded-xl font-black shadow-lg shadow-amber-100 transition-all uppercase tracking-widest">
            {editingSupplier ? 'Save Changes' : 'Register Supplier'}
          </button>
        </div>
      </Modal>



      {/* View Details Modal */}
      <Modal isOpen={!!viewSupplier} onClose={() => setViewSupplier(null)} title="Supplier Insights" size="md">
        {viewSupplier && (
          <div className="space-y-6 text-left p-1">
            <div className="flex items-center gap-4 bg-slate-50 p-5 rounded-2xl border border-slate-100 shadow-inner">
              <div className="w-14 h-14 bg-[#DAA520] text-white rounded-xl flex items-center justify-center font-black text-xl uppercase shadow-md shadow-amber-200">
                {viewSupplier.name.charAt(0)}
              </div>
              <div>
                <h3 className="text-lg font-black text-slate-900">{viewSupplier.name}</h3>
                <p className="text-xs font-bold text-[#DAA520] uppercase mt-1">Supplier Profile</p>
              </div>
            </div>
            
            <div className="grid grid-cols-2 gap-4 text-xs">
              <div className="space-y-1">
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Phone Number</p>
                <p className="font-bold text-slate-700">{viewSupplier.phone || '—'}</p>
              </div>
              <div className="space-y-1 text-right">
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">NIC</p>
                <p className="font-bold text-slate-700">{viewSupplier.nic || '—'}</p>
              </div>
              <div className="col-span-2 space-y-1">
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Physical Address</p>
                <p className="font-bold text-slate-700">{viewSupplier.address || '—'}</p>
              </div>
            </div>
            <button onClick={() => setViewSupplier(null)} className="w-full py-3 bg-gray-100 text-gray-500 rounded-xl font-black uppercase tracking-widest text-xs hover:bg-gray-200 transition-all">Close</button>
          </div>
        )}
      </Modal>

      {/* Delete Confirmation Modal */}
      <Modal isOpen={!!supplierToDelete} onClose={() => setSupplierToDelete(null)} title="Delete Supplier" size="sm">
        {supplierToDelete && (
          <div className="text-center p-2 space-y-4">
            <div className="w-15 h-15 bg-red-50 text-red-500 rounded-xl flex items-center justify-center mx-auto border border-red-100 shadow-inner">
              <Trash2Icon className="w-6 h-6" />
            </div>
            <div>
              <h4 className="font-black text-slate-800 text-sm">Delete Supplier Profile?</h4>
              <p className="text-xs text-gray-500 font-bold mt-1.5 leading-relaxed">
                Are you sure you want to permanently delete <span className="text-[#DAA520]">{supplierToDelete.name}</span>? This action is permanent and cannot be undone.
              </p>
            </div>
            <div className="flex gap-3 pt-2">
              <button onClick={() => setSupplierToDelete(null)} className="flex-1 py-3 bg-gray-100 hover:bg-gray-200 text-gray-500 rounded-xl font-black uppercase tracking-widest text-xs transition-all border border-gray-200">Cancel</button>
              <button onClick={() => handleDelete(supplierToDelete.id)} className="flex-1 py-3 bg-red-500 hover:bg-red-600 text-white rounded-xl font-black uppercase tracking-widest text-xs transition-all shadow-lg shadow-red-500/20">Delete</button>
            </div>
          </div>
        )}
      </Modal>

      {/* Toast Notification */}
      {toast && (
        <div className="fixed top-6 right-6 z-50 animate-in fade-in slide-in-from-top-4 duration-300">
          <div className={`flex items-center gap-3 px-6 py-4 rounded-2xl shadow-2xl border backdrop-blur-md ${
            toast.type === 'success' 
              ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-600' 
              : 'bg-red-500/10 border-red-500/20 text-red-600'
          }`}>
            <div className={`w-8 h-8 rounded-xl flex items-center justify-center shadow-lg ${
              toast.type === 'success' ? 'bg-emerald-500 text-white shadow-emerald-500/30' : 'bg-red-500 text-white shadow-red-500/30'
            }`}>
              <CheckCircleIcon className="w-4 h-4" />
            </div>
            <div>
              <p className="text-xs font-black uppercase tracking-wider opacity-60">System Notification</p>
              <p className="text-sm font-bold text-slate-800 mt-0.5">{toast.message}</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
