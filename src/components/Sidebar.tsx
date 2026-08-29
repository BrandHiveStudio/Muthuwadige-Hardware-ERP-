import React, { useState, useEffect } from 'react';
import {
  LayoutDashboardIcon,
  PackageIcon,
  ShoppingCartIcon,
  TruckIcon,
  UsersIcon,
  DollarSignIcon,
  BarChart3Icon,
  SettingsIcon,
  DatabaseIcon,
  ShieldIcon,
  ChevronRightIcon,
  LogOutIcon,
  PrinterIcon
} from 'lucide-react';
import type { PageName, User } from '../types';
import { ROLE_PERMISSIONS, hasUserPermission } from '../utils/permissions';
import { supabase } from '../lib/supabaseClient';

interface SidebarProps {
  currentPage: PageName;
  setCurrentPage: (page: PageName) => void;
  currentUser: User;
  onLogout: () => void;
  isOpen: boolean;
  onClose: () => void;
  setSalesTab?: (tab: 'new' | 'history' | 'credit' | 'credit_history' | 'quotes') => void;
}

interface NavItem {
  id: PageName;
  label: string;
  icon: React.ReactNode;
}

interface NavGroup {
  label: string;
  items: NavItem[];
}

const navGroups: NavGroup[] = [
  {
    label: '',
    items: [{ id: 'dashboard', label: 'Dashboard', icon: <LayoutDashboardIcon className="w-5 h-5" /> }]
  },
  {
    label: 'OPERATIONS',
    items: [
      { id: 'inventory', label: 'Inventory', icon: <PackageIcon className="w-5 h-5" /> },
      { id: 'sales', label: 'Sales & Billing', icon: <ShoppingCartIcon className="w-5 h-5" /> },
      { id: 'purchasing', label: 'Purchasing', icon: <TruckIcon className="w-5 h-5" /> },
      { id: 'barcode-print', label: 'Barcode Printing', icon: <PrinterIcon className="w-5 h-5" /> }
    ]
  },
  {
    label: 'MANAGEMENT',
    items: [
      { id: 'customers', label: 'Customers', icon: <UsersIcon className="w-5 h-5" /> },
      { id: 'suppliers', label: 'Suppliers', icon: <TruckIcon className="w-5 h-5" /> }
    ]
  },
  {
    label: 'FINANCE',
    items: [
      { id: 'reports', label: 'Reports', icon: <BarChart3Icon className="w-5 h-5" /> },
      { id: 'finance', label: 'Finance & Accounts', icon: <DollarSignIcon className="w-5 h-5" /> }
    ]
  },
  {
    label: 'ADMINISTRATION',
    items: [
      { id: 'users', label: 'Users & Roles', icon: <ShieldIcon className="w-5 h-5" /> },
      { id: 'database', label: 'Database', icon: <DatabaseIcon className="w-5 h-5" /> },
      { id: 'audit_logs', label: 'Audit Logs', icon: <ShieldIcon className="w-5 h-5" /> }
    ]
  },
  {
    label: 'SYSTEM',
    items: [
      { id: 'settings', label: 'Settings', icon: <SettingsIcon className="w-5 h-5" /> }
    ]
  }
];

const roleColors: Record<string, string> = {
  Admin: 'bg-purple-500/20 text-purple-300',
  Manager: 'bg-blue-500/20 text-blue-300',
  Cashier: 'bg-emerald-500/20 text-emerald-300',
  admin: 'bg-purple-500/20 text-purple-300',
  manager: 'bg-blue-500/20 text-blue-300',
  cashier: 'bg-emerald-500/20 text-emerald-300'
};

export function Sidebar({
  currentPage,
  setCurrentPage,
  currentUser,
  onLogout,
  isOpen,
  onClose,
  setSalesTab
}: SidebarProps) {
  
  const [, setPermissionsTick] = useState(0);
  const [shopSettings, setShopSettings] = useState<any>(null);

  const fetchSettings = async () => {
    try {
      const { data } = await supabase.from('system_settings').select('*').single();
      if (data) setShopSettings(data);
    } catch (e) {}
  };

  useEffect(() => {
    fetchSettings();
    const handlePermsUpdate = () => setPermissionsTick(t => t + 1);
    window.addEventListener('permissions-updated', handlePermsUpdate);
    window.addEventListener('settings-updated', fetchSettings);
    return () => {
      window.removeEventListener('permissions-updated', handlePermsUpdate);
      window.removeEventListener('settings-updated', fetchSettings);
    };
  }, []);

  // PERMISSION FILTERING LOGIC
  const filteredNavGroups = navGroups
    .map(group => ({
      ...group,
      items: group.items.filter(item => hasUserPermission(currentUser, item.id))
    }))
    .filter(group => group.items.length > 0);

  return (
    <>
      {/* Mobile overlay */}
      {isOpen && (
        <div
          className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[40] lg:hidden transition-opacity duration-300"
          onClick={onClose}
          aria-hidden="true"
        />
      )}

      {/* Sidebar - Changed background to Dark Silver (#464646) to match invoice */}
      <aside
        className={`fixed top-0 left-0 h-full w-64 bg-[#464646] flex flex-col z-[50] transition-transform duration-300 ease-in-out border-r border-[#5a5a5a] shadow-2xl
          ${isOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}`}
      >

        {/* Logo & Brand Section */}
        <div className="flex items-center gap-3 px-5 py-6 border-b border-[#5a5a5a]">
          {/* Logo container with a white background to make the PNG pop */}
          <div className="w-12 h-12 bg-white rounded-xl flex items-center justify-center flex-shrink-0 shadow-lg p-1">
            <img 
              src={shopSettings?.logo_path || "./images/logo.png"} 
              alt="Muthuwadige Logo" 
              className="w-full h-full object-contain"
              onError={(e) => { e.currentTarget.style.display = 'none'; }} // Hides image icon if image fails to load
            />
          </div>
          <div className="flex flex-col justify-center text-left">
            <span className="text-white font-bold text-[15px] tracking-tight leading-none mb-1">
              {(shopSettings?.shop_name || 'MUTHUWADIGE HARDWARE').split(' ')[0] || ''}
            </span>
            <span className="text-[#DAA520] font-black text-[15px] leading-none">
              {(shopSettings?.shop_name || 'MUTHUWADIGE HARDWARE').split(' ').slice(1).join(' ') || ''}
            </span>
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 overflow-y-auto py-6 px-4 custom-scrollbar">
          {filteredNavGroups.map((group, idx) => (
            <div key={idx} className="mb-6 last:mb-0">
              {group.label && (
                <p className="text-[10px] font-black text-gray-400 uppercase tracking-[0.15em] px-3 mb-3">
                  {group.label}
                </p>
              )}
              <div className="space-y-1">
                {group.items.map((item) => {
                  const isActive = currentPage === item.id;
                  return (
                    <button
                      key={item.id}
                      onClick={() => {
                        if (item.id === 'sales') {
                          if (setSalesTab) setSalesTab('new');
                          window.dispatchEvent(new Event('reset-new-sale'));
                        }
                        setCurrentPage(item.id);
                        onClose(); // Auto close on mobile
                      }}
                      className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-semibold transition-all duration-200 group
                        ${isActive 
                          ? 'bg-[#DAA520] text-white shadow-lg shadow-[#DAA520]/30' // Gold Active State
                          : 'text-gray-300 hover:text-white hover:bg-white/10'}`} // Hover State
                      aria-current={isActive ? 'page' : undefined}
                    >
                      <span className={`${isActive ? 'text-white' : 'text-gray-400 group-hover:text-[#DAA520]'} transition-colors`}>
                        {item.icon}
                      </span>
                      <span className="flex-1 text-left">{item.label}</span>
                      {isActive && (
                        <ChevronRightIcon className="w-4 h-4 text-white/50" />
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        {/* User Profile Card */}
        <div className="border-t border-[#5a5a5a] p-4 bg-black/20">
          <div className="flex items-center gap-3 mb-4 px-2">
            <div className="w-10 h-10 bg-[#DAA520] rounded-xl flex items-center justify-center text-white text-sm font-black shadow-inner shadow-black/20 uppercase">
              {currentUser.avatar || currentUser.name.charAt(0)}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-white text-sm font-bold truncate">
                {currentUser.name}
              </p>
              <span className={`text-[9px] px-2 py-0.5 rounded-full font-black uppercase tracking-tighter ${roleColors[currentUser.role] || 'bg-gray-700 text-gray-300'}`}>
                {currentUser.role.replace('_', ' ')}
              </span>
            </div>
          </div>
          <button
            onClick={onLogout}
            className="w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl text-gray-400 hover:text-white hover:bg-red-500/20 hover:text-red-300 text-xs font-bold uppercase tracking-widest transition-all"
          >
            <LogOutIcon className="w-4 h-4" />
            Sign Out
          </button>
        </div>
      </aside>
    </>
  );
}