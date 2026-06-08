import React, { useState, useEffect } from 'react'
import { useAuth } from '../App'
import { RefreshCw, CheckCircle, XCircle, AlertCircle, Eye, MessageSquare } from 'lucide-react'

const API_BASE = "http://localhost:8000"

export default function Requests() {
  const { user } = useAuth()
  const isSuperAdmin = user?.role === 'Super Admin'

  const [requests, setRequests] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  // Processing state (Super Admin only)
  const [selectedRequest, setSelectedRequest] = useState(null)
  const [adminComments, setAdminComments] = useState('')
  const [processing, setProcessing] = useState(false)

  const fetchRequests = async () => {
    setLoading(true)
    setError('')
    try {
      const response = await fetch(`${API_BASE}/credential-requests`, {
        headers: { 'Authorization': `Bearer ${user.token}` }
      })
      const data = await response.json()
      if (response.ok) {
        setRequests(data)
      } else {
        setError(data.detail || 'Failed to fetch credential requests.')
      }
    } catch (err) {
      setError('Connection error fetching requests.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchRequests()
  }, [])

  const handleProcessRequest = async (status) => {
    if (!selectedRequest) return
    setError('')
    setSuccess('')
    setProcessing(true)

    try {
      const response = await fetch(`${API_BASE}/credential-requests/${selectedRequest.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${user.token}`
        },
        body: JSON.stringify({
          status,
          admin_comments: adminComments
        })
      })

      const data = await response.json()
      if (!response.ok) {
        throw new Error(data.detail || 'Failed to update request state.')
      }

      setSuccess(`Request ID #${selectedRequest.id} has been ${status.toLowerCase()}!`)
      setSelectedRequest(null)
      setAdminComments('')
      fetchRequests()
    } catch (err) {
      setError(err.message)
    } finally {
      setProcessing(false)
    }
  }

  const getStatusBadgeClass = (status) => {
    switch (status) {
      case 'Approved': return 'badge-success'
      case 'Rejected': return 'badge-danger'
      case 'Pending': return 'badge-pending'
      default: return 'badge-pending'
    }
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
        <div>
          <h1 style={{ fontSize: '2rem', marginBottom: '0.25rem' }}>Credential Update Requests</h1>
          <p style={{ color: 'var(--text-muted)' }}>
            {isSuperAdmin ? 'Review and approve Instagram credential rotation requests.' : 'Track your submitted Instagram key updates.'}
          </p>
        </div>
        <button onClick={fetchRequests} className="btn btn-secondary" style={{ padding: '0.5rem 1rem' }}>
          <RefreshCw size={14} /> Refresh
        </button>
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

      {/* Super Admin Review Panel overlay */}
      {isSuperAdmin && selectedRequest && (
        <div className="glass-card" style={{ marginBottom: '2rem' }}>
          <h2 style={{ fontSize: '1.25rem', marginBottom: '1rem', borderBottom: '1px solid var(--border-light)', paddingBottom: '0.5rem' }}>
            Review Request ID #{selectedRequest.id} (For @{selectedRequest.requested_username})
          </h2>

          <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr', gap: '2rem', marginBottom: '1.5rem' }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', fontSize: '0.875rem' }}>
              <div>
                <span style={{ color: 'var(--text-muted)', display: 'block' }}>Update Reason:</span>
                <p style={{ background: 'rgba(0,0,0,0.3)', padding: '0.75rem', borderRadius: '8px', border: '1px solid var(--border-light)', marginTop: '0.25rem' }}>
                  {selectedRequest.reason}
                </p>
              </div>

              <div>
                <span style={{ color: 'var(--text-muted)' }}>Access Token:</span>
                <span style={{ display: 'block', wordBreak: 'break-all', fontSize: '0.75rem', fontFamily: 'monospace', background: 'rgba(0,0,0,0.3)', padding: '0.5rem', borderRadius: '6px', marginTop: '0.25rem' }}>
                  {selectedRequest.requested_access_token}
                </span>
              </div>
            </div>

            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label" htmlFor="admin-notes">Super Admin Comments / Notes</label>
              <textarea
                id="admin-notes"
                className="form-input"
                rows={4}
                placeholder="Enter feedback or comments for the user..."
                value={adminComments}
                onChange={(e) => setAdminComments(e.target.value)}
              />
            </div>
          </div>

          <div style={{ display: 'flex', gap: '1rem', justifyContent: 'flex-end' }}>
            <button type="button" onClick={() => { setSelectedRequest(null); setAdminComments(''); }} className="btn btn-secondary" disabled={processing}>Cancel</button>
            <button type="button" onClick={() => handleProcessRequest('Rejected')} className="btn btn-danger" disabled={processing}>Reject Request</button>
            <button type="button" onClick={() => handleProcessRequest('Approved')} className="btn btn-primary" style={{ background: 'var(--success)', boxShadow: '0 4px 15px rgba(16, 185, 129, 0.3)' }} disabled={processing}>Approve & Rotate Keys</button>
          </div>
        </div>
      )}

      {/* Requests Table */}
      <div className="table-container">
        {loading && requests.length === 0 ? (
          <div style={{ padding: '3rem', textAlign: 'center' }}><div className="spinner" style={{ margin: '0 auto' }}></div></div>
        ) : requests.length === 0 ? (
          <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-muted)' }}>
            No credential update requests found.
          </div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Req ID</th>
                {isSuperAdmin && <th>User ID</th>}
                <th>Target Username</th>
                <th>Reason</th>
                <th>Submitted Date</th>
                <th>Status</th>
                <th style={{ textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {requests.map(req => (
                <tr key={req.id}>
                  <td style={{ color: 'var(--text-muted)' }}>#{req.id}</td>
                  {isSuperAdmin && <td style={{ color: 'var(--text-muted)', fontSize: '0.8125rem' }}>User #{req.user_id}</td>}
                  <td style={{ fontWeight: 600 }}>@{req.requested_username}</td>
                  <td style={{ maxWidth: '280px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={req.reason}>
                    {req.reason}
                  </td>
                  <td style={{ color: 'var(--text-muted)', fontSize: '0.8125rem' }}>
                    {new Date(req.created_at).toLocaleString()}
                  </td>
                  <td>
                    <span className={`badge ${getStatusBadgeClass(req.status)}`}>
                      {req.status}
                    </span>
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <div style={{ display: 'inline-flex', gap: '0.5rem', alignItems: 'center' }}>
                      {req.admin_comments && (
                        <div title={`Admin Comments: ${req.admin_comments}`} style={{ color: 'var(--primary)', cursor: 'pointer', padding: '0.25rem' }}>
                          <MessageSquare size={14} />
                        </div>
                      )}
                      
                      {isSuperAdmin && req.status === 'Pending' && (
                        <button
                          onClick={() => {
                            setSelectedRequest(req)
                            setAdminComments(req.admin_comments || '')
                          }}
                          className="btn btn-secondary"
                          style={{ padding: '0.35rem 0.6rem', fontSize: '0.75rem', borderRadius: '6px', display: 'flex', alignItems: 'center', gap: '0.25rem' }}
                        >
                          <Eye size={12} /> Review
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
