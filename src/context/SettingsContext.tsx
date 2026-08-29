import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { API_URL, fetchWithTimeout } from '../lib/api';

export interface StoreSettings {
  storeName: string;
  shop_name: string;
  address: string;
  phone: string;
  telephone?: string;
  email: string;
  logoUrl?: string;
  logo_path?: string;
  currency: string;
  currency_symbol?: string;
  tax_rate?: number;
  invoice_footer?: string;
  receiptFooter?: string;
  footer_text?: string;
  printer_settings?: any;
  branch_settings?: any;
  backup_email?: string;
  backup_enabled?: number | boolean;
  backup_interval_hours?: number;
}

const defaultSettings: StoreSettings = {
  storeName: 'Muthuwadige Hardware',
  shop_name: 'Muthuwadige Hardware',
  address: 'No: 80, Mahahunupitiya, Negombo',
  phone: '077 076 076 7',
  telephone: '077 076 076 7',
  email: 'sanojhardware@gmail.com',
  logoUrl: './images/logo.png',
  logo_path: './images/logo.png',
  currency: 'Rs.',
  currency_symbol: 'Rs.',
  tax_rate: 0,
  invoice_footer: 'Thank you for your business! Come again.',
  receiptFooter: 'Thank you for your business! Come again.'
};

interface SettingsContextType {
  settings: StoreSettings;
  updateSettings: (newSettings: Partial<StoreSettings>) => void;
  refreshSettings: () => Promise<void>;
  isLoading: boolean;
}

const SettingsContext = createContext<SettingsContextType>({
  settings: defaultSettings,
  updateSettings: () => {},
  refreshSettings: async () => {},
  isLoading: false
});

export const SettingsProvider = ({ children }: { children: React.ReactNode }) => {
  const [settings, setSettings] = useState<StoreSettings>(() => {
    try {
      const stored = localStorage.getItem('system_settings') || localStorage.getItem('hardware_erp_settings');
      if (stored) {
        const parsed = JSON.parse(stored);
        return {
          ...defaultSettings,
          ...parsed,
          storeName: parsed.shop_name || parsed.storeName || defaultSettings.storeName,
          shop_name: parsed.shop_name || parsed.storeName || defaultSettings.shop_name,
          logoUrl: parsed.logo_path || parsed.logoUrl || defaultSettings.logoUrl,
          logo_path: parsed.logo_path || parsed.logoUrl || defaultSettings.logo_path,
        };
      }
    } catch (_) {}
    return defaultSettings;
  });

  const [isLoading, setIsLoading] = useState(false);

  const refreshSettings = useCallback(async () => {
    try {
      setIsLoading(true);
      const res = await fetchWithTimeout(`${API_URL}/settings`, {}, 8000);
      if (res.ok) {
        const data = await res.json();
        const unified: StoreSettings = {
          ...defaultSettings,
          ...data,
          storeName: data.shop_name || data.storeName || defaultSettings.storeName,
          shop_name: data.shop_name || data.storeName || defaultSettings.shop_name,
          address: data.address || defaultSettings.address,
          phone: data.phone || data.telephone || defaultSettings.phone,
          telephone: data.phone || data.telephone || defaultSettings.telephone,
          email: data.email || defaultSettings.email,
          logoUrl: data.logo_path || data.logoUrl || defaultSettings.logoUrl,
          logo_path: data.logo_path || data.logoUrl || defaultSettings.logo_path,
          currency: data.currency || defaultSettings.currency,
          currency_symbol: data.currency || defaultSettings.currency,
          invoice_footer: data.invoice_footer || data.receiptFooter || defaultSettings.invoice_footer,
          receiptFooter: data.invoice_footer || data.receiptFooter || defaultSettings.receiptFooter
        };
        setSettings(unified);
        localStorage.setItem('system_settings', JSON.stringify(unified));
      }
    } catch (e) {
      console.warn('Could not sync settings from SQLite backend, using local settings:', e);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshSettings();
    const handleUpdate = () => refreshSettings();
    window.addEventListener('settings-updated', handleUpdate);
    return () => window.removeEventListener('settings-updated', handleUpdate);
  }, [refreshSettings]);

  const updateSettings = useCallback((newSettings: Partial<StoreSettings>) => {
    setSettings(prev => {
      const updated = { ...prev, ...newSettings };
      localStorage.setItem('system_settings', JSON.stringify(updated));
      return updated;
    });
  }, []);

  return (
    <SettingsContext.Provider value={{ settings, updateSettings, refreshSettings, isLoading }}>
      {children}
    </SettingsContext.Provider>
  );
};

export const useSettings = () => useContext(SettingsContext);
export default SettingsContext;
