import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { KeyRound, User, UserPlus, Shield } from 'lucide-react'

const API_BASE = "http://localhost:8000"

export default function Signup() {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState('user')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const navigate = useNavigate()

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setLoading(true)

    if (username.length < 3) {
      setError('Username must be at least 3 characters long')
      setLoading(false)
      return
    }

    if (password.length < 5) {
      setError('Password must be at least 5 characters long')
      setLoading(false)
      return
    }

    try {
      const response = await fetch(`${API_BASE}/signup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password, role })
      })

      const data = await response.json()
      if (!response.ok) {
        throw new Error(data.detail || 'Registration failed')
      }

      // Redirect back to login with success state
      navigate('/login', { state: { message: `Successfully registered ${username}! You can now sign in.` } })
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="login-page">
      <div className="glass-card login-card">
        <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
          <div className="logo-icon" style={{ margin: '0 auto 1rem', width: '56px', height: '56px', fontSize: '1.75rem' }}>📸</div>
          <h1 style={{ fontSize: '1.75rem', marginBottom: '0.5rem' }}>IG Multi-Publisher</h1>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>Create an account to manage your feeds</p>
        </div>

        {error && (
          <div style={{ background: 'rgba(239, 68, 68, 0.15)', border: '1px solid rgba(239, 68, 68, 0.3)', padding: '0.75rem 1rem', borderRadius: '8px', color: '#f87171', fontSize: '0.875rem', marginBottom: '1.5rem' }}>
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label className="form-label" htmlFor="username">Username</label>
            <div style={{ position: 'relative' }}>
              <User size={16} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
              <input
                id="username"
                type="text"
                required
                className="form-input"
                style={{ paddingLeft: '2.5rem' }}
                placeholder="Choose username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
              />
            </div>
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="password">Password</label>
            <div style={{ position: 'relative' }}>
              <KeyRound size={16} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
              <input
                id="password"
                type="password"
                required
                className="form-input"
                style={{ paddingLeft: '2.5rem' }}
                placeholder="Choose password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="role">Account Role</label>
            <div style={{ position: 'relative' }}>
              <Shield size={16} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
              <select
                id="role"
                className="form-input"
                style={{ paddingLeft: '2.5rem', appearance: 'none', background: 'rgba(0, 0, 0, 0.3) url("data:image/svg+xml;charset=utf-8,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' viewBox=\'0 0 4 5\'%3E%3Cpath fill=\'%239ca3af\' d=\'M2 0L0 2h4zm0 5L0 3h4z\'/%3E%3C/svg%3E") no-repeat right 12px center/8px 10px' }}
                value={role}
                onChange={(e) => setRole(e.target.value)}
              >
                <option value="user" style={{ backgroundColor: '#090714', color: 'white' }}>User (Publish & View Only)</option>
                <option value="admin" style={{ backgroundColor: '#090714', color: 'white' }}>Admin (Full Access & Account Setup)</option>
              </select>
            </div>
          </div>

          <button
            type="submit"
            className="btn btn-primary"
            style={{ width: '100%', padding: '0.85rem', marginTop: '1rem' }}
            disabled={loading}
          >
            {loading ? <div className="spinner"></div> : (
              <span style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', justifyContent: 'center' }}>
                <UserPlus size={18} /> Register Account
              </span>
            )}
          </button>
        </form>

        <div style={{ marginTop: '1.5rem', textAlign: 'center', fontSize: '0.875rem' }}>
          <span style={{ color: 'var(--text-muted)' }}>Already have an account? </span>
          <a
            href="/login"
            onClick={(e) => {
              e.preventDefault()
              navigate('/login')
            }}
            style={{ color: 'var(--primary)', textDecoration: 'none', fontWeight: 600 }}
          >
            Sign in
          </a>
        </div>
      </div>
    </div>
  )
}
