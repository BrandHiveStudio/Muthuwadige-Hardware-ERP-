/**
 * Unified External URL Dispatcher
 * Launches external URLs via Electron shell or browser fallback.
 */

export const openExternalUrl = async (url: string): Promise<boolean> => {
  try {
    // Check if Electron shell is available via preload bridge
    if ((window as any).electron && typeof (window as any).electron.openExternalUrl === 'function') {
      const res = await (window as any).electron.openExternalUrl(url);
      return res?.success !== false;
    }
    if ((window as any).electronAPI && typeof (window as any).electronAPI.openExternalUrl === 'function') {
      const res = await (window as any).electronAPI.openExternalUrl(url);
      return res?.success !== false;
    }
    // Fallback for standard Web/Browser window context
    window.open(url, '_blank', 'noopener,noreferrer');
    return true;
  } catch (err) {
    console.error('[openExternalUrl] Error launching URL:', err);
    window.open(url, '_blank', 'noopener,noreferrer');
    return false;
  }
};

/**
 * Standardize WhatsApp Phone & URL Formatting
 */
export const formatWhatsAppUrl = (phone: string, message: string): string => {
  let cleanedPhone = (phone || '').replace(/[^\d+]/g, '');
  if (cleanedPhone.startsWith('0')) {
    cleanedPhone = '94' + cleanedPhone.slice(1);
  } else if (!cleanedPhone.startsWith('+') && !cleanedPhone.startsWith('94')) {
    cleanedPhone = '94' + cleanedPhone;
  }
  cleanedPhone = cleanedPhone.replace('+', '');
  return `https://wa.me/${cleanedPhone}?text=${encodeURIComponent(message)}`;
};
