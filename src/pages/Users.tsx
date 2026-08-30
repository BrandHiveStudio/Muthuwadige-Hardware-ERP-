import React, { useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import {
  PlusIcon,
  ShieldIcon,
  CheckIcon,
  XIcon,
  Trash2Icon,
  Edit2Icon,
  LockIcon,
  SlidersHorizontalIcon,
  RotateCcwIcon,
  UsersIcon,
  CheckCircle2Icon
} from 'lucide-react';
import {
  CAPABILITIES,
  CAPABILITY_CATEGORIES,
  getDefaultRolePermissions,
  arePermissionsCustomized,
  getCustomOverrideCount,
  hasPermission
} from '../utils/permissions';
import { API_URL, fetchWithTimeout } from '../lib/api';
import type { UserRole } from '../types';

const ROLES: { role: UserRole; label: string; color: string; desc: string }[] = [
  { role: 'Admin', label: 'Admin', color: 'purple', desc: 'System administration, catalog management, financials, and configurations.' },
  { role: 'Manager', label: 'Manager', color: 'blue', desc: 'Operations oversight (Sales, POs, GRN receiving, inventory counts, shift reports).' },
  { role: 'Cashier', label: 'Cashier', color: 'emerald', desc: 'Front-desk POS counter checkout, returns/exchanges, and credit settlements.' }
];

export function Users() {
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddUser, setShowAddUser] = useState(false);
  const [showEditUser, setShowEditUser] = useState(false);
  const [showQuotaModal, setShowQuotaModal] = useState(false);
  const [deleteTargetUser, setDeleteTargetUser] = useState<any>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [inspectedUserId, setInspectedUserId] = useState<string>('presets');
  
  const inspectedUser = users.find(u => u.id === inspectedUserId);
  
  // Create Form State
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    role: 'Cashier' as UserRole,
    password: '',
    permissions: getDefaultRolePermissions('Cashier')
  });

  // Edit Form State
  const [editingUser, setEditingUser] = useState<any>(null);
  const [editPermissions, setEditPermissions] = useState<string[]>([]);

  // Password Reset Modal State
  const [showResetPasswordModal, setShowResetPasswordModal] = useState(false);
  const [resetPasswordUser, setResetPasswordUser] = useState<any>(null);
  const [newPassword, setNewPassword] = useState('');

  const isSuperAdmin = (u: any) => {
    if (!u) return false;
    const r = (u.role || '').toLowerCase().trim();
    return r === 'super_admin' || r === 'super admin' || (r === 'admin' && (u.email === 'admin@hardware.com' || u.id === 'u2'));
  };

  // Staff account quota calculations: Filter out Root Super Admin
  const staffUsers = users.filter(u => !isSuperAdmin(u));
  const isQuotaReached = staffUsers.length >= 3;

  const fetchInitialData = async () => {
    setLoading(true);
    try {
      const { data: userData } = await supabase.from('profiles').select('*').order('created_at', { ascending: false });
      if (userData) {
        setUsers(userData);
      }
    } catch (err) {
      console.error("Failed to fetch staff profiles:", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchInitialData();
    const handleRefresh = () => fetchInitialData();
    window.addEventListener('refresh-all-data', handleRefresh);
    window.addEventListener('refresh-users', handleRefresh);
    return () => {
      window.removeEventListener('refresh-all-data', handleRefresh);
      window.removeEventListener('refresh-users', handleRefresh);
    };
  }, []);

  // Handle Add User Form Submission
  const handleAddUser = async (e: React.FormEvent) => {
    e.preventDefault();

    if (isQuotaReached) {
      alert("Staff quota limit reached. Maximum 3 additional staff accounts allowed.");
      return;
    }

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
    const { error } = await supabase.auth.signUp({
      email: formData.email.trim(),
      password: formData.password,
      options: {
        data: {
          full_name: formData.name.trim(),
          role: formData.role,
          permissions: formData.permissions,
          custom_permissions: formData.permissions
        }
      }
    });

    setIsSaving(false);
    if (!error) {
      alert(`Account created successfully for ${formData.name}!`);
      setShowAddUser(false);
      setFormData({
        name: '',
        email: '',
        role: 'Cashier',
        password: '',
        permissions: getDefaultRolePermissions('Cashier')
      });
      fetchInitialData();
    } else {
      alert('Failed to create user account: ' + (error.message || error));
    }
  };

  // Handle Update User Form Submission
  const handleUpdateUser = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!editingUser.name || editingUser.name.trim().length < 2) {
      alert("Name must be at least 2 characters.");
      return;
    }

    setIsSaving(true);
    const { error } = await supabase.from('profiles').update({
      name: editingUser.name.trim(),
      role: editingUser.role,
      permissions: editPermissions,
      custom_permissions: editPermissions
    }).eq('id', editingUser.id);

    setIsSaving(false);
    if (!error) {
      setUsers(users.map(u => u.id === editingUser.id ? { ...editingUser, permissions: editPermissions, custom_permissions: editPermissions } : u));
      setShowEditUser(false);
      alert(`User profile & permissions updated successfully for ${editingUser.name}!`);
    } else {
      alert('Failed to update user profile: ' + (error.message || error));
    }
  };

  const handleDeleteUser = async (id: string) => {
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
    try {
      const res = await fetchWithTimeout(`${API_URL}/profiles/${resetPasswordUser.id}/password`, {
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
    } catch (e: any) {
      alert("Failed to reset password: " + (e?.message || e));
    }
  };

  // Toggle permission helper for Add User form
  const toggleAddPermission = (key: string) => {
    const exists = formData.permissions.includes(key);
    const updated = exists
      ? formData.permissions.filter(k => k !== key)
      : [...formData.permissions, key];
    setFormData({ ...formData, permissions: updated });
  };

  // Toggle permission helper for Edit User form
  const toggleEditPermission = (key: string) => {
    const exists = editPermissions.includes(key);
    const updated = exists
      ? editPermissions.filter(k => k !== key)
      : [...editPermissions, key];
    setEditPermissions(updated);
  };

  const openEditModal = (u: any) => {
    setEditingUser({ ...u });
    const rawPerms = u.custom_permissions !== undefined ? u.custom_permissions : u.permissions;
    const current = Array.isArray(rawPerms)
      ? rawPerms
      : typeof rawPerms === 'string' && rawPerms.trim()
        ? (() => {
            try {
              return JSON.parse(rawPerms);
            } catch {
              return rawPerms.split(',').map((p: string) => p.trim());
            }
          })()
        : getDefaultRolePermissions(u.role);
    setEditPermissions(current);
    setShowEditUser(true);
  };

  return (
    <div className="p-4 sm:p-6 space-y-6 animate-in fade-in duration-500 text-left">
      <div className="space-y-6 animate-in slide-in-from-bottom-4">
        
        {/* User Accounts Card */}
        <div className="bg-white rounded-2xl border border-slate-200/80 shadow-md overflow-hidden">
          {/* Table Header */}
          <div className="bg-gradient-to-r from-slate-900 via-slate-800 to-slate-900 px-6 py-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-center gap-3.5">
              <div className="w-11 h-11 bg-white/10 text-[#DAA520] rounded-xl flex items-center justify-center shadow-inner shrink-0">
                <UsersIcon className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-base font-black text-white flex items-center gap-2">
                  Staff Accounts & Access Controls
                </h3>
                <p className="text-[11px] text-slate-300 font-medium mt-0.5">
                  Manage cashier & manager credentials, role presets, and customized capability overrides.
                </p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              {/* Clean Staff Quota Indicator */}
              <div className="flex items-center gap-2">
                <span className={`px-3.5 py-1.5 text-xs font-black rounded-xl border tracking-wide transition-all ${
                  isQuotaReached
                    ? 'bg-red-950/80 text-red-300 border-red-700/50 shadow-sm'
                    : 'bg-emerald-950/80 text-emerald-300 border-emerald-700/50'
                }`}>
                  {staffUsers.length}/3 Additional Staff
                </span>
              </div>

              {/* Add Staff Button */}
              <button
                type="button"
                onClick={() => {
                  if (isQuotaReached) {
                    setShowQuotaModal(true);
                    return;
                  }
                  setFormData({
                    name: '',
                    email: '',
                    role: 'Cashier',
                    password: '',
                    permissions: getDefaultRolePermissions('Cashier')
                  });
                  setShowAddUser(true);
                }}
                className="flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-black uppercase tracking-wider transition-all shadow-md cursor-pointer bg-[#DAA520] hover:bg-[#B8860B] text-white shadow-[#DAA520]/20"
                title={isQuotaReached ? "All 3 additional staff account slots in use (Click for details)" : "Add New Staff Account"}
              >
                <PlusIcon className="w-4 h-4" />
                Add Staff
              </button>
            </div>
          </div>

          {/* Quota Limit Reached Banner */}
          {isQuotaReached && (
            <div className="px-6 py-3.5 bg-amber-50/90 border-b border-amber-200 text-amber-900 text-xs font-bold flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <span className="w-2.5 h-2.5 rounded-full bg-amber-500 animate-ping shrink-0" />
                <span>
                  <strong>Staff Account Limit Reached (3 Staff + 1 Super Admin = 4 Total Accounts):</strong> You have utilized all 3 additional staff accounts on this workstation. To add a new team member, delete an inactive account or contact support to upgrade your enterprise license.
                </span>
              </div>
            </div>
          )}

          {/* User Table */}
          {loading ? (
            <div className="p-16 text-center text-slate-400 font-bold">Loading system accounts...</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead className="bg-slate-50/90 border-b border-slate-200 text-[10px] font-black uppercase text-slate-500 tracking-widest">
                  <tr>
                    <th className="px-6 py-4">User Details</th>
                    <th className="px-6 py-4">Email Address</th>
                    <th className="px-6 py-4 text-center">Designated Role</th>
                    <th className="px-6 py-4 text-center">Permission Status</th>
                    <th className="px-6 py-4 text-center">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {users.map(u => {
                    const superAdmin = isSuperAdmin(u);
                    const userPerms = u.custom_permissions !== undefined ? u.custom_permissions : u.permissions;
                    const isCustomized = !superAdmin && arePermissionsCustomized(u.role, userPerms);
                    const overrideCount = getCustomOverrideCount(u.role, userPerms);
                    const roleLabel = u.role ? (u.role.charAt(0).toUpperCase() + u.role.slice(1).toLowerCase()) : 'Cashier';
                    const isInspected = inspectedUserId === u.id;

                    return (
                      <tr 
                        key={u.id} 
                        onClick={() => setInspectedUserId(u.id)}
                        className={`transition-colors group cursor-pointer ${
                          isInspected ? 'bg-amber-50/60 ring-2 ring-amber-400/80 shadow-sm' : 'hover:bg-slate-50/70'
                        }`}
                      >
                        <td className="px-6 py-4 flex items-center gap-3 font-bold text-slate-900">
                          <div className={`w-10 h-10 rounded-xl flex items-center justify-center font-black text-sm text-white shadow-md ${
                            superAdmin
                              ? 'bg-gradient-to-br from-purple-600 to-indigo-700 shadow-purple-200'
                              : (u.role || '').toLowerCase() === 'manager'
                                ? 'bg-gradient-to-br from-blue-600 to-cyan-700 shadow-blue-200'
                                : 'bg-gradient-to-br from-emerald-600 to-teal-700 shadow-emerald-200'
                          }`}>
                            {u.avatar || u.name?.charAt(0).toUpperCase() || 'U'}
                          </div>
                          <div>
                            <div className="flex items-center gap-2">
                              <span>{u.name}</span>
                              {superAdmin && (
                                <span className="px-1.5 py-0.5 rounded text-[9px] font-black bg-purple-100 text-purple-800 border border-purple-200 uppercase">
                                  Root Admin
                                </span>
                              )}
                              {isInspected && (
                                <span className="px-1.5 py-0.5 rounded text-[9px] font-black bg-amber-500 text-slate-900 uppercase">
                                  Inspecting
                                </span>
                              )}
                            </div>
                            <span className="text-[11px] text-slate-400 font-medium">ID: {u.id}</span>
                          </div>
                        </td>
                        <td className="px-6 py-4 text-slate-600 font-medium">{u.email}</td>
                        <td className="px-6 py-4 text-center">
                          <span className={`px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-wider ${
                            superAdmin
                              ? 'bg-purple-100 text-purple-800 border border-purple-200'
                              : (u.role || '').toLowerCase() === 'manager'
                                ? 'bg-blue-100 text-blue-800 border border-blue-200'
                                : 'bg-emerald-100 text-emerald-800 border border-emerald-200'
                          }`}>
                            {superAdmin ? 'Super Admin' : roleLabel}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-center">
                          {superAdmin ? (
                            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-wider bg-purple-50 text-purple-700 border border-purple-200">
                              <ShieldIcon className="w-3 h-3 text-purple-600" /> Full Access (Root)
                            </span>
                          ) : isCustomized ? (
                            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-wider bg-amber-50 text-amber-800 border border-amber-300 shadow-sm" title={`${overrideCount} Granular Capabilities Configured`}>
                              <SlidersHorizontalIcon className="w-3.5 h-3.5 text-amber-600" />
                              <span>{overrideCount} Custom Overrides</span>
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-wider bg-slate-50 text-slate-600 border border-slate-200">
                              <CheckCircle2Icon className="w-3 h-3 text-emerald-600" /> Standard Preset
                            </span>
                          )}
                        </td>
                        <td className="px-6 py-4 text-center">
                          <div className="flex items-center justify-center gap-2">
                            {/* Inspect Live Matrix */}
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setInspectedUserId(u.id);
                                document.getElementById('capability-matrix-section')?.scrollIntoView({ behavior: 'smooth' });
                              }}
                              className={`p-2.5 rounded-xl border transition-all shadow-sm cursor-pointer ${
                                isInspected
                                  ? 'bg-amber-500 text-slate-900 border-amber-600 shadow-amber-200'
                                  : 'bg-amber-50 text-amber-700 hover:bg-amber-100 border-amber-200'
                              }`}
                              title="Inspect Live Capabilities in Matrix"
                            >
                              <SlidersHorizontalIcon className="w-4 h-4" />
                            </button>

                            {/* Edit Details & Permissions */}
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                openEditModal(u);
                              }}
                              className="p-2.5 rounded-xl bg-blue-50 text-blue-600 hover:bg-blue-100 border border-blue-200 transition-all shadow-sm cursor-pointer"
                              title="Edit User & Permissions"
                            >
                              <Edit2Icon className="w-4 h-4" />
                            </button>
                            
                            {/* Reset Password */}
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setResetPasswordUser(u);
                                setNewPassword('');
                                setShowResetPasswordModal(true);
                              }}
                              className="p-2.5 rounded-xl bg-slate-50 text-slate-600 hover:bg-slate-200 border border-slate-200 transition-all shadow-sm cursor-pointer"
                              title="Reset Password"
                            >
                              <LockIcon className="w-4 h-4" />
                            </button>

                            {/* Delete User */}
                            {superAdmin ? (
                              <div className="p-2.5 rounded-xl bg-slate-100 text-slate-400 border border-slate-200 cursor-not-allowed opacity-50" title="Root Super Admin account cannot be deleted">
                                <Trash2Icon className="w-4 h-4" />
                              </div>
                            ) : (
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setDeleteTargetUser(u);
                                }}
                                className="p-2.5 rounded-xl bg-red-50 text-red-600 hover:bg-red-600 hover:text-white border border-red-200 transition-all shadow-sm cursor-pointer"
                                title="Delete Staff Member"
                              >
                                <Trash2Icon className="w-4 h-4" />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Scannable Role Capabilities & Permissions Matrix */}
        <div id="capability-matrix-section" className="bg-white rounded-2xl border border-slate-200/80 shadow-md overflow-hidden scroll-mt-6">
          {/* Header */}
          <div className="bg-gradient-to-r from-slate-900 via-slate-800 to-slate-900 px-6 py-5 flex items-center justify-between flex-wrap gap-4">
            <div className="flex items-center gap-3.5">
              <div className="w-11 h-11 bg-white/10 text-[#DAA520] rounded-xl flex items-center justify-center shadow-inner shrink-0">
                <ShieldIcon className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-base font-black text-white">Granular Capability Registry & Role Presets</h3>
                <p className="text-[11px] text-slate-300 font-medium mt-0.5">Live capability matrix dynamically reflecting staff permission states and default role presets.</p>
              </div>
            </div>
          </div>

          {/* Inspector Staff Selection Bar */}
          <div className="bg-slate-800/90 px-6 py-3 border-b border-slate-700/60 flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-2 text-xs text-slate-300 font-bold uppercase tracking-wider">
              <SlidersHorizontalIcon className="w-4 h-4 text-amber-400" />
              <span>Inspect Capability Matrix:</span>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <button
                type="button"
                onClick={() => setInspectedUserId('presets')}
                className={`px-3 py-1.5 rounded-xl text-xs font-black transition-all flex items-center gap-1.5 cursor-pointer ${
                  inspectedUserId === 'presets'
                    ? 'bg-amber-500 text-slate-900 shadow-md shadow-amber-500/20 font-extrabold'
                    : 'bg-slate-700/60 text-slate-300 hover:bg-slate-700 hover:text-white border border-slate-600/60'
                }`}
              >
                <ShieldIcon className="w-3.5 h-3.5" />
                <span>Standard Role Presets (Default)</span>
              </button>
              {users.map(u => {
                const uSuper = isSuperAdmin(u);
                const uPerms = u.custom_permissions !== undefined ? u.custom_permissions : u.permissions;
                const uCustomized = !uSuper && arePermissionsCustomized(u.role, uPerms);
                const uCount = getCustomOverrideCount(u.role, uPerms);
                const isSelected = inspectedUserId === u.id;

                return (
                  <button
                    key={u.id}
                    type="button"
                    onClick={() => setInspectedUserId(u.id)}
                    className={`px-3 py-1.5 rounded-xl text-xs font-black transition-all flex items-center gap-2 cursor-pointer ${
                      isSelected
                        ? 'bg-amber-400 text-slate-900 shadow-md shadow-amber-400/30'
                        : 'bg-slate-700/60 text-slate-300 hover:bg-slate-700 hover:text-white border border-slate-600/60'
                    }`}
                  >
                    <div className="w-4 h-4 rounded-full bg-slate-900 text-white flex items-center justify-center text-[9px] font-black">
                      {u.name?.charAt(0).toUpperCase() || 'U'}
                    </div>
                    <span>{u.name}</span>
                    <span className={`text-[10px] px-1.5 py-0.2 rounded-full ${isSelected ? 'bg-slate-900 text-amber-400' : 'bg-slate-800 text-slate-400'}`}>
                      {uSuper ? 'Super Admin' : u.role || 'Cashier'}
                    </span>
                    {uCustomized && (
                      <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-amber-500/20 text-amber-300 font-extrabold border border-amber-500/40">
                        {uCount} Overrides
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Active Inspected User Banner */}
          {inspectedUser && (
            <div className="bg-gradient-to-r from-amber-50 via-orange-50 to-amber-50 border-b border-amber-200/80 px-6 py-3.5 flex items-center justify-between flex-wrap gap-3">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-amber-500 text-slate-900 flex items-center justify-center font-black text-sm shadow-md">
                  {inspectedUser.avatar || inspectedUser.name?.charAt(0).toUpperCase() || 'U'}
                </div>
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-black text-slate-900">{inspectedUser.name}</span>
                    <span className="text-[10px] px-2 py-0.5 rounded-full font-black bg-amber-100 text-amber-900 border border-amber-300 uppercase">
                      {isSuperAdmin(inspectedUser) ? 'Root Super Admin' : inspectedUser.role || 'Cashier'}
                    </span>
                    {arePermissionsCustomized(inspectedUser.role, inspectedUser.custom_permissions || inspectedUser.permissions) && (
                      <span className="text-[10px] px-2 py-0.5 rounded-full font-black bg-emerald-100 text-emerald-800 border border-emerald-300">
                        ⚡ {getCustomOverrideCount(inspectedUser.role, inspectedUser.custom_permissions || inspectedUser.permissions)} Active Custom Overrides
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] text-slate-600 font-medium mt-0.5">
                    Live effective capability status. Green checkmarks (✓) show capabilities actively enabled and granted for this user.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => openEditModal(inspectedUser)}
                className="px-4 py-2 rounded-xl bg-slate-900 text-amber-400 hover:bg-slate-800 border border-slate-700 text-xs font-bold transition-all shadow-sm flex items-center gap-2 cursor-pointer"
              >
                <Edit2Icon className="w-3.5 h-3.5" />
                <span>Edit Capabilities for {inspectedUser.name}</span>
              </button>
            </div>
          )}

          {/* Matrix Overview */}
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left border-collapse">
              <thead className="bg-slate-50 border-b border-slate-200 text-slate-500 uppercase text-[10px] font-black tracking-widest sticky top-0 z-10">
                <tr>
                  <th className="px-6 py-4 min-w-[300px]">Capability / Action</th>
                  {inspectedUser && (
                    <th className="px-4 py-4 text-center min-w-[190px] text-amber-950 bg-amber-100/80 border-x border-amber-300/80 shadow-sm">
                      <span className="flex items-center justify-center gap-1.5 font-black text-xs">
                        <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                        Live Status: {inspectedUser.name}
                      </span>
                      <span className="text-[10px] text-amber-800 font-bold block mt-0.5">
                        ({isSuperAdmin(inspectedUser) ? 'Super Admin' : inspectedUser.role || 'Cashier'})
                      </span>
                    </th>
                  )}
                  <th className="px-4 py-4 text-center min-w-[130px] text-purple-700 bg-purple-50/50">
                    <span className="flex items-center justify-center gap-1.5 font-black">
                      <ShieldIcon className="w-3.5 h-3.5" /> Admin Preset
                    </span>
                  </th>
                  <th className="px-4 py-4 text-center min-w-[130px] text-blue-700 bg-blue-50/50">
                    <span className="flex items-center justify-center gap-1.5 font-black">
                      Manager Preset
                    </span>
                  </th>
                  <th className="px-4 py-4 text-center min-w-[130px] text-emerald-700 bg-emerald-50/50">
                    <span className="flex items-center justify-center gap-1.5 font-black">
                      Cashier Preset
                    </span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {CAPABILITY_CATEGORIES.map(category => {
                  const catCapabilities = CAPABILITIES.filter(c => c.category === category.id);

                  return (
                    <React.Fragment key={category.id}>
                      {/* Category Header Row */}
                      <tr className="bg-slate-100/90 border-y border-slate-200">
                        <td colSpan={inspectedUser ? 5 : 4} className="px-6 py-3 text-left font-black text-slate-800 uppercase tracking-wider text-xs bg-slate-100 flex items-center gap-2">
                          <span>{category.icon}</span>
                          <span>{category.name}</span>
                          <span className="text-[10px] text-slate-500 font-semibold lowercase tracking-normal ml-2">({category.description})</span>
                        </td>
                      </tr>

                      {/* Capability Rows */}
                      {catCapabilities.map(cap => {
                        const adminAllowed = getDefaultRolePermissions('Admin').includes(cap.key);
                        const managerAllowed = getDefaultRolePermissions('Manager').includes(cap.key);
                        const cashierAllowed = getDefaultRolePermissions('Cashier').includes(cap.key);

                        const userAllowed = inspectedUser ? hasPermission(inspectedUser, cap.key) : false;
                        const inspectedRawPerms = inspectedUser 
                          ? (inspectedUser.custom_permissions !== undefined ? inspectedUser.custom_permissions : inspectedUser.permissions)
                          : null;
                        const isCustom = Array.isArray(inspectedRawPerms) && inspectedRawPerms.includes(cap.key);

                        return (
                          <tr key={cap.key} className="hover:bg-slate-50/60 transition-colors">
                            <td className="px-6 py-3.5 text-left">
                              <div className="font-bold text-slate-900 text-xs">{cap.name}</div>
                              <div className="text-[11px] text-slate-500 mt-0.5">{cap.description}</div>
                            </td>

                            {/* Inspected User Live Column */}
                            {inspectedUser && (
                              <td className="px-4 py-3.5 text-center bg-amber-50/50 border-x border-amber-200/80">
                                {userAllowed ? (
                                  <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-xl bg-emerald-50 text-emerald-700 border border-emerald-300 font-black text-xs shadow-sm">
                                    <CheckIcon className="w-4 h-4 text-emerald-600 stroke-[3]" />
                                    <span>Granted {isCustom ? '(Custom)' : ''}</span>
                                  </div>
                                ) : (
                                  <div className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-100/70 text-slate-400 border border-slate-200 text-xs font-semibold">
                                    <span className="text-slate-300 font-bold">—</span>
                                    <span>Disabled</span>
                                  </div>
                                )}
                              </td>
                            )}

                            {/* Admin Preset */}
                            <td className="px-4 py-3.5 text-center bg-purple-50/20">
                              {adminAllowed ? (
                                <div className="inline-flex items-center justify-center w-7 h-7 rounded-lg bg-emerald-50 text-emerald-600 border border-emerald-200 font-black">
                                  <CheckIcon className="w-4 h-4" />
                                </div>
                              ) : (
                                <span className="text-slate-300 font-bold">—</span>
                              )}
                            </td>
                            {/* Manager Preset */}
                            <td className="px-4 py-3.5 text-center bg-blue-50/20">
                              {managerAllowed ? (
                                <div className="inline-flex items-center justify-center w-7 h-7 rounded-lg bg-emerald-50 text-emerald-600 border border-emerald-200 font-black">
                                  <CheckIcon className="w-4 h-4" />
                                </div>
                              ) : (
                                <span className="text-slate-300 font-bold">—</span>
                              )}
                            </td>
                            {/* Cashier Preset */}
                            <td className="px-4 py-3.5 text-center bg-emerald-50/20">
                              {cashierAllowed ? (
                                <div className="inline-flex items-center justify-center w-7 h-7 rounded-lg bg-emerald-50 text-emerald-600 border border-emerald-200 font-black">
                                  <CheckIcon className="w-4 h-4" />
                                </div>
                              ) : (
                                <span className="text-slate-300 font-bold">—</span>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* CREATE NEW STAFF MODAL */}
      {showAddUser && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-[100] p-4 overflow-y-auto">
          <form onSubmit={handleAddUser} className="bg-white rounded-3xl shadow-2xl w-full max-w-2xl p-6 sm:p-8 space-y-6 animate-in zoom-in-95 my-8">
            <div className="flex justify-between items-center pb-4 border-b border-slate-100">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-amber-50 text-[#DAA520] flex items-center justify-center shadow-inner">
                  <PlusIcon className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-black text-lg text-slate-900">Add New Staff Account</h3>
                  <p className="text-xs text-slate-500 font-medium">Select a base role preset or customize granular permissions.</p>
                </div>
              </div>
              <button type="button" onClick={() => setShowAddUser(false)} className="p-2 hover:bg-slate-100 rounded-full text-slate-400 transition-colors">
                <XIcon className="w-5 h-5" />
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1.5 block">Staff Full Name</label>
                <input
                  required
                  className="w-full px-4 py-2.5 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-[#DAA520] font-bold text-slate-800 text-sm"
                  value={formData.name}
                  onChange={e => setFormData({ ...formData, name: e.target.value })}
                  placeholder="e.g. Nalaka Bandara"
                />
              </div>

              <div>
                <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1.5 block">Email Address (Login ID)</label>
                <input
                  type="email"
                  required
                  className="w-full px-4 py-2.5 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-[#DAA520] font-bold text-slate-800 text-sm"
                  value={formData.email}
                  onChange={e => setFormData({ ...formData, email: e.target.value })}
                  placeholder="e.g. nalaka@hardware.com"
                />
              </div>
            </div>

            <div>
              <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1.5 block">Initial Temporary Password</label>
              <input
                type="password"
                required
                className="w-full px-4 py-2.5 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-[#DAA520] font-bold text-slate-800 text-sm"
                value={formData.password}
                onChange={e => setFormData({ ...formData, password: e.target.value })}
                placeholder="Minimum 6 characters"
              />
            </div>

            {/* Role Preset Selector */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest block">Role Preset Selector</label>
                {arePermissionsCustomized(formData.role, formData.permissions) ? (
                  <span className="text-[10px] font-black text-amber-600 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full uppercase">
                    Customized Permissions
                  </span>
                ) : (
                  <span className="text-[10px] font-black text-emerald-600 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full uppercase">
                    Standard Preset
                  </span>
                )}
              </div>

              <div className="grid grid-cols-3 gap-3">
                {ROLES.map(r => {
                  const isSelected = formData.role === r.role;
                  return (
                    <button
                      key={r.role}
                      type="button"
                      onClick={() => {
                        setFormData({
                          ...formData,
                          role: r.role,
                          permissions: getDefaultRolePermissions(r.role)
                        });
                      }}
                      className={`p-3 rounded-2xl border text-left transition-all cursor-pointer ${
                        isSelected
                          ? 'border-[#DAA520] bg-amber-50/50 shadow-md ring-2 ring-[#DAA520]/20'
                          : 'border-slate-200 hover:border-slate-300 bg-white'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span className="font-black text-xs text-slate-900">{r.label}</span>
                        {isSelected && <CheckCircle2Icon className="w-4 h-4 text-[#DAA520]" />}
                      </div>
                      <p className="text-[10px] text-slate-500 line-clamp-2 leading-snug">{r.desc}</p>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Interactive Capability Checkbox Grid */}
            <div className="space-y-3 pt-2">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="text-xs font-black text-slate-900 uppercase tracking-wider">Granular Permission Capabilities</h4>
                  <p className="text-[11px] text-slate-500 font-medium">Toggle specific actions on or off to create custom permission profiles.</p>
                </div>

                <button
                  type="button"
                  onClick={() => setFormData({ ...formData, permissions: getDefaultRolePermissions(formData.role) })}
                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl text-[11px] font-black text-slate-600 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 transition-all cursor-pointer"
                >
                  <RotateCcwIcon className="w-3.5 h-3.5" /> Reset to Defaults
                </button>
              </div>

              <div className="max-h-60 overflow-y-auto pr-1 space-y-3 divide-y divide-slate-100 border border-slate-200 rounded-2xl p-3 bg-slate-50/50">
                {CAPABILITY_CATEGORIES.map(category => {
                  const catCaps = CAPABILITIES.filter(c => c.category === category.id);

                  return (
                    <div key={category.id} className="pt-2 first:pt-0 space-y-2">
                      <div className="text-[11px] font-black text-slate-700 uppercase tracking-wider flex items-center gap-1.5">
                        <span>{category.icon}</span> {category.name}
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {catCaps.map(cap => {
                          const isChecked = formData.permissions.includes(cap.key);

                          return (
                            <label
                              key={cap.key}
                              className={`flex items-start gap-2.5 p-2.5 rounded-xl border transition-all cursor-pointer text-left ${
                                isChecked
                                  ? 'bg-white border-emerald-300 shadow-sm ring-1 ring-emerald-500/10'
                                  : 'bg-white/60 border-slate-200 hover:bg-white text-slate-400'
                              }`}
                            >
                              <input
                                type="checkbox"
                                checked={isChecked}
                                onChange={() => toggleAddPermission(cap.key)}
                                className="mt-0.5 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500 h-4 w-4 shrink-0 cursor-pointer"
                              />
                              <div className="flex-1 min-w-0">
                                <div className={`text-xs font-bold ${isChecked ? 'text-slate-900' : 'text-slate-500'}`}>
                                  {cap.name}
                                </div>
                                <div className="text-[10px] text-slate-400 leading-tight truncate">
                                  {cap.description}
                                </div>
                              </div>
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="flex gap-3 pt-4 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setShowAddUser(false)}
                className="flex-1 py-3 font-black text-slate-600 hover:bg-slate-100 rounded-xl uppercase tracking-widest text-xs transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSaving}
                className="flex-1 py-3 font-black bg-[#DAA520] hover:bg-[#B8860B] text-white rounded-xl shadow-lg shadow-[#DAA520]/20 uppercase tracking-widest text-xs transition-all flex items-center justify-center gap-2 cursor-pointer"
              >
                {isSaving ? <span className="animate-spin">↻</span> : null}
                Create Staff Account
              </button>
            </div>
          </form>
        </div>
      )}

      {/* EDIT USER & PERMISSIONS MODAL */}
      {showEditUser && editingUser && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-[100] p-4 overflow-y-auto">
          <form onSubmit={handleUpdateUser} className="bg-white rounded-3xl shadow-2xl w-full max-w-2xl p-6 sm:p-8 space-y-6 animate-in zoom-in-95 my-8">
            <div className="flex justify-between items-center pb-4 border-b border-slate-100">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center shadow-inner">
                  <Edit2Icon className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-black text-lg text-slate-900">Edit User & Permission Overrides</h3>
                  <p className="text-xs text-slate-500 font-medium">Update profile information and customize granular capability access.</p>
                </div>
              </div>
              <button type="button" onClick={() => setShowEditUser(false)} className="p-2 hover:bg-slate-100 rounded-full text-slate-400 transition-colors">
                <XIcon className="w-5 h-5" />
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1.5 block">Staff Full Name</label>
                <input
                  required
                  className="w-full px-4 py-2.5 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-blue-500 font-bold text-slate-800 text-sm"
                  value={editingUser.name}
                  onChange={e => setEditingUser({ ...editingUser, name: e.target.value })}
                />
              </div>

              <div>
                <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1.5 block">Email Address (Login ID)</label>
                <input
                  disabled
                  className="w-full px-4 py-2.5 border border-slate-200 rounded-xl outline-none font-bold text-slate-500 bg-slate-50 cursor-not-allowed text-sm opacity-80"
                  value={editingUser.email}
                />
              </div>
            </div>

            {/* Base Role Preset Selection */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest block">Base System Role</label>
                {arePermissionsCustomized(editingUser.role, editPermissions) ? (
                  <span className="text-[10px] font-black text-amber-600 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded-full uppercase">
                    Customized Permissions ({editPermissions.length} Active)
                  </span>
                ) : (
                  <span className="text-[10px] font-black text-emerald-600 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full uppercase">
                    Standard Preset
                  </span>
                )}
              </div>

              <div className="grid grid-cols-3 gap-3">
                {ROLES.map(r => {
                  const isSelected = (editingUser.role || '').toLowerCase() === r.role.toLowerCase();
                  return (
                    <button
                      key={r.role}
                      type="button"
                      onClick={() => {
                        setEditingUser({ ...editingUser, role: r.role });
                        setEditPermissions(getDefaultRolePermissions(r.role));
                      }}
                      className={`p-3 rounded-2xl border text-left transition-all cursor-pointer ${
                        isSelected
                          ? 'border-blue-600 bg-blue-50/50 shadow-md ring-2 ring-blue-500/20'
                          : 'border-slate-200 hover:border-slate-300 bg-white'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span className="font-black text-xs text-slate-900">{r.label}</span>
                        {isSelected && <CheckCircle2Icon className="w-4 h-4 text-blue-600" />}
                      </div>
                      <p className="text-[10px] text-slate-500 line-clamp-2 leading-snug">{r.desc}</p>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Interactive Capability Checkbox Grid */}
            <div className="space-y-3 pt-2">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="text-xs font-black text-slate-900 uppercase tracking-wider">Granular Permission Capabilities</h4>
                  <p className="text-[11px] text-slate-500 font-medium">Toggle capabilities on or off for this specific user account.</p>
                </div>

                <button
                  type="button"
                  onClick={() => setEditPermissions(getDefaultRolePermissions(editingUser.role))}
                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl text-[11px] font-black text-slate-600 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 transition-all cursor-pointer"
                >
                  <RotateCcwIcon className="w-3.5 h-3.5" /> Reset to Role Defaults
                </button>
              </div>

              <div className="max-h-60 overflow-y-auto pr-1 space-y-3 divide-y divide-slate-100 border border-slate-200 rounded-2xl p-3 bg-slate-50/50">
                {CAPABILITY_CATEGORIES.map(category => {
                  const catCaps = CAPABILITIES.filter(c => c.category === category.id);

                  return (
                    <div key={category.id} className="pt-2 first:pt-0 space-y-2">
                      <div className="text-[11px] font-black text-slate-700 uppercase tracking-wider flex items-center gap-1.5">
                        <span>{category.icon}</span> {category.name}
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {catCaps.map(cap => {
                          const isChecked = editPermissions.includes(cap.key);

                          return (
                            <label
                              key={cap.key}
                              className={`flex items-start gap-2.5 p-2.5 rounded-xl border transition-all cursor-pointer text-left ${
                                isChecked
                                  ? 'bg-white border-blue-300 shadow-sm ring-1 ring-blue-500/10'
                                  : 'bg-white/60 border-slate-200 hover:bg-white text-slate-400'
                              }`}
                            >
                              <input
                                type="checkbox"
                                checked={isChecked}
                                onChange={() => toggleEditPermission(cap.key)}
                                className="mt-0.5 rounded border-slate-300 text-blue-600 focus:ring-blue-500 h-4 w-4 shrink-0 cursor-pointer"
                              />
                              <div className="flex-1 min-w-0">
                                <div className={`text-xs font-bold ${isChecked ? 'text-slate-900' : 'text-slate-500'}`}>
                                  {cap.name}
                                </div>
                                <div className="text-[10px] text-slate-400 leading-tight truncate">
                                  {cap.description}
                                </div>
                              </div>
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="flex gap-3 pt-4 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setShowEditUser(false)}
                className="flex-1 py-3 font-black text-slate-600 hover:bg-slate-100 rounded-xl uppercase tracking-widest text-xs transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSaving}
                className="flex-1 py-3 font-black bg-slate-900 hover:bg-slate-800 text-white rounded-xl shadow-lg uppercase tracking-widest text-xs transition-all flex items-center justify-center gap-2 cursor-pointer"
              >
                {isSaving ? <span className="animate-spin">↻</span> : null}
                Save Changes
              </button>
            </div>
          </form>
        </div>
      )}

      {/* DANGER ZONE: CONFIRM DELETE USER MODAL */}
      {deleteTargetUser && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-[100] p-4">
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-md p-8 space-y-6 animate-in zoom-in-95">
            <div className="flex justify-between items-center">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.3em] text-red-500">Danger Zone</p>
                <h3 className="text-2xl font-black text-slate-900">Confirm Delete</h3>
              </div>
              <button type="button" onClick={() => setDeleteTargetUser(null)} className="p-2 hover:bg-slate-100 rounded-full text-slate-400 transition-colors">
                <XIcon className="w-5 h-5" />
              </button>
            </div>
            <div className="rounded-2xl bg-red-50 border border-red-100 p-5 text-center">
              <div className="mx-auto w-16 h-16 bg-red-500/10 rounded-2xl flex items-center justify-center mb-4 text-red-600">
                <Trash2Icon className="w-8 h-8" />
              </div>
              <p className="text-sm text-slate-600 mb-1">You are about to remove staff account</p>
              <p className="font-black text-lg text-slate-900">{deleteTargetUser.name}</p>
              <p className="text-xs text-slate-500 mt-1">{deleteTargetUser.email}</p>
              <p className="text-xs uppercase tracking-[0.2em] text-red-500 font-bold mt-4">This action cannot be undone</p>
            </div>
            <div className="flex gap-3">
              <button type="button" onClick={() => setDeleteTargetUser(null)} className="flex-1 py-3 rounded-xl border border-slate-200 text-slate-700 font-black uppercase tracking-wider text-xs hover:bg-slate-50 transition-all cursor-pointer">
                Cancel
              </button>
              <button type="button" onClick={() => handleDeleteUser(deleteTargetUser.id)} className="flex-1 py-3 rounded-xl bg-red-600 text-white font-black uppercase tracking-wider text-xs hover:bg-red-700 transition-all shadow-md shadow-red-600/20 cursor-pointer">
                Delete User
              </button>
            </div>
          </div>
        </div>
      )}

      {/* RESET PASSWORD MODAL */}
      {showResetPasswordModal && resetPasswordUser && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-[100] p-4">
          <form onSubmit={handleResetPassword} className="bg-white rounded-3xl shadow-2xl w-full max-w-md p-8 space-y-5 animate-in zoom-in-95">
            <div className="flex justify-between items-center mb-2">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-slate-100 text-slate-700 flex items-center justify-center shadow-inner">
                  <LockIcon className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-black text-lg text-slate-900">Reset Staff Password</h3>
                  <p className="text-xs text-slate-500 font-medium">Assign a new login password for this account.</p>
                </div>
              </div>
              <button type="button" onClick={() => setShowResetPasswordModal(false)} className="p-2 hover:bg-slate-100 rounded-full text-slate-400 transition-colors">
                <XIcon className="w-5 h-5" />
              </button>
            </div>
            
            <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 text-xs font-bold text-amber-900 leading-relaxed text-left">
              Resetting password for: <strong>{resetPasswordUser.name}</strong> ({resetPasswordUser.email})
            </div>

            <div className="text-left">
              <label className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-1.5 block">New Password</label>
              <input
                type="password"
                required
                className="w-full px-4 py-3 border border-slate-200 rounded-xl outline-none focus:ring-2 focus:ring-[#DAA520] font-bold text-slate-900 text-sm"
                value={newPassword}
                onChange={e => setNewPassword(e.target.value)}
                placeholder="Minimum 6 characters"
              />
            </div>

            <div className="flex gap-3 pt-4 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setShowResetPasswordModal(false)}
                className="flex-1 py-3.5 font-black text-slate-600 hover:bg-slate-100 rounded-xl uppercase tracking-widest text-xs transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="flex-1 py-3.5 font-black bg-[#DAA520] hover:bg-[#B8860B] text-white rounded-xl shadow-lg shadow-[#DAA520]/20 uppercase tracking-widest text-xs transition-all cursor-pointer"
              >
                Save New Password
              </button>
            </div>
          </form>
        </div>
      )}

      {/* QUOTA BOUNDARY MODAL ALERT */}
      {showQuotaModal && (
        <div className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center z-[110] p-4">
          <div className="bg-white rounded-3xl shadow-2xl w-full max-w-md p-6 sm:p-8 space-y-6 animate-in zoom-in-95 border border-slate-100">
            <div className="flex justify-between items-start">
              <div className="w-12 h-12 rounded-2xl bg-red-50 text-red-600 flex items-center justify-center shadow-inner">
                <LockIcon className="w-6 h-6" />
              </div>
              <button
                type="button"
                onClick={() => setShowQuotaModal(false)}
                className="p-2 hover:bg-slate-100 rounded-full text-slate-400 transition-colors cursor-pointer"
              >
                <XIcon className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-2">
              <span className="px-2.5 py-1 text-[10px] font-black uppercase rounded-full bg-red-100 text-red-700 border border-red-200 inline-block">
                Staff Quota Limit Reached (3/3 Staff)
              </span>
              <h3 className="text-xl font-black text-slate-900">
                Staff Account Limit Reached
              </h3>
              <p className="text-xs text-slate-600 font-medium leading-relaxed">
                All <strong>3 additional staff account slots</strong> are currently in use on this license. Your system supports 1 Root Super Admin plus 3 dedicated staff accounts (4 total accounts).
              </p>
            </div>

            <div className="p-4 bg-slate-50 rounded-2xl border border-slate-200 space-y-2 text-xs">
              <div className="font-bold text-slate-800 flex items-center gap-1.5">
                <span>💡</span> What can you do?
              </div>
              <ul className="space-y-1.5 text-slate-600 font-medium pl-4 list-disc text-[11px]">
                <li>Delete or deactivate an unused staff account to free up a slot.</li>
                <li>Contact support to upgrade your enterprise license for multi-branch/multi-staff seats.</li>
              </ul>
            </div>

            <div className="p-3.5 bg-amber-50 rounded-2xl border border-amber-200 text-xs flex items-center justify-between">
              <div>
                <div className="text-[10px] font-black uppercase text-amber-800 tracking-wider">License & Upgrade Support</div>
                <div className="font-black text-slate-900 text-sm mt-0.5">077 076 076 7</div>
              </div>
              <a
                href="tel:0770760767"
                className="px-3 py-2 bg-[#DAA520] hover:bg-[#B8860B] text-white font-black text-xs rounded-xl shadow-sm uppercase tracking-wider transition-colors"
              >
                Call Support
              </a>
            </div>

            <button
              type="button"
              onClick={() => setShowQuotaModal(false)}
              className="w-full py-3.5 bg-slate-900 hover:bg-slate-800 text-white font-black text-xs uppercase tracking-widest rounded-xl transition-colors cursor-pointer shadow-md"
            >
              Understood
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
export default Users;
