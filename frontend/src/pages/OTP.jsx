import React, { useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { ShieldCheck, Mail, Phone, User } from 'lucide-react'

const API_BASE = "http://localhost:8000"

export default function OTP() {
  const navigate = useNavigate()
  const location = useLocation()
  
  // Try to pre-fill username from redirect state
  const redirectedUsername = location.state?.username || ''
  
  const [username, setUsername] = useState(redirectedUsername)
  const [emailOtp, setEmailOtp] = useState('')
  const [mobileOtp, setMobileOtp] = useState('')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setSuccess('')
    setLoading(true)

    if (!username.trim()) {
      setError('Username is required')
      setLoading(false)
      return
    }

    try {
      const response = await fetch(`${API_BASE}/verify-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: username.trim(),
          email_otp: emailOtp.trim(),
          mobile_otp: mobileOtp.trim()
        })
      })

      const data = await response.json()
      if (!response.ok) {
        throw new Error(data.detail || 'OTP verification failed.')
      }

      setSuccess('Verification successful!')
      setTimeout(() => {
        navigate('/login', { state: { message: 'Verification complete! Your account is now pending approval by the Super Admin.' } })
      }, 2000)
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
          <div className="logo-icon" style={{ margin: '0 auto 1rem', width: '56px', height: '56px', fontSize: '1.75rem', background: 'var(--gradient-primary)' }}>🔐</div>
          <h1 style={{ fontSize: '1.75rem', marginBottom: '0.5rem' }}>Account Verification</h1>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.875rem' }}>
            Please enter the verification codes sent to your email and mobile.
          </p>
          <div style={{ marginTop: '0.5rem', background: 'rgba(192, 132, 252, 0.1)', border: '1px solid rgba(192, 132, 252, 0.2)', padding: '0.5rem', borderRadius: '6px', fontSize: '0.75rem', color: 'var(--primary)' }}>
            💡 Hint: Check backend logs/audit logs to read the generated codes!
          </div>
        </div>

        {error && (
          <div style={{ background: 'rgba(239, 68, 68, 0.15)', border: '1px solid rgba(239, 68, 68, 0.3)', padding: '0.75rem 1rem', borderRadius: '8px', color: '#f87171', fontSize: '0.875rem', marginBottom: '1.5rem' }}>
            {error}
          </div>
        )}

        {success && (
          <div style={{ background: 'rgba(16, 185, 129, 0.15)', border: '1px solid rgba(16, 185, 129, 0.3)', padding: '0.75rem 1rem', borderRadius: '8px', color: '#34d399', fontSize: '0.875rem', marginBottom: '1.5rem' }}>
            {success}
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
                placeholder="Enter registered username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
              />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
            <div className="form-group">
              <label className="form-label" htmlFor="emailOtp">Email OTP</label>
              <div style={{ position: 'relative' }}>
                <Mail size={16} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                <input
                  id="emailOtp"
                  type="text"
                  required
                  maxLength={6}
                  className="form-input"
                  style={{ paddingLeft: '2.5rem', letterSpacing: '2px', textAlign: 'center' }}
                  placeholder="6-digit"
                  value={emailOtp}
                  onChange={(e) => setEmailOtp(e.target.value)}
                />
              </div>
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="mobileOtp">Mobile OTP</label>
              <div style={{ position: 'relative' }}>
                <Phone size={16} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                <input
                  id="mobileOtp"
                  type="text"
                  required
                  maxLength={6}
                  className="form-input"
                  style={{ paddingLeft: '2.5rem', letterSpacing: '2px', textAlign: 'center' }}
                  placeholder="6-digit"
                  value={mobileOtp}
                  onChange={(e) => setMobileOtp(e.target.value)}
                />
              </div>
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
                <ShieldCheck size={18} /> Confirm Verification
              </span>
            )}
          </button>
        </form>

        <div style={{ marginTop: '1.5rem', textAlign: 'center', fontSize: '0.875rem' }}>
          <span style={{ color: 'var(--text-muted)' }}>Need to register? </span>
          <a href="/signup" onClick={(e) => { e.preventDefault(); navigate('/signup'); }} style={{ color: 'var(--primary)', textDecoration: 'none', fontWeight: 600 }}>
            Sign up
          </a>
        </div>
      </div>
    </div>
  )
}
