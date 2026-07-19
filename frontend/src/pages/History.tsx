import React, { useState, useEffect } from 'react';
import { RotateCcw, FileText, Image as ImageIcon, Video, CheckCircle2, AlertTriangle, ExternalLink } from 'lucide-react';
import axios from 'axios';
import { API_URL } from '../config.ts';
import { motion, AnimatePresence } from 'framer-motion';

interface HistoryRecord {
  id: number;
  post_id: number;
  account_id: number;
  media_id: string;
  published_time: string;
  caption: string | null;
  media_url: string | null;
  username: string;
}

interface QueueRecord {
  id: number;
  post_id: number;
  account_id: number;
  status: string;
  progress_percent: number;
  current_step: string | null;
  elapsed_time: number;
  retry_count: number;
  created_at: string;
  post: {
    media_url: string;
    media_type: string;
    caption: string;
  };
  account: {
    instagram_username: string;
  };
}

interface AttemptLog {
  id: number;
  http_status: number | null;
  meta_error_code: string | null;
  subcode: string | null;
  message: string | null;
  fbtrace_id: string | null;
  request_url: string | null;
  response: string | null;
  timestamp: string;
  retry_count: number;
}

export default function PublishingHistory() {
  const [history, setHistory] = useState<HistoryRecord[]>([]);
  const [queues, setQueues] = useState<QueueRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  
  // Log inspection modal state
  const [logs, setLogs] = useState<AttemptLog[]>([]);
  const [logDialogOpen, setLogDialogOpen] = useState(false);
  const [selectedQueueId, setSelectedQueueId] = useState<number | null>(null);
  const [loadingLogs, setLoadingLogs] = useState(false);

  const fetchData = async () => {
    setLoading(true);
    setError('');
    try {
      const [historyRes, queueRes] = await Promise.all([
        axios.get(`${API_URL}/publish/history`, {
          headers: { Authorization: `Bearer ${localStorage.getItem("token")}` }
        }),
        axios.get(`${API_URL}/publish/status`, {
          headers: { Authorization: `Bearer ${localStorage.getItem("token")}` }
        })
      ]);
      setHistory(historyRes.data);
      setQueues(queueRes.data);
    } catch (err: any) {
      setError("Failed to fetch publishing history.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleRetry = async (queueId: number) => {
    setError('');
    setSuccess('');
    try {
      await axios.post(`${API_URL}/publish/${queueId}/retry`, {}, {
        headers: { Authorization: `Bearer ${localStorage.getItem("token")}` }
      });
      setSuccess("Retry initiated successfully.");
      fetchData();
    } catch (err: any) {
      setError(err.response?.data?.detail || "Failed to retry publication.");
    }
  };

  const handleViewLogs = async (queueId: number) => {
    setSelectedQueueId(queueId);
    setLogDialogOpen(true);
    setLoadingLogs(true);
    try {
      const response = await axios.get(`${API_URL}/publish-history/${queueId}/logs`, {
        headers: { Authorization: `Bearer ${localStorage.getItem("token")}` }
      });
      setLogs(response.data);
    } catch (err) {
      console.error("Failed to load logs: ", err);
    } finally {
      setLoadingLogs(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-black font-outfit text-slate-100 mb-1.5">Publishing History & Status</h1>
        <p className="text-sm text-slate-400">Monitor past publications, retry failures, and audit execution logs.</p>
      </div>

      {success && (
        <div className="p-4 rounded-xl bg-green-500/10 border border-green-500/20 text-green-400 text-sm font-semibold">
          {success}
        </div>
      )}
      {error && (
        <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm font-semibold">
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex justify-center items-center py-16">
          <svg className="animate-spin h-8 w-8 text-purple-500" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
        </div>
      ) : history.length === 0 && queues.length === 0 ? (
        <div className="glass-panel p-12 text-center rounded-2xl border border-slate-900">
          <h3 className="text-lg font-bold text-slate-300 mb-1">No Publications Logged</h3>
          <p className="text-sm text-slate-500">Queue a post from the dashboard to begin your history collection.</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-slate-900 shadow-xl">
          <table className="w-full text-left border-collapse bg-slate-950">
            <thead>
              <tr className="bg-slate-900/60 text-slate-300 text-xs font-bold uppercase tracking-wider border-b border-slate-900">
                <th className="px-6 py-4">Media</th>
                <th className="px-6 py-4">Target Profile</th>
                <th className="px-6 py-4">Caption Preview</th>
                <th className="px-6 py-4">Status</th>
                <th className="px-6 py-4">Details</th>
                <th className="px-6 py-4">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-900 text-sm">
              {/* Queued / Active / Failed Posts */}
              {queues.map((item) => (
                <tr key={`queue-${item.id}`} className="hover:bg-slate-900/10 text-slate-400">
                  <td className="px-6 py-4">
                    <div className="w-12 h-12 rounded-lg overflow-hidden border border-slate-800 bg-slate-900 flex items-center justify-center">
                      {(item.post.media_type === "VIDEO" || item.post.media_type === "REELS") ? (
                        <div className="relative">
                          <video src={item.post.media_url} className="w-full h-full object-cover" />
                          <div className="absolute inset-0 bg-black/40 flex items-center justify-center">
                            <Video size={14} className="text-purple-400" />
                          </div>
                        </div>
                      ) : (
                        <img src={item.post.media_url} className="w-full h-full object-cover" alt="Post thumbnail" />
                      )}
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap font-bold text-slate-200">
                    @{item.account.instagram_username}
                  </td>
                  <td className="px-6 py-4 max-w-xs truncate text-slate-300">
                    {item.post.caption || "No caption"}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span className={`px-2.5 py-1 rounded-full text-xs font-bold ${
                      item.status === "Failed" 
                        ? "bg-red-500/10 text-red-400 border border-red-500/20" 
                        : item.status === "Completed"
                        ? "bg-green-500/10 text-green-400 border border-green-500/20"
                        : "bg-yellow-500/10 text-yellow-400 border border-yellow-500/20"
                    }`}>
                      {item.status}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-xs text-slate-500">
                    {item.current_step || "N/A"}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleViewLogs(item.id)}
                        title="View Execution Logs"
                        className="p-2 bg-slate-900 hover:bg-slate-800 hover:text-slate-200 rounded-lg transition-colors cursor-pointer"
                      >
                        <FileText size={15} />
                      </button>
                      {item.status === "Failed" && (
                        <button
                          onClick={() => handleRetry(item.id)}
                          title="Retry Job"
                          className="p-2 bg-purple-500/10 hover:bg-purple-500/20 text-purple-400 rounded-lg transition-colors cursor-pointer"
                        >
                          <RotateCcw size={15} />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}

              {/* Finalized Succeeded Posts */}
              {history.map((record) => (
                <tr key={`history-${record.id}`} className="hover:bg-slate-900/10 text-slate-400">
                  <td className="px-6 py-4">
                    <div className="w-12 h-12 rounded-lg overflow-hidden border border-slate-800 bg-slate-900 flex items-center justify-center">
                      <img src={record.media_url || ''} className="w-full h-full object-cover" alt="Post thumbnail" />
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap font-bold text-slate-200">
                    @{record.username}
                  </td>
                  <td className="px-6 py-4 max-w-xs truncate text-slate-300">
                    {record.caption || "No caption"}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <span className="px-2.5 py-1 rounded-full text-xs font-bold bg-green-500/10 text-green-400 border border-green-500/20">
                      Success
                    </span>
                  </td>
                  <td className="px-6 py-4 text-xs text-slate-500 font-mono">
                    ID: {record.media_id}
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleViewLogs(record.post_id)}  // Linked queue post ID
                        title="View Execution Logs"
                        className="p-2 bg-slate-900 hover:bg-slate-800 hover:text-slate-200 rounded-lg transition-colors cursor-pointer"
                      >
                        <FileText size={15} />
                      </button>
                      <a
                        href={`https://instagram.com/p/${record.media_id}`}
                        target="_blank"
                        rel="noreferrer"
                        title="View Live Post"
                        className="p-2 bg-purple-500/10 hover:bg-purple-500/20 text-purple-400 rounded-lg transition-colors cursor-pointer"
                      >
                        <ExternalLink size={15} />
                      </a>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Audit Log Modal Dialog */}
      <AnimatePresence>
        {logDialogOpen && (
          <div className="fixed inset-0 flex items-center justify-center z-50 p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setLogDialogOpen(false)}
              className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="glass-panel w-full max-w-2xl rounded-2xl border border-slate-800 shadow-2xl relative overflow-hidden flex flex-col max-h-[85vh] z-10"
            >
              <div className="px-6 py-4 border-b border-slate-900">
                <h3 className="text-xl font-bold font-outfit text-slate-100">Meta API Execution Logs</h3>
              </div>

              <div className="flex-1 overflow-y-auto p-6 space-y-4">
                {loadingLogs ? (
                  <div className="flex justify-center py-8">
                    <svg className="animate-spin h-8 w-8 text-purple-500" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                  </div>
                ) : logs.length === 0 ? (
                  <p className="text-sm text-slate-500 italic text-center py-4">No Meta API call records enqueued for this job.</p>
                ) : (
                  <div className="space-y-4">
                    {logs.map((log) => (
                      <div key={log.id} className="p-4 rounded-xl bg-slate-900/50 border border-slate-900 space-y-2">
                        <div className="flex justify-between items-center text-xs">
                          <span className="font-bold text-purple-400">HTTP Status: {log.http_status || "N/A"}</span>
                          <span className="text-slate-500">{new Date(log.timestamp).toLocaleString()}</span>
                        </div>
                        <p className="text-xs font-mono text-slate-300 break-all">{log.request_url}</p>
                        {log.message && (
                          <div className="p-2.5 rounded bg-red-500/5 border border-red-500/10 text-xs text-red-400 font-medium">
                            {log.message}
                          </div>
                        )}
                        <div className="grid grid-cols-2 gap-2 text-[10px] text-slate-500 font-mono">
                          <span>Trace ID: {log.fbtrace_id || "N/A"}</span>
                          <span>Retry: {log.retry_count}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="px-6 py-4 bg-slate-900/40 border-t border-slate-900 flex justify-end">
                <button
                  onClick={() => setLogDialogOpen(false)}
                  className="px-5 py-2 bg-slate-900 hover:bg-slate-800 text-slate-300 font-bold rounded-xl text-sm transition-colors cursor-pointer"
                >
                  Close
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
