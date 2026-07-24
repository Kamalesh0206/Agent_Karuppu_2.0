import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import { API_URL, WS_URL } from '../config.ts';
import { 
  Send, Sparkles, Image as ImageIcon, Video, Layers, Clock, AlertTriangle, 
  CheckCircle2, Play, RefreshCw, FileCode, Download, Copy, Trash2, Globe, BarChart3, Smile,
  ChevronUp, ChevronDown
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import PublishingStatusPanel from '../components/PublishingStatusPanel.tsx';

interface InstagramAccount {
  id: number;
  instagram_username: string;
  profile_picture: string | null;
  followers_count: number;
}

interface QueueItem {
  id: number;
  post_id: number;
  account_id: number;
  status: string;
  progress_percent: number;
  current_step: string | null;
  elapsed_time: number;
  retry_count: number;
  post: {
    media_url: string;
    media_type: string;
    caption: string;
  };
  account: {
    instagram_username: string;
  };
}

interface ErrorLog {
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

export default function Dashboard() {
  const [accounts, setAccounts] = useState<InstagramAccount[]>([]);
  const [selectedAccounts, setSelectedAccounts] = useState<number[]>([]);
  const [caption, setCaption] = useState('');
  
  // Media parameters
  const [oneDriveUrl, setOneDriveUrl] = useState('');
  const [validatingLink, setValidatingLink] = useState(false);
  const [linkVerified, setLinkVerified] = useState(false);
  const [validatedMetadata, setValidatedMetadata] = useState<{
    filename: string;
    mime_type: string;
    size: number;
    direct_download_url: string;
  } | null>(null);

  const [mediaUrl, setMediaUrl] = useState('');
  const [mediaType, setMediaType] = useState<'IMAGE' | 'REELS'>('IMAGE');

  // Media source tabs & uploading states
  const [mediaSourceTab, setMediaSourceTab] = useState<'url' | 'upload'>('url');
  const [uploadingFile, setUploadingFile] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [selectedRawFile, setSelectedRawFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  // Real-time publishing and queue status
  const [activeQueue, setActiveQueue] = useState<QueueItem[]>([]);
  const [errorLogs, setErrorLogs] = useState<ErrorLog[]>([]);
  const [publishing, setPublishing] = useState(false);
  const [formError, setFormError] = useState('');
  const [formSuccess, setFormSuccess] = useState('');
  const [errorLogExpanded, setErrorLogExpanded] = useState(false);
  const [selectionMode, setSelectionMode] = useState<'all' | 'manual'>('manual');
  const [searchQuery, setSearchQuery] = useState('');

  // AI assistant states
  const [aiLoading, setAiLoading] = useState(false);
  const [aiLang, setAiLang] = useState('Spanish');
  const [aiQualityScore, setAiQualityScore] = useState<number | null>(null);

  const socketRef = useRef<WebSocket | null>(null);

  const fetchAccounts = async () => {
    try {
      const response = await axios.get(`${API_URL}/accounts`, {
        headers: { Authorization: `Bearer ${localStorage.getItem("token")}` }
      });
      setAccounts(response.data);
    } catch (err) {
      console.error("Failed to load accounts: ", err);
    }
  };

  const fetchStatusAndLogs = async () => {
    try {
      const [queueRes, errorRes] = await Promise.all([
        axios.get(`${API_URL}/publish/status`, {
          headers: { Authorization: `Bearer ${localStorage.getItem("token")}` }
        }),
        axios.get(`${API_URL}/publish/errors`, {
          headers: { Authorization: `Bearer ${localStorage.getItem("token")}` }
        })
      ]);
      setActiveQueue(queueRes.data.filter((item: QueueItem) => 
        !["SUCCESS", "Completed", "FAILED", "Failed", "Cancelled"].includes(item.status)
      ));
      setErrorLogs(errorRes.data);
    } catch (err) {
      console.error("Failed to fetch status: ", err);
    }
  };

  // Load draft from localStorage on mount
  useEffect(() => {
    const savedDraft = localStorage.getItem("campaign_draft");
    if (savedDraft) {
      try {
        const draft = JSON.parse(savedDraft);
        if (draft.caption) setCaption(draft.caption);
        if (draft.oneDriveUrl) setOneDriveUrl(draft.oneDriveUrl);
        if (draft.mediaUrl) setMediaUrl(draft.mediaUrl);
        if (draft.mediaType) setMediaType(draft.mediaType);
        if (draft.validatedMetadata) setValidatedMetadata(draft.validatedMetadata);
        if (draft.linkVerified) setLinkVerified(draft.linkVerified);
        if (draft.mediaSourceTab) setMediaSourceTab(draft.mediaSourceTab);
      } catch (e) {
        console.error("Failed to parse campaign draft: ", e);
      }
    }
  }, []);

  // Save draft on state updates
  useEffect(() => {
    const draft = {
      caption,
      oneDriveUrl,
      mediaUrl,
      mediaType,
      validatedMetadata,
      linkVerified,
      mediaSourceTab
    };
    localStorage.setItem("campaign_draft", JSON.stringify(draft));
  }, [caption, oneDriveUrl, mediaUrl, mediaType, validatedMetadata, linkVerified, mediaSourceTab]);

  const handleLocalFileUpload = async (file: File) => {
    setSelectedRawFile(file);
    // Validate client-side first
    const filename = file.name;
    const ext = filename.split('.').pop()?.toLowerCase() || '';
    
    const isImage = ['jpg', 'jpeg', 'png', 'webp'].includes(ext);
    const isVideo = ['mp4', 'mov'].includes(ext);
    
    console.log("[Local Media Upload] File selected:", {
      name: file.name,
      size: file.size,
      type: file.type,
      extension: ext
    });

    if (!isImage && !isVideo) {
      setFormError("Unsupported file type. Please upload JPG, JPEG, PNG, WEBP images or MP4, MOV videos.");
      return;
    }
    
    const maxSize = isImage ? 10 * 1024 * 1024 : 100 * 1024 * 1024;
    if (file.size > maxSize) {
      const typeStr = isImage ? "Image" : "Video";
      const limitStr = isImage ? "10MB" : "100MB";
      setFormError(`${typeStr} size exceeds the limit of ${limitStr}.`);
      return;
    }
    
    setUploadingFile(true);
    setUploadProgress(0);
    setFormError('');
    setFormSuccess('');
    setLinkVerified(false);
    setValidatedMetadata(null);
    
    try {
      const formData = new FormData();
      formData.append("file", file);
      
      const targetEndpoints = [
        `${API_URL}/media/upload`,
        `${API_URL}/api/media/upload`
      ];

      let response = null;
      let lastErr = null;

      for (const endpoint of targetEndpoints) {
        try {
          console.log(`[Local Media Upload] Attempting POST to: ${endpoint}`);
          response = await axios.post(endpoint, formData, {
            headers: { 
              'Content-Type': 'multipart/form-data',
              Authorization: `Bearer ${localStorage.getItem("token")}`
            },
            onUploadProgress: (progressEvent) => {
              if (progressEvent.total) {
                const percent = Math.round((progressEvent.loaded * 100) / progressEvent.total);
                setUploadProgress(percent);
              }
            }
          });
          if (response && response.status === 200) {
            console.log(`[Local Media Upload] Request succeeded via ${endpoint}`, response.data);
            break;
          }
        } catch (e: any) {
          lastErr = e;
          if (e.response?.status === 404) {
            console.warn(`[Local Media Upload] Endpoint ${endpoint} returned 404, attempting fallback route...`);
            continue;
          }
          throw e;
        }
      }

      if (!response && lastErr) {
        throw lastErr;
      }
      
      const data = response!.data;
      setLinkVerified(true);
      setMediaUrl(data.storage_url || data.public_url);
      setOneDriveUrl(data.storage_url || data.public_url); // populate OneDrive URL state to prevent validator blocks
      setMediaType(data.media_type);
      setValidatedMetadata({
        filename: data.filename,
        mime_type: data.media_type === "IMAGE" ? "image/jpeg" : "video/mp4",
        size: data.file_size,
        direct_download_url: data.storage_url || data.public_url
      });
      setFormSuccess("Media file uploaded to Supabase Storage and verified successfully.");
    } catch (err: any) {
      console.error("[Local Media Upload Error]", err);
      setLinkVerified(false);
      
      const status = err.response?.status;
      const detail = err.response?.data?.detail;

      if (status === 404 || detail === "Not Found") {
        setFormError("Upload endpoint not found on backend (404). Please verify backend server service is active.");
      } else if (status === 401) {
        setFormError("Authentication session expired. Please log in again.");
      } else if (status === 403) {
        setFormError("You do not have permission to upload media files.");
      } else if (status === 422) {
        setFormError("Invalid upload payload structure (422). Please try another file.");
      } else if (status === 500) {
        setFormError(detail || "Backend storage service error (500). Unable to save file to Supabase Storage.");
      } else {
        setFormError(detail || "Media file upload failed. Please check network connection and try again.");
      }
    } finally {
      setUploadingFile(false);
    }
  };

  const handleRemoveUploadedFile = () => {
    setLinkVerified(false);
    setMediaUrl('');
    setOneDriveUrl('');
    setValidatedMetadata(null);
    setFormSuccess('');
    setSelectedRawFile(null);
  };

  // WebSocket connection for real-time progress broadcast updates
  useEffect(() => {
    fetchAccounts();
    fetchStatusAndLogs();

    const wsUrl = `${WS_URL}/publish/ws`;
    const socket = new WebSocket(wsUrl);
    socketRef.current = socket;

    socket.onopen = () => {
      console.log("WebSocket connected to progressive stream.");
    };

    socket.onmessage = (event) => {
      try {
        const update = JSON.parse(event.data);
        console.log("WebSocket progressive update: ", update);
        fetchStatusAndLogs();
      } catch (err) {
        console.error("Failed to parse socket update: ", err);
      }
    };

    socket.onclose = () => {
      console.log("WebSocket disconnected.");
    };

    return () => {
      if (socketRef.current) socketRef.current.close();
    };
  }, []);

  useEffect(() => {
    if (selectionMode === 'all') {
      setSelectedAccounts(accounts.map(acc => acc.id));
    } else {
      setSelectedAccounts([]);
    }
  }, [selectionMode, accounts]);

  const handleValidateLink = async () => {
    const trimmedUrl = oneDriveUrl.trim();
    if (!trimmedUrl) {
      setFormError("Media sharing link is required.");
      return;
    }

    setValidatingLink(true);
    setFormError('');
    setFormSuccess('');
    setLinkVerified(false);
    setValidatedMetadata(null);

    try {
      const response = await axios.post(`${API_URL}/media/validate-link`, {
        url: trimmedUrl
      }, {
        headers: { Authorization: `Bearer ${localStorage.getItem("token")}` }
      });

      const data = response.data;
      setLinkVerified(true);
      setValidatedMetadata(data);
      setMediaUrl(data.direct_download_url);
      setMediaType(data.media_type || (data.mime_type.startsWith("video") ? "REELS" : "IMAGE"));
      setFormSuccess("Media link verified successfully.");
    } catch (err: any) {
      setLinkVerified(false);
      setFormError(err.response?.data?.detail || "Invalid media link or link is private.");
    } finally {
      setValidatingLink(false);
    }
  };

  const handlePublish = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');
    setFormSuccess('');

    if (selectedAccounts.length === 0) {
      setFormError("Please check at least one Instagram Profile card.");
      return;
    }
    if (!linkVerified || !mediaUrl) {
      setFormError("Please provide and validate a public media URL first.");
      return;
    }

    setPublishing(true);
    try {
      await axios.post(`${API_URL}/publish`, {
        caption,
        account_ids: selectedAccounts,
        media_url: mediaUrl,
        media_type: mediaType,
        onedrive_share_url: oneDriveUrl.trim(),
        direct_download_url: mediaUrl,
        filename: validatedMetadata?.filename,
        mime_type: validatedMetadata?.mime_type,
        file_size: validatedMetadata?.size
      }, {
        headers: { Authorization: `Bearer ${localStorage.getItem("token")}` }
      });

      setFormSuccess("Publishing jobs enqueued successfully. Monitor step-by-step progress below.");
      setCaption('');
      setOneDriveUrl('');
      setMediaUrl('');
      setLinkVerified(false);
      setValidatedMetadata(null);
      setSelectedAccounts([]);
      localStorage.removeItem("campaign_draft");
      fetchStatusAndLogs();
    } catch (err: any) {
      const errorMsg = err.response?.data?.detail || err.response?.data?.error || err.message || "Queue job injection failed. Publishing worker is not running.";
      setFormError(errorMsg);
    } finally {
      setPublishing(false);
    }
  };

  // Gemini AI integration call hooks
  const optimizeCaption = async () => {
    if (!caption) return;
    setAiLoading(true);
    try {
      const response = await axios.post(`${API_URL}/ai/optimize`, { caption });
      setCaption(response.data.optimized_caption);
    } catch (err) {
      console.error(err);
    } finally {
      setAiLoading(false);
    }
  };

  const suggestHashtags = async () => {
    if (!caption) return;
    setAiLoading(true);
    try {
      const response = await axios.post(`${API_URL}/ai/hashtags`, { caption });
      setCaption(prev => `${prev}\n\n${response.data.hashtags.join(' ')}`);
    } catch (err) {
      console.error(err);
    } finally {
      setAiLoading(false);
    }
  };

  const suggestEmojis = async () => {
    if (!caption) return;
    setAiLoading(true);
    try {
      const response = await axios.post(`${API_URL}/ai/emojis`, { caption });
      setCaption(prev => `${prev} ${response.data.emojis.join('')}`);
    } catch (err) {
      console.error(err);
    } finally {
      setAiLoading(false);
    }
  };

  const translateCaption = async () => {
    if (!caption) return;
    setAiLoading(true);
    try {
      const response = await axios.post(`${API_URL}/ai/translate`, { caption, target_lang: aiLang });
      setCaption(response.data.translated_caption);
    } catch (err) {
      console.error(err);
    } finally {
      setAiLoading(false);
    }
  };

  const checkQualityScore = async () => {
    if (!caption) return;
    setAiLoading(true);
    try {
      const response = await axios.post(`${API_URL}/ai/quality-score`, { caption });
      setAiQualityScore(response.data.score);
    } catch (err) {
      console.error(err);
    } finally {
      setAiLoading(false);
    }
  };

  const copyErrorToClipboard = (log: ErrorLog) => {
    const errorText = JSON.stringify(log, null, 2);
    navigator.clipboard.writeText(errorText);
  };

  const downloadCSV = () => {
    const headers = ["Timestamp", "HTTP Status", "Meta Code", "Message", "Trace ID", "Request URL"];
    const rows = errorLogs.map(l => [
      new Date(l.timestamp).toLocaleString(),
      l.http_status || "N/A",
      l.meta_error_code || "N/A",
      `"${(l.message || "").replace(/"/g, '""')}"`,
      l.fbtrace_id || "N/A",
      l.request_url || "N/A"
    ]);
    const csvContent = "data:text/csv;charset=utf-8," 
      + [headers.join(","), ...rows.map(r => r.join(","))].join("\n");
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `agent_karuppu_meta_errors_${Date.now()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const downloadJSON = () => {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(errorLogs, null, 2));
    const link = document.createElement("a");
    link.setAttribute("href", dataStr);
    link.setAttribute("download", `agent_karuppu_meta_errors_${Date.now()}.json`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const toggleAccountSelection = (id: number) => {
    setSelectedAccounts(prev => 
      prev.includes(id) ? prev.filter(a => a !== id) : [...prev, id]
    );
  };

  const formatBytes = (bytes: number): string => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const getFriendlyStatus = (status: string) => {
    switch (status) {
      case "QUEUED":
        return "Waiting";
      case "DOWNLOADING":
        return "Downloading";
      case "VALIDATING":
        return "Validating";
      case "CREATING_CONTAINER":
        return "Creating Container";
      case "WAITING_CONTAINER":
        return "Waiting Container";
      case "PUBLISHING":
        return "Publishing";
      case "SUCCESS":
        return "Completed";
      case "FAILED":
        return "Failed";
      case "Retrying":
        return "Retrying";
      default:
        return status;
    }
  };

  return (
    <div className="grid grid-cols-1 xl:grid-cols-3 gap-8">
      {/* Central Publishing Control Panel */}
      <div className="xl:col-span-2 space-y-6">
        <div>
          <h1 className="text-3xl font-black font-outfit text-slate-100 mb-1.5">Publish Campaign</h1>
          <p className="text-sm text-slate-400">Validate public media URLs, assemble caption copies, and dispatch campaigns.</p>
        </div>

        {formSuccess && (
          <div className="p-4 rounded-xl bg-green-500/10 border border-green-500/20 text-green-400 text-sm font-semibold">
            {formSuccess}
          </div>
        )}
        {formError && (
          <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm font-semibold flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <span>{formError}</span>
            {selectedRawFile && mediaSourceTab === 'upload' && !uploadingFile && (
              <button
                type="button"
                onClick={() => handleLocalFileUpload(selectedRawFile)}
                className="px-3 py-1.5 bg-purple-500 hover:bg-purple-400 text-slate-950 font-black rounded-lg text-xs flex items-center gap-1.5 cursor-pointer shadow-md shrink-0"
              >
                <RefreshCw size={12} />
                <span>Retry Upload</span>
              </button>
            )}
          </div>
        )}

        <form onSubmit={handlePublish} className="glass-panel p-6 rounded-2xl border border-slate-900 shadow-xl space-y-5">
          {/* Account Checklist */}
          <div className="space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider">Target Profile Cards *</label>
              
              {/* Selection Mode Selector Toggles */}
              <div className="flex gap-4 text-xs font-semibold">
                <label className="flex items-center gap-2 text-slate-300 cursor-pointer select-none">
                  <input 
                    type="radio" 
                    name="selectionMode"
                    checked={selectionMode === 'all'}
                    onChange={() => setSelectionMode('all')}
                    className="accent-purple-500 cursor-pointer"
                  />
                  <span>Select All Profiles ({accounts.length})</span>
                </label>
                <label className="flex items-center gap-2 text-slate-300 cursor-pointer select-none">
                  <input 
                    type="radio" 
                    name="selectionMode"
                    checked={selectionMode === 'manual'}
                    onChange={() => setSelectionMode('manual')}
                    className="accent-purple-500 cursor-pointer"
                  />
                  <span>Select Profiles Manually</span>
                </label>
              </div>
            </div>

            {selectionMode === 'manual' && (
              <div className="space-y-3">
                {/* Username Search Input */}
                <input 
                  type="text"
                  placeholder="Search profiles by username..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full px-4 py-2 rounded-xl bg-slate-900/50 border border-slate-800 focus:border-purple-500/50 outline-none text-slate-300 text-xs transition-all"
                />

                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  {accounts
                    .filter(acc => acc.instagram_username.toLowerCase().includes(searchQuery.toLowerCase()))
                    .map(acc => (
                      <div 
                        key={acc.id}
                        onClick={() => toggleAccountSelection(acc.id)}
                        className={`p-3 rounded-xl border flex items-center gap-3 cursor-pointer transition-all duration-300 ${
                          selectedAccounts.includes(acc.id)
                            ? "bg-purple-500/10 border-purple-500 text-purple-400"
                            : "bg-slate-900/50 border-slate-800 text-slate-400 hover:border-slate-700"
                        }`}
                      >
                        <img src={acc.profile_picture || "https://placekitten.com/200/200"} className="w-8 h-8 rounded-full object-cover" alt="Profile" />
                        <div className="truncate">
                          <p className="text-xs font-bold text-slate-200 truncate">@{acc.instagram_username}</p>
                          <span className="text-[10px] text-slate-500 font-mono">{acc.followers_count.toLocaleString()} followers</span>
                        </div>
                      </div>
                    ))}
                </div>
              </div>
            )}
            
            {selectionMode === 'all' && accounts.length > 0 && (
              <div className="p-3 bg-purple-500/5 border border-purple-500/10 rounded-xl text-xs text-purple-400 font-medium">
                Targeting all {accounts.length} connected Instagram account profiles.
              </div>
            )}
          </div>

          {/* Media Source Toggle and Inputs */}
          <div className="space-y-4">
            <div className="space-y-1.5">
              <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider">Media Source</label>
              <div className="flex bg-slate-900/50 p-1 rounded-xl border border-slate-850 gap-1">
                <button
                  type="button"
                  onClick={() => {
                    setMediaSourceTab('url');
                    handleRemoveUploadedFile();
                  }}
                  className={`flex-1 py-2 text-xs font-bold rounded-lg transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                    mediaSourceTab === 'url' 
                      ? "bg-purple-500/10 border border-purple-500/20 text-purple-400 font-extrabold" 
                      : "text-slate-500 hover:text-slate-350 border border-transparent"
                  }`}
                >
                  <Globe size={13} />
                  <span>Public Media URL</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setMediaSourceTab('upload');
                    handleRemoveUploadedFile();
                  }}
                  className={`flex-1 py-2 text-xs font-bold rounded-lg transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                    mediaSourceTab === 'upload' 
                      ? "bg-purple-500/10 border border-purple-500/20 text-purple-400 font-extrabold" 
                      : "text-slate-500 hover:text-slate-350 border border-transparent"
                  }`}
                >
                  <Download size={13} className="rotate-180" />
                  <span>Upload from Device</span>
                </button>
              </div>
            </div>

            {mediaSourceTab === 'url' && (
              <div className="space-y-3">
                <div className="space-y-2">
                  <label className="block text-xs font-semibold text-slate-500">Public Media URL *</label>
                  <div className="flex gap-2">
                    <input 
                      type="text" 
                      value={oneDriveUrl}
                      onChange={(e) => setOneDriveUrl(e.target.value)}
                      placeholder="OneDrive, Google Drive, Dropbox, S3, CDN, or raw direct link..."
                      className="flex-1 px-4 py-2.5 rounded-xl bg-slate-900/50 border border-slate-800 focus:border-purple-500/50 focus:ring-1 focus:ring-purple-500/50 outline-none text-slate-200 text-sm transition-all placeholder:text-slate-700"
                    />
                    <button
                      type="button"
                      onClick={handleValidateLink}
                      disabled={validatingLink || !oneDriveUrl}
                      className="px-5 py-2.5 border border-slate-800 hover:bg-slate-900 rounded-xl text-xs font-bold text-slate-300 transition-all cursor-pointer flex items-center justify-center gap-2 disabled:opacity-50"
                    >
                      {validatingLink ? (
                        <>
                          <svg className="animate-spin h-4 w-4 text-slate-300" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                          </svg>
                          <span>Validating...</span>
                        </>
                      ) : (
                        <span>Validate Link</span>
                      )}
                    </button>
                  </div>
                </div>

                {/* Display Verified File Details and Preview */}
                {linkVerified && validatedMetadata && (
                  <motion.div 
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="p-4 rounded-xl bg-purple-500/5 border border-purple-500/10 space-y-4"
                  >
                    <div className="flex items-center justify-between text-xs font-bold">
                      <div className="flex items-center gap-2 text-purple-400">
                        <CheckCircle2 size={16} />
                        <span>Public Media URL Verified</span>
                      </div>
                      <span className="text-[10px] text-green-400 bg-green-500/10 border border-green-500/20 px-2 py-0.5 rounded uppercase tracking-wider">
                        Status: Valid
                      </span>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 text-xs">
                      <div>
                        <span className="block text-slate-500 font-bold uppercase text-[9px] tracking-wider">File Name</span>
                        <span className="text-slate-200 font-medium truncate block max-w-[200px]">{validatedMetadata.filename}</span>
                      </div>
                      <div>
                        <span className="block text-slate-500 font-bold uppercase text-[9px] tracking-wider">File Type</span>
                        <span className="text-slate-200 font-medium">{validatedMetadata.mime_type.startsWith("video") ? "Video" : "Image"}</span>
                      </div>
                      <div>
                        <span className="block text-slate-500 font-bold uppercase text-[9px] tracking-wider">File Size</span>
                        <span className="text-slate-200 font-mono font-medium">{formatBytes(validatedMetadata.size)}</span>
                      </div>
                    </div>

                    <div>
                      <span className="block text-slate-500 font-bold uppercase text-[9px] tracking-wider">Final Resolved Media URL</span>
                      <span className="text-slate-200 font-mono text-[10px] truncate block max-w-full text-slate-400 select-all" title={mediaUrl}>
                        {mediaUrl}
                      </span>
                    </div>

                    <div className="space-y-1.5">
                      <span className="block text-slate-500 font-bold uppercase text-[9px] tracking-wider">Preview</span>
                      <div className="w-full h-48 bg-slate-950/60 rounded-xl overflow-hidden border border-slate-900 flex items-center justify-center relative">
                        {mediaType === "REELS" ? (
                          <video src={mediaUrl} controls className="w-full h-full object-contain" />
                        ) : (
                          <img src={mediaUrl} className="w-full h-full object-contain" alt="Media Preview" />
                        )}
                      </div>
                    </div>
                  </motion.div>
                )}
              </div>
            )}

            {mediaSourceTab === 'upload' && (
              <div className="space-y-3">
                <input 
                  type="file" 
                  ref={fileInputRef} 
                  onChange={(e) => {
                    if (e.target.files && e.target.files.length > 0) {
                      handleLocalFileUpload(e.target.files[0]);
                    }
                  }}
                  accept="image/jpeg,image/jpg,image/png,image/webp,video/mp4,video/quicktime"
                  className="hidden"
                />

                {!linkVerified && !uploadingFile && (
                  <div 
                    onDragOver={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                    }}
                    onDrop={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                        handleLocalFileUpload(e.dataTransfer.files[0]);
                      }
                    }}
                    onClick={() => fileInputRef.current?.click()}
                    className="border-2 border-dashed border-slate-800 hover:border-purple-500/50 bg-slate-950/40 hover:bg-purple-500/[0.02] p-8 rounded-2xl text-center cursor-pointer transition-all flex flex-col items-center justify-center gap-3"
                  >
                    <div className="p-3 bg-purple-500/10 border border-purple-500/20 text-purple-400 rounded-xl">
                      <Download size={24} className="rotate-180" />
                    </div>
                    <div>
                      <p className="text-sm font-bold text-slate-200">Drag & Drop files here, or <span className="text-purple-400">Browse Files</span></p>
                      <p className="text-[10px] text-slate-500 mt-1">Supports JPG, JPEG, PNG, WEBP (max 10MB) & MP4, MOV (max 100MB)</p>
                    </div>
                  </div>
                )}

                {uploadingFile && (
                  <div className="p-6 rounded-2xl border border-slate-850 bg-slate-950/40 space-y-4 text-center">
                    <RefreshCw size={20} className="animate-spin text-purple-500 mx-auto" />
                    <div className="space-y-2">
                      <p className="text-xs font-bold text-slate-300">Uploading media to secure storage...</p>
                      <div className="w-full bg-slate-900 h-2 rounded-full overflow-hidden border border-slate-800">
                        <div 
                          className="bg-purple-500 h-full rounded-full transition-all duration-300"
                          style={{ width: `${uploadProgress}%` }}
                        />
                      </div>
                      <span className="text-[10px] text-purple-400 font-mono font-bold">{uploadProgress}% uploaded</span>
                    </div>
                  </div>
                )}

                {linkVerified && validatedMetadata && (
                  <motion.div 
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="p-4 rounded-xl bg-purple-500/5 border border-purple-500/10 space-y-4"
                  >
                    <div className="flex items-center justify-between text-xs font-bold">
                      <div className="flex items-center gap-2 text-purple-400">
                        <CheckCircle2 size={16} />
                        <span>Uploaded to Supabase Cloud Storage</span>
                      </div>
                      <button
                        type="button"
                        onClick={handleRemoveUploadedFile}
                        className="text-[10px] text-red-400 bg-red-500/10 border border-red-500/20 px-2 py-0.5 rounded uppercase tracking-wider flex items-center gap-1 cursor-pointer hover:bg-red-500/20 transition-all"
                      >
                        <Trash2 size={10} />
                        <span>Remove</span>
                      </button>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 text-xs">
                      <div>
                        <span className="block text-slate-500 font-bold uppercase text-[9px] tracking-wider">File Name</span>
                        <span className="text-slate-200 font-medium truncate block max-w-[200px]">{validatedMetadata.filename}</span>
                      </div>
                      <div>
                        <span className="block text-slate-500 font-bold uppercase text-[9px] tracking-wider">File Type</span>
                        <span className="text-slate-200 font-medium">{validatedMetadata.mime_type.startsWith("video") ? "Video" : "Image"}</span>
                      </div>
                      <div>
                        <span className="block text-slate-500 font-bold uppercase text-[9px] tracking-wider">File Size</span>
                        <span className="text-slate-200 font-mono font-medium">{formatBytes(validatedMetadata.size)}</span>
                      </div>
                    </div>

                    <div className="space-y-1.5">
                      <span className="block text-slate-500 font-bold uppercase text-[9px] tracking-wider">Preview</span>
                      <div className="w-full h-48 bg-slate-950/60 rounded-xl overflow-hidden border border-slate-900 flex items-center justify-center relative">
                        {mediaType === "REELS" ? (
                          <video src={mediaUrl} controls className="w-full h-full object-contain" />
                        ) : (
                          <img src={mediaUrl} className="w-full h-full object-contain" alt="Media Preview" />
                        )}
                      </div>
                    </div>
                  </motion.div>
                )}
              </div>
            )}
          </div>

          {/* Caption Input */}
          <div className="space-y-2">
            <div className="flex justify-between items-center">
              <label className="block text-xs font-bold text-slate-400 uppercase tracking-wider">Campaign Caption</label>
              <button
                type="button"
                onClick={suggestHashtags}
                disabled={aiLoading || !caption}
                className="flex items-center gap-1 text-xs text-purple-400 hover:text-purple-300 font-semibold cursor-pointer disabled:opacity-50"
              >
                <Sparkles size={12} className="animate-pulse" />
                <span>Suggest Hashtags (AI)</span>
              </button>
            </div>
            <textarea
              rows={4}
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              placeholder="Write your creative caption hook here..."
              className="w-full px-4 py-3 rounded-xl bg-slate-900/50 border border-slate-800 focus:border-purple-500/50 focus:ring-1 focus:ring-purple-500/50 outline-none text-slate-200 text-sm transition-all"
            />
          </div>

          <button
            type="submit"
            disabled={publishing || !linkVerified}
            className="w-full py-4 gradient-btn text-slate-950 font-extrabold rounded-xl shadow-lg hover:shadow-purple-500/10 flex items-center justify-center gap-2 cursor-pointer transition-all disabled:opacity-50"
          >
            <Play size={16} />
            <span>Publish Campaigns</span>
          </button>
        </form>

      </div>

      {/* Right Column: Enhanced Publishing Status Panel */}
      <div className="space-y-6">
        <PublishingStatusPanel onQueueUpdated={fetchStatusAndLogs} />
      </div>
    </div>
  );
}
