import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { KeyRound, User, UserPlus, Mail, Phone, FileText } from 'lucide-react'

const API_BASE = "http://localhost:8000"

export default function Signup() {
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [mobileNumber, setMobileNumber] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const navigate = useNavigate()

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setLoading(true)

    if (fullName.trim().length < 3) {
      setError('Full Name must be at least 3 characters long.')
      setLoading(false)
      return
    }

    if (username.trim().length < 3) {
      setError('Username must be at least 3 characters long.')
      setLoading(false)
      return
    }

    if (password.length < 5) {
      setError('Password must be at least 5 characters long.')
      setLoading(false)
      return
    }

    try {
      const response = await fetch(`${API_BASE}/signup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          full_name: fullName.trim(),
          email: email.trim(),
          mobile_number: mobileNumber.trim(),
          username: username.trim(),
          password: password
        })
      })

      const data = await response.json()
      if (!response.ok) {
        throw new Error(data.detail || 'Registration failed.')
      }

      // Redirect to verification OTP page, passing the username
      navigate('/verify', { state: { username: username.trim() } })
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="login-page">
      <div className="glass-card login-card" style={{ maxWidth: '460px' }}>
        <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
          <div className="logo-icon" style={{ margin: '0 auto 1rem', width: '56px', height: '56px', fontSize: '1.75rem' }}>📸</div>
          <h1 style={{ fontSize: '1.75rem', marginBottom: '0.5rem' }}>Platform Registration</h1>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>Create an account to join the publishing platform</p>
        </div>

        {error && (
          <div style={{ background: 'rgba(239, 68, 68, 0.15)', border: '1px solid rgba(239, 68, 68, 0.3)', padding: '0.75rem 1rem', borderRadius: '8px', color: '#f87171', fontSize: '0.875rem', marginBottom: '1.5rem' }}>
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label className="form-label" htmlFor="fullname">Full Name</label>
            <div style={{ position: 'relative' }}>
              <FileText size={16} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
              <input
                id="fullname"
                type="text"
                required
                className="form-input"
                style={{ paddingLeft: '2.5rem' }}
                placeholder="Enter your full name"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
              />
            </div>
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="email">Email Address</label>
            <div style={{ position: 'relative' }}>
              <Mail size={16} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
              <input
                id="email"
                type="email"
                required
                className="form-input"
                style={{ paddingLeft: '2.5rem' }}
                placeholder="Enter email address"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
          </div>

          <div className="form-group">
            <label className="form-label" htmlFor="mobile">Mobile Number</label>
            <div style={{ position: 'relative' }}>
              <Phone size={16} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
              <input
                id="mobile"
                type="text"
                required
                className="form-input"
                style={{ paddingLeft: '2.5rem' }}
                placeholder="Enter mobile number"
                value={mobileNumber}
                onChange={(e) => setMobileNumber(e.target.value)}
              />
            </div>
          </div>

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

          <button
            type="submit"
            className="btn btn-primary"
            style={{ width: '100%', padding: '0.85rem', marginTop: '1rem' }}
            disabled={loading}
          >
            {loading ? <div className="spinner"></div> : (
              <span style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', justifyContent: 'center' }}>
                <UserPlus size={18} /> Register & Verify
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
