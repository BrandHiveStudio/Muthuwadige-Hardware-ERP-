import React, { useState, useCallback } from 'react';

export interface RefreshButtonProps {
  onRefresh?: () => Promise<void> | void;
  className?: string;
  showText?: boolean;
}

export const AppRefreshButton: React.FC<RefreshButtonProps> = ({
  onRefresh,
  className = '',
  showText = true
}) => {
  const [isRefreshing, setIsRefreshing] = useState(false);

  const handleDeepRefresh = useCallback(async () => {
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

      // 3. Trigger Electron IPC renderer garbage collection / cache flush if running in Electron
      const win = typeof window !== 'undefined' ? (window as any) : null;
      if (win?.electronAPI?.clearRendererCache) {
        try {
          await win.electronAPI.clearRendererCache();
        } catch (_) {}
      }

      // 4. Clean up any stuck DOM modals/overlays (leave permanent ones)
      if (typeof document !== 'undefined') {
        document.querySelectorAll('.modal-backdrop, [role="dialog"]').forEach(el => {
          if (!el.classList.contains('permanent') && !el.closest('#root')) {
            el.remove();
          }
        });
      }

      // 5. Trigger internal state reload events without triggering window.location.reload()
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('app:force-sync-data'));
        window.dispatchEvent(new CustomEvent('refresh-all-data'));
        window.dispatchEvent(new CustomEvent('settings-updated'));
      }
    } catch (err) {
      console.error('Deep refresh encountered an error:', err);
    } finally {
      setTimeout(() => {
        setIsRefreshing(false);
      }, 700);
    }
  }, [isRefreshing, onRefresh]);

  return (
    <button
      type="button"
      onClick={handleDeepRefresh}
      disabled={isRefreshing}
      className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-slate-700 bg-white border border-slate-200 rounded-xl hover:bg-slate-50 hover:text-amber-600 hover:border-amber-300 active:scale-95 transition-all shadow-sm disabled:opacity-60 ${className}`}
      title="Force Refresh App State & Sync Data"
    >
      <svg
        className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin text-amber-600' : 'text-slate-500'}`}
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth="2"
          d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
        />
      </svg>
      {showText && <span>{isRefreshing ? 'Syncing...' : 'Refresh'}</span>}
    </button>
  );
};

export const RefreshButton = AppRefreshButton;
export default AppRefreshButton;
