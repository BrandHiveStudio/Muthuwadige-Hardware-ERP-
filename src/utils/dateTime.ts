/**
 * Centralized Timezone & Date Utility
 * Muthuwadige Hardware ERP - Single Source of Truth for Asia/Colombo (UTC+05:30)
 */

export const SRI_LANKA_TIMEZONE = 'Asia/Colombo';

/**
 * Normalizes input date to a valid JavaScript Date object.
 * Correctly treats SQLite timestamps ("YYYY-MM-DD HH:MM:SS" without Z) as UTC.
 */
export function parseToDate(dateInput: any): Date | null {
  if (!dateInput && dateInput !== 0) return null;
  if (dateInput instanceof Date) {
    return isNaN(dateInput.getTime()) ? null : dateInput;
  }

  if (typeof dateInput === 'number') {
    const d = new Date(dateInput);
    return isNaN(d.getTime()) ? null : d;
  }

  if (typeof dateInput === 'string') {
    const trimmed = dateInput.trim();
    if (!trimmed || trimmed === '---' || trimmed === 'null' || trimmed === 'undefined') return null;

    // Check for plain YYYY-MM-DD calendar date
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
      // Treat as calendar date at noon UTC to prevent any date-boundary jumps
      const d = new Date(`${trimmed}T12:00:00Z`);
      return isNaN(d.getTime()) ? null : d;
    }

    // Check for SQLite timestamp format "YYYY-MM-DD HH:MM:SS" or "YYYY-MM-DDTHH:MM:SS" (without timezone offset)
    if (/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(\.\d+)?$/.test(trimmed)) {
      // SQLite CURRENT_TIMESTAMP is UTC
      const isoFormat = trimmed.replace(' ', 'T') + 'Z';
      const d = new Date(isoFormat);
      return isNaN(d.getTime()) ? null : d;
    }

    // Standard ISO string or parseable format
    const d = new Date(trimmed);
    return isNaN(d.getTime()) ? null : d;
  }

  return null;
}

/**
 * Formats any date input to YYYY-MM-DD string in Asia/Colombo timezone (UTC+05:30).
 */
export function toSriLankaDateStr(dateInput: any): string {
  if (!dateInput && dateInput !== 0) return '';
  if (typeof dateInput === 'string') {
    const trimmed = dateInput.trim();
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
      return trimmed;
    }
  }

  const d = parseToDate(dateInput);
  if (!d) {
    if (typeof dateInput === 'string' && dateInput.length >= 10) {
      return dateInput.substring(0, 10);
    }
    return '';
  }

  try {
    return d.toLocaleDateString('sv-SE', { timeZone: SRI_LANKA_TIMEZONE });
  } catch (e) {
    return d.toISOString().substring(0, 10);
  }
}

/**
 * Formats any date input to readable datetime string in Asia/Colombo timezone.
 */
export function toSriLankaDateTimeStr(dateInput: any, includeSeconds: boolean = true): string {
  const d = parseToDate(dateInput);
  if (!d) return '---';

  try {
    const options: Intl.DateTimeFormatOptions = {
      timeZone: SRI_LANKA_TIMEZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: includeSeconds ? '2-digit' : undefined,
      hour12: true
    };
    return d.toLocaleString('en-US', options);
  } catch (e) {
    return d.toISOString();
  }
}

/**
 * Returns today's calendar date in Asia/Colombo (UTC+05:30) as YYYY-MM-DD.
 */
export function getTodaySriLankaDate(): string {
  return new Date().toLocaleDateString('sv-SE', { timeZone: SRI_LANKA_TIMEZONE });
}

/**
 * Returns current month in Asia/Colombo as YYYY-MM.
 */
export function getCurrentSriLankaMonth(): string {
  return getTodaySriLankaDate().substring(0, 7);
}

/**
 * Evaluates whether a date input falls inclusively within [fromDate, toDate] in Sri Lanka timezone.
 */
export function isWithinDateRange(dateVal: any, fromDate?: string, toDate?: string): boolean {
  if (!fromDate && !toDate) return true;
  if (!dateVal && dateVal !== 0) return false;

  const checkDateStr = toSriLankaDateStr(dateVal);
  if (!checkDateStr) return false;

  if (fromDate && checkDateStr < fromDate) return false;
  if (toDate && checkDateStr > toDate) return false;
  return true;
}
