import React, { useState, useEffect } from 'react'
import { useAuth } from '../App'
import { Plus, Edit2, Trash2, ShieldAlert, Check, X, Key, Lock, ClipboardCheck, AlertTriangle, Eye, EyeOff } from 'lucide-react'

import { API_BASE } from '../config'

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
  const [usernameOrEmail, setUsernameOrEmail] = useState('')
  const [password, setPassword] = useState('')
  const [accessToken, setAccessToken] = useState('')

  // Credential Update Request form states
  const [selectedAccountId, setSelectedAccountId] = useState(null)
  const [reqUsernameOrEmail, setReqUsernameOrEmail] = useState('')
  const [reqPassword, setReqPassword] = useState('')
  const [reqAccessToken, setReqAccessToken] = useState('')
  const [reqReason, setReqReason] = useState('')

  // Edit Account state (Super Admin only)
  const [editingAccount, setEditingAccount] = useState(null)

  const [showCreds, setShowCreds] = useState({})
  const toggleShowCreds = (id) => {
    setShowCreds(prev => ({ ...prev, [id]: !prev[id] }))
  }

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

    if (!usernameOrEmail.trim() || !password.trim() || !accessToken.trim()) {
      setError('Username/Email, Password and Access Token are required.')
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
          instagram_username_or_email: usernameOrEmail.trim(),
          password: password.trim(),
          access_token: accessToken.trim()
        })
      })

      const data = await response.json()
      if (!response.ok) {
        throw new Error(data.detail || 'Failed to connect account.')
      }

      setSuccess(`Account ${data.instagram_username_or_email} connected successfully!`)
      setIsAddFormOpen(false)
      setUsernameOrEmail('')
      setPassword('')
      setAccessToken('')
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

    if (!usernameOrEmail.trim() || !password.trim() || !accessToken.trim()) {
      setError('Username/Email, Password and Access Token are required.')
      return
    }

    try {
      const response = await fetch(`${API_BASE}/accounts/${editingAccount.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${user.token}`
        },
        body: JSON.stringify({
          instagram_username_or_email: usernameOrEmail.trim(),
          password: password.trim(),
          access_token: accessToken.trim()
        })
      })

      const data = await response.json()
      if (!response.ok) {
        throw new Error(data.detail || 'Update failed')
      }

      setSuccess('Account credentials updated directly.')
      setEditingAccount(null)
      setUsernameOrEmail('')
      setPassword('')
      setAccessToken('')
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
    setReqUsernameOrEmail(acc.instagram_username_or_email)
    setReqPassword('')
    setReqAccessToken('')
    setReqReason('')
    setIsRequestFormOpen(true)
  }

  // Handle submit credential request (Standard User)
  const handleRequestSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setSuccess('')

    if (!reqUsernameOrEmail.trim() || !reqPassword.trim() || !reqAccessToken.trim() || !reqReason.trim()) {
      setError('All fields (including Access Token) are required to request a credential update.')
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
          requested_username_or_email: reqUsernameOrEmail.trim(),
          requested_password: reqPassword.trim(),
          requested_access_token: reqAccessToken.trim(),
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
      setReqUsernameOrEmail('')
      setReqPassword('')
      setReqAccessToken('')
      setReqReason('')
    } catch (err) {
      setError(err.message)
    }
  }

  const handleOpenEdit = (acc) => {
    setEditingAccount(acc)
    setUsernameOrEmail(acc.instagram_username_or_email)
    setPassword('')
    setAccessToken('')
    setIsAddFormOpen(false)
  }

  const getMetricBadgeClass = (status) => {
    switch (status) {
      case 'SUCCESS': return 'badge-success'
      case 'FAILED': return 'badge-danger'
      default: return 'badge-pending'
    }
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
          <h2 style={{ fontSize: '1.25rem', marginBottom: '1.5rem' }}>Connect Instagram Account</h2>
          <form onSubmit={handleAddAccount} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem' }}>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label" htmlFor="acc-username">Instagram Username or Email</label>
              <input
                id="acc-username"
                type="text"
                required
                className="form-input"
                placeholder="Username or email address"
                value={usernameOrEmail}
                onChange={(e) => setUsernameOrEmail(e.target.value)}
              />
            </div>

            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label" htmlFor="acc-password">Instagram Password</label>
              <input
                id="acc-password"
                type="password"
                required
                className="form-input"
                placeholder="Account password (will be encrypted)"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>

            <div className="form-group" style={{ marginBottom: 0, gridColumn: 'span 2' }}>
              <label className="form-label" htmlFor="acc-token">Instagram Access Token</label>
              <input
                id="acc-token"
                type="password"
                required
                className="form-input"
                placeholder="Graph API Access Token (will be encrypted)"
                value={accessToken}
                onChange={(e) => setAccessToken(e.target.value)}
              />
            </div>

            <div style={{ gridColumn: 'span 2', display: 'flex', gap: '1rem', justifyContent: 'flex-end', marginTop: '0.5rem' }}>
              <button type="button" onClick={() => setIsAddFormOpen(false)} className="btn btn-secondary">Cancel</button>
              <button type="submit" className="btn btn-primary">Connect Credentials</button>
            </div>
          </form>
        </div>
      )}

      {/* Super Admin Edit Account Form */}
      {editingAccount && (
        <div className="glass-card" style={{ marginBottom: '2rem' }}>
          <h2 style={{ fontSize: '1.25rem', marginBottom: '1.5rem' }}>Modify Account: {editingAccount.instagram_username_or_email}</h2>
          <form onSubmit={handleDirectUpdate} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem' }}>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label" htmlFor="edit-username">Instagram Username or Email</label>
              <input
                id="edit-username"
                type="text"
                required
                className="form-input"
                value={usernameOrEmail}
                onChange={(e) => setUsernameOrEmail(e.target.value)}
              />
            </div>

            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label" htmlFor="edit-password">New Instagram Password</label>
              <input
                id="edit-password"
                type="password"
                required
                className="form-input"
                placeholder="Enter new password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>

            <div className="form-group" style={{ marginBottom: 0, gridColumn: 'span 2' }}>
              <label className="form-label" htmlFor="edit-token">New Instagram Access Token</label>
              <input
                id="edit-token"
                type="password"
                required
                className="form-input"
                placeholder="Enter new access token"
                value={accessToken}
                onChange={(e) => setAccessToken(e.target.value)}
              />
            </div>

            <div style={{ gridColumn: 'span 2', display: 'flex', gap: '1rem', justifyContent: 'flex-end', marginTop: '0.5rem' }}>
              <button type="button" onClick={() => setEditingAccount(null)} className="btn btn-secondary">Cancel</button>
              <button type="submit" className="btn btn-primary">Save Credentials</button>
            </div>
          </form>
        </div>
      )}

      {/* Submit Update Request Form (Standard User) */}
      {isRequestFormOpen && (
        <div className="glass-card" style={{ marginBottom: '2rem' }}>
          <h2 style={{ fontSize: '1.25rem', marginBottom: '1.5rem' }}>Request Credential Update: {reqUsernameOrEmail}</h2>
          <form onSubmit={handleRequestSubmit} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem' }}>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label" htmlFor="req-username">Instagram Username or Email</label>
              <input
                id="req-username"
                type="text"
                required
                className="form-input"
                value={reqUsernameOrEmail}
                onChange={(e) => setReqUsernameOrEmail(e.target.value)}
              />
            </div>

            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label" htmlFor="req-password">New Instagram Password</label>
              <input
                id="req-password"
                type="password"
                required
                className="form-input"
                placeholder="Enter new password"
                value={reqPassword}
                onChange={(e) => setReqPassword(e.target.value)}
              />
            </div>

            <div className="form-group" style={{ marginBottom: 0, gridColumn: 'span 2' }}>
              <label className="form-label" htmlFor="req-token">New Instagram Access Token</label>
              <input
                id="req-token"
                type="password"
                required
                className="form-input"
                placeholder="Enter new access token"
                value={reqAccessToken}
                onChange={(e) => setReqAccessToken(e.target.value)}
              />
            </div>

            <div className="form-group" style={{ marginBottom: 0, gridColumn: 'span 2' }}>
              <label className="form-label" htmlFor="req-reason">Reason for Update</label>
              <textarea
                id="req-reason"
                required
                className="form-input"
                rows={3}
                placeholder="Explain why credentials need to be updated (e.g. Password changed, login failure, security lock, etc.)"
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
                <th>Username/Email</th>
                {isSuperAdmin && <th>User ID</th>}
                {isSuperAdmin && <th>Decrypted Credentials</th>}
                <th>Status</th>
                <th>Last Login</th>
                <th>Last Publish</th>
                <th>Security Health</th>
                <th style={{ textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {accounts.map(acc => (
                <tr key={acc.id}>
                  <td style={{ fontWeight: 600 }}>{acc.instagram_username_or_email}</td>
                  {isSuperAdmin && <td style={{ color: 'var(--text-muted)', fontSize: '0.8125rem' }}>User #{acc.user_id}</td>}
                  {isSuperAdmin && (
                    <td>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', fontSize: '0.8125rem', minWidth: '150px' }}>
                        <div>
                          <span style={{ color: 'var(--text-muted)' }}>Password: </span>
                          <span style={{ fontFamily: 'monospace', color: 'var(--accent-pink)' }}>{showCreds[acc.id] ? acc.decrypted_password : '••••••••'}</span>
                        </div>
                        <div>
                          <span style={{ color: 'var(--text-muted)' }}>Token: </span>
                          <span style={{ fontFamily: 'monospace', wordBreak: 'break-all', color: 'var(--accent-pink)' }}>
                            {showCreds[acc.id] ? (acc.decrypted_access_token || 'None') : '••••••••••••••••'}
                          </span>
                        </div>
                        <button
                          type="button"
                          onClick={() => toggleShowCreds(acc.id)}
                          className="btn btn-secondary"
                          style={{ padding: '0.15rem 0.4rem', fontSize: '0.7rem', alignSelf: 'flex-start', display: 'inline-flex', alignItems: 'center', gap: '0.25rem', marginTop: '0.25rem' }}
                        >
                          {showCreds[acc.id] ? <EyeOff size={11} /> : <Eye size={11} />}
                          {showCreds[acc.id] ? 'Hide' : 'Reveal'}
                        </button>
                      </div>
                    </td>
                  )}
                  <td>
                    <span className={`badge ${acc.status === 'ACTIVE' ? 'badge-success' : acc.status === 'LOCKED' ? 'badge-danger' : 'badge-pending'}`}>
                      {acc.status}
                    </span>
                  </td>
                  <td>
                    <span className={`badge ${getMetricBadgeClass(acc.last_login_status)}`}>
                      {acc.last_login_status}
                    </span>
                  </td>
                  <td>
                    <span className={`badge ${getMetricBadgeClass(acc.last_publish_status)}`}>
                      {acc.last_publish_status}
                    </span>
                  </td>
                  <td>
                    <span style={{ color: 'var(--success)', fontSize: '0.8125rem', display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                      <span style={{ width: '6px', height: '6px', background: 'var(--success)', borderRadius: '50%' }}></span>
                      Encrypted Credentials
                    </span>
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
