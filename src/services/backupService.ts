import { API_URL, fetchWithTimeout, getAuthHeaders } from '../lib/api';
import { toSriLankaDateStr } from '../utils/dateTime';

export interface BackupTriggerOptions {
  email?: string;
  type?: 'Manual' | 'Auto';
  fromDate?: string | null;
  toDate?: string | null;
}

export async function triggerDatabaseBackup(options: BackupTriggerOptions = {}) {
  const normalizedPayload = {
    email: options.email,
    type: options.type || 'Manual',
    fromDate: options.fromDate ? toSriLankaDateStr(options.fromDate) : null,
    toDate: options.toDate ? toSriLankaDateStr(options.toDate) : null
  };

  try {
    const res = await fetchWithTimeout(
      `${API_URL}/settings/trigger-backup`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...getAuthHeaders()
        },
        body: JSON.stringify(normalizedPayload)
      },
      15000
    );

    if (res.ok) {
      return await res.json();
    }
    const err = await res.json().catch(() => ({ message: 'Backup trigger failed' }));
    throw new Error(err.message || 'Backup trigger failed');
  } catch (e: any) {
    console.error('Failed to trigger database backup:', e);
    throw e;
  }
}

export default {
  triggerDatabaseBackup
};
