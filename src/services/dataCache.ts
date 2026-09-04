/**
 * In-Memory Stale-While-Revalidate (SWR) Data Cache
 * Eliminates blocking page spinners and enables instant 0ms tab navigation across the ERP.
 */

export interface CacheStore {
  customers: any[] | null;
  suppliers: any[] | null;
  products: any[] | null;
  categories: any[] | null;
  sales: any[] | null;
  returns: any[] | null;
  settings: any | null;
  transactions: any[] | null;
  cheques: any[] | null;
  purchaseOrders: any[] | null;
  reports: any | null;
  finance: any | null;
  lastFetched: Record<string, number>;
}

const memoryCache: CacheStore = {
  customers: null,
  suppliers: null,
  products: null,
  categories: null,
  sales: null,
  returns: null,
  settings: null,
  transactions: null,
  cheques: null,
  purchaseOrders: null,
  reports: null,
  finance: null,
  lastFetched: {}
};

export type CacheKey = keyof Omit<CacheStore, 'lastFetched'>;

export function getCachedData<T = any[]>(key: CacheKey): T | null {
  return (memoryCache[key] as T) ?? null;
}

export function setCachedData<T = any>(key: CacheKey, data: T): void {
  (memoryCache as any)[key] = data;
  memoryCache.lastFetched[key] = Date.now();
}

export function invalidateCache(key?: CacheKey): void {
  if (key) {
    (memoryCache as any)[key] = null;
    delete memoryCache.lastFetched[key];
  } else {
    memoryCache.customers = null;
    memoryCache.suppliers = null;
    memoryCache.products = null;
    memoryCache.categories = null;
    memoryCache.sales = null;
    memoryCache.returns = null;
    memoryCache.settings = null;
    memoryCache.transactions = null;
    memoryCache.cheques = null;
    memoryCache.purchaseOrders = null;
    memoryCache.reports = null;
    memoryCache.finance = null;
    memoryCache.lastFetched = {};
  }
}

/**
 * Full factory/boot cache reset: clears all memory cache, session storage, and stale local caches.
 */
export function resetAllCaches(): void {
  invalidateCache();
  try {
    if (typeof window !== 'undefined') {
      const keysToClear = [
        'erp_cached_reports',
        'erp_dashboard_cache',
        'erp_finance_cache',
        'hardware_erp_sales_draft',
        'hardware_erp_cart',
        'hardware_erp_finance_tab',
        'hardware_erp_reports_filter'
      ];
      keysToClear.forEach(k => {
        try {
          sessionStorage.removeItem(k);
          localStorage.removeItem(k);
        } catch (_) {}
      });
    }
  } catch (_) {}
}

export function isCacheStale(key: CacheKey, maxAgeMs = 30000): boolean {
  const last = memoryCache.lastFetched[key];
  if (!last) return true;
  return Date.now() - last > maxAgeMs;
}
