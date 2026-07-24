import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import { API_URL, WS_URL } from '../config.ts';
import { 
  ChevronUp, ChevronDown, Play, RefreshCw, AlertTriangle, CheckCircle2, 
  Clock, Search, Filter, Copy, FileCode, Layers, ExternalLink, X, RotateCcw, 
  Info, Sparkles, Image as ImageIcon, Video, User, ChevronLeft, ChevronRight, Hash
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

export interface QueueItem {
  id: number;
  post_id: number;
  account_id: number;
  status: string; // "Waiting", "Preparing", "Uploading", "Container Created", "Publishing", "Completed", "SUCCESS", "Retrying", "FAILED", "Failed", "Cancelled"
  progress_percent: number;
  current_step: string | null;
  elapsed_time: number;
  retry_count: number;
  created_at: string;
  updated_at: string;
  post?: {
    id: number;
    media_url: string;
    media_type: string;
    caption?: string | null;
    filename?: string | null;
    mime_type?: string | null;
    file_size?: number | null;
    created_at?: string;
  };
  account?: {
    id: number;
    instagram_username: string;
    profile_picture?: string | null;
    group_name?: string | null;
  };
}

export interface ErrorLogItem {
  id: number;
  queue_id: number;
  http_status: number | null;
  meta_error_code: string | null;
  subcode: string | null;
  message: string | null;
  fbtrace_id: string | null;
  request_url: string | null;
  request_body: string | null;
  response: string | null;
  timestamp: string;
  retry_count: number;
}

export interface HistoryItem {
  id: number;
  post_id: number;
  account_id: number;
  media_id: string;
  published_time: string;
  caption?: string | null;
  media_url?: string | null;
  username: string;
}

interface PublishingStatusPanelProps {
  onQueueUpdated?: () => void;
}

export default function PublishingStatusPanel({ onQueueUpdated }: PublishingStatusPanelProps) {
  // Collapsible state (persisted in sessionStorage)
  const [isCollapsed, setIsCollapsed] = useState<boolean>(() => {
    try {
      return sessionStorage.getItem("pub_panel_collapsed") === "true";
    } catch (e) {
      return false;
    }
  });

  // Active Main Tab ("in_progress" | "status")
  const [activeTab, setActiveTab] = useState<'in_progress' | 'status'>('in_progress');

  // Active Status Sub-Filter ("all" | "success" | "failed" | "pending")
  const [statusSubFilter, setStatusSubFilter] = useState<'all' | 'success' | 'failed' | 'pending'>('all');

  // Search Query
  const [searchQuery, setSearchQuery] = useState('');

  // Data states
  const [queueItems, setQueueItems] = useState<QueueItem[]>([]);
  const [errorLogs, setErrorLogs] = useState<ErrorLogItem[]>([]);
  const [historyItems, setHistoryItems] = useState<HistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Pagination states for Status Tab
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 8;

  // Selected Queue Item for Detail Modal
  const [selectedDetailItem, setSelectedDetailItem] = useState<QueueItem | null>(null);
  const [selectedLogs, setSelectedLogs] = useState<ErrorLogItem[]>([]);
  const [loadingModalLogs, setLoadingModalLogs] = useState(false);

  // Retry loading per item ID
  const [retryingIds, setRetryingIds] = useState<Record<number, boolean>>({});
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const socketRef = useRef<WebSocket | null>(null);

  const toggleCollapse = () => {
    setIsCollapsed(prev => {
      const next = !prev;
      try {
        sessionStorage.setItem("pub_panel_collapsed", String(next));
      } catch (e) {
        console.warn(e);
      }
      return next;
    });
  };

  // Fetch status, queue, logs, and history from backend API
  const fetchData = async () => {
    try {
      const token = localStorage.getItem("token");
      if (!token) return;

      const [statusRes, errorRes, historyRes] = await Promise.all([
        axios.get(`${API_URL}/publish/status`, { headers: { Authorization: `Bearer ${token}` } }),
        axios.get(`${API_URL}/publish/errors`, { headers: { Authorization: `Bearer ${token}` } }).catch(() => ({ data: [] })),
        axios.get(`${API_URL}/publish/history`, { headers: { Authorization: `Bearer ${token}` } }).catch(() => ({ data: [] }))
      ]);

      setQueueItems(statusRes.data || []);
      setErrorLogs(errorRes.data || []);
      setHistoryItems(historyRes.data || []);
      setError(null);
    } catch (err: any) {
      console.error("[PublishingStatusPanel] Error fetching status data:", err);
      setError("Failed to load live publishing status. Reconnecting...");
    } finally {
      setLoading(false);
    }
  };

  // Setup WebSocket connection and polling fallback
  useEffect(() => {
    fetchData();

    // Setup polling fallback every 3s
    const pollInterval = setInterval(() => {
      fetchData();
    }, 3500);

    // Setup WebSocket connection if available
    try {
      const ws = new WebSocket(WS_URL);
      socketRef.current = ws;

      ws.onopen = () => {
        console.log("[PublishingStatusPanel] WebSocket connected to real-time status stream");
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.type === "queue_update" || data.event === "queue_updated" || data.type === "publish_progress") {
            fetchData();
            if (onQueueUpdated) onQueueUpdated();
          }
        } catch (e) {
          console.warn("[PublishingStatusPanel] WS JSON parse error", e);
        }
      };

      ws.onerror = (err) => {
        console.warn("[PublishingStatusPanel] WS Error:", err);
      };
    } catch (wsErr) {
      console.warn("[PublishingStatusPanel] WebSocket initialization skipped:", wsErr);
    }

    return () => {
      clearInterval(pollInterval);
      if (socketRef.current) {
        socketRef.current.close();
      }
    };
  }, []);

  // Helper status checkers
  const isInProgress = (status: string) => {
    const s = (status || '').toUpperCase();
    return ["WAITING", "PREPARING", "UPLOADING", "CONTAINER CREATED", "PUBLISHING", "RETRYING", "QUEUED"].includes(s) && 
           !["SUCCESS", "COMPLETED", "FAILED", "CANCELLED"].includes(s);
  };

  const isSuccess = (status: string) => {
    const s = (status || '').toUpperCase();
    return ["SUCCESS", "COMPLETED"].includes(s);
  };

  const isFailed = (status: string) => {
    const s = (status || '').toUpperCase();
    return ["FAILED", "CANCELLED", "ERROR"].includes(s);
  };

  const isPending = (status: string) => {
    const s = (status || '').toUpperCase();
    return ["QUEUED", "WAITING", "PREPARING", "PENDING"].includes(s);
  };

  // Filter datasets
  const inProgressList = queueItems.filter(item => isInProgress(item.status));
  
  // Status items include completed, failed, queued items
  const statusList = queueItems.filter(item => !isInProgress(item.status) || isPending(item.status));

  const successList = queueItems.filter(item => isSuccess(item.status));
  const failedList = queueItems.filter(item => isFailed(item.status));
  const pendingList = queueItems.filter(item => isPending(item.status));

  // Search filtering logic across Progress ID, Username, Workspace / Group, Caption
  const applySearchFilter = (items: QueueItem[]) => {
    if (!searchQuery.trim()) return items;
    const query = searchQuery.toLowerCase().trim();
    return items.filter(item => {
      const matchId = String(item.id).includes(query) || `#${item.id}`.includes(query);
      const matchAccount = (item.account?.instagram_username || '').toLowerCase().includes(query);
      const matchGroup = (item.account?.group_name || '').toLowerCase().includes(query);
      const matchCaption = (item.post?.caption || '').toLowerCase().includes(query);
      return matchId || matchAccount || matchGroup || matchCaption;
    });
  };

  // Current active filtered list for "In Progress"
  const filteredInProgress = applySearchFilter(inProgressList);

  // Current active filtered list for "Status"
  const rawStatusByFilter = statusSubFilter === 'all' ? queueItems :
                           statusSubFilter === 'success' ? successList :
                           statusSubFilter === 'failed' ? failedList :
                           pendingList;

  const filteredStatusList = applySearchFilter(rawStatusByFilter);

  // Pagination for Status Tab
  const totalPages = Math.ceil(filteredStatusList.length / itemsPerPage) || 1;
  const paginatedStatusList = filteredStatusList.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage);

  // Retry publish job
  const handleRetry = async (queueId: number, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    setRetryingIds(prev => ({ ...prev, [queueId]: true }));
    try {
      const token = localStorage.getItem("token");
      await axios.post(`${API_URL}/publish/${queueId}/retry`, {}, {
        headers: { Authorization: `Bearer ${token}` }
      });
      fetchData();
      if (onQueueUpdated) onQueueUpdated();
    } catch (err: any) {
      alert(`Retry failed: ${err.response?.data?.detail || err.message}`);
    } finally {
      setRetryingIds(prev => ({ ...prev, [queueId]: false }));
    }
  };

  // Open detail modal for specific progress ID
  const openDetailModal = async (item: QueueItem) => {
    setSelectedDetailItem(item);
    setLoadingModalLogs(true);
    try {
      const token = localStorage.getItem("token");
      const res = await axios.get(`${API_URL}/publish/${item.id}/logs`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setSelectedLogs(res.data || []);
    } catch (e) {
      setSelectedLogs([]);
    } finally {
      setLoadingModalLogs(false);
    }
  };

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(label);
    setTimeout(() => setCopiedId(null), 2000);
  };

  // Color badge helpers
  const getBadgeStyle = (status: string) => {
    const s = (status || '').toUpperCase();
    if (["SUCCESS", "COMPLETED"].includes(s)) {
      return "bg-green-500/10 border-green-500/30 text-green-400";
    }
    if (["FAILED", "CANCELLED", "ERROR"].includes(s)) {
      return "bg-red-500/10 border-red-500/30 text-red-400";
    }
    if (["QUEUED", "WAITING", "PREPARING"].includes(s)) {
      return "bg-amber-500/10 border-amber-500/30 text-amber-400";
    }
    return "bg-blue-500/10 border-blue-500/30 text-blue-400";
  };

  const getEstimatedRemaining = (item: QueueItem) => {
    const percent = item.progress_percent || 0;
    if (percent >= 100) return "Completing...";
    if (percent === 0) return "Calculating...";
    const elapsed = item.elapsed_time || 5;
    const estTotal = (elapsed / percent) * 100;
    const remaining = Math.max(1, Math.round(estTotal - elapsed));
    return `~${remaining}s remaining`;
  };

  return (
    <div className="glass-panel rounded-3xl border border-slate-800/80 shadow-2xl overflow-hidden transition-all duration-300">
      
      {/* Header Bar */}
      <div className="p-5 sm:p-6 bg-slate-950/60 border-b border-slate-800/60 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <div className="p-2.5 bg-purple-500/10 border border-purple-500/20 text-purple-400 rounded-2xl shrink-0 shadow-inner">
            <Layers size={20} />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-lg font-bold font-outfit text-slate-100 truncate">Current Publishing Status</h2>
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-purple-500/10 border border-purple-500/20 text-purple-400">
                <span className="w-1.5 h-1.5 rounded-full bg-purple-500 animate-ping" />
                Real-Time
              </span>
            </div>
            
            {/* Minimized Summary Pill */}
            {isCollapsed && (
              <p className="text-xs text-slate-400 mt-1 font-mono flex items-center gap-2 flex-wrap">
                <span className="text-blue-400 font-bold">⚡ {inProgressList.length} In Progress</span>
                <span className="text-slate-600">•</span>
                <span className="text-green-400 font-bold">🟢 {successList.length} Successful</span>
                <span className="text-slate-600">•</span>
                <span className="text-red-400 font-bold">🔴 {failedList.length} Failed</span>
                <span className="text-slate-600">•</span>
                <span className="text-amber-400 font-bold">🟡 {pendingList.length} Pending</span>
              </p>
            )}
          </div>
        </div>

        {/* Minimize / Maximize Button */}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={toggleCollapse}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-slate-800 bg-slate-900/60 hover:bg-slate-800/80 text-slate-300 text-xs font-semibold transition-all cursor-pointer shadow-sm hover:text-white"
            title={isCollapsed ? "Expand Panel" : "Minimize Panel"}
          >
            <span>{isCollapsed ? "Expand" : "Minimize"}</span>
            {isCollapsed ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
          </button>
        </div>
      </div>

      {/* Expanded Content View */}
      <AnimatePresence initial={false}>
        {!isCollapsed && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25 }}
            className="space-y-0"
          >
            {/* Sticky Tab Header & Search / Filter Controls */}
            <div className="sticky top-0 z-20 bg-slate-950/90 backdrop-blur-md border-b border-slate-800/80 px-5 sm:px-6 py-3.5 space-y-3">
              
              {/* Primary Tabs */}
              <div className="flex items-center justify-between gap-4 flex-wrap">
                <div className="flex items-center gap-2 p-1 rounded-2xl bg-slate-900/80 border border-slate-800/80">
                  <button
                    type="button"
                    onClick={() => setActiveTab('in_progress')}
                    className={`px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-2 ${
                      activeTab === 'in_progress' 
                        ? 'bg-purple-500 text-slate-950 shadow-lg shadow-purple-500/20' 
                        : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
                    }`}
                  >
                    <RefreshCw size={14} className={inProgressList.length > 0 ? "animate-spin" : ""} />
                    <span>In Progress</span>
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-black ${
                      activeTab === 'in_progress' ? 'bg-slate-950/20 text-slate-950' : 'bg-slate-800 text-purple-400'
                    }`}>
                      {inProgressList.length}
                    </span>
                  </button>

                  <button
                    type="button"
                    onClick={() => setActiveTab('status')}
                    className={`px-4 py-2 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-2 ${
                      activeTab === 'status' 
                        ? 'bg-purple-500 text-slate-950 shadow-lg shadow-purple-500/20' 
                        : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
                    }`}
                  >
                    <CheckCircle2 size={14} />
                    <span>Status</span>
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-black ${
                      activeTab === 'status' ? 'bg-slate-950/20 text-slate-950' : 'bg-slate-800 text-slate-300'
                    }`}>
                      {queueItems.length}
                    </span>
                  </button>
                </div>

                {/* Search Bar Input */}
                <div className="relative flex-1 min-w-[200px] max-w-md">
                  <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search by Progress ID (#1042), Account, Workspace..."
                    className="w-full pl-9 pr-4 py-2 bg-slate-900/90 border border-slate-800 focus:border-purple-500/50 focus:ring-1 focus:ring-purple-500/50 rounded-xl text-xs text-slate-200 placeholder:text-slate-500 outline-none transition-all"
                  />
                  {searchQuery && (
                    <button 
                      onClick={() => setSearchQuery('')}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 cursor-pointer"
                    >
                      <X size={12} />
                    </button>
                  )}
                </div>
              </div>

              {/* Sub-Status Filter Pills (Visible when Status tab is selected) */}
              {activeTab === 'status' && (
                <div className="flex items-center gap-2 pt-1 overflow-x-auto pb-1 scrollbar-none">
                  <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider shrink-0 mr-1 flex items-center gap-1">
                    <Filter size={12} /> Filter:
                  </span>

                  <button
                    type="button"
                    onClick={() => { setStatusSubFilter('all'); setCurrentPage(1); }}
                    className={`px-3 py-1 rounded-xl text-[11px] font-bold transition-all cursor-pointer shrink-0 border ${
                      statusSubFilter === 'all'
                        ? 'bg-slate-800 text-slate-100 border-slate-700'
                        : 'bg-slate-950/40 text-slate-400 border-slate-850 hover:bg-slate-900'
                    }`}
                  >
                    All ({queueItems.length})
                  </button>

                  <button
                    type="button"
                    onClick={() => { setStatusSubFilter('success'); setCurrentPage(1); }}
                    className={`px-3 py-1 rounded-xl text-[11px] font-bold transition-all cursor-pointer shrink-0 border flex items-center gap-1.5 ${
                      statusSubFilter === 'success'
                        ? 'bg-green-500/20 text-green-300 border-green-500/40'
                        : 'bg-slate-950/40 text-slate-400 border-slate-850 hover:bg-slate-900 hover:text-green-400'
                    }`}
                  >
                    <span className="w-1.5 h-1.5 rounded-full bg-green-400" />
                    Success ({successList.length})
                  </button>

                  <button
                    type="button"
                    onClick={() => { setStatusSubFilter('failed'); setCurrentPage(1); }}
                    className={`px-3 py-1 rounded-xl text-[11px] font-bold transition-all cursor-pointer shrink-0 border flex items-center gap-1.5 ${
                      statusSubFilter === 'failed'
                        ? 'bg-red-500/20 text-red-300 border-red-500/40'
                        : 'bg-slate-950/40 text-slate-400 border-slate-850 hover:bg-slate-900 hover:text-red-400'
                    }`}
                  >
                    <span className="w-1.5 h-1.5 rounded-full bg-red-400" />
                    Failed ({failedList.length})
                  </button>

                  <button
                    type="button"
                    onClick={() => { setStatusSubFilter('pending'); setCurrentPage(1); }}
                    className={`px-3 py-1 rounded-xl text-[11px] font-bold transition-all cursor-pointer shrink-0 border flex items-center gap-1.5 ${
                      statusSubFilter === 'pending'
                        ? 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                        : 'bg-slate-950/40 text-slate-400 border-slate-850 hover:bg-slate-900 hover:text-amber-400'
                    }`}
                  >
                    <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                    Pending ({pendingList.length})
                  </button>
                </div>
              )}
            </div>

            {/* TAB CONTENT 1: IN PROGRESS */}
            {activeTab === 'in_progress' && (
              <div className="p-5 sm:p-6 space-y-4">
                {filteredInProgress.length === 0 ? (
                  <div className="text-center py-12 px-4 rounded-2xl bg-slate-950/40 border border-slate-900 space-y-3">
                    <div className="w-12 h-12 rounded-full bg-purple-500/10 border border-purple-500/20 text-purple-400 flex items-center justify-center mx-auto">
                      <CheckCircle2 size={24} />
                    </div>
                    <div>
                      <h4 className="text-sm font-bold text-slate-200">No Active Publishing Tasks</h4>
                      <p className="text-xs text-slate-500 mt-1 max-w-sm mx-auto">
                        All queued jobs have completed processing. Select accounts and publish a campaign to track progress here.
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 gap-4">
                    {filteredInProgress.map((item) => (
                      <div
                        key={item.id}
                        onClick={() => openDetailModal(item)}
                        className="group bg-slate-900/60 hover:bg-slate-900/90 border border-slate-800/80 hover:border-purple-500/40 p-5 rounded-2xl shadow-xl transition-all cursor-pointer space-y-4 relative overflow-hidden"
                      >
                        {/* Glowing progress accent */}
                        <div 
                          className="absolute top-0 left-0 bottom-0 bg-purple-500/5 transition-all duration-300 pointer-events-none"
                          style={{ width: `${item.progress_percent}%` }}
                        />

                        <div className="flex items-start justify-between gap-4 relative z-10">
                          
                          {/* Left: Thumbnail & Info */}
                          <div className="flex items-center gap-3.5 min-w-0">
                            {/* Media Thumbnail */}
                            <div className="w-14 h-14 rounded-xl bg-slate-950 overflow-hidden border border-slate-800 shrink-0 flex items-center justify-center relative shadow-inner">
                              {item.post?.media_url ? (
                                item.post.media_type === "REELS" ? (
                                  <video src={item.post.media_url} className="w-full h-full object-cover" />
                                ) : (
                                  <img src={item.post.media_url} alt="Thumbnail" className="w-full h-full object-cover" />
                                )
                              ) : (
                                <ImageIcon size={20} className="text-slate-600" />
                              )}
                              <span className="absolute bottom-1 right-1 px-1 py-0.5 rounded text-[8px] font-extrabold bg-slate-950/80 text-purple-400 border border-slate-800 uppercase">
                                {item.post?.media_type || "IMG"}
                              </span>
                            </div>

                            {/* Account & Details */}
                            <div className="min-w-0 space-y-1">
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className="font-mono text-xs font-extrabold text-purple-400 group-hover:text-purple-300 underline underline-offset-2">
                                  #{item.id}
                                </span>
                                <h4 className="text-sm font-bold text-slate-100 truncate">
                                  @{item.account?.instagram_username || "unknown"}
                                </h4>
                                <span className="px-2 py-0.5 rounded-lg text-[10px] font-bold bg-slate-800 text-slate-400 border border-slate-750">
                                  {item.account?.group_name || "Default Workspace"}
                                </span>
                              </div>

                              <p className="text-xs text-slate-400 line-clamp-1 font-medium">
                                {item.post?.caption || "No caption provided"}
                              </p>
                              
                              <p className="text-[11px] text-purple-300/80 font-mono font-medium flex items-center gap-1.5">
                                <span className="w-1.5 h-1.5 rounded-full bg-purple-400 animate-ping" />
                                Step: {item.current_step || "Processing Container"}
                              </p>
                            </div>
                          </div>

                          {/* Right: Status Pill & Percentage */}
                          <div className="text-right shrink-0 space-y-1">
                            <span className={`inline-flex items-center gap-1 px-3 py-1 rounded-xl text-xs font-extrabold uppercase border ${getBadgeStyle(item.status)}`}>
                              <RefreshCw size={12} className="animate-spin" />
                              {item.status}
                            </span>
                            <p className="text-xs font-mono font-bold text-slate-300">
                              {item.progress_percent}%
                            </p>
                          </div>
                        </div>

                        {/* Animated Progress Bar */}
                        <div className="space-y-1.5 relative z-10">
                          <div className="w-full h-2.5 rounded-full bg-slate-950 overflow-hidden border border-slate-850">
                            <motion.div
                              initial={{ width: 0 }}
                              animate={{ width: `${item.progress_percent}%` }}
                              transition={{ duration: 0.5 }}
                              className="h-full bg-gradient-to-r from-purple-500 via-pink-500 to-amber-400 rounded-full"
                            />
                          </div>

                          <div className="flex items-center justify-between text-[11px] font-mono text-slate-400">
                            <span>Elapsed: {item.elapsed_time || 0}s</span>
                            <span className="text-purple-400 font-bold">{getEstimatedRemaining(item)}</span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* TAB CONTENT 2: STATUS */}
            {activeTab === 'status' && (
              <div className="p-5 sm:p-6 space-y-4">
                {paginatedStatusList.length === 0 ? (
                  <div className="text-center py-12 px-4 rounded-2xl bg-slate-950/40 border border-slate-900 space-y-3">
                    <Info size={24} className="text-slate-600 mx-auto" />
                    <div>
                      <h4 className="text-sm font-bold text-slate-300">No Matching Status Records</h4>
                      <p className="text-xs text-slate-500 mt-1">
                        Try adjusting your search query or switching the status filter above.
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {paginatedStatusList.map((item) => (
                      <div
                        key={item.id}
                        onClick={() => openDetailModal(item)}
                        className="group bg-slate-900/40 hover:bg-slate-900/80 border border-slate-800/70 hover:border-purple-500/30 p-4 rounded-2xl transition-all cursor-pointer flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                      >
                        {/* Left: Progress ID, Account, Thumbnail & Caption */}
                        <div className="flex items-center gap-3.5 min-w-0">
                          {/* Thumbnail */}
                          <div className="w-12 h-12 rounded-xl bg-slate-950 overflow-hidden border border-slate-800 shrink-0 flex items-center justify-center relative shadow-inner">
                            {item.post?.media_url ? (
                              item.post.media_type === "REELS" ? (
                                <video src={item.post.media_url} className="w-full h-full object-cover" />
                              ) : (
                                <img src={item.post.media_url} alt="Thumbnail" className="w-full h-full object-cover" />
                              )
                            ) : (
                              <ImageIcon size={16} className="text-slate-600" />
                            )}
                          </div>

                          <div className="min-w-0 space-y-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-mono text-xs font-extrabold text-purple-400 group-hover:text-purple-300">
                                #{item.id}
                              </span>
                              <span className="text-sm font-bold text-slate-200 truncate">
                                @{item.account?.instagram_username || "unknown"}
                              </span>
                              <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-800 text-slate-400 border border-slate-750">
                                {item.account?.group_name || "Default Workspace"}
                              </span>
                            </div>

                            <p className="text-xs text-slate-400 truncate max-w-md">
                              {item.post?.caption || item.current_step || "No caption details"}
                            </p>

                            <p className="text-[10px] text-slate-500 font-mono">
                              Created: {new Date(item.created_at).toLocaleString()}
                            </p>
                          </div>
                        </div>

                        {/* Right: Status Badge & Action */}
                        <div className="flex items-center gap-3 shrink-0 self-end sm:self-center">
                          <span className={`px-3 py-1 rounded-xl text-xs font-extrabold uppercase border ${getBadgeStyle(item.status)}`}>
                            {item.status}
                          </span>

                          {/* Retry button for failed items */}
                          {isFailed(item.status) && (
                            <button
                              type="button"
                              onClick={(e) => handleRetry(item.id, e)}
                              disabled={retryingIds[item.id]}
                              className="px-3 py-1.5 bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 text-red-400 hover:text-red-300 rounded-xl text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 disabled:opacity-50"
                              title="Retry Publishing"
                            >
                              <RotateCcw size={12} className={retryingIds[item.id] ? "animate-spin" : ""} />
                              <span>{retryingIds[item.id] ? "Retrying..." : "Retry"}</span>
                            </button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Pagination Footer Controls */}
                {totalPages > 1 && (
                  <div className="flex items-center justify-between border-t border-slate-800/80 pt-4 text-xs">
                    <span className="text-slate-400 font-mono">
                      Showing Page <strong className="text-slate-200">{currentPage}</strong> of <strong className="text-slate-200">{totalPages}</strong>
                    </span>

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                        disabled={currentPage === 1}
                        className="px-3 py-1.5 rounded-xl border border-slate-800 bg-slate-900/80 text-slate-300 hover:bg-slate-800 transition-all cursor-pointer disabled:opacity-40 flex items-center gap-1"
                      >
                        <ChevronLeft size={14} />
                        <span>Prev</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                        disabled={currentPage === totalPages}
                        className="px-3 py-1.5 rounded-xl border border-slate-800 bg-slate-900/80 text-slate-300 hover:bg-slate-800 transition-all cursor-pointer disabled:opacity-40 flex items-center gap-1"
                      >
                        <span>Next</span>
                        <ChevronRight size={14} />
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* DETAIL MODAL (Opens when clicking any Progress ID) */}
      <AnimatePresence>
        {selectedDetailItem && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-slate-950/80 backdrop-blur-md">
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="bg-slate-900 border border-slate-800 w-full max-w-3xl rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
            >
              {/* Modal Header */}
              <div className="p-6 bg-slate-950 border-b border-slate-800 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-purple-500/10 border border-purple-500/20 text-purple-400 rounded-xl">
                    <FileCode size={20} />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="text-base font-bold text-slate-100 font-outfit">Publishing Job Detail</h3>
                      <span className="font-mono text-xs font-bold text-purple-400 bg-purple-500/10 border border-purple-500/20 px-2 py-0.5 rounded">
                        #{selectedDetailItem.id}
                      </span>
                    </div>
                    <p className="text-xs text-slate-400 mt-0.5">
                      Account: @{selectedDetailItem.account?.instagram_username} • Workspace: {selectedDetailItem.account?.group_name || "Default"}
                    </p>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => setSelectedDetailItem(null)}
                  className="p-2 rounded-xl bg-slate-900 border border-slate-800 text-slate-400 hover:text-slate-200 cursor-pointer transition-all"
                >
                  <X size={18} />
                </button>
              </div>

              {/* Modal Body */}
              <div className="p-6 overflow-y-auto space-y-6 flex-1 text-xs">
                {/* Top Grid: Status & Timings */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 p-4 rounded-2xl bg-slate-950/60 border border-slate-800/80">
                  <div>
                    <span className="block text-slate-500 font-bold uppercase text-[9px]">Current Status</span>
                    <span className={`inline-block mt-1 px-2.5 py-0.5 rounded-lg text-xs font-extrabold uppercase border ${getBadgeStyle(selectedDetailItem.status)}`}>
                      {selectedDetailItem.status}
                    </span>
                  </div>

                  <div>
                    <span className="block text-slate-500 font-bold uppercase text-[9px]">Progress</span>
                    <span className="text-slate-200 font-mono font-bold text-sm">{selectedDetailItem.progress_percent}%</span>
                  </div>

                  <div>
                    <span className="block text-slate-500 font-bold uppercase text-[9px]">Elapsed Time</span>
                    <span className="text-slate-200 font-mono font-bold">{selectedDetailItem.elapsed_time || 0} seconds</span>
                  </div>

                  <div>
                    <span className="block text-slate-500 font-bold uppercase text-[9px]">Retries</span>
                    <span className="text-slate-200 font-mono font-bold">{selectedDetailItem.retry_count} / 3</span>
                  </div>
                </div>

                {/* Media & Caption Details */}
                <div className="space-y-3 p-4 rounded-2xl bg-slate-950/40 border border-slate-800/60">
                  <h4 className="text-xs font-bold text-purple-400 uppercase tracking-wider">Media & Campaign Payload</h4>
                  <div className="flex gap-4 items-start">
                    {selectedDetailItem.post?.media_url && (
                      <div className="w-24 h-24 rounded-xl bg-slate-950 border border-slate-800 overflow-hidden shrink-0">
                        {selectedDetailItem.post.media_type === "REELS" ? (
                          <video src={selectedDetailItem.post.media_url} controls className="w-full h-full object-cover" />
                        ) : (
                          <img src={selectedDetailItem.post.media_url} className="w-full h-full object-cover" alt="Media" />
                        )}
                      </div>
                    )}
                    <div className="space-y-2 flex-1 min-w-0">
                      <div>
                        <span className="block text-slate-500 font-bold uppercase text-[9px]">Caption</span>
                        <p className="text-slate-300 font-medium whitespace-pre-wrap">{selectedDetailItem.post?.caption || "No caption"}</p>
                      </div>
                      <div className="flex gap-4 font-mono text-[10px] text-slate-400 flex-wrap">
                        <span>Type: {selectedDetailItem.post?.media_type}</span>
                        <span>File: {selectedDetailItem.post?.filename || "direct_media"}</span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Complete Timeline Steps */}
                <div className="space-y-3">
                  <h4 className="text-xs font-bold text-purple-400 uppercase tracking-wider">Publishing Timeline Steps</h4>
                  <div className="space-y-2 relative border-l-2 border-slate-800 pl-4 ml-2">
                    <div className="relative">
                      <span className="absolute -left-[21px] top-0.5 w-2.5 h-2.5 rounded-full bg-green-500" />
                      <p className="font-bold text-slate-200">1. Job Created & Enqueued</p>
                      <p className="text-[10px] text-slate-500 font-mono">{new Date(selectedDetailItem.created_at).toLocaleString()}</p>
                    </div>

                    <div className="relative pt-2">
                      <span className={`absolute -left-[21px] top-2.5 w-2.5 h-2.5 rounded-full ${selectedDetailItem.progress_percent >= 30 ? "bg-green-500" : "bg-slate-700"}`} />
                      <p className="font-bold text-slate-200">2. Media Validated & Container Initialized</p>
                      <p className="text-[10px] text-slate-500 font-mono">Step: {selectedDetailItem.current_step || "Pending"}</p>
                    </div>

                    <div className="relative pt-2">
                      <span className={`absolute -left-[21px] top-2.5 w-2.5 h-2.5 rounded-full ${selectedDetailItem.progress_percent >= 80 ? "bg-green-500" : "bg-slate-700"}`} />
                      <p className="font-bold text-slate-200">3. Meta API Container Processing & Verification</p>
                      <p className="text-[10px] text-slate-500 font-mono">Elapsed: {selectedDetailItem.elapsed_time}s</p>
                    </div>

                    <div className="relative pt-2">
                      <span className={`absolute -left-[21px] top-2.5 w-2.5 h-2.5 rounded-full ${isSuccess(selectedDetailItem.status) ? "bg-green-500" : isFailed(selectedDetailItem.status) ? "bg-red-500" : "bg-slate-700"}`} />
                      <p className="font-bold text-slate-200">4. Published to Instagram Feed / Reels</p>
                      <p className="text-[10px] text-slate-500 font-mono">Status: {selectedDetailItem.status}</p>
                    </div>
                  </div>
                </div>

                {/* Error & API Diagnostics Log */}
                <div className="space-y-3">
                  <div className="flex justify-between items-center">
                    <h4 className="text-xs font-bold text-purple-400 uppercase tracking-wider">API Logs & Meta Diagnostic Payload</h4>
                    <button
                      type="button"
                      onClick={() => copyToClipboard(JSON.stringify({ item: selectedDetailItem, logs: selectedLogs }, null, 2), "modal_json")}
                      className="flex items-center gap-1 text-[11px] text-purple-400 hover:text-purple-300 font-semibold cursor-pointer"
                    >
                      <Copy size={12} />
                      <span>{copiedId === "modal_json" ? "Copied!" : "Copy Full JSON"}</span>
                    </button>
                  </div>

                  {loadingModalLogs ? (
                    <div className="p-4 text-center text-slate-500">Loading API logs...</div>
                  ) : selectedLogs.length === 0 ? (
                    <div className="p-4 rounded-xl bg-slate-950/40 border border-slate-800 text-slate-500 text-center">
                      No Meta API error logs recorded for this job.
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {selectedLogs.map(log => (
                        <div key={log.id} className="p-4 rounded-xl bg-slate-950 border border-red-500/20 space-y-2 font-mono text-[11px]">
                          <div className="flex justify-between text-red-400 font-bold">
                            <span>HTTP {log.http_status || "ERR"} • Code: {log.meta_error_code || "N/A"}</span>
                            <span>Subcode: {log.subcode || "N/A"}</span>
                          </div>
                          <p className="text-slate-300">{log.message}</p>
                          {log.request_url && <p className="text-slate-500 truncate">URL: {log.request_url}</p>}
                          {log.fbtrace_id && <p className="text-slate-500">fbtrace_id: {log.fbtrace_id}</p>}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Modal Footer */}
              <div className="p-4 bg-slate-950 border-t border-slate-800 flex justify-between items-center gap-4">
                {isFailed(selectedDetailItem.status) ? (
                  <button
                    type="button"
                    onClick={(e) => {
                      handleRetry(selectedDetailItem.id, e);
                      setSelectedDetailItem(null);
                    }}
                    className="px-5 py-2.5 bg-purple-500 hover:bg-purple-400 text-slate-950 font-bold rounded-xl text-xs flex items-center gap-2 cursor-pointer transition-all"
                  >
                    <RotateCcw size={14} />
                    <span>Retry Publishing Now</span>
                  </button>
                ) : (
                  <div />
                )}

                <button
                  type="button"
                  onClick={() => setSelectedDetailItem(null)}
                  className="px-5 py-2.5 bg-slate-900 hover:bg-slate-800 text-slate-200 font-bold rounded-xl text-xs border border-slate-800 cursor-pointer transition-all"
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
