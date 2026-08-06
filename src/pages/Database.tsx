import React, { useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import {
  DatabaseIcon,
  Loader2Icon,
  PackageIcon,
  ShoppingCartIcon,
  TruckIcon,
  UsersIcon,
  ShieldIcon,
  SearchIcon
} from 'lucide-react';

type DbTab = 'products' | 'customers' | 'profiles' | 'purchase_orders' | 'sales' | 'system_settings';

export function Database() {
  const [dbTab, setDbTab] = useState<DbTab>('products');
  const [dbData, setDbData] = useState<any[]>([]);
  const [dbSearch, setDbSearch] = useState('');
  const [dbLoading, setDbLoading] = useState(false);

  const fetchDbTable = async () => {
    setDbLoading(true);
    try {
      const { data } = await supabase.from(dbTab).select('*');
      if (dbTab === 'system_settings') {
        setDbData(data ? (Array.isArray(data) ? data : [data]) : []);
      } else {
        setDbData(data || []);
      }
    } catch (e) {
      console.error('Failed to fetch database table for Database page:', e);
      setDbData([]);
    } finally {
      setDbLoading(false);
    }
  };

  useEffect(() => {
    fetchDbTable();
  }, [dbTab]);

  return (
    <div className="p-4 sm:p-6 animate-in fade-in duration-500">
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        <div className="lg:col-span-1 space-y-2">
          <h3 className="text-[10px] text-gray-400 font-black uppercase tracking-widest px-3 mb-3">System Tables</h3>
          {[
            { id: 'products', label: 'products', icon: <PackageIcon className="w-4 h-4" /> },
            { id: 'customers', label: 'customers', icon: <UsersIcon className="w-4 h-4" /> },
            { id: 'profiles', label: 'profiles', icon: <ShieldIcon className="w-4 h-4" /> },
            { id: 'purchase_orders', label: 'purchase_orders', icon: <TruckIcon className="w-4 h-4" /> },
            { id: 'sales', label: 'sales', icon: <ShoppingCartIcon className="w-4 h-4" /> },
            { id: 'system_settings', label: 'system_settings', icon: <DatabaseIcon className="w-4 h-4" /> }
          ].map(item => (
            <button
              key={item.id}
              onClick={() => {
                setDbTab(item.id as DbTab);
                setDbSearch('');
              }}
              className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl text-xs font-mono font-bold transition-all text-left ${
                dbTab === item.id
                  ? 'bg-[#DAA520] text-white shadow-lg shadow-[#DAA520]/20'
                  : 'bg-white hover:bg-gray-50 text-[#464646] border border-gray-100'
              }`}
            >
              {item.icon}
              {item.label}
            </button>
          ))}
        </div>

        <div className="lg:col-span-3 bg-white rounded-2xl border border-slate-100 shadow-lg overflow-hidden text-left flex flex-col">
          <div className="bg-gradient-to-r from-slate-800 to-slate-900 px-6 py-4 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3">
            <div>
              <h3 className="font-mono font-black text-white text-lg flex items-center gap-2">
                <DatabaseIcon className="w-5 h-5 text-indigo-400 animate-pulse" />
                <span className="capitalize">{dbTab}</span>
              </h3>
              <p className="text-[10px] text-slate-400 font-semibold mt-0.5">
                Live SQLite Database Table Viewer & Search Explorer
              </p>
            </div>

            <div className="flex items-center gap-3 w-full sm:w-auto">
              <span className="px-3 py-1.5 bg-slate-700/50 text-slate-300 text-xs font-black rounded-full border border-slate-600/30 whitespace-nowrap">
                {dbData.length} Records
              </span>
              <div className="relative w-full sm:w-64">
                <input
                  type="text"
                  value={dbSearch}
                  onChange={e => setDbSearch(e.target.value)}
                  placeholder="Search table columns..."
                  className="w-full pl-4 pr-10 py-2 bg-slate-800 border border-slate-700 rounded-xl text-xs font-bold text-white placeholder-slate-500 outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
                />
                <SearchIcon className="absolute right-3.5 top-2.5 w-4 h-4 text-slate-500" />
              </div>
            </div>
          </div>

          <div className="p-6 flex-1 flex flex-col">
            {dbLoading ? (
              <div className="flex flex-col items-center justify-center py-20 flex-1">
                <Loader2Icon className="w-8 h-8 text-indigo-500 animate-spin" />
                <p className="text-xs font-black uppercase tracking-widest text-indigo-500 mt-3 animate-pulse">Loading live records...</p>
              </div>
            ) : (
              <div className="overflow-x-auto border border-slate-100 rounded-xl">
                <table className="w-full text-xs text-left">
                  <thead className="bg-slate-50 text-[10px] font-black uppercase text-slate-400 tracking-widest border-b border-slate-100">
                  {dbTab === 'products' && (
                    <tr>
                      <th className="px-5 py-4">id</th>
                      <th className="px-5 py-4">sku</th>
                      <th className="px-5 py-4">name</th>
                      <th className="px-5 py-4">category</th>
                      <th className="px-5 py-4 text-right">price</th>
                      <th className="px-5 py-4 text-right">cost_price</th>
                      <th className="px-5 py-4 text-center">stock</th>
                      <th className="px-5 py-4 text-center">min_stock</th>
                      <th className="px-5 py-4">supplier</th>
                      <th className="px-5 py-4 text-center">unit</th>
                      <th className="px-5 py-4">barcode</th>
                    </tr>
                  )}
                  {dbTab === 'customers' && (
                    <tr>
                      <th className="px-5 py-4">id</th>
                      <th className="px-5 py-4">name</th>
                      <th className="px-5 py-4">phone</th>
                      <th className="px-5 py-4">address</th>
                      <th className="px-5 py-4">nic</th>
                      <th className="px-5 py-4 text-center">loyalty_points</th>
                      <th className="px-5 py-4 text-right">total_purchases</th>
                      <th className="px-5 py-4 text-center">join_date</th>
                    </tr>
                  )}
                  {dbTab === 'profiles' && (
                    <tr>
                      <th className="px-5 py-4">id</th>
                      <th className="px-5 py-4">name</th>
                      <th className="px-5 py-4">email</th>
                      <th className="px-5 py-4">role</th>
                      <th className="px-5 py-4 text-center">avatar</th>
                      <th className="px-5 py-4">password</th>
                    </tr>
                  )}
                  {dbTab === 'purchase_orders' && (
                    <tr>
                      <th className="px-5 py-4">id</th>
                      <th className="px-5 py-4">po_number</th>
                      <th className="px-5 py-4">supplier_id</th>
                      <th className="px-5 py-4">supplier_name</th>
                      <th className="px-5 py-4 text-right">total</th>
                      <th className="px-5 py-4 text-center">status</th>
                      <th className="px-5 py-4 text-center">date</th>
                      <th className="px-5 py-4 text-center">due_date</th>
                    </tr>
                  )}
                  {dbTab === 'sales' && (
                    <tr>
                      <th className="px-5 py-4">id</th>
                      <th className="px-5 py-4">invoice_no</th>
                      <th className="px-5 py-4">customer_id</th>
                      <th className="px-5 py-4">customer_name</th>
                      <th className="px-5 py-4 text-right">subtotal</th>
                      <th className="px-5 py-4 text-right">discount</th>
                      <th className="px-5 py-4 text-right">tax</th>
                      <th className="px-5 py-4 text-center">tax_rate</th>
                      <th className="px-5 py-4 text-right">total_amount</th>
                      <th className="px-5 py-4 text-center">status</th>
                      <th className="px-5 py-4 text-center">created_at</th>
                    </tr>
                  )}
                  {dbTab === 'system_settings' && (
                    <tr>
                      <th className="px-5 py-4">id</th>
                      <th className="px-5 py-4">shop_name</th>
                      <th className="px-5 py-4">address</th>
                      <th className="px-5 py-4">phone</th>
                      <th className="px-5 py-4">email</th>
                      <th className="px-5 py-4">currency</th>
                      <th className="px-5 py-4 text-center">tax_rate</th>
                      <th className="px-5 py-4">backup_email</th>
                      <th className="px-5 py-4 text-center">backup_enabled</th>
                      <th className="px-5 py-4">next_invoice_number</th>
                      <th className="px-5 py-4">return_passkey</th>
                    </tr>
                  )}
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {dbData
                    .filter((row: any) => {
                      const searchStr = dbSearch.toLowerCase();
                      return Object.values(row).some((val) => String(val || '').toLowerCase().includes(searchStr));
                    })
                    .map((row: any, idx: number) => (
                      <tr key={row.id || idx} className="hover:bg-indigo-50/20 transition-colors group font-medium text-slate-700">
                        {dbTab === 'products' && (
                          <>
                            <td className="px-5 py-3 font-mono font-bold text-gray-400">{row.id}</td>
                            <td className="px-5 py-3 font-bold text-[#DAA520]">{row.sku}</td>
                            <td className="px-5 py-3 font-black text-slate-800">{row.name}</td>
                            <td className="px-5 py-3 font-bold text-gray-500">{row.category}</td>
                            <td className="px-5 py-3 text-right font-black text-slate-800">Rs. {Number(row.price || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                            <td className="px-5 py-3 text-right font-bold text-gray-400">Rs. {Number(row.cost_price || row.costPrice || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                            <td className="px-5 py-3 text-center font-black text-emerald-600 bg-emerald-50/20">{row.stock}</td>
                            <td className="px-5 py-3 text-center font-bold text-red-600 bg-red-50/20">{row.min_stock || row.minStock || 0}</td>
                            <td className="px-5 py-3 text-gray-600">{row.supplier}</td>
                            <td className="px-5 py-3 text-center font-bold text-slate-500">{row.unit}</td>
                            <td className="px-5 py-3 font-mono font-semibold text-gray-500">{row.barcode || '—'}</td>
                          </>
                        )}
                        {dbTab === 'customers' && (
                          <>
                            <td className="px-5 py-3 font-mono font-bold text-gray-400">{row.id}</td>
                            <td className="px-5 py-3 font-black text-slate-800">{row.name}</td>
                            <td className="px-5 py-3 font-bold text-slate-600">{row.phone}</td>
                            <td className="px-5 py-3 font-semibold text-gray-500">{row.address}</td>
                            <td className="px-5 py-3 font-mono font-semibold text-gray-500">{row.nic || '—'}</td>
                            <td className="px-5 py-3 text-center font-black text-[#DAA520] bg-amber-50/20">{row.loyalty_points || row.loyaltyPoints || 0}</td>
                            <td className="px-5 py-3 text-right font-black text-slate-800">Rs. {Number(row.total_purchases || row.totalPurchases || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                            <td className="px-5 py-3 text-center text-gray-500 font-bold">{row.join_date || row.joinDate}</td>
                          </>
                        )}
                        {dbTab === 'profiles' && (
                          <>
                            <td className="px-5 py-3 font-mono font-bold text-gray-400">{row.id}</td>
                            <td className="px-5 py-3 font-black text-slate-800">{row.name}</td>
                            <td className="px-5 py-3 font-semibold text-gray-500">{row.email}</td>
                            <td className="px-5 py-3 font-bold text-[#DAA520]">{row.role}</td>
                            <td className="px-5 py-3 text-center">
                              <div className="w-7 h-7 bg-[#DAA520]/10 text-[#DAA520] rounded-md flex items-center justify-center font-black mx-auto">{row.avatar}</div>
                            </td>
                            <td className="px-5 py-3 font-mono font-bold text-gray-400 select-all">{row.password || '••••••••'}</td>
                          </>
                        )}
                        {dbTab === 'purchase_orders' && (
                          <>
                            <td className="px-5 py-3 font-mono font-bold text-gray-400">{row.id}</td>
                            <td className="px-5 py-3 font-black text-slate-800">{row.po_number || row.poNumber}</td>
                            <td className="px-5 py-3 font-mono font-bold text-gray-400">{row.supplier_id || row.supplierId}</td>
                            <td className="px-5 py-3 font-bold text-slate-700">{row.supplier_name || row.supplierName}</td>
                            <td className="px-5 py-3 text-right font-black text-slate-800">Rs. {Number(row.total || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                            <td className="px-5 py-3 text-center">
                              <span className={`px-2 py-0.5 rounded-md text-[9px] font-black uppercase tracking-wider ${row.status === 'received' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>{row.status}</span>
                            </td>
                            <td className="px-5 py-3 text-center text-gray-500 font-bold">{row.date}</td>
                            <td className="px-5 py-3 text-center text-gray-500 font-bold">{row.due_date || row.dueDate}</td>
                          </>
                        )}
                        {dbTab === 'sales' && (
                          <>
                            <td className="px-5 py-3 font-mono font-bold text-gray-400">{row.id}</td>
                            <td className="px-5 py-3 font-black text-slate-800">{row.invoice_no || row.invoiceNo}</td>
                            <td className="px-5 py-3 font-mono font-bold text-gray-400">{row.customer_id || 'guest'}</td>
                            <td className="px-5 py-3 font-bold text-slate-700">{row.customer_name || row.customerName || 'Guest Customer'}</td>
                            <td className="px-5 py-3 text-right font-semibold text-gray-500">Rs. {Number(row.subtotal || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                            <td className="px-5 py-3 text-right text-gray-400">Rs. {Number(row.discount || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                            <td className="px-5 py-3 text-right text-gray-400">Rs. {Number(row.tax || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                            <td className="px-5 py-3 text-center font-bold text-slate-500">{row.tax_rate || row.taxRate || 0}%</td>
                            <td className="px-5 py-3 text-right font-black text-slate-800">Rs. {Number(row.total_amount || row.total || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}</td>
                            <td className="px-5 py-3 text-center">
                              <span className={`px-2 py-0.5 rounded-md text-[9px] font-black uppercase tracking-wider ${row.status === 'paid' || row.status === 'Paid' ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>{row.status}</span>
                            </td>
                            <td className="px-5 py-3 text-center text-gray-500 font-bold">{(row.created_at || '').split('T')[0] || row.date}</td>
                          </>
                        )}
                        {dbTab === 'system_settings' && (
                          <>
                            <td className="px-5 py-3 font-mono font-bold text-gray-400">{row.id}</td>
                            <td className="px-5 py-3 font-black text-slate-800">{row.shop_name || row.shopName}</td>
                            <td className="px-5 py-3 font-bold text-gray-600">{row.address}</td>
                            <td className="px-5 py-3 text-gray-600">{row.phone}</td>
                            <td className="px-5 py-3 text-gray-500">{row.email}</td>
                            <td className="px-5 py-3 font-bold text-[#DAA520]">{row.currency}</td>
                            <td className="px-5 py-3 text-center font-bold text-slate-500">{row.tax_rate || row.taxRate}%</td>
                            <td className="px-5 py-3 text-gray-600">{row.backup_email || row.backupEmail}</td>
                            <td className="px-5 py-3 text-center">
                              <span className={`px-2 py-0.5 rounded-md text-[9px] font-black uppercase tracking-wider ${row.backup_enabled === 1 || row.backup_enabled === true ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500'}`}>{row.backup_enabled === 1 || row.backup_enabled === true ? 'Enabled' : 'Disabled'}</span>
                            </td>
                            <td className="px-5 py-3 font-bold text-slate-600">{row.next_invoice_number || row.nextInvoiceNumber}</td>
                            <td className="px-5 py-3 font-mono font-bold text-emerald-600 select-all cursor-pointer">{row.return_passkey || row.returnPasskey}</td>
                          </>
                        )}
                      </tr>
                    ))}
                  {dbData.length === 0 && (
                    <tr>
                      <td colSpan={11} className="p-12 text-center text-gray-400 font-bold text-sm">
                        No database records found in this table.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
          </div>
        </div>
      </div>
    </div>
  );
}
