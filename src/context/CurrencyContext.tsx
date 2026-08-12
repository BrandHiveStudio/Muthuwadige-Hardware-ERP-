import React, { createContext, useContext, useState, useEffect } from 'react';
import { API_URL, fetchWithTimeout } from '../lib/api';

const CurrencyContext = createContext<any>(null);

export const CurrencyProvider = ({ children }: { children: React.ReactNode }) => {
  const [currency, setCurrency] = useState('LKR');
  // Define your exchange rate (e.g., 1 USD = 300 LKR)
  const exchangeRate = 300; 

  // Synchronize currency with system settings from local SQLite API on mount
  useEffect(() => {
    const fetchSystemCurrency = async () => {
      try {
        const res = await fetchWithTimeout(`${API_URL}/settings`, {}, 8000);
        if (res.ok) {
          const settings = await res.json();
          if (settings.currency) {
            const cur = settings.currency === 'Rs.' ? 'LKR' : settings.currency;
            setCurrency(cur);
          }
        }
      } catch (e) {
        console.error('Failed to sync global currency context with SQLite:', e);
      }
    };
    fetchSystemCurrency();
    window.addEventListener('settings-updated', fetchSystemCurrency);
    return () => window.removeEventListener('settings-updated', fetchSystemCurrency);
  }, []);

  /**
   * Helper function to convert and format the currency value
   * @param value - The base price (usually in USD)
   */
  const formatValue = (value: number) => {
    if (currency === 'LKR' || currency === 'Rs.') {
      const convertedValue = value * exchangeRate;
      return `Rs. ${convertedValue.toLocaleString('en-LK', { 
        minimumFractionDigits: 2, 
        maximumFractionDigits: 2 
      })}`;
    }
    return `$${value.toLocaleString('en-US', { 
      minimumFractionDigits: 2, 
      maximumFractionDigits: 2 
    })}`;
  };

  return (
    <CurrencyContext.Provider value={{ currency, setCurrency, formatValue, exchangeRate }}>
      {children}
    </CurrencyContext.Provider>
  );
};

export const useCurrency = () => useContext(CurrencyContext);