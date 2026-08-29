import { api, API_URL, fetchWithTimeout } from '../lib/api';

export interface BackupTriggerOptions {
  email?: string;
  type?: 'Manual' | 'Auto';
  fromDate?: string | null;
  toDate?: string | null;
}

export async function triggerDatabaseBackup(options: BackupTriggerOptions = {}) {
  try {
    const res = await fetchWithTimeout(`${API_URL}/settings/trigger-backup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(options)
    }, 15000);

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
