import React, { useState, useEffect } from 'react'
import { useAuth } from '../App'
import { Plus, Edit2, Trash2, ShieldAlert, Check, X, ToggleLeft, ToggleRight } from 'lucide-react'

const API_BASE = "http://localhost:8000"

export default function Accounts() {
  const { user } = useAuth()
  const isAdmin = user?.role === 'admin'

  const [accounts, setAccounts] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')

  // Form states
  const [isFormOpen, setIsFormOpen] = useState(false)
  const [editingAccount, setEditingAccount] = useState(null)
  const [username, setUsername] = useState('')
  const [accessToken, setAccessToken] = useState('')
  const [status, setStatus] = useState('ACTIVE')

  const fetchAccounts = async () => {
    setLoading(true)
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

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setSuccess('')

    if (!username.trim()) {
      setError('Username is required')
      return
    }

    const payload = { username }
    
    // For creation, access token is required. For editing, it is optional.
    if (!editingAccount && !accessToken.trim()) {
      setError('Access token is required for new accounts')
      return
    }

    if (accessToken.trim()) {
      payload.access_token = accessToken
    }

    if (editingAccount) {
      payload.status = status
    }

    try {
      const url = editingAccount 
        ? `${API_BASE}/accounts/${editingAccount.id}` 
        : `${API_BASE}/accounts`
      
      const method = editingAccount ? 'PUT' : 'POST'

      const response = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${user.token}`
        },
        body: JSON.stringify(payload)
      })

      const data = await response.json()
      if (!response.ok) {
        throw new Error(data.detail || 'Save failed')
      }

      setSuccess(editingAccount ? 'Account updated successfully!' : 'Account registered successfully!')
      handleCloseForm()
      fetchAccounts()
    } catch (err) {
      setError(err.message)
    }
  }

  const handleEdit = (acc) => {
    if (!isAdmin) return
    setEditingAccount(acc)
    setUsername(acc.username)
    setAccessToken('') // Leave blank unless updating
    setStatus(acc.status)
    setIsFormOpen(true)
  }

  const handleDelete = async (id) => {
    if (!isAdmin) return
    if (!window.confirm('Are you sure you want to delete this Instagram account? All history entries will remain, but this account will be removed.')) return

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

      setSuccess('Account deleted successfully!')
      fetchAccounts()
    } catch (err) {
      setError(err.message)
    }
  }

  const handleToggleStatus = async (acc) => {
    if (!isAdmin) return
    const newStatus = acc.status === 'ACTIVE' ? 'INACTIVE' : 'ACTIVE'
    
    try {
      const response = await fetch(`${API_BASE}/accounts/${acc.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${user.token}`
        },
        body: JSON.stringify({ status: newStatus })
      })

      if (response.ok) {
        fetchAccounts()
      }
    } catch (err) {
      console.error("Failed to toggle status:", err)
    }
  }

  const handleCloseForm = () => {
    setIsFormOpen(false)
    setEditingAccount(null)
    setUsername('')
    setAccessToken('')
    setStatus('ACTIVE')
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '2rem' }}>
        <div>
          <h1 style={{ fontSize: '2rem', marginBottom: '0.25rem' }}>Instagram Accounts</h1>
          <p style={{ color: 'var(--text-muted)' }}>Configure credentials and verify connection links.</p>
        </div>
        
        {isAdmin && !isFormOpen && (
          <button onClick={() => setIsFormOpen(true)} className="btn btn-primary">
            <Plus size={16} /> Add IG Account
          </button>
        )}
      </div>

      {/* Admin Privilege Notification */}
      {!isAdmin && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', background: 'rgba(245, 158, 11, 0.12)', border: '1px solid rgba(245, 158, 11, 0.25)', padding: '0.85rem 1.25rem', borderRadius: '10px', color: '#fbbf24', fontSize: '0.875rem', marginBottom: '1.5rem' }}>
          <ShieldAlert size={18} />
          <span>Role-Based Access Active: You have view-only access. Account registrations and key rotations require admin status.</span>
        </div>
      )}

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

      {/* Account form block */}
      {isFormOpen && (
        <div className="glass-card" style={{ marginBottom: '2rem' }}>
          <h2 style={{ fontSize: '1.25rem', marginBottom: '1.5rem' }}>
            {editingAccount ? `Modify Account: @${editingAccount.username}` : 'Register New Instagram Account'}
          </h2>
          
          <form onSubmit={handleSubmit} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem' }}>
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
              <label className="form-label" htmlFor="acc-token">
                {editingAccount ? 'Update Page Access Token (Leave blank to keep current)' : 'Facebook Page Access Token'}
              </label>
              <input
                id="acc-token"
                type="password"
                className="form-input"
                placeholder={editingAccount ? '••••••••••••••••••••••••••••' : 'Enter access token (or mock_token_username)'}
                value={accessToken}
                onChange={(e) => setAccessToken(e.target.value)}
              />
            </div>

            {editingAccount && (
              <div className="form-group" style={{ marginBottom: 0, gridColumn: 'span 2' }}>
                <label className="form-label">Account Status</label>
                <div style={{ display: 'flex', gap: '1rem' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                    <input type="radio" name="status" checked={status === 'ACTIVE'} onChange={() => setStatus('ACTIVE')} />
                    <span>ACTIVE (Enable publications)</span>
                  </label>
                  <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer' }}>
                    <input type="radio" name="status" checked={status === 'INACTIVE'} onChange={() => setStatus('INACTIVE')} />
                    <span>INACTIVE (Temporarily disable)</span>
                  </label>
                </div>
              </div>
            )}

            <div style={{ gridColumn: 'span 2', display: 'flex', gap: '1rem', justifyContent: 'flex-end', marginTop: '0.5rem' }}>
              <button type="button" onClick={handleCloseForm} className="btn btn-secondary">Cancel</button>
              <button type="submit" className="btn btn-primary">Save Account</button>
            </div>
          </form>
        </div>
      )}

      {/* Accounts List Table */}
      <div className="table-container">
        {loading && accounts.length === 0 ? (
          <div style={{ padding: '3rem', textAlign: 'center' }}><div className="spinner" style={{ margin: '0 auto' }}></div></div>
        ) : accounts.length === 0 ? (
          <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-muted)' }}>
            No accounts registered. Click "Add IG Account" to connect your first page.
          </div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Username</th>
                <th>Status</th>
                <th>Decryption Health</th>
                <th>Registered At</th>
                {isAdmin && <th style={{ textAlign: 'right' }}>Actions</th>}
              </tr>
            </thead>
            <tbody>
              {accounts.map(acc => (
                <tr key={acc.id}>
                  <td style={{ fontWeight: 600 }}>@{acc.username}</td>
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
                  {isAdmin && (
                    <td style={{ textAlign: 'right' }}>
                      <div style={{ display: 'inline-flex', gap: '0.5rem' }}>
                        <button
                          onClick={() => handleToggleStatus(acc)}
                          className="btn btn-secondary"
                          style={{ padding: '0.35rem 0.5rem', fontSize: '0.75rem', borderRadius: '6px' }}
                          title={acc.status === 'ACTIVE' ? "Deactivate Account" : "Activate Account"}
                        >
                          {acc.status === 'ACTIVE' ? <ToggleRight size={16} style={{ color: 'var(--primary)' }} /> : <ToggleLeft size={16} />}
                        </button>
                        <button
                          onClick={() => handleEdit(acc)}
                          className="btn btn-secondary"
                          style={{ padding: '0.35rem 0.5rem', fontSize: '0.75rem', borderRadius: '6px' }}
                          title="Edit Account Credentials"
                        >
                          <Edit2 size={13} />
                        </button>
                        <button
                          onClick={() => handleDelete(acc.id)}
                          className="btn btn-danger"
                          style={{ padding: '0.35rem 0.5rem', fontSize: '0.75rem', borderRadius: '6px' }}
                          title="Remove Account"
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  )
}
