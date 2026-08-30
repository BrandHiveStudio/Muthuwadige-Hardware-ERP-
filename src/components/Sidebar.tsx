import React, { useState, useEffect, useRef, useCallback } from 'react';
import { 
  LayoutDashboard, 
  Package, 
  ShoppingCart, 
  Truck, 
  Printer, 
  Users, 
  Building2, 
  BarChart3, 
  Wallet, 
  Shield, 
  Database, 
  FileText, 
  Settings as SettingsIcon,
  ChevronLeft, 
  ChevronRight, 
  LogOut 
} from 'lucide-react';
import type { PageName, User } from '../types';
import { hasPermission, hasUserPermission } from '../utils/permissions';
import { supabase } from '../lib/supabaseClient';

const MIN_WIDTH = 220;
const MAX_WIDTH = 380;
const COLLAPSED_WIDTH = 72;

export interface SidebarProps {
  currentPage: PageName;
  setCurrentPage: (page: PageName) => void;
  currentUser: User;
  onLogout: () => void;
  isOpen: boolean;
  onClose: () => void;
  setSalesTab?: (tab: 'new' | 'history' | 'credit' | 'credit_history' | 'quotes') => void;
}

interface NavItemDef {
  id: PageName;
  label: string;
  icon: React.ReactNode;
  capability?: string;
}

interface NavGroupDef {
  label: string;
  items: NavItemDef[];
}

const navGroups: NavGroupDef[] = [
  {
    label: '',
    items: [{ id: 'dashboard', label: 'Dashboard', icon: <LayoutDashboard size={18} />, capability: 'dashboard' }]
  },
  {
    label: 'OPERATIONS',
    items: [
      { id: 'inventory', label: 'Inventory', icon: <Package size={18} />, capability: 'inventory' },
      { id: 'sales', label: 'Sales & Billing', icon: <ShoppingCart size={18} />, capability: 'pos_create_sales' },
      { id: 'purchasing', label: 'Purchasing', icon: <Truck size={18} />, capability: 'po_create_and_receive' },
      { id: 'barcode-print', label: 'Barcode Printing', icon: <Printer size={18} />, capability: 'barcode-print' }
    ]
  },
  {
    label: 'MANAGEMENT',
    items: [
      { id: 'customers', label: 'Customers', icon: <Users size={18} />, capability: 'customers' },
      { id: 'suppliers', label: 'Suppliers', icon: <Building2 size={18} />, capability: 'po_create_and_receive' }
    ]
  },
  {
    label: 'FINANCE',
    items: [
      { id: 'reports', label: 'Reports', icon: <BarChart3 size={18} />, capability: 'reports_view_financials' },
      { id: 'finance', label: 'Finance & Accounts', icon: <Wallet size={18} />, capability: 'reports_view_financials' }
    ]
  },
  {
    label: 'ADMINISTRATION',
    items: [
      { id: 'users', label: 'Users & Roles', icon: <Shield size={18} />, capability: 'users' },
      { id: 'database', label: 'Database', icon: <Database size={18} />, capability: 'system_backup_manage' },
      { id: 'audit_logs', label: 'Audit Logs', icon: <FileText size={18} />, capability: 'audit_logs' }
    ]
  },
  {
    label: 'SYSTEM',
    items: [
      { id: 'settings', label: 'Settings', icon: <SettingsIcon size={18} />, capability: 'system_backup_manage' }
    ]
  }
];

export function Sidebar({
  currentPage,
  setCurrentPage,
  currentUser,
  onLogout,
  isOpen,
  onClose,
  setSalesTab
}: SidebarProps) {
  // Load saved preferences
  const [isCollapsed, setIsCollapsed] = useState<boolean>(() => {
    return localStorage.getItem('sidebar_collapsed') === 'true';
  });
  
  const [sidebarWidth, setSidebarWidth] = useState<number>(() => {
    const saved = localStorage.getItem('sidebar_width');
    return saved ? parseInt(saved, 10) : 260;
  });

  const [shopSettings, setShopSettings] = useState<any>(null);
  const [, setPermissionsTick] = useState(0);
  const isResizingRef = useRef(false);

  const fetchSettings = async () => {
    try {
      const { data } = await supabase.from('system_settings').select('*').single();
      if (data) setShopSettings(data);
    } catch (_) {}
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

  // Toggle Collapse
  const toggleCollapse = () => {
    setIsCollapsed(prev => {
      const next = !prev;
      localStorage.setItem('sidebar_collapsed', String(next));
      return next;
    });
  };

  // Cursor Drag Resizing Handlers
  const startResizing = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isResizingRef.current = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    const handleMouseMove = (event: MouseEvent) => {
      if (!isResizingRef.current) return;
      let newWidth = event.clientX;
      if (newWidth < MIN_WIDTH) newWidth = MIN_WIDTH;
      if (newWidth > MAX_WIDTH) newWidth = MAX_WIDTH;
      setSidebarWidth(newWidth);
      if (isCollapsed) {
        setIsCollapsed(false);
        localStorage.setItem('sidebar_collapsed', 'false');
      }
    };

    const handleMouseUp = () => {
      if (!isResizingRef.current) return;
      isResizingRef.current = false;
      document.body.style.cursor = 'default';
      document.body.style.userSelect = 'auto';
      setSidebarWidth(currentW => {
        localStorage.setItem('sidebar_width', String(currentW));
        return currentW;
      });
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  }, [isCollapsed]);

  const currentWidth = isCollapsed ? COLLAPSED_WIDTH : sidebarWidth;

  // PERMISSION FILTERING LOGIC
  const filteredNavGroups = navGroups
    .map(group => ({
      ...group,
      items: group.items.filter(item => hasPermission(currentUser, item.capability || item.id))
    }))
    .filter(group => group.items.length > 0);

  const handleNavClick = (pageId: PageName) => {
    if (pageId === 'sales') {
      if (setSalesTab) setSalesTab('new');
      window.dispatchEvent(new Event('reset-new-sale'));
    }
    setCurrentPage(pageId);
    onClose();
  };

  const storeName = shopSettings?.shop_name || 'MUTHUWADIGE HARDWARE';
  const nameParts = storeName.split(' ');
  const firstWord = nameParts[0] || 'Muthuwadige';
  const restWords = nameParts.slice(1).join(' ') || 'Hardware';

  return (
    <>
      {/* Mobile Backdrop Overlay */}
      {isOpen && (
        <div
          className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[40] lg:hidden transition-opacity duration-300"
          onClick={onClose}
          aria-hidden="true"
        />
      )}

      <aside
        style={{ width: `${currentWidth}px` }}
        className={`fixed top-0 left-0 h-screen z-[50] lg:static lg:z-30 flex flex-col bg-[#2e3135] text-gray-200 border-r border-[#3d4248] transition-[width] duration-150 ease-out select-none flex-shrink-0 shadow-2xl lg:shadow-none
          ${isOpen ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}`}
      >
        {/* Resizer Handle (Cursor Adjuster) - Active on Desktop */}
        <div
          onMouseDown={startResizing}
          className="hidden lg:block absolute top-0 right-0 w-1.5 h-full cursor-col-resize hover:bg-amber-500/60 active:bg-amber-500 transition-colors z-30"
          title="Drag to resize sidebar width"
        />

        {/* Header & Brand with Collapse Button */}
        <div className="flex items-center justify-between p-3 border-b border-[#3d4248] min-h-[64px]">
          <div className="flex items-center gap-2.5 overflow-hidden">
            <div className="w-10 h-10 rounded-xl bg-white p-1 flex items-center justify-center flex-shrink-0 shadow-sm">
              <img 
                src={shopSettings?.logo_path || "./images/logo.png"} 
                alt="Logo" 
                className="w-full h-full object-contain"
                onError={(e) => { e.currentTarget.style.display = 'none'; }}
              />
            </div>
            {!isCollapsed && (
              <div className="flex flex-col truncate text-left">
                <span className="font-black text-sm tracking-wide uppercase text-white leading-tight truncate">
                  {firstWord}
                </span>
                <span className="font-extrabold text-xs text-amber-500 uppercase tracking-wider truncate">
                  {restWords}
                </span>
              </div>
            )}
          </div>

          {/* Collapse / Expand Toggle Button */}
          <button
            onClick={toggleCollapse}
            className="p-1.5 rounded-lg bg-[#3d4248] hover:bg-[#4d535b] text-gray-300 hover:text-white transition flex-shrink-0"
            title={isCollapsed ? "Expand Sidebar" : "Collapse Sidebar"}
          >
            {isCollapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
          </button>
        </div>

        {/* Navigation List */}
        <div className="flex-1 overflow-y-auto px-2 py-3 space-y-4 custom-scrollbar">
          {filteredNavGroups.map((group, gIdx) => (
            <div key={gIdx} className="space-y-1">
              {!isCollapsed && group.label && (
                <p className="px-2.5 pt-2 pb-1 text-[10px] font-bold tracking-wider uppercase text-gray-400 text-left">
                  {group.label}
                </p>
              )}
              {group.items.map(item => {
                const isActive = currentPage === item.id || (item.id === 'barcode-print' && (currentPage === 'barcode_print' || currentPage === 'barcodes'));
                return (
                  <NavItem
                    key={item.id}
                    icon={item.icon}
                    label={item.label}
                    active={isActive}
                    collapsed={isCollapsed}
                    onClick={() => handleNavClick(item.id)}
                  />
                );
              })}
            </div>
          ))}
        </div>

        {/* User Footer Profile */}
        <div className="p-2 border-t border-[#3d4248] bg-[#282b2e]">
          <div className={`flex items-center ${isCollapsed ? 'justify-center' : 'justify-between'} p-1.5`}>
            <div className="flex items-center gap-2.5 overflow-hidden">
              <div className="w-8 h-8 rounded-lg bg-amber-500 text-gray-950 font-black flex items-center justify-center flex-shrink-0 text-sm shadow-sm uppercase">
                {currentUser?.avatar || currentUser?.name?.charAt(0) || 'S'}
              </div>
              {!isCollapsed && (
                <div className="flex flex-col truncate text-left">
                  <span className="text-xs font-bold text-white truncate">
                    {currentUser?.name || 'User'}
                  </span>
                  <span className="text-[9px] font-black text-amber-400 uppercase tracking-tighter">
                    {currentUser?.role?.replace('_', ' ') || 'USER'}
                  </span>
                </div>
              )}
            </div>
            {!isCollapsed && (
              <button
                onClick={onLogout}
                className="p-1.5 text-gray-400 hover:text-rose-400 hover:bg-white/5 rounded-lg transition"
                title="Sign Out"
              >
                <LogOut size={16} />
              </button>
            )}
          </div>
        </div>
      </aside>
    </>
  );
}

// Reusable NavItem Component
interface NavItemProps {
  icon: React.ReactNode;
  label: string;
  active: boolean;
  collapsed: boolean;
  onClick: () => void;
}

function NavItem({ icon, label, active, collapsed, onClick }: NavItemProps) {
  return (
    <button
      onClick={onClick}
      title={collapsed ? label : undefined}
      className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-xs font-medium transition-all ${
        active
          ? 'bg-amber-500 text-gray-950 font-bold shadow-md shadow-amber-500/20'
          : 'text-gray-300 hover:bg-[#3d4248] hover:text-white'
      } ${collapsed ? 'justify-center px-0' : 'text-left'}`}
    >
      <span className="flex-shrink-0">{icon}</span>
      {!collapsed && <span className="truncate flex-1 font-semibold text-[13px]">{label}</span>}
    </button>
  );
}