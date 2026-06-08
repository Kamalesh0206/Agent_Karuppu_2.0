import React, { useState, useEffect } from 'react'
import { useAuth } from '../App'
import { Check, X, ShieldAlert, ShieldCheck, Ban, UserCheck, RefreshCw, Terminal, Eye } from 'lucide-react'

const API_BASE = "http://localhost:8000"

export default function Admin() {
  const { user } = useAuth()
  
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  
  // Modal log view states
  const [activeUserLogs, setActiveUserLogs] = useState(null)
  const [userLogs, setUserLogs] = useState([])
  const [logsLoading, setLogsLoading] = useState(false)

  const fetchUsers = async () => {
    setLoading(true)
    setError('')
    try {
      const response = await fetch(`${API_BASE}/users`, {
        headers: { 'Authorization': `Bearer ${user.token}` }
      })
      const data = await response.json()
      if (response.ok) {
        setUsers(data)
      } else {
        setError(data.detail || 'Failed to fetch user directories.')
      }
    } catch (err) {
      setError('Connection error fetching users.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchUsers()
  }, [])

  const handleApprove = async (userId) => {
    setError('')
    setSuccess('')
    try {
      const response = await fetch(`${API_BASE}/users/${userId}/approve`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${user.token}` }
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.detail || 'Approval failed.')
      setSuccess('User approved successfully.')
      fetchUsers()
    } catch (err) {
      setError(err.message)
    }
  }

  const handleReject = async (userId) => {
    setError('')
    setSuccess('')
    try {
      const response = await fetch(`${API_BASE}/users/${userId}/reject`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${user.token}` }
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.detail || 'Rejection failed.')
      setSuccess('User registration rejected.')
      fetchUsers()
    } catch (err) {
      setError(err.message)
    }
  }

  const handleToggleStatus = async (targetUser) => {
    setError('')
    setSuccess('')
    const nextStatus = targetUser.status === 'Approved' ? 'Deactivated' : 'Approved'
    try {
      const response = await fetch(`${API_BASE}/users/${targetUser.id}/status`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${user.token}`
        },
        body: JSON.stringify({ status: nextStatus })
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.detail || 'Status change failed.')
      setSuccess(`User status updated to ${nextStatus}.`)
      fetchUsers()
    } catch (err) {
      setError(err.message)
    }
  }

  const handleTogglePermissions = async (targetUser) => {
    setError('')
    setSuccess('')
    const nextPermission = !targetUser.publishing_permission
    try {
      const response = await fetch(`${API_BASE}/users/${targetUser.id}/permissions`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${user.token}`
        },
        body: JSON.stringify({ publishing_permission: nextPermission })
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.detail || 'Permission update failed.')
      setSuccess(`User publishing access updated.`)
      fetchUsers()
    } catch (err) {
      setError(err.message)
    }
  }

  const handleViewLogs = async (targetUser) => {
    setActiveUserLogs(targetUser)
    setLogsLoading(true)
    setUserLogs([])
    try {
      const response = await fetch(`${API_BASE}/logs`, {
        headers: { 'Authorization': `Bearer ${user.token}` }
      })
      const data = await response.json()
      if (response.ok) {
        // Filter logs by user ID
        const filtered = data.filter(log => log.user_id === targetUser.id)
        setUserLogs(filtered)
      }
    } catch (err) {
      console.error(err)
    } finally {
      setLogsLoading(false)
    }
  }

  const pendingApprovals = users.filter(u => u.status === 'Pending Approval')
  const generalDirectory = users.filter(u => u.status !== 'Pending Approval')

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
        <div>
          <h1 style={{ fontSize: '2rem', marginBottom: '0.25rem' }}>Super Admin Console</h1>
          <p style={{ color: 'var(--text-muted)' }}>Approve user accounts, toggle publishing permissions, and review audit logs.</p>
        </div>
        <button onClick={fetchUsers} className="btn btn-secondary" style={{ padding: '0.5rem 1rem' }}>
          <RefreshCw size={14} /> Refresh Directory
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

      {/* 1. Pending Approvals Queue */}
      <section className="glass-card" style={{ marginBottom: '2rem' }}>
        <h2 style={{ fontSize: '1.25rem', marginBottom: '1.25rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <ShieldAlert size={18} style={{ color: 'var(--warning)' }} /> Registration Approvals Queue ({pendingApprovals.length})
        </h2>
        
        {pendingApprovals.length === 0 ? (
          <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>No registration approvals pending.</p>
        ) : (
          <div className="table-container">
            <table>
              <thead>
                <tr>
                  <th>Full Name</th>
                  <th>Email Address</th>
                  <th>Mobile Number</th>
                  <th>Username</th>
                  <th style={{ textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {pendingApprovals.map(u => (
                  <tr key={u.id}>
                    <td style={{ fontWeight: 600 }}>{u.full_name}</td>
                    <td>{u.email}</td>
                    <td>{u.mobile_number}</td>
                    <td style={{ color: 'var(--primary)' }}>@{u.username}</td>
                    <td style={{ textAlign: 'right' }}>
                      <div style={{ display: 'inline-flex', gap: '0.5rem' }}>
                        <button
                          onClick={() => handleReject(u.id)}
                          className="btn btn-danger"
                          style={{ padding: '0.35rem 0.6rem', fontSize: '0.75rem', borderRadius: '6px', display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}
                        >
                          <X size={12} /> Reject
                        </button>
                        <button
                          onClick={() => handleApprove(u.id)}
                          className="btn btn-primary"
                          style={{ background: 'var(--success)', boxShadow: '0 4px 15px rgba(16, 185, 129, 0.3)', padding: '0.35rem 0.6rem', fontSize: '0.75rem', borderRadius: '6px', display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}
                        >
                          <Check size={12} /> Approve
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* 2. User Directory */}
      <section className="glass-card">
        <h2 style={{ fontSize: '1.25rem', marginBottom: '1.25rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <ShieldCheck size={18} style={{ color: 'var(--primary)' }} /> User Administration Directory
        </h2>

        {generalDirectory.length === 0 ? (
          <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>No other registered users in the database.</p>
        ) : (
          <div className="table-container">
            <table>
              <thead>
                <tr>
                  <th>Full Name</th>
                  <th>Username</th>
                  <th>Email</th>
                  <th>Status</th>
                  <th>Publishing Access</th>
                  <th style={{ textAlign: 'right' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {generalDirectory.map(u => (
                  <tr key={u.id}>
                    <td style={{ fontWeight: 600 }}>{u.full_name}</td>
                    <td style={{ color: 'var(--primary)' }}>@{u.username}</td>
                    <td>{u.email}</td>
                    <td>
                      <span className={`badge ${u.status === 'Approved' ? 'badge-success' : 'badge-danger'}`}>
                        {u.status}
                      </span>
                    </td>
                    <td>
                      <button
                        onClick={() => handleTogglePermissions(u)}
                        className={`btn ${u.publishing_permission ? 'btn-primary' : 'btn-secondary'}`}
                        style={{ padding: '0.25rem 0.5rem', fontSize: '0.75rem', borderRadius: '6px' }}
                      >
                        {u.publishing_permission ? 'Granted' : 'Revoked'}
                      </button>
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <div style={{ display: 'inline-flex', gap: '0.5rem' }}>
                        <button
                          onClick={() => handleViewLogs(u)}
                          className="btn btn-secondary"
                          style={{ padding: '0.35rem 0.5rem', fontSize: '0.75rem', borderRadius: '6px' }}
                          title="View User Logs"
                        >
                          <Terminal size={13} />
                        </button>
                        
                        <button
                          onClick={() => handleToggleStatus(u)}
                          className={`btn ${u.status === 'Approved' ? 'btn-danger' : 'btn-primary'}`}
                          style={{ padding: '0.35rem 0.6rem', fontSize: '0.75rem', borderRadius: '6px', display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}
                        >
                          {u.status === 'Approved' ? (
                            <><Ban size={12} /> Deactivate</>
                          ) : (
                            <><UserCheck size={12} style={{ color: 'white' }} /> Activate</>
                          )}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* 3. User Activity Log Drawer Overlay (Conditional Modal) */}
      {activeUserLogs && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.8)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '2rem' }}>
          <div className="glass-card" style={{ width: '100%', maxWidth: '750px', display: 'flex', flexDirection: 'column', gap: '1.5rem', background: '#090714', maxHeight: '90vh' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border-light)', paddingBottom: '0.75rem' }}>
              <h3 style={{ fontSize: '1.25rem' }}>Activity Logs: @{activeUserLogs.username}</h3>
              <button onClick={() => setActiveUserLogs(null)} className="btn btn-secondary" style={{ padding: '0.25rem 0.5rem' }}>✕ Close</button>
            </div>

            <div className="console-container" style={{ flex: 1, overflowY: 'auto' }}>
              {logsLoading ? (
                <div style={{ display: 'flex', justifyContent: 'center', padding: '2rem' }}><div className="spinner"></div></div>
              ) : userLogs.length === 0 ? (
                <p style={{ color: 'var(--text-muted)', fontSize: '0.8125rem' }}>No activity logs found for this user.</p>
              ) : (
                userLogs.map(log => (
                  <div key={log.id} className="console-line">
                    <span className="console-timestamp">[{new Date(log.created_at).toLocaleString()}]</span>
                    <span className="console-action" style={{ color: 'var(--primary)' }}>{log.action}</span>
                    <span style={{ color: 'var(--text-muted)', fontSize: '0.75rem', marginRight: '0.5rem' }}>({log.ip_address})</span>
                    <span style={{ color: 'var(--text-main)' }}>{log.description}</span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
