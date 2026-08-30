import React, { useState } from 'react';
import { SearchIcon, BellIcon, MenuIcon, RotateCw } from 'lucide-react';
import type { User, PageName } from '../types';

interface HeaderProps {
  currentPage: PageName;
  currentUser: User;
  onMenuToggle: () => void;
  // NEW PROPS ADDED HERE:
  onSearch?: (query: string) => void;
  onNotificationClick?: () => void;
  onRefresh?: () => void;
  unreadNotifications?: number; 
}

const pageTitles: Partial<
  Record<
    PageName,
    {
      title: string;
      breadcrumb: string;
    }
  >
> = {
  dashboard: { title: 'Dashboard', breadcrumb: 'Home / Dashboard' },
  inventory: { title: 'Inventory Management', breadcrumb: 'Operations / Inventory' },
  sales: { title: 'Sales & Billing', breadcrumb: 'Operations / Sales' },
  purchasing: { title: 'Purchasing', breadcrumb: 'Operations / Purchasing' },
  customers: { title: 'Customer Management', breadcrumb: 'Management / Customers' },
  suppliers: { title: 'Supplier Management', breadcrumb: 'Management / Suppliers' },
  reports: { title: 'Reports & Analytics', breadcrumb: 'Finance / Reports' },
  users: { title: 'Users & Roles', breadcrumb: 'System / Users & Roles' },
  database: { title: 'Database', breadcrumb: 'System / Database' },
  settings: { title: 'Settings', breadcrumb: 'System / Settings' },
  finance: { title: 'Finance Ledger', breadcrumb: 'Finance / Ledger' },
  audit_logs: { title: 'Audit Logs', breadcrumb: 'System / Audit Logs' },
  'barcode-print': { title: 'Barcode Printing', breadcrumb: 'Operations / Barcode Printing' },
  barcode_print: { title: 'Barcode Printing', breadcrumb: 'Operations / Barcode Printing' },
  barcodes: { title: 'Barcode Printing', breadcrumb: 'Operations / Barcode Printing' }
};

const roleColors: Record<string, string> = {
  admin: 'bg-red-100 text-red-700',
  manager: 'bg-blue-100 text-blue-700',
  cashier: 'bg-green-100 text-green-700'
};

export function Header({
  currentPage,
  currentUser,
  onMenuToggle,
  onSearch,
  onNotificationClick,
  onRefresh,
  unreadNotifications = 0 // Default to 0
}: HeaderProps) {
  const [searchValue, setSearchValue] = useState('');
  const [isRefreshing, setIsRefreshing] = useState(false);
  const pageInfo = pageTitles[currentPage] || { title: 'Hardware Store ERP', breadcrumb: 'System' };

  const handleGlobalRefresh = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (isRefreshing) return;

    setIsRefreshing(true);

    try {
      // 1. Clear any active input focus to unbind keyboard capture
      if (typeof document !== 'undefined' && document.activeElement instanceof HTMLElement) {
        document.activeElement.blur();
      }

      // 2. Execute custom onRefresh callback if provided
      if (onRefresh) {
        await Promise.resolve(onRefresh());
      }

      // 3. Trigger Electron IPC renderer cache flush if running in Electron
      const win = typeof window !== 'undefined' ? (window as any) : null;
      if (win?.electronAPI?.clearRendererCache) {
        try {
          await win.electronAPI.clearRendererCache();
        } catch (_) {}
      }

      // 4. Clean up any stuck DOM modals/overlays (leave permanent root)
      if (typeof document !== 'undefined') {
        document.querySelectorAll('.modal-backdrop, [role="dialog"]').forEach(el => {
          if (!el.classList.contains('permanent') && !el.closest('#root')) {
            el.remove();
          }
        });
      }

      // 5. Broadcast single synchronized refresh events to all modules without reloading window
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('app:force-sync-data'));
        window.dispatchEvent(new CustomEvent('refresh-all-data'));
        window.dispatchEvent(new CustomEvent('settings-updated'));
      }

      // 6. Trigger non-blocking orange glowing pulse on manual refresh
      if (typeof document !== 'undefined') {
        const elements = document.querySelectorAll(
          '.bg-white, .rounded-2xl, .rounded-xl, .card, input, select, textarea'
        );
        elements.forEach((el) => {
          el.classList.add('erp-refresh-active');
        });
        setTimeout(() => {
          elements.forEach((el) => {
            el.classList.remove('erp-refresh-active');
          });
        }, 800);
      }
    } catch (err) {
      console.error('Page refresh error:', err);
    } finally {
      setTimeout(() => {
        setIsRefreshing(false);
      }, 700);
    }
  };

  // Handle search input changes
  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const query = e.target.value;
    setSearchValue(query);
    // Pass the search query up to the parent component
    if (onSearch) {
      onSearch(query);
    }
  };

  return (
    <header className="h-16 bg-white border-b border-slate-200 flex items-center px-4 sm:px-6 gap-4 sticky top-0 z-10">
      {/* Mobile menu button */}
      <button
        onClick={onMenuToggle}
        className="lg:hidden w-9 h-9 flex items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 transition-colors"
        aria-label="Toggle menu"
      >
        <MenuIcon className="w-5 h-5" />
      </button>

      {/* Page title */}
      <div className="flex-1 min-w-0">
        <h1 className="text-lg font-bold text-slate-900 leading-none">
          {pageInfo.title}
        </h1>
        <p className="text-xs text-slate-400 mt-0.5 hidden sm:block">{pageInfo.breadcrumb}</p>
      </div>

      {/* Refresh Page Button */}
      <button
        type="button"
        onClick={handleGlobalRefresh}
        disabled={isRefreshing}
        className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100 hover:text-amber-600 hover:border-amber-300 transition-colors text-xs font-semibold disabled:opacity-50 shadow-sm"
        title="Refresh Data"
        aria-label="Refresh Data"
      >
        <RotateCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin text-amber-600' : ''}`} />
        <span>{isRefreshing ? 'Syncing...' : 'Refresh'}</span>
      </button>



      {/* Notifications */}
      <button
        onClick={onNotificationClick}
        className="relative w-9 h-9 flex items-center justify-center rounded-lg text-slate-500 hover:bg-slate-100 transition-colors"
        aria-label="Notifications"
      >
        <BellIcon className="w-5 h-5" />
        {/* Only show the red dot if there are actual unread notifications */}
        {unreadNotifications > 0 && (
          <span
            className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 bg-[#DAA520] text-white rounded-full flex items-center justify-center text-[9px] font-black border-2 border-white shadow-md animate-pulse"
            aria-hidden="true" 
          >
            {unreadNotifications}
          </span>
        )}
      </button>

      {/* User avatar */}
      <div className="flex items-center gap-3">
        <div className="hidden sm:block text-right">
          <p className="text-sm font-medium text-slate-900 leading-none">
            {currentUser.name}
          </p>
          <span
            className={`text-xs px-1.5 py-0.5 rounded font-medium capitalize inline-block mt-1 ${roleColors[currentUser.role]}`}
          >
            {currentUser.role}
          </span>
        </div>
        <div className="w-9 h-9 bg-orange-500 rounded-full flex items-center justify-center text-white text-sm font-bold flex-shrink-0 uppercase">
          {/* Fallback to initials if avatar isn't provided */}
          {currentUser.avatar || currentUser.name.charAt(0)}
        </div>
      </div>
    </header>
  );
}