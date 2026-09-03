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

  const isElectronApp = typeof window !== 'undefined' && Boolean((window as any).electronAPI);
  const isWeb = !isElectronApp || Boolean(syncStatus?.isWebClient);

  const fetchSyncStatus = useCallback(async () => {
    try {
      const data = await api.sync.getStatus();
      setSyncStatus(data);
    } catch (_) {
      const isElectron = typeof window !== 'undefined' && Boolean((window as any).electronAPI);
      setSyncStatus(prev => prev ? { ...prev, isOnline: false, status: 'offline' } : {
        isOnline: false,
        isWebClient: !isElectron,
        lastUpstreamSync: null,
        lastDownstreamSync: null,
        lastCounterSync: null,
        lastSyncedAt: null,
        queuedCount: 0,
        pendingCount: 0,
        status: 'offline',
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
      window.dispatchEvent(new Event('sync-completed'));
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

  const formatTooltipTime = (isoString: string | null | undefined) => {
    if (!isoString) return 'Not yet synced';
    const d = new Date(isoString);
    if (isNaN(d.getTime())) return 'Not yet synced';
    return d.toLocaleString([], {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
  };

  const handleGlobalRefresh = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (isRefreshing) return;

    setIsRefreshing(true);

    try {
      if (typeof document !== 'undefined' && document.activeElement instanceof HTMLElement) {
        document.activeElement.blur();
      }

      // Trigger immediate bidirectional sync before reloading
      try {
        await api.sync.triggerSync();
        window.dispatchEvent(new Event('sync-completed'));
      } catch (_) {}

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

      {/* Live Sync / Cloud Status Pill */}
      {isWeb ? (
        // Web Cloud Portal (Online App)
        (syncStatus && (syncStatus.status === 'offline' || syncStatus.isOnline === false)) ? (
          <div
            className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold bg-red-50 text-red-700 border border-red-200 shadow-sm select-none"
            title="Unable to reach cloud database server. Please check your internet connection."
          >
            <span>🔴 Cloud Disconnected</span>
          </div>
        ) : (() => {
          const counterTime = syncStatus?.lastCounterSync || syncStatus?.lastSyncedAt;
          const queuedCount = Number(syncStatus?.queuedCount ?? syncStatus?.pendingCount ?? 0);

          if (!counterTime) {
            return (
              <div
                className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200 shadow-sm select-none"
                title="Connected to cloud database. Awaiting initial counter sync."
              >
                <span>🟢 Cloud Connected • Synced: Never • {queuedCount} Queued</span>
              </div>
            );
          }

          const diffMs = Date.now() - new Date(counterTime).getTime();
          const isStale = !isNaN(diffMs) && diffMs >= 30 * 60 * 1000;
          const counterTimeText = formatTimeAgo(counterTime);

          if (isStale) {
            return (
              <div
                className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold bg-amber-50 text-amber-700 border border-amber-200 shadow-sm select-none"
                title={`Connected to cloud database. In-store counter has been inactive for over 30 minutes.\nLast sync: ${formatTooltipTime(counterTime)}`}
              >
                <span>🟠 Cloud Connected • Synced: {counterTimeText} (Inactive) • {queuedCount} Queued</span>
              </div>
            );
          }

          return (
            <div
              className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200 shadow-sm select-none"
              title={`Connected to cloud database. In-store counter sync active.\nLast sync: ${formatTooltipTime(counterTime)}`}
            >
              <span>🟢 Cloud Connected • Synced: {counterTimeText} • {queuedCount} Queued</span>
            </div>
          );
        })()
      ) : (() => {
        // Offline / Desktop Electron App (In-Store POS)
        const isSyncingActive = syncStatus?.status === 'syncing' || syncStatus?.isSyncing || isManualSyncing;
        const isOffline = syncStatus?.status === 'offline' || (syncStatus && syncStatus.isOnline === false);
        const queued = syncStatus?.queuedCount ?? syncStatus?.pendingCount ?? 0;
        const syncTime = syncStatus?.lastUpstreamSync || syncStatus?.lastCounterSync || syncStatus?.lastSyncedAt;

        const desktopTooltip = `Upstream: Last pushed to Super Admin at ${formatTooltipTime(syncStatus?.lastUpstreamSync || syncTime)}\nDownstream: Last pulled catalog/pricing at ${formatTooltipTime(syncStatus?.lastDownstreamSync || syncTime)}\nQueued Records: ${queued} transactions pending upload`;

        if (isSyncingActive) {
          return (
            <div
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold bg-blue-50 text-blue-700 border border-blue-200 shadow-sm animate-pulse select-none"
              title={desktopTooltip}
            >
              <RefreshCw className="w-3.5 h-3.5 animate-spin text-blue-600" />
              <span>🔄 Syncing with Super Admin...</span>
            </div>
          );
        }

        if (isOffline) {
          if (queued > 0) {
            return (
              <button
                type="button"
                onClick={handleManualSync}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold bg-amber-50 text-amber-700 border border-amber-200 shadow-sm hover:bg-amber-100 transition-colors"
                title={`${desktopTooltip}\nClick to retry sync.`}
              >
                <span>🟠 Offline • {queued} sales queued locally</span>
              </button>
            );
          } else {
            return (
              <button
                type="button"
                onClick={handleManualSync}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold bg-slate-100 text-slate-700 border border-slate-200 shadow-sm hover:bg-slate-200 transition-colors"
                title={`${desktopTooltip}\nClick to retry sync.`}
              >
                <span>⚪ Offline (Local Mode)</span>
              </button>
            );
          }
        }

        return (
          <button
            type="button"
            onClick={handleManualSync}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200 shadow-sm hover:bg-emerald-100 transition-colors"
            title={`${desktopTooltip}\nClick to trigger sync now.`}
          >
            <span>🟢 Synced to Super Admin • {formatTimeAgo(syncTime)}</span>
          </button>
        );
      })()}

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