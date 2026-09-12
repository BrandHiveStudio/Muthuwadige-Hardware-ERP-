import { useState, useRef, useCallback } from 'react';
import { api } from '../lib/api';

const TWELVE_HOURS_MS = 12 * 60 * 60 * 1000;

export function useOfflineSyncWarning() {
  const [isOpen, setIsOpen] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const pendingActionRef = useRef<(() => void) | null>(null);

  const checkSyncAndExecute = useCallback(async (action: () => void) => {
    // 1. Quick browser-level offline check
    if (typeof navigator !== 'undefined' && !navigator.onLine) {
      pendingActionRef.current = action;
      setIsOpen(true);
      return;
    }

    // 2. Fetch fresh sync status
    let status: any = null;
    try {
      status = await api.sync.getStatus();
      if (typeof window !== 'undefined') {
        sessionStorage.setItem('erp_last_sync_status', JSON.stringify(status));
      }
    } catch (_) {
      try {
        const cached = sessionStorage.getItem('erp_last_sync_status');
        if (cached) status = JSON.parse(cached);
      } catch (_) {}
    }

    // 3. Evaluate if sync is stale (>12 hrs) or terminal is offline
    const isOffline = !status || status.isOnline === false || status.status === 'offline';
    const lastSync = status?.lastSyncedAt || status?.lastDownstreamSync || status?.lastCounterSync;

    let isStale = false;
    if (!lastSync) {
      // Never synced with cloud
      isStale = true;
    } else {
      const syncTime = new Date(lastSync).getTime();
      if (isNaN(syncTime) || (Date.now() - syncTime > TWELVE_HOURS_MS)) {
        isStale = true;
      }
    }

    if (isOffline || isStale) {
      pendingActionRef.current = action;
      setIsOpen(true);
    } else {
      // Fresh sync within 12 hours -> proceed immediately
      action();
    }
  }, []);

  const handleClose = useCallback(() => {
    // User clicked "Continue Offline"
    setIsOpen(false);
    const action = pendingActionRef.current;
    pendingActionRef.current = null;
    if (action) {
      action();
    }
  }, []);

  const handleSyncNow = useCallback(async () => {
    // User clicked "Sync Now"
    try {
      setIsSyncing(true);
      await api.sync.pullDownstream().catch(() => {});
      await api.sync.triggerSync().catch(() => {});

      // Refresh sync status cache
      try {
        const updated = await api.sync.getStatus();
        if (typeof window !== 'undefined') {
          sessionStorage.setItem('erp_last_sync_status', JSON.stringify(updated));
        }
      } catch (_) {}
    } catch (_) {
    } finally {
      setIsSyncing(false);
      setIsOpen(false);
      const action = pendingActionRef.current;
      pendingActionRef.current = null;
      if (action) {
        action();
      }
    }
  }, []);

  return {
    isOpen,
    isSyncing,
    checkSyncAndExecute,
    handleClose,
    handleSyncNow
  };
}
