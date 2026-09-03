import React, { useState, useEffect, useCallback } from 'react';
import { SearchIcon, BellIcon, MenuIcon, RotateCw, RefreshCw } from 'lucide-react';
import type { User, PageName, SyncStatus } from '../types';
import { api } from '../lib/api';

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
  const [syncStatus, setSyncStatus] = useState<SyncStatus | null>(null);
  const [isManualSyncing, setIsManualSyncing] = useState(false);
  const pageInfo = pageTitles[currentPage] || { title: 'Hardware Store ERP', breadcrumb: 'System' };

  const fetchSyncStatus = useCallback(async () => {
    try {
      const data = await api.sync.getStatus();
      setSyncStatus(data);
    } catch (_) {
      setSyncStatus(prev => prev ? { ...prev, isOnline: false } : {
        isOnline: false,
        isWebClient: false,
        lastSyncedAt: null,
        pendingCount: 0,
        isSyncing: false
      });
    }
  }, []);

  useEffect(() => {
    fetchSyncStatus();
    const interval = setInterval(fetchSyncStatus, 10000);
    const handleFocus = () => fetchSyncStatus();
    window.addEventListener('focus', handleFocus);
    return () => {
      clearInterval(interval);
      window.removeEventListener('focus', handleFocus);
    };
  }, [fetchSyncStatus]);

  const handleManualSync = async () => {
    if (isManualSyncing || syncStatus?.isSyncing) return;
    setIsManualSyncing(true);
    try {
      const res = await api.sync.triggerSync();
      setSyncStatus(res);
    } catch (_) {
    } finally {
      setIsManualSyncing(false);
      fetchSyncStatus();
    }
  };

  const formatTimeAgo = (isoString: string | null | undefined) => {
    if (!isoString) return 'Just now';
    const diffMs = Date.now() - new Date(isoString).getTime();
    if (isNaN(diffMs) || diffMs < 0 || diffMs < 60000) return 'Just now';
    const mins = Math.floor(diffMs / 60000);
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  };

  const formatWebTimestamp = (isoString: string | null | undefined) => {
    if (!isoString) return 'Never';
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return 'Never';
    const today = new Date();
    const isToday = d.toDateString() === today.toDateString();
    const timeStr = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    if (isToday) return `Today at ${timeStr}`;
    return `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })} at ${timeStr}`;
  };

  const isWebActive = Boolean(
    syncStatus?.lastSyncedAt &&
    (Date.now() - new Date(syncStatus.lastSyncedAt).getTime() < 30 * 60 * 1000)
  );

  const handleGlobalRefresh = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (isRefreshing) return;

    setIsRefreshing(true);

    try {
      if (typeof document !== 'undefined' && document.activeElement instanceof HTMLElement) {
        document.activeElement.blur();
      }

      if (onRefresh) {
        try {
          await Promise.resolve(onRefresh());
        } catch (_) {}
      }

      const win = typeof window !== 'undefined' ? (window as any) : null;
      if (win?.electronAPI?.reload) {
        await Promise.resolve(win.electronAPI.reload());
        return;
      }
    } catch (err) {
      console.error('Window reload error:', err);
    }
    window.location.reload();
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
    <header className="h-16 bg-white border-b border-slate-200 flex items-center px-4 sm:px-6 gap-3 sticky top-0 z-10">
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

      {/* Live Sync Status Pill */}
      {syncStatus?.isWebClient ? (
        // Web Portal View
        isWebActive ? (
          <div
            className="hidden md:flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200 shadow-sm select-none"
            title={`Store counter heartbeat active. Last counter sync: ${syncStatus?.lastSyncedAt ? new Date(syncStatus.lastSyncedAt).toLocaleString() : 'Never'}`}
          >
            <span>Counter Last Synced: {formatWebTimestamp(syncStatus?.lastSyncedAt)} • Database Status: Live 🟢</span>
          </div>
        ) : (
          <div
            className="hidden md:flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold bg-amber-50 text-amber-700 border border-amber-200 shadow-sm select-none"
            title={`Store counter has not synced for > 30 minutes. Last sync: ${syncStatus?.lastSyncedAt ? new Date(syncStatus.lastSyncedAt).toLocaleString() : 'Never'}`}
          >
            <span>Counter Last Synced: {formatWebTimestamp(syncStatus?.lastSyncedAt)} • Status: Counter Inactive / Offline 🟠</span>
          </div>
        )
      ) : (
        // Desktop Electron App (Local Counter)
        (syncStatus?.isSyncing || isManualSyncing) ? (
          <div
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold bg-blue-50 text-blue-700 border border-blue-200 shadow-sm animate-pulse select-none"
            title="Synchronizing pending local mutations with Turso Cloud..."
          >
            <RefreshCw className="w-3.5 h-3.5 animate-spin text-blue-600" />
            <span>🔄 Syncing {syncStatus?.pendingCount ? `${syncStatus.pendingCount} pending sales...` : 'with cloud...'}</span>
          </div>
        ) : (syncStatus && !syncStatus.isOnline) ? (
          <button
            type="button"
            onClick={handleManualSync}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold bg-amber-50 text-amber-700 border border-amber-200 shadow-sm hover:bg-amber-100 transition-colors"
            title="Local POS is fully operational. Transactions are queued safely in local database and will automatically sync when network restores. Click to retry sync."
          >
            <span>🟠 Offline ({syncStatus.pendingCount} sales queued locally)</span>
          </button>
        ) : (
          <button
            type="button"
            onClick={handleManualSync}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200 shadow-sm hover:bg-emerald-100 transition-colors"
            title={`All local transactions synced with Turso Cloud. Last synced: ${syncStatus?.lastSyncedAt ? new Date(syncStatus.lastSyncedAt).toLocaleString() : 'Just now'}. Click to trigger sync now.`}
          >
            <span>🟢 Synced {formatTimeAgo(syncStatus?.lastSyncedAt)}</span>
          </button>
        )
      )}

      {/* Refresh Page Button */}
      <button
        type="button"
        onClick={handleGlobalRefresh}
        disabled={isRefreshing}
        className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100 hover:text-amber-600 hover:border-amber-300 transition-colors text-xs font-semibold disabled:opacity-50 shadow-sm"
        title="Reload Application Window (Ctrl+R)"
        aria-label="Reload Application Window"
      >
        <RotateCw className={`w-4 h-4 ${isRefreshing ? 'animate-spin text-amber-600' : ''}`} />
        <span>{isRefreshing ? 'Reloading...' : 'Reload'}</span>
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