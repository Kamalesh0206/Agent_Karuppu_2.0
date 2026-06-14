import React, { useState, useEffect, useRef } from 'react'
import { useAuth } from '../App'
import { Image, Video, Send, FilePlus, AlertCircle, RefreshCw, CheckCircle2, XCircle, ChevronDown, ChevronUp, Terminal, Clock, PlayCircle } from 'lucide-react'

import { API_BASE } from '../config'

export default function Dashboard() {
  const { user } = useAuth()
  
  // Post Composer states
  const [caption, setCaption] = useState('')
  const [hashtags, setHashtags] = useState('')
  const [selectedAccounts, setSelectedAccounts] = useState([])
  const [mediaFile, setMediaFile] = useState(null)
  
  // Upload status states
  const [uploading, setUploading] = useState(false)
  const [uploadedPath, setUploadedPath] = useState('')
  const [uploadedUrl, setUploadedUrl] = useState('')
  const [isMediaVideo, setIsMediaVideo] = useState(false)

  // System states
  const [accounts, setAccounts] = useState([])
  const [history, setHistory] = useState([])
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [selectedPostDetails, setSelectedPostDetails] = useState(null)
  const [postLogs, setPostLogs] = useState([])
  const [activePostsLogs, setActivePostsLogs] = useState({})
  const [expandedLogs, setExpandedLogs] = useState({})
  const [progressCollapsed, setProgressCollapsed] = useState(false)
  const [historyCollapsed, setHistoryCollapsed] = useState(false)
  const [isMobile, setIsMobile] = useState(false)
  const [gitStatus, setGitStatus] = useState(null)
  const [gitSyncing, setGitSyncing] = useState(false)
  
  const fileInputRef = useRef(null)

  useEffect(() => {
    const handleResize = () => {
      setIsMobile(window.innerWidth <= 1024)
    }
    handleResize()
    window.addEventListener('resize', handleResize)
    return () => window.removeEventListener('resize', handleResize)
  }, [])

  // Fetch accounts and history
  const fetchData = async () => {
    try {
      const headers = { 'Authorization': `Bearer ${user.token}` }
      
      const accResponse = await fetch(`${API_BASE}/accounts`, { headers })
      const accData = await accResponse.json()
      if (accResponse.ok) {
        setAccounts(accData.filter(a => a.status === 'ACTIVE'))
      }

      const histResponse = await fetch(`${API_BASE}/publish-history`, { headers })
      const histData = await histResponse.json()
      if (histResponse.ok) {
        setHistory(histData)
      }
    } catch (err) {
      console.error("Error fetching data:", err)
    }
  }

  useEffect(() => {
    fetchData()
    // Poll history status updates every 7 seconds
    const interval = setInterval(fetchData, 7000)
    return () => clearInterval(interval)
  }, [])

  useEffect(() => {
    if (!selectedPostDetails) {
      setPostLogs([])
      return
    }

    const fetchPostLogs = async () => {
      try {
        const headers = { 'Authorization': `Bearer ${user.token}` }
        const response = await fetch(`${API_BASE}/publish-history/${selectedPostDetails.id}/logs`, { headers })
        if (response.status === 401) return
        if (response.ok) {
          const data = await response.json()
          setPostLogs(data)
        }
      } catch (err) {
        console.error("Error fetching post logs:", err)
      }
    }

    fetchPostLogs()
    
    let intervalId
    if (!['Success', 'Failed'].includes(selectedPostDetails.publish_status)) {
      intervalId = setInterval(fetchPostLogs, 3000)
    }

    return () => {
      if (intervalId) clearInterval(intervalId)
    }
  }, [selectedPostDetails, user.token])

  // Server-Sent Events (SSE) progress stream connection
  useEffect(() => {
    const sseUrl = `${API_BASE}/publish-progress/stream`;
    console.log("Connecting to SSE progress stream:", sseUrl);
    const eventSource = new EventSource(sseUrl);

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        console.log("SSE progress event received:", data);
        
        // Merge real-time progress fields directly into the history state
        setHistory((prevHistory) => {
          return prevHistory.map((post) => {
            if (post.id === data.post_id) {
              return {
                ...post,
                publish_status: data.status,
                progress_percent: data.progress_percent,
                failure_reason: data.failure_reason,
                updated_at: data.updated_at
              };
            }
            return post;
          });
        });
      } catch (err) {
        console.error("Error parsing SSE data:", err);
      }
    };

    eventSource.onerror = (err) => {
      console.error("SSE connection error, closing:", err);
      eventSource.close();
    };

    return () => {
      eventSource.close();
    };
  }, []);

  // Fast poll for active posts
  useEffect(() => {
    const active = history.filter(p => !['Success', 'Failed'].includes(p.publish_status))
    if (active.length === 0) return

    const fastPoll = async () => {
      try {
        const headers = { 'Authorization': `Bearer ${user.token}` }
        const histResponse = await fetch(`${API_BASE}/publish-history`, { headers })
        if (histResponse.ok) {
          const histData = await histResponse.json()
          setHistory(histData)
          
          // Fetch logs for active ones
          const activeNow = histData.filter(p => !['Success', 'Failed'].includes(p.publish_status))
          const logsDict = {}
          for (const post of activeNow) {
            try {
              const res = await fetch(`${API_BASE}/publish-history/${post.id}/logs`, { headers })
              if (res.ok) {
                logsDict[post.id] = await res.json()
              }
            } catch (e) {
              console.error("Error fetching logs for active post:", post.id, e)
            }
          }
          setActivePostsLogs(logsDict)
        }
      } catch (err) {
        console.error("Error fast polling history:", err)
      }
    }

    fastPoll()
    const interval = setInterval(fastPoll, 2500)
    return () => clearInterval(interval)
  }, [history, user.token])

  const fetchGitStatus = async () => {
    try {
      const headers = { 'Authorization': `Bearer ${user.token}` }
      const response = await fetch(`${API_BASE}/git/status`, { headers })
      if (response.ok) {
        const data = await response.json()
        setGitStatus(data)
      }
    } catch (err) {
      console.error("Error fetching git status:", err)
    }
  }

  const triggerGitSync = async () => {
    try {
      setGitSyncing(true)
      const headers = { 'Authorization': `Bearer ${user.token}` }
      const response = await fetch(`${API_BASE}/git/sync`, { method: 'POST', headers })
      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.detail || 'Sync failed')
      }
      fetchGitStatus()
    } catch (err) {
      console.error("Error triggering git sync:", err)
    } finally {
      setGitSyncing(false)
    }
  }

  useEffect(() => {
    fetchGitStatus()
    const interval = setInterval(fetchGitStatus, 10000)
    return () => clearInterval(interval)
  }, [])

  const getPostProgressInfo = (post) => {
    const status = post.publish_status;
    const percent = post.progress_percent || 0;
    
    let color = 'var(--primary)';
    if (status === 'Success') color = '#34d399';
    else if (status === 'Failed') color = '#f87171';
    else if (status === 'Waiting for Instagram Processing') color = '#eab308';
    else if (status === 'Publishing Post' || status === 'Verifying Publication') color = '#3b82f6';
    else if (status === 'Queued') color = 'rgba(255,255,255,0.4)';
    
    return { percent, step: status, color };
  };

  const getAvatarFallback = (username) => {
    const name = username || 'IG';
    const initials = name.slice(0, 2).toUpperCase();
    
    let hash = 0;
    for (let i = 0; i < name.length; i++) {
      hash = name.charCodeAt(i) + ((hash << 5) - hash);
    }
    const h = Math.abs(hash % 360);
    const background = `hsl(${h}, 70%, 45%)`;
    
    return (
      <div style={{
        width: '32px',
        height: '32px',
        borderRadius: '50%',
        background,
        color: '#fff',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: '0.75rem',
        fontWeight: 'bold',
        textShadow: '0 1px 2px rgba(0,0,0,0.2)'
      }}>
        {initials}
      </div>
    );
  };

  const getGroupedJobs = () => {
    const groups = {};
    history.forEach(post => {
      const jobId = post.job_id || `single-${post.id}`;
      if (!groups[jobId]) {
        groups[jobId] = {
          jobId,
          posts: [],
          created_at: post.created_at,
          updated_at: post.updated_at,
          caption: post.caption,
          hashtags: post.hashtags,
          media_path: post.media_path
        };
      }
      groups[jobId].posts.push(post);
      
      if (new Date(post.created_at) < new Date(groups[jobId].created_at)) {
        groups[jobId].created_at = post.created_at;
      }
      if (new Date(post.updated_at || post.created_at) > new Date(groups[jobId].updated_at || groups[jobId].created_at)) {
        groups[jobId].updated_at = post.updated_at || post.created_at;
      }
    });
    return Object.values(groups).sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  };

  const getActiveOrRecentOrFailedJobs = (grouped) => {
    return grouped.filter(job => {
      const has_active = job.posts.some(post => !['Success', 'Failed'].includes(post.publish_status));
      if (has_active) return true;
      
      const has_failed = job.posts.some(post => post.publish_status === 'Failed');
      if (has_failed) return true;
      
      const last_update = new Date(job.updated_at || job.created_at);
      const diff_ms = new Date() - last_update;
      return diff_ms < 5 * 60 * 1000; // 5 minutes
    });
  };

  const toggleExpandLogs = async (postId) => {
    if (expandedLogs[postId]) {
      setExpandedLogs(prev => {
        const next = { ...prev };
        delete next[postId];
        return next;
      });
    } else {
      try {
        const headers = { 'Authorization': `Bearer ${user.token}` };
        const res = await fetch(`${API_BASE}/publish-history/${postId}/logs`, { headers });
        if (res.ok) {
          const data = await res.json();
          setExpandedLogs(prev => ({ ...prev, [postId]: data }));
        }
      } catch (e) {
        console.error("Error fetching logs on click:", e);
      }
    }
  };

  const handleRetry = async (postId) => {
    try {
      setError('');
      setSuccess('');
      const response = await fetch(`${API_BASE}/publish/${postId}/retry`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${user.token}`
        }
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.detail || 'Failed to retry publishing');
      }
      setSuccess('Publishing retried successfully. Monitoring progress.');
      fetchData();
    } catch (err) {
      setError(err.message);
    }
  };

  const handleFileChange = async (e) => {
    const file = e.target.files[0]
    if (!file) return

    setMediaFile(file)
    setError('')
    setSuccess('')
    setUploading(true)

    const fileType = file.type
    const isVideo = fileType.startsWith('video/')
    setIsMediaVideo(isVideo)

    const formData = new FormData()
    formData.append('file', file)

    try {
      const response = await fetch(`${API_BASE}/upload-media`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${user.token}` },
        body: formData
      })

      const data = await response.json()
      if (!response.ok) {
        throw new Error(data.detail || 'Failed to upload media')
      }

      setUploadedPath(data.media_path)
      setUploadedUrl(data.public_url)
      setSuccess('Media uploaded and pre-verified by system.')
    } catch (err) {
      setError(err.message)
      setMediaFile(null)
    } finally {
      setUploading(false)
    }
  }

  const handleAccountToggle = (id) => {
    if (selectedAccounts.includes(id)) {
      setSelectedAccounts(selectedAccounts.filter(aId => aId !== id))
    } else {
      setSelectedAccounts([...selectedAccounts, id])
    }
  }

  const handlePublish = async (e) => {
    e.preventDefault()
    setError('')
    setSuccess('')

    if (!uploadedPath) {
      setError('Please upload an image or video first.')
      return
    }

    if (selectedAccounts.length === 0) {
      setError('Please select at least one Instagram account.')
      return
    }

    setSubmitting(true)

    try {
      const response = await fetch(`${API_BASE}/publish`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${user.token}`
        },
        body: JSON.stringify({
          caption,
          hashtags,
          account_ids: selectedAccounts,
          media_path: uploadedPath
        })
      })

      const data = await response.json()
      if (!response.ok) {
        throw new Error(data.detail || 'Failed to trigger publishing')
      }

      setSuccess('Publishing started successfully. You can monitor real-time progress in the Publishing Progress panel.')
      
      // Clear form composer fields
      setCaption('')
      setHashtags('')
      setSelectedAccounts([])
      setMediaFile(null)
      setUploadedPath('')
      setUploadedUrl('')
      
      fetchData()
    } catch (err) {
      setError(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  const getStatusBadgeClass = (status) => {
    switch (status) {
      case 'Success': return 'badge-success'
      case 'Pending':
      case 'Processing': return 'badge-pending'
      case 'Failed': return 'badge-danger'
      default: return 'badge-pending'
    }
  }

  const getStatusIcon = (status) => {
    switch (status) {
      case 'Success': return <CheckCircle2 size={12} />
      case 'Failed': return <XCircle size={12} />
      case 'Pending':
      case 'Processing': return <RefreshCw size={12} className="spinner" style={{ animationDuration: '2s' }} />
      default: return <AlertCircle size={12} />
    }
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h1 style={{ fontSize: '2rem', marginBottom: '0.25rem' }}>Dashboard</h1>
          <p style={{ color: 'var(--text-muted)' }}>Upload and schedule posts across connected Instagram feeds.</p>
        </div>

        {gitStatus && (
          <div style={{
            background: 'rgba(255, 255, 255, 0.02)',
            border: '1px solid var(--border-light)',
            borderRadius: '10px',
            padding: '0.5rem 0.75rem',
            display: 'flex',
            flexDirection: 'column',
            gap: '0.25rem',
            maxWidth: '320px',
            boxShadow: 'var(--shadow-premium)',
            backdropFilter: 'var(--glass-blur)'
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', justifyContent: 'space-between' }}>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)', fontWeight: 500 }}>GitHub Sync</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                {gitStatus.status === 'SYNCING' && (
                  <>
                    <RefreshCw size={12} className="spinner" style={{ color: 'var(--primary)' }} />
                    <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--primary)' }}>Syncing...</span>
                  </>
                )}
                {gitStatus.status === 'SUCCESS' && (
                  <>
                    <CheckCircle2 size={12} style={{ color: '#34d399' }} />
                    <span style={{ fontSize: '0.75rem', fontWeight: 600, color: '#34d399' }}>Synced</span>
                  </>
                )}
                {gitStatus.status === 'FAILED' && (
                  <>
                    <XCircle size={12} style={{ color: '#f87171' }} />
                    <span style={{ fontSize: '0.75rem', fontWeight: 600, color: '#f87171' }}>Failed</span>
                  </>
                )}
              </div>
            </div>

            {gitStatus.last_commit && (
              <p style={{ margin: 0, fontSize: '0.675rem', color: 'var(--text-main)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '280px' }} title={gitStatus.last_commit}>
                {gitStatus.last_commit}
              </p>
            )}

            {gitStatus.status === 'FAILED' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', marginTop: '0.25rem' }}>
                <span style={{ fontSize: '0.65rem', color: '#f87171', wordBreak: 'break-all', maxHeight: '40px', overflowY: 'auto', fontFamily: 'monospace' }}>
                  {gitStatus.error}
                </span>
                <button
                  type="button"
                  onClick={triggerGitSync}
                  className="btn btn-primary"
                  style={{ padding: '0.2rem 0.5rem', fontSize: '0.65rem', alignSelf: 'flex-start', background: 'rgba(239, 68, 68, 0.2)', border: '1px solid rgba(239, 68, 68, 0.4)', color: '#f87171' }}
                  disabled={gitSyncing}
                >
                  {gitSyncing ? 'Syncing...' : 'Retry Sync'}
                </button>
              </div>
            )}

            {gitStatus.status === 'SUCCESS' && gitStatus.uncommitted_changes && (
              <span style={{ fontSize: '0.65rem', color: 'var(--primary)', marginTop: '0.25rem', fontStyle: 'italic' }}>
                Local edits detected, auto-syncing...
              </span>
            )}
          </div>
        )}
      </div>

      {error && (
        <div style={{ background: 'rgba(239, 68, 68, 0.15)', border: '1px solid rgba(239, 68, 68, 0.3)', padding: '0.85rem 1.25rem', borderRadius: '10px', color: '#f87171', fontSize: '0.875rem', marginBottom: '1.5rem' }}>
          {error}
        </div>
      )}

      {success && (
        <div style={{ background: 'rgba(16, 185, 129, 0.15)', border: '1px solid rgba(16, 185, 129, 0.3)', padding: '0.85rem 1.25rem', borderRadius: '10px', color: '#34d399', fontSize: '0.875rem', marginBottom: '1.5rem' }}>
          {success}
        </div>
      )}

      <div style={{ 
        display: 'grid', 
        gridTemplateColumns: isMobile ? '1fr' : '6.5fr 3.5fr', 
        gap: '2rem',
        alignItems: 'start',
        marginTop: '2rem'
      }}>
        {/* Left Column: Post Composer (65% Width) */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
          <section className="glass-card" style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
            <h2 style={{ fontSize: '1.25rem', borderBottom: '1px solid var(--border-light)', paddingBottom: '0.75rem' }}>Post Composer</h2>
            
            <form onSubmit={handlePublish} style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
              
              {/* Upload Area */}
              <div className="form-group" style={{ marginBottom: 0 }}>
                <span className="form-label">Media Attachment (Mandatory)</span>
                <input
                  type="file"
                  ref={fileInputRef}
                  style={{ display: 'none' }}
                  accept="image/*,video/*"
                  onChange={handleFileChange}
                />
                
                {!mediaFile ? (
                  <div className="dropzone" onClick={() => fileInputRef.current?.click()}>
                    <FilePlus size={36} style={{ color: 'var(--primary)' }} />
                    <div>
                      <p style={{ fontSize: '0.875rem', fontWeight: 600 }}>Upload Image or Video</p>
                      <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Drag & drop or click to browse</p>
                    </div>
                    <span style={{ fontSize: '0.675rem', color: 'var(--text-muted)' }}>Supported: JPG, PNG, MP4, MOV</span>
                  </div>
                ) : (
                  <div className="preview-container">
                    {isMediaVideo ? (
                      <video src={uploadedUrl || URL.createObjectURL(mediaFile)} className="preview-media" controls />
                    ) : (
                      <img src={uploadedUrl || URL.createObjectURL(mediaFile)} className="preview-media" alt="preview" />
                    )}
                    <div className="preview-overlay">
                      <button
                        type="button"
                        className="btn btn-danger"
                        style={{ padding: '0.35rem 0.6rem', fontSize: '0.75rem', borderRadius: '6px' }}
                        onClick={() => {
                          setMediaFile(null)
                          setUploadedPath('')
                          setUploadedUrl('')
                        }}
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                )}
                {uploading && <div style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', marginTop: '0.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}><div className="spinner"></div>Uploading to server...</div>}
              </div>

              {/* Caption Textarea */}
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label" htmlFor="caption">Caption (Optional)</label>
                <textarea
                  id="caption"
                  className="form-input"
                  rows={4}
                  style={{ resize: 'vertical' }}
                  placeholder="Enter caption. The AI Content agent will refine and polish this to maximize engagement."
                  value={caption}
                  onChange={(e) => setCaption(e.target.value)}
                />
              </div>

              {/* Hashtags input */}
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label" htmlFor="hashtags">Hashtags (Optional)</label>
                <input
                  id="hashtags"
                  type="text"
                  className="form-input"
                  placeholder="#instagram #marketing"
                  value={hashtags}
                  onChange={(e) => setHashtags(e.target.value)}
                />
              </div>

              {/* Select Target Accounts */}
              <div className="form-group" style={{ marginBottom: 0 }}>
                <label className="form-label">Publish to Accounts</label>
                {accounts.length === 0 ? (
                  <div style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', background: 'rgba(255,255,255,0.02)', padding: '1rem', borderRadius: '8px', border: '1px solid var(--border-light)' }}>
                    No active accounts found. Go to 'IG Accounts' in the sidebar to add accounts.
                  </div>
                ) : (
                  <div className="accounts-grid-select">
                    {accounts.map(acc => (
                      <div
                        key={acc.id}
                        className={`account-checkbox-card ${selectedAccounts.includes(acc.id) ? 'selected' : ''}`}
                        onClick={() => handleAccountToggle(acc.id)}
                      >
                        <input
                          type="checkbox"
                          checked={selectedAccounts.includes(acc.id)}
                          onChange={() => {}}
                          style={{ cursor: 'pointer' }}
                        />
                        <span style={{ fontSize: '0.8125rem', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {acc.instagram_username_or_email}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <button
                type="submit"
                className="btn btn-primary"
                style={{ width: '100%', padding: '0.85rem' }}
                disabled={submitting || uploading}
              >
                {submitting ? <div className="spinner"></div> : <><Send size={16} />Publish Now</>}
              </button>
            </form>
          </section>
        </div>

        {/* Right Column: Tracking & History (35% Width) */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
          
          {/* Agent Publishing Progress Tracker */}
          <section className="glass-card" style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1.25rem', border: '1px solid rgba(167, 139, 250, 0.25)', boxShadow: '0 0 15px rgba(167, 139, 250, 0.05)' }}>
            <div 
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: progressCollapsed ? 'none' : '1px solid var(--border-light)', paddingBottom: '0.75rem', cursor: 'pointer', userSelect: 'none' }}
              onClick={() => setProgressCollapsed(!progressCollapsed)}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <Terminal size={18} style={{ color: 'var(--primary)' }} />
                <h2 style={{ fontSize: '1.15rem', margin: 0, fontWeight: 600 }}>Agent Publishing Progress Tracker</h2>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                  {progressCollapsed ? 'Collapsed' : 'Real-time'}
                </span>
                {progressCollapsed ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
              </div>
            </div>

            {!progressCollapsed && (
              getActiveOrRecentOrFailedJobs(getGroupedJobs()).length === 0 ? (
                <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '1.5rem 0.5rem', fontSize: '0.8125rem' }}>
                  No active publishing jobs. Use the Post Composer on the left to start publishing.
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
                  {getActiveOrRecentOrFailedJobs(getGroupedJobs()).map(job => {
                    const totalPosts = job.posts.length;
                    const avgPercent = Math.round(job.posts.reduce((sum, p) => sum + (p.progress_percent || 0), 0) / totalPosts);
                    const anyActive = job.posts.some(p => !['Success', 'Failed'].includes(p.publish_status));
                    const allSuccess = job.posts.every(p => p.publish_status === 'Success');
                    const anyFailed = job.posts.some(p => p.publish_status === 'Failed');

                    let overallStatusText = 'Processing';
                    let overallColor = '#c084fc';
                    if (allSuccess) {
                      overallStatusText = 'Success';
                      overallColor = '#34d399';
                    } else if (anyFailed) {
                      overallStatusText = anyActive ? 'Processing with Failures' : 'Failed';
                      overallColor = '#f87171';
                    } else if (anyActive) {
                      overallStatusText = 'Running';
                      overallColor = 'var(--primary)';
                    }

                    return (
                      <div key={job.jobId} style={{ background: 'rgba(255,255,255,0.01)', border: '1px solid var(--border-light)', borderRadius: '12px', padding: '1rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                        
                        {/* Job Header */}
                        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap', justifyContent: 'space-between' }}>
                          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                            <div style={{ width: '40px', height: '40px', borderRadius: '6px', overflow: 'hidden', background: '#000', border: '1px solid rgba(255,255,255,0.1)' }}>
                              {job.media_path.toLowerCase().endsWith('.mp4') || job.media_path.toLowerCase().endsWith('.mov') ? (
                                <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#111' }}><Video size={14} /></div>
                              ) : (
                                <img 
                                  src={`${API_BASE}/static/uploads/${job.media_path.split(/[\\/]/).pop()}`} 
                                  style={{ width: '100%', height: '100%', objectFit: 'cover' }} 
                                  alt=""
                                  onError={(e) => { e.target.src="data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%2240%22 height=%2240%22><rect width=%2240%22 height=%2240%22 fill=%22%23222%22/></svg>" }}
                                />
                              )}
                            </div>
                            <div>
                              <p style={{ margin: 0, fontSize: '0.85rem', fontWeight: 600, color: 'var(--text-main)', maxWidth: '140px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                {job.caption || "No caption provided"}
                              </p>
                              <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)', display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}>
                                <Clock size={10} />
                                Started: {new Date(job.created_at).toLocaleTimeString()}
                              </span>
                            </div>
                          </div>

                          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '0.15rem' }}>
                            <span className="badge" style={{ background: `${overallColor}1a`, border: `1px solid ${overallColor}4d`, color: overallColor, display: 'inline-flex', padding: '0.25rem 0.5rem', borderRadius: '4px', fontSize: '0.7rem' }}>
                              {anyActive && <RefreshCw size={10} className="spinner" style={{ marginRight: '0.25rem' }} />}
                              <span>{overallStatusText}</span>
                            </span>
                            <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>
                              Updated: {new Date(job.updated_at).toLocaleTimeString()}
                            </span>
                          </div>
                        </div>

                        {/* Overall Job Progress Bar */}
                        <div style={{ width: '100%' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.7rem', color: 'var(--text-muted)', marginBottom: '0.25rem' }}>
                            <span>Overall Progress ({totalPosts} IG)</span>
                            <span style={{ fontWeight: 600, color: overallColor }}>{avgPercent}%</span>
                          </div>
                          <div style={{ width: '100%', height: '5px', background: 'rgba(255,255,255,0.05)', borderRadius: '3px', overflow: 'hidden' }}>
                            <div style={{ width: `${avgPercent}%`, height: '100%', background: overallColor, borderRadius: '3px', transition: 'width 0.4s ease' }}></div>
                          </div>
                        </div>

                        {/* Per Account Progress Rows */}
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', borderTop: '1px solid rgba(255,255,255,0.03)', paddingTop: '0.75rem' }}>
                          {job.posts.map(post => {
                            const logs = activePostsLogs[post.id] || expandedLogs[post.id] || [];
                            const isExpanded = !!expandedLogs[post.id];
                            const { percent, step, color } = getPostProgressInfo(post);

                            return (
                              <div key={post.id} style={{ background: 'rgba(0,0,0,0.15)', border: '1px solid var(--border-light)', borderRadius: '8px', padding: '0.75rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.4rem' }}>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                                    {getAvatarFallback(post.instagram_username)}
                                    <div>
                                      <p style={{ margin: 0, fontSize: '0.75rem', fontWeight: 600, color: 'var(--text-main)', maxWidth: '100px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                        @{post.instagram_username}
                                      </p>
                                      <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>
                                        Status: <strong style={{ color }}>{step}</strong>
                                      </span>
                                    </div>
                                  </div>

                                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                                    <button 
                                      type="button"
                                      onClick={() => toggleExpandLogs(post.id)}
                                      className="btn btn-secondary"
                                      style={{ padding: '0.2rem 0.35rem', fontSize: '0.65rem', display: 'flex', alignItems: 'center', gap: '0.15rem' }}
                                      title="Toggle terminal activity logs"
                                    >
                                      <Terminal size={10} />
                                      <span>{isExpanded ? 'Hide' : 'Logs'}</span>
                                      {isExpanded ? <ChevronUp size={8} /> : <ChevronDown size={8} />}
                                    </button>

                                    {post.publish_status === 'Failed' && (
                                      <button 
                                        type="button"
                                        onClick={() => handleRetry(post.id)}
                                        className="btn btn-primary"
                                        style={{ padding: '0.2rem 0.35rem', fontSize: '0.65rem', background: '#dc2626', borderColor: '#b91c1c', color: '#fff', display: 'flex', alignItems: 'center', gap: '0.15rem' }}
                                      >
                                        <RefreshCw size={8} />
                                        <span>Retry</span>
                                      </button>
                                    )}

                                    <span className={`badge ${getStatusBadgeClass(post.publish_status)}`} style={{ padding: '0.2rem 0.35rem', borderRadius: '4px', fontSize: '0.65rem' }}>
                                      {getStatusIcon(post.publish_status)}
                                    </span>
                                  </div>
                                </div>

                                {/* Individual Progress Bar */}
                                <div style={{ width: '100%' }}>
                                  <div style={{ width: '100%', height: '3px', background: 'rgba(255,255,255,0.03)', borderRadius: '2px', overflow: 'hidden' }}>
                                    <div style={{ width: `${percent}%`, height: '100%', background: color, borderRadius: '2px', transition: 'width 0.4s ease' }}></div>
                                  </div>
                                </div>

                                {/* Error block for failed post */}
                                {post.publish_status === 'Failed' && post.failure_reason && (
                                  <div style={{ background: 'rgba(239, 68, 68, 0.05)', border: '1px solid rgba(239, 68, 68, 0.15)', borderRadius: '6px', padding: '0.4rem 0.6rem', color: '#f87171', fontSize: '0.65rem', fontFamily: 'monospace', whiteSpace: 'pre-wrap', maxHeight: '60px', overflowY: 'auto' }}>
                                    {post.failure_reason.split('\n')[0]}
                                  </div>
                                )}

                                {/* Expandable Terminal Log Feed */}
                                {isExpanded && (
                                  <div style={{ background: '#020104', border: '1px solid #1c1535', borderRadius: '6px', padding: '0.5rem 0.75rem', fontFamily: 'monospace', fontSize: '0.65rem', display: 'flex', flexDirection: 'column', gap: '0.3rem', maxHeight: '140px', overflowY: 'auto', color: '#a7f3d0' }}>
                                    <div style={{ color: 'rgba(255,255,255,0.2)', borderBottom: '1px solid rgba(255,255,255,0.05)', paddingBottom: '0.15rem', marginBottom: '0.15rem', display: 'flex', justifyContent: 'space-between' }}>
                                      <span>$ logs --post-id={post.id}</span>
                                    </div>
                                    {logs.length === 0 ? (
                                      <div style={{ color: 'var(--text-muted)', fontStyle: 'italic' }}>Awaiting logs...</div>
                                    ) : (
                                      logs.map(log => (
                                        <div key={log.id} style={{ display: 'flex', gap: '0.35rem', borderBottom: '1px solid rgba(255,255,255,0.01)', paddingBottom: '0.15rem' }}>
                                          <span style={{ color: '#c084fc', flexShrink: 0 }}>[{new Date(log.created_at).toLocaleTimeString()}]</span>
                                          <span style={{ color: log.action.includes('FAIL') || log.action.includes('ERR') ? '#f87171' : '#cbd5e1' }}>{log.description}</span>
                                        </div>
                                      ))
                                    )}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>

                      </div>
                    );
                  })}
                </div>
              )
            )}
          </section>

          {/* Tracker Publishing History */}
          <section className="glass-card" style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem', maxHeight: historyCollapsed ? 'auto' : '650px', overflowY: 'auto', padding: '1.5rem' }}>
            <div 
              style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: historyCollapsed ? 'none' : '1px solid var(--border-light)', paddingBottom: '0.75rem', cursor: 'pointer', userSelect: 'none' }}
              onClick={() => setHistoryCollapsed(!historyCollapsed)}
            >
              <h2 style={{ fontSize: '1.15rem', margin: 0, fontWeight: 600 }}>Tracker Publishing History</h2>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <button 
                  onClick={(e) => { 
                    e.stopPropagation(); 
                    fetchData(); 
                  }} 
                  className="btn btn-secondary" 
                  style={{ padding: '0.2rem 0.4rem', fontSize: '0.65rem' }}
                >
                  <RefreshCw size={10} />
                </button>
                {historyCollapsed ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
              </div>
            </div>

            {!historyCollapsed && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                {history.length === 0 ? (
                  <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '3rem 1rem', fontSize: '0.8125rem' }}>
                    No publishing tasks recorded. Write and publish your first post to see status logs.
                  </div>
                ) : (
                  history.map(post => (
                    <div 
                      key={post.id} 
                      onClick={() => setSelectedPostDetails(post)}
                      className="history-card"
                      style={{ 
                        background: 'rgba(255,255,255,0.02)', 
                        border: '1px solid var(--border-light)', 
                        borderRadius: '10px', 
                        padding: '0.75rem 1rem', 
                        display: 'flex', 
                        flexDirection: 'column', 
                        gap: '0.5rem',
                        cursor: 'pointer',
                        transition: 'transform 0.2s, background-color 0.2s'
                      }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.background = 'rgba(255,255,255,0.05)';
                        e.currentTarget.style.transform = 'translateY(-2px)';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.background = 'rgba(255,255,255,0.02)';
                        e.currentTarget.style.transform = 'translateY(0px)';
                      }}
                    >
                      {/* Header info */}
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                          <div style={{ width: '36px', height: '36px', borderRadius: '6px', overflow: 'hidden', background: '#000', border: '1px solid rgba(255,255,255,0.1)' }}>
                            {post.media_path.toLowerCase().endsWith('.mp4') || post.media_path.toLowerCase().endsWith('.mov') ? (
                              <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#111' }}><Video size={14} /></div>
                            ) : (
                              <img 
                                src={`${API_BASE}/static/uploads/${post.media_path.split(/[\\/]/).pop()}`} 
                                style={{ width: '100%', height: '100%', objectFit: 'cover' }} 
                                alt=""
                                onError={(e) => { e.target.src="data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%2240%22 height=%2240%22><rect width=%2240%22 height=%2240%22 fill=%22%23222%22/></svg>" }}
                              />
                            )}
                          </div>
                          <div>
                            <span style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>
                              {new Date(post.created_at).toLocaleString()}
                            </span>
                            <p style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--text-main)', maxWidth: '110px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {post.caption || "No caption"}
                            </p>
                          </div>
                        </div>
                        
                        <span className={`badge ${getStatusBadgeClass(post.publish_status)}`} style={{ fontSize: '0.65rem', padding: '0.2rem 0.35rem' }}>
                          {post.publish_status}
                        </span>
                      </div>

                      {/* Destination info */}
                      <div style={{ borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '0.4rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>Target Account:</span>
                        <span style={{ fontSize: '0.75rem', fontWeight: 600, color: 'var(--primary)' }}>@{post.instagram_username}</span>
                      </div>

                      {post.publish_status === 'Failed' && (
                        <div style={{ fontSize: '0.7rem', color: '#f87171', textAlign: 'right', textDecoration: 'underline', marginTop: '0.15rem', fontWeight: 500 }}>
                          Click for details
                        </div>
                      )}
                    </div>
                  ))
                )}
              </div>
            )}
          </section>

        </div>
      </div>

      {/* Publishing Details Modal */}
      {selectedPostDetails && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.8)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '2rem' }}>
          <div className="glass-card" style={{ width: '100%', maxWidth: '850px', display: 'flex', flexDirection: 'column', gap: '1.5rem', background: '#090714', padding: '2rem', border: '1px solid var(--border-light)', boxShadow: '0 8px 32px 0 rgba(0, 0, 0, 0.5)' }}>
            
            {/* Modal Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border-light)', paddingBottom: '0.75rem' }}>
              <h3 style={{ fontSize: '1.25rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.5rem', color: selectedPostDetails.publish_status === 'Failed' ? '#f87171' : '#34d399' }}>
                {selectedPostDetails.publish_status === 'Failed' ? 'Failure Details' : 'Publishing Details'}
              </h3>
              <button 
                onClick={() => setSelectedPostDetails(null)} 
                className="btn btn-secondary" 
                style={{ padding: '0.25rem 0.5rem', fontSize: '0.875rem', cursor: 'pointer' }}
              >
                ✕ Close
              </button>
            </div>

            {/* Modal Body: Two Columns */}
            <div style={{ display: 'flex', gap: '1.5rem', fontSize: '0.875rem', minHeight: '350px', flexWrap: 'wrap' }}>
              
              {/* Left Column: Metadata */}
              <div style={{ flex: '1 1 300px', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                <div>
                  <span style={{ color: 'var(--text-muted)', display: 'block', marginBottom: '0.25rem', fontWeight: 500 }}>Status:</span>
                  <span className={`badge ${getStatusBadgeClass(selectedPostDetails.publish_status)}`} style={{ display: 'inline-flex', padding: '0.35rem 0.65rem', borderRadius: '6px' }}>
                    {getStatusIcon(selectedPostDetails.publish_status)}
                    <span style={{ marginLeft: '0.25rem' }}>{selectedPostDetails.publish_status}</span>
                  </span>
                </div>

                <div>
                  <span style={{ color: 'var(--text-muted)', display: 'block', marginBottom: '0.25rem', fontWeight: 500 }}>Timestamp:</span>
                  <span style={{ fontWeight: 600, color: 'var(--text-main)' }}>
                    {new Date(selectedPostDetails.created_at).toLocaleString()}
                  </span>
                </div>

                <div>
                  <span style={{ color: 'var(--text-muted)', display: 'block', marginBottom: '0.25rem', fontWeight: 500 }}>Account:</span>
                  <span style={{ fontWeight: 600, color: 'var(--primary)' }}>
                    {selectedPostDetails.instagram_username}
                  </span>
                </div>

                <div>
                  <span style={{ color: 'var(--text-muted)', display: 'block', marginBottom: '0.25rem', fontWeight: 500 }}>Caption:</span>
                  <div style={{ background: 'rgba(255, 255, 255, 0.02)', border: '1px solid var(--border-light)', padding: '0.75rem 1rem', borderRadius: '8px', color: 'var(--text-main)', fontSize: '0.8125rem', maxHeight: '120px', overflowY: 'auto' }}>
                    {selectedPostDetails.caption || "(No caption)"}
                  </div>
                </div>

                {selectedPostDetails.hashtags && (
                  <div>
                    <span style={{ color: 'var(--text-muted)', display: 'block', marginBottom: '0.25rem', fontWeight: 500 }}>Hashtags:</span>
                    <span style={{ color: 'var(--accent-pink)', fontWeight: 600 }}>
                      {selectedPostDetails.hashtags}
                    </span>
                  </div>
                )}

                {selectedPostDetails.publish_status === 'Failed' && (
                  <div>
                    <span style={{ color: '#f87171', display: 'block', marginBottom: '0.25rem', fontWeight: 500 }}>Failure Detail:</span>
                    <div style={{ background: 'rgba(239, 68, 68, 0.08)', border: '1px solid rgba(239, 68, 68, 0.2)', padding: '0.75rem 1rem', borderRadius: '8px', color: '#f87171', fontSize: '0.75rem', maxHeight: '120px', overflowY: 'auto', whiteSpace: 'pre-wrap', fontFamily: 'monospace' }}>
                      {selectedPostDetails.failure_reason || "Unknown publishing error"}
                    </div>
                  </div>
                )}
              </div>

              {/* Right Column: Live Terminal Logs */}
              <div style={{ flex: '1.2 1 350px', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                <span style={{ color: 'var(--text-muted)', display: 'block', fontWeight: 500 }}>Agent Live Activity Log:</span>
                <div style={{ 
                  flex: 1,
                  background: '#040209', 
                  border: '1px solid #1c1535', 
                  borderRadius: '10px', 
                  padding: '1rem', 
                  fontFamily: 'monospace', 
                  fontSize: '0.75rem',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '0.75rem',
                  color: '#cbd5e1',
                  overflowY: 'auto',
                  maxHeight: '360px'
                }}>
                  {postLogs.length === 0 ? (
                    <div style={{ color: 'var(--text-muted)', textAlign: 'center', margin: 'auto', fontSize: '0.8125rem' }}>
                      <div className="spinner" style={{ margin: '0 auto 0.75rem auto' }}></div>
                      Awaiting agent execution logs...
                    </div>
                  ) : (
                    postLogs.map(log => (
                      <div key={log.id} style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', paddingBottom: '0.5rem', borderBottom: '1px solid rgba(255,255,255,0.03)' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <span style={{ color: log.action.includes('FAIL') ? '#f87171' : log.action.includes('SUCCESS') ? '#34d399' : '#a78bfa', fontWeight: 'bold' }}>
                            [{log.action}]
                          </span>
                          <span style={{ color: '#64748b', fontSize: '0.65rem' }}>
                            {new Date(log.created_at).toLocaleTimeString()}
                          </span>
                        </div>
                        <p style={{ margin: 0, whiteSpace: 'pre-wrap', color: log.action.includes('FAIL') ? '#f87171' : '#cbd5e1' }}>
                          {log.description}
                        </p>
                      </div>
                    ))
                  )}
                </div>
              </div>

            </div>

          </div>
        </div>
      )}
    </div>
  )
}
