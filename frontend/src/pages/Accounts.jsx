import React, { useState, useEffect } from 'react'
import { useAuth } from '../App'
import { Plus, Edit2, Trash2, ShieldAlert, Check, X, ToggleLeft, ToggleRight, FileInput, ClipboardCheck } from 'lucide-react'

const API_BASE = "http://localhost:8000"

export default function Accounts() {
  const { user } = useAuth()
  const isSuperAdmin = user?.role === 'Super Admin'

  const [accounts, setAccounts] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  // Form toggles
  const [isAddFormOpen, setIsAddFormOpen] = useState(false)
  const [isRequestFormOpen, setIsRequestFormOpen] = useState(false)
  
  // Add Account form states
  const [username, setUsername] = useState('')
  const [accessToken, setAccessToken] = useState('')
  const [refreshToken, setRefreshToken] = useState('')

  // Credential Update Request form states
  const [selectedAccountId, setSelectedAccountId] = useState(null)
  const [reqUsername, setReqUsername] = useState('')
  const [reqPassword, setReqPassword] = useState('')
  const [reqAccessToken, setReqAccessToken] = useState('')
  const [reqRefreshToken, setReqRefreshToken] = useState('')
  const [reqReason, setReqReason] = useState('')

  // Edit Account state (Super Admin only)
  const [editingAccount, setEditingAccount] = useState(null)

  const fetchAccounts = async () => {
    setLoading(true)
    setError('')
    try {
      const response = await fetch(`${API_BASE}/accounts`, {
        headers: { 'Authorization': `Bearer ${user.token}` }
      })
      const data = await response.json()
      if (response.ok) {
        setAccounts(data)
      } else {
        setError(data.detail || 'Failed to retrieve accounts')
      }
    } catch (err) {
      setError('Connection error fetching accounts.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchAccounts()
  }, [])

  // Handle Add Account (Standard User or Super Admin)
  const handleAddAccount = async (e) => {
    e.preventDefault()
    setError('')
    setSuccess('')

    if (!username.trim() || !accessToken.trim()) {
      setError('Username and Page Access Token are required.')
      return
    }

    try {
      const response = await fetch(`${API_BASE}/accounts`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${user.token}`
        },
        body: JSON.stringify({
          instagram_username: username.trim(),
          access_token: accessToken.trim(),
          refresh_token: refreshToken.trim() || null
        })
      })

      const data = await response.json()
      if (!response.ok) {
        throw new Error(data.detail || 'Failed to connect account.')
      }

      setSuccess(`Account @${data.instagram_username} connected successfully!`)
      setIsAddFormOpen(false)
      setUsername('')
      setAccessToken('')
      setRefreshToken('')
      fetchAccounts()
    } catch (err) {
      setError(err.message)
    }
  }

  // Handle direct account update (Super Admin only)
  const handleDirectUpdate = async (e) => {
    e.preventDefault()
    setError('')
    setSuccess('')

    try {
      const response = await fetch(`${API_BASE}/accounts/${editingAccount.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${user.token}`
        },
        body: JSON.stringify({
          instagram_username: username.trim(),
          access_token: accessToken.trim(),
          refresh_token: refreshToken.trim() || null
        })
      })

      const data = await response.json()
      if (!response.ok) {
        throw new Error(data.detail || 'Update failed')
      }

      setSuccess('Account credentials updated directly.')
      setEditingAccount(null)
      setUsername('')
      setAccessToken('')
      setRefreshToken('')
      fetchAccounts()
    } catch (err) {
      setError(err.message)
    }
  }

  // Handle delete account (Super Admin only)
  const handleDelete = async (id) => {
    if (!isSuperAdmin) return
    if (!window.confirm('Are you sure you want to delete these credentials? Standard users will lose publishing access to this feed.')) return

    setError('')
    setSuccess('')

    try {
      const response = await fetch(`${API_BASE}/accounts/${id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${user.token}` }
      })

      const data = await response.json()
      if (!response.ok) {
        throw new Error(data.detail || 'Delete failed')
      }

      setSuccess('Instagram account removed successfully.')
      fetchAccounts()
    } catch (err) {
      setError(err.message)
    }
  }

  // Handle open request form (Standard User)
  const handleOpenRequestForm = (acc) => {
    setSelectedAccountId(acc.id)
    setReqUsername(acc.instagram_username)
    setReqPassword('')
    setReqAccessToken('')
    setReqRefreshToken('')
    setReqReason('')
    setIsRequestFormOpen(true)
  }

  // Handle submit credential request (Standard User)
  const handleRequestSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setSuccess('')

    if (!reqAccessToken.trim() || !reqReason.trim()) {
      setError('New Access Token and Reason for Update are required.')
      return
    }

    try {
      const response = await fetch(`${API_BASE}/credential-requests`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${user.token}`
        },
        body: JSON.stringify({
          instagram_account_id: selectedAccountId,
          requested_username: reqUsername.trim(),
          requested_password: reqPassword.trim() || null,
          requested_access_token: reqAccessToken.trim(),
          requested_refresh_token: reqRefreshToken.trim() || null,
          reason: reqReason.trim()
        })
      })

      const data = await response.json()
      if (!response.ok) {
        throw new Error(data.detail || 'Failed to submit update request.')
      }

      setSuccess('Credential update request submitted successfully. Awaiting Super Admin review.')
      setIsRequestFormOpen(false)
      setSelectedAccountId(null)
      setReqUsername('')
      setReqPassword('')
      setReqAccessToken('')
      setReqRefreshToken('')
      setReqReason('')
    } catch (err) {
      setError(err.message)
    }
  }

  const handleOpenEdit = (acc) => {
    setEditingAccount(acc)
    setUsername(acc.instagram_username)
    setAccessToken('') // clear input for security
    setRefreshToken('')
    setIsAddFormOpen(false)
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
        <div>
          <h1 style={{ fontSize: '2rem', marginBottom: '0.25rem' }}>Instagram Accounts</h1>
          <p style={{ color: 'var(--text-muted)' }}>
            {isSuperAdmin ? 'Administrate all connected Instagram feeds and credentials.' : 'Connect and view your publishing feeds.'}
          </p>
        </div>
        
        {!isAddFormOpen && !editingAccount && !isRequestFormOpen && (
          <button onClick={() => setIsAddFormOpen(true)} className="btn btn-primary">
            <Plus size={16} /> Connect Account
          </button>
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

      {/* Add / Connect Account Form */}
      {isAddFormOpen && (
        <div className="glass-card" style={{ marginBottom: '2rem' }}>
          <h2 style={{ fontSize: '1.25rem', marginBottom: '1.5rem' }}>Connect Instagram Business Account</h2>
          <form onSubmit={handleAddAccount} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem' }}>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label" htmlFor="acc-username">Instagram Username (Handle)</label>
              <input
                id="acc-username"
                type="text"
                required
                className="form-input"
                placeholder="e.g. tech_trends_daily"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
              />
            </div>

            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label" htmlFor="acc-token">Graph Access Token</label>
              <input
                id="acc-token"
                type="password"
                required
                className="form-input"
                placeholder="Paste Page/User Access Token"
                value={accessToken}
                onChange={(e) => setAccessToken(e.target.value)}
              />
            </div>

            <div className="form-group" style={{ marginBottom: 0, gridColumn: 'span 2' }}>
              <label className="form-label" htmlFor="acc-refresh">Refresh Token (Optional)</label>
              <input
                id="acc-refresh"
                type="password"
                className="form-input"
                placeholder="Paste Refresh Token if offline access is enabled"
                value={refreshToken}
                onChange={(e) => setRefreshToken(e.target.value)}
              />
            </div>

            <div style={{ gridColumn: 'span 2', display: 'flex', gap: '1rem', justifyContent: 'flex-end', marginTop: '0.5rem' }}>
              <button type="button" onClick={() => setIsAddFormOpen(false)} className="btn btn-secondary">Cancel</button>
              <button type="submit" className="btn btn-primary">Connect Account</button>
            </div>
          </form>
        </div>
      )}

      {/* Super Admin Edit Account Form */}
      {editingAccount && (
        <div className="glass-card" style={{ marginBottom: '2rem' }}>
          <h2 style={{ fontSize: '1.25rem', marginBottom: '1.5rem' }}>Modify Account Credentials: @{editingAccount.instagram_username}</h2>
          <form onSubmit={handleDirectUpdate} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem' }}>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label" htmlFor="edit-username">Instagram Username (Handle)</label>
              <input
                id="edit-username"
                type="text"
                required
                className="form-input"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
              />
            </div>

            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label" htmlFor="edit-token">New Graph Access Token</label>
              <input
                id="edit-token"
                type="password"
                required
                className="form-input"
                placeholder="Paste new access token"
                value={accessToken}
                onChange={(e) => setAccessToken(e.target.value)}
              />
            </div>

            <div className="form-group" style={{ marginBottom: 0, gridColumn: 'span 2' }}>
              <label className="form-label" htmlFor="edit-refresh">New Refresh Token (Optional)</label>
              <input
                id="edit-refresh"
                type="password"
                className="form-input"
                placeholder="Paste new refresh token"
                value={refreshToken}
                onChange={(e) => setRefreshToken(e.target.value)}
              />
            </div>

            <div style={{ gridColumn: 'span 2', display: 'flex', gap: '1rem', justifyContent: 'flex-end', marginTop: '0.5rem' }}>
              <button type="button" onClick={() => setEditingAccount(null)} className="btn btn-secondary">Cancel</button>
              <button type="submit" className="btn btn-primary">Save Changes</button>
            </div>
          </form>
        </div>
      )}

      {/* Submit Update Request Form (Standard User) */}
      {isRequestFormOpen && (
        <div className="glass-card" style={{ marginBottom: '2rem' }}>
          <h2 style={{ fontSize: '1.25rem', marginBottom: '1.5rem' }}>Request Credential Update: @{reqUsername}</h2>
          <form onSubmit={handleRequestSubmit} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem' }}>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label" htmlFor="req-username">Instagram Username</label>
              <input
                id="req-username"
                type="text"
                required
                className="form-input"
                value={reqUsername}
                onChange={(e) => setReqUsername(e.target.value)}
              />
            </div>

            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label" htmlFor="req-password">Instagram Account Password (Optional)</label>
              <input
                id="req-password"
                type="password"
                className="form-input"
                placeholder="Optional"
                value={reqPassword}
                onChange={(e) => setReqPassword(e.target.value)}
              />
            </div>

            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label" htmlFor="req-token">New Access Token</label>
              <input
                id="req-token"
                type="password"
                required
                className="form-input"
                placeholder="Paste new Page Access Token"
                value={reqAccessToken}
                onChange={(e) => setReqAccessToken(e.target.value)}
              />
            </div>

            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label" htmlFor="req-refresh">New Refresh Token (Optional)</label>
              <input
                id="req-refresh"
                type="password"
                className="form-input"
                placeholder="Paste new Refresh Token"
                value={reqRefreshToken}
                onChange={(e) => setReqRefreshToken(e.target.value)}
              />
            </div>

            <div className="form-group" style={{ marginBottom: 0, gridColumn: 'span 2' }}>
              <label className="form-label" htmlFor="req-reason">Reason for Update</label>
              <textarea
                id="req-reason"
                required
                className="form-input"
                rows={3}
                placeholder="Explain why credentials need to be updated (e.g. Expired token, password reset, etc.)"
                value={reqReason}
                onChange={(e) => setReqReason(e.target.value)}
              />
            </div>

            <div style={{ gridColumn: 'span 2', display: 'flex', gap: '1rem', justifyContent: 'flex-end', marginTop: '0.5rem' }}>
              <button type="button" onClick={() => setIsRequestFormOpen(false)} className="btn btn-secondary">Cancel</button>
              <button type="submit" className="btn btn-primary">Submit Request</button>
            </div>
          </form>
        </div>
      )}

      {/* Connected Accounts Table */}
      <div className="table-container">
        {loading && accounts.length === 0 ? (
          <div style={{ padding: '3rem', textAlign: 'center' }}><div className="spinner" style={{ margin: '0 auto' }}></div></div>
        ) : accounts.length === 0 ? (
          <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-muted)' }}>
            No accounts connected. Click "Connect Account" to connect your first feed.
          </div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Username</th>
                {isSuperAdmin && <th>User ID</th>}
                <th>Status</th>
                <th>Security Health</th>
                <th>Connected At</th>
                <th style={{ textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {accounts.map(acc => (
                <tr key={acc.id}>
                  <td style={{ fontWeight: 600 }}>@{acc.instagram_username}</td>
                  {isSuperAdmin && <td style={{ color: 'var(--text-muted)', fontSize: '0.8125rem' }}>User #{acc.user_id}</td>}
                  <td>
                    <span className={`badge ${acc.status === 'ACTIVE' ? 'badge-success' : 'badge-danger'}`}>
                      {acc.status === 'ACTIVE' ? <Check size={10} /> : <X size={10} />}
                      {acc.status}
                    </span>
                  </td>
                  <td>
                    <span style={{ color: 'var(--success)', fontSize: '0.8125rem', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                      <span style={{ width: '6px', height: '6px', background: 'var(--success)', borderRadius: '50%' }}></span>
                      Encrypted (Secure)
                    </span>
                  </td>
                  <td style={{ color: 'var(--text-muted)', fontSize: '0.8125rem' }}>
                    {new Date(acc.created_at).toLocaleDateString()}
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    {isSuperAdmin ? (
                      <div style={{ display: 'inline-flex', gap: '0.5rem' }}>
                        <button
                          onClick={() => handleOpenEdit(acc)}
                          className="btn btn-secondary"
                          style={{ padding: '0.35rem 0.5rem', fontSize: '0.75rem', borderRadius: '6px' }}
                          title="Direct Edit Credentials"
                        >
                          <Edit2 size={13} />
                        </button>
                        <button
                          onClick={() => handleDelete(acc.id)}
                          className="btn btn-danger"
                          style={{ padding: '0.35rem 0.5rem', fontSize: '0.75rem', borderRadius: '6px' }}
                          title="Delete Credentials"
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => handleOpenRequestForm(acc)}
                        className="btn btn-secondary"
                        style={{ padding: '0.35rem 0.75rem', fontSize: '0.75rem', borderRadius: '6px', display: 'inline-flex', alignItems: 'center', gap: '0.35rem' }}
                      >
                        <ClipboardCheck size={12} /> Request Update
                      </button>
                    )}
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
