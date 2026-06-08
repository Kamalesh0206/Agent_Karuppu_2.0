import React, { useState, useEffect, useRef } from 'react'
import { useAuth } from '../App'
import { Image, Video, Send, FilePlus, AlertCircle, RefreshCw, CheckCircle2, XCircle } from 'lucide-react'

const API_BASE = "http://localhost:8000"

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
  
  const fileInputRef = useRef(null)

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

      setSuccess('Publishing sequence initiated successfully in the background!')
      
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
      case 'Pending': return 'badge-pending'
      case 'Failed': return 'badge-danger'
      default: return 'badge-pending'
    }
  }

  const getStatusIcon = (status) => {
    switch (status) {
      case 'Success': return <CheckCircle2 size={12} />
      case 'Failed': return <XCircle size={12} />
      case 'Pending': return <RefreshCw size={12} className="spinner" style={{ animationDuration: '2s' }} />
      default: return <AlertCircle size={12} />
    }
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
        <div>
          <h1 style={{ fontSize: '2rem', marginBottom: '0.25rem' }}>Dashboard</h1>
          <p style={{ color: 'var(--text-muted)' }}>Upload and schedule posts across connected Instagram feeds.</p>
        </div>
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

      <div className="dashboard-grid">
        {/* Creator Panel */}
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
                        @{acc.instagram_username}
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

        {/* History Tracker */}
        <section className="glass-card" style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', maxHeight: '720px', overflowY: 'auto' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border-light)', paddingBottom: '0.75rem' }}>
            <h2 style={{ fontSize: '1.25rem' }}>Publishing History</h2>
            <button onClick={fetchData} className="btn btn-secondary" style={{ padding: '0.35rem 0.6rem', fontSize: '0.75rem' }}>
              <RefreshCw size={12} />
            </button>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            {history.length === 0 ? (
              <div style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '3rem 1rem' }}>
                No publishing tasks recorded. Write and publish your first post to see status logs.
              </div>
            ) : (
              history.map(post => (
                <div key={post.id} style={{ background: 'rgba(255,255,255,0.02)', border: '1px solid var(--border-light)', borderRadius: '10px', padding: '1rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                  
                  {/* Header info */}
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                    <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
                      <div style={{ width: '42px', height: '42px', borderRadius: '6px', overflow: 'hidden', background: '#000', border: '1px solid rgba(255,255,255,0.1)' }}>
                        {post.media_path.toLowerCase().endsWith('.mp4') || post.media_path.toLowerCase().endsWith('.mov') ? (
                          <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#111' }}><Video size={16} /></div>
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
                        <span style={{ fontSize: '0.675rem', color: 'var(--text-muted)' }}>
                          {new Date(post.created_at).toLocaleString()}
                        </span>
                        <p style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--text-main)', maxWidth: '220px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {post.caption || "No caption"}
                        </p>
                      </div>
                    </div>
                    
                    <span className={`badge ${getStatusBadgeClass(post.publish_status)}`}>
                      {getStatusIcon(post.publish_status)}
                      {post.publish_status}
                    </span>
                  </div>

                  {/* Destination info */}
                  <div style={{ borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: '0.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>Target Account:</span>
                    <span style={{ fontSize: '0.8125rem', fontWeight: 600, color: 'var(--primary)' }}>@{post.instagram_username}</span>
                  </div>
                </div>
              ))
            )}
          </div>
        </section>
      </div>
    </div>
  )
}
