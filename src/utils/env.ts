/**
 * Environment detection utilities for Muthuwadige Hardware ERP
 * Distinguishes between desktop Electron client and browser web portal
 */

export const isElectron: boolean = typeof window !== 'undefined' && 
  (Boolean((window as any).electron) || Boolean((window as any).electronAPI) || navigator.userAgent.toLowerCase().includes('electron'));

export const isWebPortal: boolean = !isElectron;
