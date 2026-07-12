import React, { useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import {
  PlusIcon,
  ShieldIcon,
  CheckIcon,
  XIcon,
  Trash2Icon,
  Edit2Icon,
  LockIcon
} from 'lucide-react';
import { getPermissions, savePermissions } from '../utils/permissions';
import { API_URL } from '../lib/api';

const FEATURES_LIST = [
  { feature: 'Dashboard', key: 'dashboard' },
  { feature: 'Inventory', key: 'inventory' },
  { feature: 'Sales & Billing', key: 'sales' },
  { feature: 'Purchasing', key: 'purchasing' },
  { feature: 'Customers', key: 'customers' },
  { feature: 'Suppliers', key: 'suppliers' },
  { feature: 'Reports', key: 'reports' },
  { feature: 'Finance (Accounting)', key: 'finance' },
  { feature: 'User Management', key: 'users' },
  { feature: 'System Settings', key: 'settings' },
  { feature: 'Security Audit Logs', key: 'audit_logs' }
];

export function Users() {
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddUser, setShowAddUser] = useState(false);
  const [showEditUser, setShowEditUser] = useState(false);
  const [deleteTargetUser, setDeleteTargetUser] = useState<any>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    role: 'cashier',
    password: ''
  });
  const [editingUser, setEditingUser] = useState<any>(null);
  const [showResetPasswordModal, setShowResetPasswordModal] = useState(false);
  const [resetPasswordUser, setResetPasswordUser] = useState<any>(null);
  const [newPassword, setNewPassword] = useState('');
  const [matrix, setMatrix] = useState<any[]>([]);

  const handleTogglePermission = (idx: number, role: 'admin' | 'manager' | 'cashier') => {
    const updated = [...matrix];
    updated[idx][role] = !updated[idx][role];
    setMatrix(updated);

    const perms = getPermissions();
    const allowedForRole = updated.filter(row => row[role]).map(row => row.key) as any[];
    
    perms[role] = allowedForRole;
    if (role === 'cashier') {
      perms.retail_user = allowedForRole;
    }
    
    savePermissions(perms);
  };

  const fetchInitialData = async () => {
    setLoading(true);
    const { data: userData } = await supabase.from('profiles').select('*').order('created_at', { ascending: false });
    if (userData) setUsers(userData);
    setLoading(false);

    // Initialize matrix from custom permissions loaded from DB
    let perms = getPermissions();
    try {
      const res = await fetch(`${API_URL}/permissions`);
      if (res.ok) {
        const dbPerms = await res.json();
        if (dbPerms && Object.keys(dbPerms).length > 0) {
          perms = dbPerms;
          localStorage.setItem('custom_permissions', JSON.stringify(dbPerms));
          window.dispatchEvent(new Event('permissions-updated'));
        }
      }
    } catch (e) {
      console.error("Failed to load custom permissions from DB:", e);
    }

    const rows = FEATURES_LIST.map(f => ({
      feature: f.feature,
      key: f.key,
      admin: perms.admin?.includes(f.key as any) || false,
      manager: perms.manager?.includes(f.key as any) || false,
      cashier: perms.cashier?.includes(f.key as any) || false
    }));
    setMatrix(rows);
  };

  useEffect(() => {
    fetchInitialData();
  }, []);

  const handleAddUser = async (e: React.FormEvent) => {
    e.preventDefault();

    // Validations
    if (!formData.name || formData.name.trim().length < 2) {
      alert("Name must be at least 2 characters.");
      return;
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(formData.email.trim())) {
      alert("Please enter a valid email address.");
      return;
    }

    if (formData.password.length < 6) {
      alert("Password must be at least 6 characters for security.");
      return;
    }

    setIsSaving(true);
    const { data, error } = await supabase.auth.signUp({
      email: formData.email.trim(),
      password: formData.password,
      options: {
        data: {
          full_name: formData.name.trim(),
          role: formData.role
        }
      }
    });

    setIsSaving(false);
    if (!error) {
      alert(`Account created successfully for ${formData.name}!`);
      setShowAddUser(false);
      setFormData({ name: '', email: '', role: 'cashier', password: '' });
      fetchInitialData();
    } else {
      alert('Failed to create user account: ' + (error.message || error));
    }
  };

  const handleUpdateUser = async (e: React.FormEvent) => {
    e.preventDefault();

    // Validations
    if (!editingUser.name || editingUser.name.trim().length < 2) {
      alert("Name must be at least 2 characters.");
      return;
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(editingUser.email.trim())) {
      alert("Please enter a valid email address.");
      return;
    }

    const { error } = await supabase.from('profiles').update({
      name: editingUser.name.trim(),
      email: editingUser.email.trim(),
      role: editingUser.role
    }).eq('id', editingUser.id);

    if (!error) {
      setUsers(users.map(u => u.id === editingUser.id ? editingUser : u));
      setShowEditUser(false);
    }
  };

  const handleDeleteUser = async (id: string) => {
    const user = users.find(u => u.id === id);
    if (user && user.role === 'super_admin') {
      alert("Super Admin user cannot be deleted.");
      return;
    }
    const { error } = await supabase.from('profiles').delete().eq('id', id);
    if (!error) {
      setUsers(users.filter(u => u.id !== id));
      setDeleteTargetUser(null);
    } else {
      alert('Failed to delete user: ' + (error.message || error));
    }
  };

  const handleResetPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword.length < 6) {
      alert("Password must be at least 6 characters.");
      return;
    }
    const res = await fetch(`${API_URL}/profiles/${resetPasswordUser.id}/password`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: newPassword })
    });
    if (res.ok) {
      alert(`Password reset successfully for ${resetPasswordUser.name}!`);
      setShowResetPasswordModal(false);
      setNewPassword('');
    } else {
      alert("Failed to reset password.");
    }
  };

  return (
    <div className="p-4 sm:p-6 space-y-6 animate-in fade-in duration-500 text-left">
      <div className="space-y-6 animate-in slide-in-from-bottom-4">
        {/* User Accounts Card */}
        <div className="bg-white rounded-2xl border border-slate-100 shadow-lg overflow-hidden">
          {/* Table Header with gradient */}
          <div className="bg-gradient-to-r from-slate-800 to-slate-900 px-6 py-4 flex items-center justify-between">
            <div>
              <h3 className="text-sm font-black text-white">System Users & Roles</h3>
              <p className="text-[10px] text-slate-400 font-semibold mt-0.5">Staff accounts are created directly by the Super Admin here. Public signup is disabled for security.</p>
            </div>
            <div className="flex items-center gap-3">
              <span className="px-3 py-1.5 bg-purple-500/20 text-purple-400 text-xs font-black rounded-full border border-purple-500/30">
                {users.length} Users
              </span>
              <button
                type="button"
                onClick={() => {
                  setFormData({ name: '', email: '', role: 'cashier', password: '' });
                  setShowAddUser(true);
                }}
                className="flex items-center gap-2 bg-[#DAA520] hover:bg-[#B8860B] text-white px-4 py-2 rounded-xl text-xs font-black uppercase tracking-wider transition-all shadow-md shadow-[#DAA520]/20"
              >
                <PlusIcon className="w-4.5 h-4.5" /> Add Staff
              </button>
            </div>
          </div>

          <div className="px-6 py-5 border-b border-red-100 bg-red-50/80 text-sm">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div className="flex items-start gap-3">
                <div className="w-11 h-11 rounded-3xl bg-red-500/10 text-red-600 flex items-center justify-center shadow-sm shadow-red-500/10">
                  <Trash2Icon className="w-5 h-5" />
                </div>
                <div>
                  <p className="text-xs font-black uppercase tracking-[0.25em] text-red-600">Delete Card</p>
                  <h3 className="text-lg font-black text-slate-900">Remove user profiles safely</h3>
                  <p className="text-sm text-slate-500 mt-1">Use the Delete action on the right side of each row to permanently remove staff accounts. This card helps you manage the danger zone with confidence.</p>
                </div>
              </div>
              <div className="flex gap-3">
                <button className="inline-flex items-center gap-2 rounded-2xl bg-white border border-red-200 text-red-600 px-4 py-2 text-xs font-black uppercase tracking-[0.18em] shadow-sm hover:bg-red-50 transition-all">
                  <Trash2Icon className="w-4 h-4" /> Delete Tip
                </button>
                <button className="inline-flex items-center gap-2 rounded-2xl bg-red-600 text-white px-4 py-2 text-xs font-black uppercase tracking-[0.18em] shadow-lg shadow-red-500/20 hover:bg-red-700 transition-all">
                  <ShieldIcon className="w-4 h-4" /> Secure Delete
                </button>
              </div>
            </div>
          </div>

          {loading ? (
            <div className="p-16 text-center text-slate-400 font-bold">Loading user accounts...</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead className="bg-slate-50 border-b border-slate-100 text-[10px] font-black uppercase text-slate-400 tracking-widest">
                  <tr>
                    <th className="px-6 py-4">User</th>
                    <th className="px-6 py-4">Email</th>
                    <th className="px-6 py-4 text-center">Role</th>
                    <th className="px-6 py-4 text-center">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {users.map(u => (
                    <tr key={u.id} className="hover:bg-purple-50/20 transition-colors group">
                      <td className="px-6 py-4 flex items-center gap-3 font-bold text-slate-800">
                        <div className="w-10 h-10 bg-gradient-to-br from-purple-500 to-indigo-600 text-white rounded-xl flex items-center justify-center font-black text-sm shadow-md shadow-purple-100">{u.avatar}</div>
                        {u.name}
                      </td>
                      <td className="px-6 py-4 text-slate-500 font-medium">{u.email}</td>
                      <td className="px-6 py-4 text-center"><span className="px-3 py-1 rounded-full text-[10px] font-black bg-slate-100 text-slate-600 uppercase tracking-wider">{u.role}</span></td>
                      <td className="px-6 py-4 text-center">
                        <div className="flex items-center justify-center gap-2">
                          <button onClick={() => { setEditingUser(u); setShowEditUser(true); }} className="p-2.5 rounded-xl bg-blue-50 text-blue-600 hover:bg-blue-200 border border-blue-100 transition-all shadow-sm" title="Edit Details"><Edit2Icon className="w-4 h-4" /></button>
                          <button onClick={() => { setResetPasswordUser(u); setNewPassword(''); setShowResetPasswordModal(true); }} className="p-2.5 rounded-xl bg-slate-50 text-slate-600 hover:bg-slate-200 border border-slate-100 transition-all shadow-sm" title="Reset Password"><LockIcon className="w-4 h-4" /></button>
                          {u.role === 'super_admin' ? (
                            <span className="inline-flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl bg-gray-50 text-gray-400 border border-gray-100 cursor-not-allowed select-none">
                              <Trash2Icon className="w-3.5 h-3.5 opacity-50" />
                              <span className="text-[9px] font-black uppercase tracking-wider opacity-50">Protected</span>
                            </span>
                          ) : (
                            <button type="button" onClick={() => setDeleteTargetUser(u)} className="p-2.5 rounded-xl bg-red-50 text-red-600 hover:bg-red-500 hover:text-white border border-red-100 transition-all shadow-sm shadow-red-500/10">
                              <Trash2Icon className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Permissions Matrix Card */}
        <div className="bg-white rounded-2xl border border-slate-100 shadow-lg overflow-hidden">
          {/* Table Header with gradient */}
          <div className="bg-gradient-to-r from-slate-800 to-slate-900 px-6 py-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-white/10 text-[#DAA520] rounded-xl flex items-center justify-center shadow-inner shrink-0">
                <ShieldIcon className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-sm font-black text-white">Permissions Matrix</h3>
                <p className="text-[10px] text-slate-400 font-semibold mt-0.5">Define access control tiers for software modules</p>
              </div>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-center">
              <thead className="bg-slate-50 border-b border-slate-100 text-slate-400 uppercase text-[10px] font-black tracking-widest">
                <tr>
                  <th className="text-left px-6 py-4">Feature</th>
                  <th className="px-6 py-4 text-slate-700">Admin</th>
                  <th className="px-6 py-4 text-slate-700">Manager</th>
                  <th className="px-6 py-4 text-slate-700">Cashier</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {matrix.map((row, idx) => (
                  <tr key={row.feature} className="hover:bg-slate-50/50 transition-colors">
                    <td className="px-6 py-4 text-left font-black text-slate-700">{row.feature}</td>
                    <td className="px-6 py-4">
                      <button onClick={() => handleTogglePermission(idx, 'admin')} className="p-1 rounded hover:bg-slate-100 transition-all">{row.admin ? <CheckIcon className="w-5 h-5 text-emerald-500 mx-auto bg-emerald-50 border border-emerald-200 rounded-lg p-0.5 shadow-sm" /> : <span className="text-gray-300 font-bold">—</span>}</button>
                    </td>
                    <td className="px-6 py-4">
                      <button onClick={() => handleTogglePermission(idx, 'manager')} className="p-1 rounded hover:bg-slate-100 transition-all">{row.manager ? <CheckIcon className="w-5 h-5 text-emerald-500 mx-auto bg-emerald-50 border border-emerald-200 rounded-lg p-0.5 shadow-sm" /> : <span className="text-gray-300 font-bold">—</span>}</button>
                    </td>
                    <td className="px-6 py-4">
                      <button onClick={() => handleTogglePermission(idx, 'cashier')} className="p-1 rounded hover:bg-slate-100 transition-all">{row.cashier ? <CheckIcon className="w-5 h-5 text-emerald-500 mx-auto bg-emerald-50 border border-emerald-200 rounded-lg p-0.5 shadow-sm" /> : <span className="text-gray-300 font-bold">—</span>}</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {showAddUser && (
        <div className="fixed inset-0 bg-[#464646]/60 backdrop-blur-sm flex items-center justify-center z-[100] p-4">
          <form onSubmit={handleAddUser} className="bg-white rounded-3xl shadow-2xl w-full max-w-md p-8 space-y-5 animate-in zoom-in-95">
            <div className="flex justify-between items-center mb-2">
              <h3 className="font-black text-xl text-[#464646]">Add New Staff Account</h3>
              <button type="button" onClick={() => setShowAddUser(false)} className="p-2 hover:bg-gray-100 rounded-full text-gray-400 transition-colors"><XIcon className="w-5 h-5" /></button>
            </div>
            <div>
              <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1.5 block">Staff Full Name</label>
              <input required className="w-full px-4 py-3 border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-[#DAA520] font-bold text-[#464646]" value={formData.name} onChange={e => setFormData({ ...formData, name: e.target.value })} placeholder="e.g. Nalaka Bandara" />
            </div>
            <div>
              <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1.5 block">Email Address</label>
              <input type="email" required className="w-full px-4 py-3 border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-[#DAA520] font-bold text-[#464646]" value={formData.email} onChange={e => setFormData({ ...formData, email: e.target.value })} placeholder="e.g. nalaka@hardware.com" />
            </div>
            <div>
              <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1.5 block">Temporary Password</label>
              <input type="password" required className="w-full px-4 py-3 border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-[#DAA520] font-bold text-[#464646]" value={formData.password} onChange={e => setFormData({ ...formData, password: e.target.value })} placeholder="••••••••" />
            </div>
            <div>
              <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1.5 block">System Role</label>
              <select className="w-full px-4 py-3 border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-[#DAA520] font-bold text-[#464646] bg-white cursor-pointer" value={formData.role} onChange={e => setFormData({ ...formData, role: e.target.value as any })}>
                <option value="cashier">Retail User (Cashier)</option>
                <option value="manager">Admin (Manager)</option>
                <option value="super_admin">Super Admin (Owner)</option>
              </select>
            </div>
            <div className="flex gap-3 pt-4 border-t border-gray-100">
              <button type="button" onClick={() => setShowAddUser(false)} className="flex-1 py-3.5 font-black text-gray-500 hover:bg-gray-100 rounded-xl uppercase tracking-widest text-xs transition-colors">Cancel</button>
              <button type="submit" disabled={isSaving} className="flex-1 py-3.5 font-black bg-[#DAA520] hover:bg-[#B8860B] text-white rounded-xl shadow-lg shadow-[#DAA520]/20 uppercase tracking-widest text-xs transition-all flex items-center justify-center gap-2">
                {isSaving ? <span className="animate-spin">↻</span> : null}
                Create Account
              </button>
            </div>
          </form>
        </div>
      )}

      {deleteTargetUser && (
        <div className="fixed inset-0 bg-[#464646]/60 backdrop-blur-sm flex items-center justify-center z-[100] p-4">
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-md p-8 space-y-6 animate-in zoom-in-95">
            <div className="flex justify-between items-center">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.3em] text-red-500">Danger Zone</p>
                <h3 className="text-2xl font-black text-[#464646]">Confirm Delete</h3>
              </div>
              <button type="button" onClick={() => setDeleteTargetUser(null)} className="p-2 hover:bg-gray-100 rounded-full text-gray-400 transition-colors"><XIcon className="w-5 h-5" /></button>
            </div>
            <div className="rounded-3xl bg-red-50 border border-red-100 p-5 text-center">
              <div className="mx-auto w-16 h-16 bg-red-500/10 rounded-3xl flex items-center justify-center mb-4">
                <Trash2Icon className="w-8 h-8 text-red-600" />
              </div>
              <p className="text-sm text-gray-500 mb-3">You are about to remove the user</p>
              <p className="font-black text-lg text-[#464646]">{deleteTargetUser.name}</p>
              <p className="text-xs uppercase tracking-[0.2em] text-red-500 mt-3">This action cannot be undone</p>
            </div>
            <div className="flex gap-3">
              <button type="button" onClick={() => setDeleteTargetUser(null)} className="flex-1 py-3 rounded-2xl border border-gray-200 text-gray-600 font-black uppercase tracking-[0.15em] hover:bg-gray-50 transition-all">Cancel</button>
              <button type="button" onClick={() => handleDeleteUser(deleteTargetUser.id)} className="flex-1 py-3 rounded-2xl bg-red-600 text-white font-black uppercase tracking-[0.15em] hover:bg-red-700 transition-all">Delete User</button>
            </div>
          </div>
        </div>
      )}

      {showEditUser && editingUser && (
        <div className="fixed inset-0 bg-[#464646]/60 backdrop-blur-sm flex items-center justify-center z-[100] p-4">
          <form onSubmit={handleUpdateUser} className="bg-white rounded-3xl shadow-2xl w-full max-w-md p-8 space-y-5 animate-in zoom-in-95">
            <div className="flex justify-between items-center mb-2">
              <h3 className="font-black text-xl text-[#464646]">Edit Profile</h3>
              <button type="button" onClick={() => setShowEditUser(false)} className="p-2 hover:bg-gray-100 rounded-full text-gray-400 transition-colors"><XIcon className="w-5 h-5" /></button>
            </div>
            <div>
              <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1.5 block">Full Name</label>
              <input required className="w-full px-4 py-3 border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-[#DAA520] font-bold text-[#464646]" value={editingUser.name} onChange={e => setEditingUser({ ...editingUser, name: e.target.value })} />
            </div>
            <div>
              <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1.5 block">Email Address</label>
              <input disabled className="w-full px-4 py-3 border border-gray-200 rounded-xl outline-none font-bold text-[#464646] bg-gray-50 cursor-not-allowed opacity-70" value={editingUser.email} />
            </div>
            <div>
              <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1.5 block">System Role</label>
              <select 
                disabled={editingUser.role === 'super_admin'}
                className="w-full px-4 py-3 border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-[#DAA520] font-bold text-[#464646] bg-white cursor-pointer disabled:bg-gray-50 disabled:cursor-not-allowed" 
                value={editingUser.role} 
                onChange={e => setEditingUser({ ...editingUser, role: e.target.value as any })}
              >
                <option value="retail_user">Retail User (Cashier)</option>
                <option value="admin">Admin (Manager)</option>
                <option value="super_admin">Super Admin (Owner)</option>
              </select>
            </div>
            <div className="flex gap-3 pt-4 border-t border-gray-100">
              <button type="button" onClick={() => setShowEditUser(false)} className="flex-1 py-3.5 font-black text-gray-500 hover:bg-gray-100 rounded-xl uppercase tracking-widest text-xs transition-colors">Cancel</button>
              <button type="submit" className="flex-1 py-3.5 font-black bg-[#464646] hover:bg-[#333333] text-white rounded-xl shadow-lg shadow-[#464646]/20 uppercase tracking-widest text-xs transition-all">Update Details</button>
            </div>
          </form>
        </div>
      )}

      {showResetPasswordModal && resetPasswordUser && (
        <div className="fixed inset-0 bg-[#464646]/60 backdrop-blur-sm flex items-center justify-center z-[100] p-4">
          <form onSubmit={handleResetPassword} className="bg-white rounded-3xl shadow-2xl w-full max-w-md p-8 space-y-5 animate-in zoom-in-95">
            <div className="flex justify-between items-center mb-2">
              <h3 className="font-black text-xl text-[#464646]">Reset Staff Password</h3>
              <button type="button" onClick={() => setShowResetPasswordModal(false)} className="p-2 hover:bg-gray-100 rounded-full text-gray-400 transition-colors"><XIcon className="w-5 h-5" /></button>
            </div>
            <div className="bg-amber-50 border border-amber-100 rounded-2xl p-4 text-xs font-bold text-amber-800 leading-relaxed text-left">
              You are resetting the password for <strong>{resetPasswordUser.name}</strong> ({resetPasswordUser.email}).
            </div>
            <div className="text-left">
              <label className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1.5 block">New Password</label>
              <input type="password" required className="w-full px-4 py-3 border border-gray-200 rounded-xl outline-none focus:ring-2 focus:ring-[#DAA520] font-bold text-[#464646]" value={newPassword} onChange={e => setNewPassword(e.target.value)} placeholder="Minimum 6 characters" />
            </div>
            <div className="flex gap-3 pt-4 border-t border-gray-100">
              <button type="button" onClick={() => setShowResetPasswordModal(false)} className="flex-1 py-3.5 font-black text-gray-500 hover:bg-gray-100 rounded-xl uppercase tracking-widest text-xs transition-colors">Cancel</button>
              <button type="submit" className="flex-1 py-3.5 font-black bg-[#DAA520] hover:bg-[#B8860B] text-white rounded-xl shadow-lg shadow-[#DAA520]/20 uppercase tracking-widest text-xs transition-all">Reset Password</button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
