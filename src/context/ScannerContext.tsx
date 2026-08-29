import React, { createContext, useContext, useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { API_URL, fetchWithTimeout } from '../lib/api';

export interface MobileScanRecord {
  id: string;
  barcode: string;
  timestamp: number;
  scannerName: string;
  format: string;
}

export interface ConnectedScannerClient {
  id: string;
  ip: string;
  deviceName: string;
  connectedAt: string;
}

export interface LocalScannerInfo {
  ip: string;
  port: number;
  httpsPort: number;
  ips: { name: string; address: string; isWifi: boolean }[];
  scannerUrl: string;
  httpScannerUrl?: string;
  protocol?: string;
}

interface ScannerContextType {
  scannerSessionId: string;
  setScannerSessionId: (id: string) => void;
  isMobileScannerConnected: boolean;
  connectedDevicesCount: number;
  connectedClients: ConnectedScannerClient[];
  fetchConnectedClients: () => Promise<void>;
  isRefreshingClients: boolean;
  recentScans: MobileScanRecord[];
  clearRecentScans: () => void;
  localScannerInfo: LocalScannerInfo | null;
  fetchScannerInfo: () => Promise<void>;
  sendTestBarcode: (barcode: string) => Promise<boolean>;
}

const ScannerContext = createContext<ScannerContextType | null>(null);

export const ScannerProvider = ({ children }: { children: React.ReactNode }) => {
  const [scannerSessionId, setScannerSessionIdState] = useState<string>(() => {
    try {
      const stored = localStorage.getItem('pos_mobile_scanner_session');
      return stored || 'POS-8828';
    } catch {
      return 'POS-8828';
    }
  });

  const [connectedClients, setConnectedClients] = useState<ConnectedScannerClient[]>([]);
  const [connectedDevicesCount, setConnectedDevicesCount] = useState<number>(0);
  const [isRefreshingClients, setIsRefreshingClients] = useState(false);

  const [recentScans, setRecentScans] = useState<MobileScanRecord[]>([]);
  const [localScannerInfo, setLocalScannerInfo] = useState<LocalScannerInfo | null>(null);

  const clientsRef = useRef<ConnectedScannerClient[]>([]);
  const recentScansBufferRef = useRef<MobileScanRecord[]>([]);

  const applyClientsUpdate = useCallback((newClients: ConnectedScannerClient[], newCount?: number) => {
    const count = typeof newCount === 'number' ? newCount : newClients.length;
    const current = clientsRef.current;
    const isIdentical =
      current.length === newClients.length &&
      current.every((c, i) => c.id === newClients[i]?.id && c.ip === newClients[i]?.ip && c.deviceName === newClients[i]?.deviceName);

    if (!isIdentical) {
      clientsRef.current = newClients;
      setConnectedClients(newClients);
      setConnectedDevicesCount(count);
    }
  }, []);

  const isMobileScannerConnected = connectedDevicesCount > 0 || connectedClients.length > 0;

  const setScannerSessionId = useCallback((newId: string) => {
    const cleanId = newId.trim();
    if (!cleanId) return;
    setScannerSessionIdState(cleanId);
    try {
      localStorage.setItem('pos_mobile_scanner_session', cleanId);
    } catch (_) {}
  }, []);

  const clearRecentScans = useCallback(() => {
    recentScansBufferRef.current = [];
    setRecentScans([]);
  }, []);

  const fetchScannerInfo = useCallback(async () => {
    try {
      const res = await fetchWithTimeout(`${API_URL}/scanner/local-ip`, {}, 6000);
      if (res.ok) {
        const data = await res.json();
        setLocalScannerInfo(data);
      }
    } catch (e) {
      console.warn('[Scanner Context] Could not fetch local IP signaling:', e);
    }
  }, []);

  const fetchConnectedClientsInternal = useCallback(async (isManual = false) => {
    if (isManual) setIsRefreshingClients(true);
    try {
      const res = await fetchWithTimeout(
        `${API_URL}/scanner/clients?sessionId=${encodeURIComponent(scannerSessionId)}`,
        {},
        5000
      );
      if (res.ok) {
        const data = await res.json();
        const clients: ConnectedScannerClient[] = Array.isArray(data.clients) ? data.clients : [];
        applyClientsUpdate(clients, data.count);
      }
    } catch (e) {
      console.warn('[Scanner Context] Could not fetch connected scanner clients:', e);
    } finally {
      if (isManual) {
        setTimeout(() => {
          setIsRefreshingClients(false);
        }, 400);
      }
    }
  }, [scannerSessionId, applyClientsUpdate]);

  const fetchConnectedClients = useCallback(async () => {
    return fetchConnectedClientsInternal(true);
  }, [fetchConnectedClientsInternal]);

  useEffect(() => {
    fetchScannerInfo();
  }, [fetchScannerInfo]);

  useEffect(() => {
    fetchConnectedClientsInternal(false);
  }, [fetchConnectedClientsInternal]);

  // Periodic polling fallback for client count sync (runs quietly when tab is visible)
  useEffect(() => {
    const interval = setInterval(() => {
      if (typeof document !== 'undefined' && !document.hidden) {
        fetchConnectedClientsInternal(false);
      }
    }, 15000);
    return () => clearInterval(interval);
  }, [fetchConnectedClientsInternal]);

  // Inject virtual keyboard input or dispatch global barcode event
  const dispatchIncomingBarcode = useCallback((barcode: string, meta: { scannerName?: string; format?: string } = {}) => {
    const cleanCode = barcode.trim();
    if (!cleanCode) return;

    // Record in recent scan history buffer
    const record: MobileScanRecord = {
      id: 'scan_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
      barcode: cleanCode,
      timestamp: Date.now(),
      scannerName: meta.scannerName || 'Mobile Camera',
      format: meta.format || 'AUTO'
    };
    recentScansBufferRef.current = [record, ...recentScansBufferRef.current.slice(0, 49)];
    setRecentScans(recentScansBufferRef.current);

    // Check if user is currently focused on an active editable input / textarea
    const activeEl = document.activeElement;
    const isInput = activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA');
    const isWritable = isInput && !(activeEl as HTMLElement).hasAttribute('readonly') && !(activeEl as HTMLInputElement).disabled;

    if (isWritable) {
      const inputEl = activeEl as HTMLInputElement | HTMLTextAreaElement;
      const nativeSetter = Object.getOwnPropertyDescriptor(
        inputEl.tagName === 'INPUT' ? window.HTMLInputElement.prototype : window.HTMLTextAreaElement.prototype,
        'value'
      )?.set;

      if (nativeSetter) {
        nativeSetter.call(inputEl, cleanCode);
      } else {
        inputEl.value = cleanCode;
      }

      inputEl.dispatchEvent(new Event('input', { bubbles: true }));
      inputEl.dispatchEvent(new Event('change', { bubbles: true }));

      // Dispatch simulated Enter key
      inputEl.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
      inputEl.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
    } else {
      // Fallback: Dispatch global event for POS or active screen handler
      window.dispatchEvent(new CustomEvent('global-barcode-scanned', {
        detail: { barcode: cleanCode, source: 'mobile', meta }
      }));
    }
  }, []);

  const dispatchIncomingBarcodeRef = useRef(dispatchIncomingBarcode);
  useEffect(() => {
    dispatchIncomingBarcodeRef.current = dispatchIncomingBarcode;
  }, [dispatchIncomingBarcode]);

  // Persistent Server-Sent Events (SSE) Stream Listener for Desktop POS
  useEffect(() => {
    let eventSource: EventSource | null = null;
    let reconnectTimeout: ReturnType<typeof setTimeout> | null = null;

    const connectSSE = () => {
      try {
        const streamUrl = `${API_URL}/scanner/stream?sessionId=${encodeURIComponent(scannerSessionId)}&clientType=desktop`;
        eventSource = new EventSource(streamUrl);

        eventSource.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            if (data.type === 'connected' || data.type === 'clients_update') {
              if (Array.isArray(data.clients)) {
                applyClientsUpdate(data.clients, data.count);
              }
            } else if (data.type === 'scan' && data.barcode) {
              dispatchIncomingBarcodeRef.current(data.barcode, {
                scannerName: data.scannerName,
                format: data.format
              });
            }
          } catch (err) {
            console.error('[Scanner SSE] Failed to parse event:', err);
          }
        };

        eventSource.onerror = () => {
          eventSource?.close();
          if (reconnectTimeout) clearTimeout(reconnectTimeout);
          reconnectTimeout = setTimeout(connectSSE, 3000);
        };
      } catch (err) {
        console.warn('[Scanner SSE] Stream initialization error:', err);
      }
    };

    connectSSE();

    return () => {
      if (eventSource) eventSource.close();
      if (reconnectTimeout) clearTimeout(reconnectTimeout);
    };
  }, [scannerSessionId, applyClientsUpdate]);

  const sendTestBarcode = useCallback(async (barcode: string) => {
    const clean = barcode.trim();
    if (!clean) return false;
    try {
      const res = await fetchWithTimeout(`${API_URL}/scanner/broadcast`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          barcode: clean,
          sessionId: scannerSessionId,
          scannerName: 'Desktop Test Simulator',
          format: 'MANUAL_TEST'
        })
      }, 5000);
      return res.ok;
    } catch {
      return false;
    }
  }, [scannerSessionId]);

  const contextValue = useMemo(() => ({
    scannerSessionId,
    setScannerSessionId,
    isMobileScannerConnected,
    connectedDevicesCount,
    connectedClients,
    fetchConnectedClients,
    isRefreshingClients,
    recentScans,
    clearRecentScans,
    localScannerInfo,
    fetchScannerInfo,
    sendTestBarcode
  }), [
    scannerSessionId,
    setScannerSessionId,
    isMobileScannerConnected,
    connectedDevicesCount,
    connectedClients,
    fetchConnectedClients,
    isRefreshingClients,
    recentScans,
    clearRecentScans,
    localScannerInfo,
    fetchScannerInfo,
    sendTestBarcode
  ]);

  return (
    <ScannerContext.Provider value={contextValue}>
      {children}
    </ScannerContext.Provider>
  );
};

export const useScanner = () => {
  const context = useContext(ScannerContext);
  if (!context) {
    throw new Error('useScanner must be used within a ScannerProvider');
  }
  return context;
};
