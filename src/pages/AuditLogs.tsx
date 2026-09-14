import React, { useEffect, useState } from 'react';
import { supabase } from '../lib/supabaseClient';
import { api } from '../lib/api';
import {
  ShieldIcon,
  SearchIcon,
  ClockIcon,
  UserIcon,
  FileTextIcon
} from 'lucide-react';

const formatLogDate = (timestamp: string) => {
  const d = new Date(timestamp);
  if (isNaN(d.getTime())) return '';
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd} ${hh}:${min}:${ss}`;
};

export function AuditLogs() {
  const [logs, setLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');

  const fetchLogs = async () => {
    setLoading(true);
    try {
      let records: any[] = [];
      try {
        const localLogs = await api.auditLogs.getAll();
        if (Array.isArray(localLogs) && localLogs.length > 0) {
          records = localLogs;
        }
      } catch (localErr) {
        console.warn("Direct audit API notice, falling back to Supabase:", localErr);
      }

      if (!records || records.length === 0) {
        const { data } = await supabase.from('audit_logs').select('*');
        if (data && Array.isArray(data)) {
          records = data;
        }
      }

      if (records) {
        // Sort by timestamp desc
        const sorted = [...records].sort((a: any, b: any) => 
          new Date(b?.timestamp || 0).getTime() - new Date(a?.timestamp || 0).getTime()
        );
        setLogs(sorted);
      }
    } catch (e) {
      console.error("Failed to load audit logs:", e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLogs();
  }, []);

  const filteredLogs = logs.filter(log => {
    const term = searchTerm.toLowerCase();
    return (
      (log?.user_name || '').toLowerCase().includes(term) ||
      (log?.user_role || '').toLowerCase().includes(term) ||
      (log?.user_email || '').toLowerCase().includes(term) ||
      (log?.action || '').toLowerCase().includes(term) ||
      (log?.details || '').toLowerCase().includes(term)
    );
  });

  const getRoleBadge = (role?: string) => {
    if (!role) return null;
    const r = role.toLowerCase();
    let colorClass = 'bg-slate-100 text-slate-700 border-slate-200';
    if (r.includes('super')) {
      colorClass = 'bg-amber-100 text-amber-900 border-amber-300';
    } else if (r.includes('admin')) {
      colorClass = 'bg-purple-100 text-purple-900 border-purple-200';
    } else if (r.includes('manager')) {
      colorClass = 'bg-sky-100 text-sky-900 border-sky-200';
    } else if (r.includes('cashier')) {
      colorClass = 'bg-emerald-100 text-emerald-900 border-emerald-200';
    }

    const label = role.toUpperCase().replace(/_/g, ' ');
    return (
      <span className={`px-2 py-0.5 rounded-md text-[9px] font-black uppercase tracking-wider border shrink-0 ${colorClass}`}>
        {label}
      </span>
    );
  };

  return (
    <div className="p-4 sm:p-6 space-y-6 animate-in fade-in duration-500 text-left">
      <div className="space-y-6 animate-in slide-in-from-bottom-4">
        <div className="bg-white rounded-2xl border border-slate-100 shadow-lg overflow-hidden">
          
          {/* Header with dark gradient */}
          <div className="bg-gradient-to-r from-slate-800 to-slate-900 px-6 py-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-white/10 text-[#DAA520] rounded-xl flex items-center justify-center shadow-inner shrink-0">
                <ShieldIcon className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-sm font-black text-white">Security & System Audit Logs</h3>
                <p className="text-[10px] text-slate-400 font-semibold mt-0.5">Chronological log of critical operations, password resets, stock adjustments, and invoice cancellations.</p>
              </div>
            </div>
            <span className="px-3 py-1.5 bg-slate-500/20 text-slate-400 text-xs font-black rounded-full border border-slate-500/30 shrink-0">
              {filteredLogs.length} Records
            </span>
          </div>

          {/* Sub-bar for Search Controls */}
          <div className="p-4 bg-slate-50 border-b border-slate-100 flex items-center gap-4">
            <div className="relative w-full sm:w-72">
              <input
                type="text"
                placeholder="Search logs..."
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
                className="w-full pl-9 pr-4 py-2 border border-slate-200 rounded-xl text-xs font-bold text-slate-700 bg-white outline-none focus:ring-2 focus:ring-[#DAA520] transition-all"
              />
              <SearchIcon className="absolute left-3 top-2.5 w-4 h-4 text-slate-400" />
            </div>
          </div>

          {/* Table */}
          {loading ? (
            <div className="p-16 text-center text-gray-400 font-bold flex flex-col items-center justify-center gap-3">
              <div className="w-8 h-8 border-4 border-[#DAA520]/30 border-t-[#DAA520] rounded-full animate-spin" />
              <span className="text-xs uppercase tracking-widest text-[#DAA520] animate-pulse">Fetching system logs...</span>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead className="bg-slate-50 border-b border-slate-100 text-[10px] font-black uppercase text-slate-400 tracking-widest">
                  <tr>
                    <th className="px-6 py-4">Timestamp</th>
                    <th className="px-6 py-4">User / Initiator</th>
                    <th className="px-6 py-4">Action</th>
                    <th className="px-6 py-4">Details</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {filteredLogs.map(log => {
                    const isAlert = (log?.action || '').toLowerCase().match(/\b(void|delete|error|fail|reset)\b/);
                    const displayName = log?.user_name || (log?.user_email === 'Automated Background Sync' || log?.user_email === 'system_trigger' ? 'Automated Background Sync' : (log?.user_email || 'System'));
                    const displayRole = log?.user_role || (log?.user_email === 'Automated Background Sync' || log?.user_email === 'system_trigger' ? 'SYSTEM' : 'STAFF');
                    const hasSecondaryEmail = log?.user_email && log?.user_email !== 'Automated Background Sync' && log?.user_email !== 'system_trigger' && log?.user_email !== displayName;

                    return (
                      <tr key={log?.id || Math.random()} className="hover:bg-slate-50/50 transition-colors">
                        <td className="px-6 py-4 font-mono text-xs text-gray-400 flex items-center gap-2 font-medium">
                          <ClockIcon className="w-3.5 h-3.5 opacity-60" />
                          {formatLogDate(log?.timestamp || '')}
                        </td>
                        <td className="px-6 py-4">
                          <div className="flex flex-col gap-0.5">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-slate-900 font-black text-xs">
                                {displayName}
                              </span>
                              {getRoleBadge(displayRole)}
                            </div>
                            {hasSecondaryEmail && (
                              <span className="text-[10px] text-slate-400 font-medium">
                                {log?.user_email}
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-6 py-4">
                          <span className={`px-2.5 py-1 rounded-lg text-[9px] font-black uppercase tracking-wider ${
                            isAlert 
                              ? 'bg-red-50 text-red-600 border border-red-100' 
                              : 'bg-emerald-50 text-emerald-700 border border-emerald-100'
                          }`}>
                            {log?.action}
                          </span>
                        </td>
                        <td className="px-6 py-4 text-slate-500 font-semibold max-w-md break-all">
                          <span className="inline-flex items-start gap-1.5">
                            <FileTextIcon className="w-3.5 h-3.5 opacity-60 shrink-0 mt-0.5" />
                            {log?.details}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                  {filteredLogs.length === 0 && (
                    <tr>
                      <td colSpan={4} className="p-16 text-center text-gray-400 font-bold text-xs uppercase tracking-wider">
                        No audit records found.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}
