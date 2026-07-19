import React, { useState, useEffect } from 'react';
import { Search } from 'lucide-react';
import axios from 'axios';
import { API_URL } from '../config.ts';
import { motion } from 'framer-motion';

interface AuditLog {
  id: number;
  user_id: number | null;
  action: string;
  description: string;
  ip_address: string | null;
  created_at: string;
}

export default function Logs() {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');

  const fetchLogs = async () => {
    setLoading(true);
    setError('');
    try {
      const response = await axios.get(`${API_URL}/publish/logs`, {
        headers: { Authorization: `Bearer ${localStorage.getItem("token")}` }
      });
      setLogs(response.data);
    } catch (err: any) {
      setError("Failed to fetch system audit logs.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLogs();
  }, []);

  const filteredLogs = logs.filter(log => 
    log.action.toLowerCase().includes(search.toLowerCase()) ||
    log.description.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-black font-outfit text-slate-100 mb-1.5">Audit Logs</h1>
        <p className="text-sm text-slate-400">Inspect operations, authentication events, account connections, and publishing attempts.</p>
      </div>

      {error && (
        <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm font-semibold">
          {error}
        </div>
      )}

      <div className="relative">
        <span className="absolute inset-y-0 left-0 pl-3 flex items-center text-slate-500">
          <Search size={16} />
        </span>
        <input
          type="text"
          placeholder="Search by action or description..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full pl-10 pr-4 py-3 rounded-xl bg-slate-900/50 border border-slate-800 focus:border-purple-500/50 focus:ring-1 focus:ring-purple-500/50 outline-none text-slate-200 text-sm transition-all"
        />
      </div>

      {loading ? (
        <div className="flex justify-center items-center py-16">
          <svg className="animate-spin h-8 w-8 text-purple-500" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
        </div>
      ) : filteredLogs.length === 0 ? (
        <div className="glass-panel p-12 text-center rounded-2xl border border-slate-900">
          <h3 className="text-lg font-bold text-slate-300 mb-1">No Logs Found</h3>
          <p className="text-sm text-slate-500">No audit records matched your current query filter.</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-slate-900 shadow-xl">
          <table className="w-full text-left border-collapse bg-slate-950">
            <thead>
              <tr className="bg-slate-900/60 text-slate-300 text-xs font-bold uppercase tracking-wider border-b border-slate-900">
                <th className="px-6 py-4">Timestamp</th>
                <th className="px-6 py-4">Action</th>
                <th className="px-6 py-4">Description</th>
                <th className="px-6 py-4">IP Address</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-900 text-sm">
              {filteredLogs.map((log, index) => (
                <motion.tr 
                  key={log.id}
                  initial={{ opacity: 0, y: 5 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: index * 0.02 }}
                  className="hover:bg-slate-900/20 text-slate-400"
                >
                  <td className="px-6 py-4 whitespace-nowrap text-xs text-slate-500">
                    {new Date(log.created_at).toLocaleString()}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap font-bold text-purple-400">
                    {log.action}
                  </td>
                  <td className="px-6 py-4 text-slate-200 font-medium max-w-md break-words">
                    {log.description}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-xs font-mono text-slate-500">
                    {log.ip_address || "N/A"}
                  </td>
                </motion.tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
