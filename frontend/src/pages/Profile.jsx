import React, { useState, useEffect } from 'react'
import { useAuth } from '../App'
import { User, Mail, Phone, Lock, CheckCircle2, AlertTriangle, ShieldCheck } from 'lucide-react'

const API_BASE = "http://localhost:8000"

export default function Profile() {
  const { user, updateProfileInStorage } = useAuth()
  
  // Profile state
  const [profile, setProfile] = useState(null)
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [mobileNumber, setMobileNumber] = useState('')
  
  // Password state
  const [oldPassword, setOldPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  
  // Notice states
  const [profileSuccess, setProfileSuccess] = useState('')
  const [profileError, setProfileError] = useState('')
  const [passSuccess, setPassSuccess] = useState('')
  const [passError, setPassError] = useState('')
  
  const [loading, setLoading] = useState(false)
  const [passLoading, setPassLoading] = useState(false)

  const fetchProfile = async () => {
    try {
      const response = await fetch(`${API_BASE}/profile`, {
        headers: { 'Authorization': `Bearer ${user.token}` }
      })
      const data = await response.json()
      if (response.ok) {
        setProfile(data)
        setFullName(data.full_name)
        setEmail(data.email)
        setMobileNumber(data.mobile_number)
      } else {
        setProfileError(data.detail || 'Failed to load profile details')
      }
    } catch (err) {
      setProfileError('Network error loading profile')
    }
  }

  useEffect(() => {
    fetchProfile()
  }, [])

  const handleProfileSubmit = async (e) => {
    e.preventDefault()
    setProfileError('')
    setProfileSuccess('')
    setLoading(true)

    try {
      const response = await fetch(`${API_BASE}/profile`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${user.token}`
        },
        body: JSON.stringify({
          full_name: fullName,
          email,
          mobile_number: mobileNumber
        })
      })

      const data = await response.json()
      if (!response.ok) {
        throw new Error(data.detail || 'Failed to update profile information')
      }

      setProfileSuccess('Profile information updated successfully!')
      setProfile(data)
      
      // Update name/email context storage if username was changed
      updateProfileInStorage(data.username)
    } catch (err) {
      setProfileError(err.message)
    } finally {
      setLoading(false)
    }
  }

  const handlePasswordSubmit = async (e) => {
    e.preventDefault()
    setPassError('')
    setPassSuccess('')
    setPassLoading(true)

    if (newPassword !== confirmPassword) {
      setPassError('New passwords do not match.')
      setPassLoading(false)
      return
    }

    if (newPassword.length < 5) {
      setPassError('New password must be at least 5 characters long.')
      setPassLoading(false)
      return
    }

    try {
      const response = await fetch(`${API_BASE}/profile/password`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${user.token}`
        },
        body: JSON.stringify({
          old_password: oldPassword,
          new_password: newPassword
        })
      })

      const data = await response.json()
      if (!response.ok) {
        throw new Error(data.detail || 'Failed to change password.')
      }

      setPassSuccess('Password changed successfully!')
      setOldPassword('')
      setNewPassword('')
      setConfirmPassword('')
    } catch (err) {
      setPassError(err.message)
    } finally {
      setPassLoading(false)
    }
  }

  if (!profile) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: '4rem' }}>
        <div className="spinner"></div>
      </div>
    )
  }

  return (
    <div>
      <div style={{ marginBottom: '2rem' }}>
        <h1 style={{ fontSize: '2rem', marginBottom: '0.25rem' }}>My Profile & Settings</h1>
        <p style={{ color: 'var(--text-muted)' }}>Manage your details and update authentication credentials.</p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2rem' }}>
        
        {/* Account Info and Details Form */}
        <div className="glass-card">
          <h2 style={{ fontSize: '1.25rem', marginBottom: '1.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <User size={18} style={{ color: 'var(--primary)' }} /> Edit Profile
          </h2>

          {profileError && (
            <div style={{ background: 'rgba(239, 68, 68, 0.15)', border: '1px solid rgba(239, 68, 68, 0.3)', padding: '0.75rem 1rem', borderRadius: '8px', color: '#f87171', fontSize: '0.875rem', marginBottom: '1.5rem' }}>
              {profileError}
            </div>
          )}

          {profileSuccess && (
            <div style={{ background: 'rgba(16, 185, 129, 0.15)', border: '1px solid rgba(16, 185, 129, 0.3)', padding: '0.75rem 1rem', borderRadius: '8px', color: '#34d399', fontSize: '0.875rem', marginBottom: '1.5rem' }}>
              {profileSuccess}
            </div>
          )}

          <form onSubmit={handleProfileSubmit}>
            <div className="form-group">
              <label className="form-label" htmlFor="username-display">Username</label>
              <input
                id="username-display"
                type="text"
                disabled
                className="form-input"
                style={{ background: 'rgba(255, 255, 255, 0.05)', color: 'var(--text-muted)', cursor: 'not-allowed' }}
                value={profile.username}
              />
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="fullname">Full Name</label>
              <input
                id="fullname"
                type="text"
                required
                className="form-input"
                placeholder="Enter full name"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
              />
            </div>

            <div className="form-group">
              <label className="form-label" htmlFor="profile-email">Email Address</label>
              <div style={{ position: 'relative' }}>
                <Mail size={16} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                <input
                  id="profile-email"
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
              <label className="form-label" htmlFor="profile-mobile">Mobile Number</label>
              <div style={{ position: 'relative' }}>
                <Phone size={16} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                <input
                  id="profile-mobile"
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

            <button type="submit" className="btn btn-primary" style={{ width: '100%', padding: '0.75rem' }} disabled={loading}>
              {loading ? <div className="spinner"></div> : 'Update Profile Details'}
            </button>
          </form>
        </div>

        {/* Password Manager & System Info Card */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
          
          {/* System Account Status Info */}
          <div className="glass-card" style={{ padding: '1.5rem' }}>
            <h2 style={{ fontSize: '1.1rem', marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <ShieldCheck size={18} style={{ color: 'var(--success)' }} /> Account Status Details
            </h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', fontSize: '0.875rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--border-light)', paddingBottom: '0.5rem' }}>
                <span style={{ color: 'var(--text-muted)' }}>Role Type:</span>
                <span style={{ fontWeight: 600, color: 'var(--primary)' }}>{profile.role}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid var(--border-light)', paddingBottom: '0.5rem' }}>
                <span style={{ color: 'var(--text-muted)' }}>Status:</span>
                <span className="badge badge-success">{profile.status}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: 'var(--text-muted)' }}>Publishing Access:</span>
                {profile.publishing_permission ? (
                  <span style={{ color: 'var(--success)', display: 'flex', alignItems: 'center', gap: '0.25rem', fontWeight: 600 }}>
                    <CheckCircle2 size={14} /> Active
                  </span>
                ) : (
                  <span style={{ color: 'var(--danger)', display: 'flex', alignItems: 'center', gap: '0.25rem', fontWeight: 600 }}>
                    <AlertTriangle size={14} /> Revoked
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Password Change Form */}
          <div className="glass-card" style={{ flex: 1 }}>
            <h2 style={{ fontSize: '1.25rem', marginBottom: '1.5rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Lock size={18} style={{ color: 'var(--accent-pink)' }} /> Change Password
            </h2>

            {passError && (
              <div style={{ background: 'rgba(239, 68, 68, 0.15)', border: '1px solid rgba(239, 68, 68, 0.3)', padding: '0.75rem 1rem', borderRadius: '8px', color: '#f87171', fontSize: '0.875rem', marginBottom: '1.5rem' }}>
                {passError}
              </div>
            )}

            {passSuccess && (
              <div style={{ background: 'rgba(16, 185, 129, 0.15)', border: '1px solid rgba(16, 185, 129, 0.3)', padding: '0.75rem 1rem', borderRadius: '8px', color: '#34d399', fontSize: '0.875rem', marginBottom: '1.5rem' }}>
                {passSuccess}
              </div>
            )}

            <form onSubmit={handlePasswordSubmit}>
              <div className="form-group">
                <label className="form-label" htmlFor="old-pass">Current Password</label>
                <input
                  id="old-pass"
                  type="password"
                  required
                  className="form-input"
                  placeholder="Enter current password"
                  value={oldPassword}
                  onChange={(e) => setOldPassword(e.target.value)}
                />
              </div>

              <div className="form-group">
                <label className="form-label" htmlFor="new-pass">New Password</label>
                <input
                  id="new-pass"
                  type="password"
                  required
                  className="form-input"
                  placeholder="Enter new password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                />
              </div>

              <div className="form-group">
                <label className="form-label" htmlFor="confirm-pass">Confirm New Password</label>
                <input
                  id="confirm-pass"
                  type="password"
                  required
                  className="form-input"
                  placeholder="Confirm new password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                />
              </div>

              <button type="submit" className="btn btn-secondary" style={{ width: '100%', padding: '0.75rem' }} disabled={passLoading}>
                {passLoading ? <div className="spinner"></div> : 'Update Password'}
              </button>
            </form>
          </div>

        </div>

      </div>
    </div>
  )
}
