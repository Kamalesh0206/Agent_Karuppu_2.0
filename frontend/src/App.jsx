import React, { createContext, useContext, useState, useEffect } from 'react'
import { BrowserRouter, Routes, Route, Navigate, NavLink, useNavigate } from 'react-router-dom'
import { LayoutDashboard, Users, Terminal, LogOut, KeyRound, User, ClipboardList, ShieldAlert } from 'lucide-react'

// Pages
import Login from './pages/Login'
import Signup from './pages/Signup'
import OTP from './pages/OTP'
import Dashboard from './pages/Dashboard'
import Accounts from './pages/Accounts'
import Requests from './pages/Requests'
import Profile from './pages/Profile'
import Admin from './pages/Admin'
import Logs from './pages/Logs'

// Auth Context
const AuthContext = createContext(null)

export const useAuth = () => useContext(AuthContext)

const ProtectedRoute = ({ children, allowedRoles }) => {
  const { user, loading } = useAuth()

  if (loading) {
    return (
      <div style={{ display: 'flex', height: '100vh', alignItems: 'center', justifyContent: 'center', background: '#090714' }}>
        <div className="spinner"></div>
      </div>
    )
  }

  if (!user) {
    return <Navigate to="/login" replace />
  }

  if (allowedRoles && !allowedRoles.includes(user.role)) {
    return <Navigate to="/dashboard" replace />
  }

  return children
}

const Layout = () => {
  const { user, logout } = useAuth()
  const navigate = useNavigate()

  const handleLogout = () => {
    logout()
    navigate('/login')
  }

  const isSuperAdmin = user?.role === 'Super Admin'

  return (
    <div className="app-container">
      <aside className="sidebar">
        <NavLink to="/dashboard" className="logo-container">
          <div className="logo-icon">📸</div>
          <span className="logo-text">IG Publisher</span>
        </NavLink>

        <nav style={{ flex: 1 }}>
          <ul className="nav-links">
            <li>
              <NavLink to="/dashboard" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
                <LayoutDashboard size={18} />
                Dashboard
              </NavLink>
            </li>
            <li>
              <NavLink to="/accounts" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
                <Users size={18} />
                IG Accounts
              </NavLink>
            </li>
            <li>
              <NavLink to="/requests" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
                <ClipboardList size={18} />
                Update Requests
              </NavLink>
            </li>
            {isSuperAdmin && (
              <li>
                <NavLink to="/admin" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
                  <ShieldAlert size={18} style={{ color: 'var(--primary)' }} />
                  Admin Console
                </NavLink>
              </li>
            )}
            <li>
              <NavLink to="/profile" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
                <User size={18} />
                My Profile
              </NavLink>
            </li>
            <li>
              <NavLink to="/logs" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
                <Terminal size={18} />
                Audit Logs
              </NavLink>
            </li>
          </ul>
        </nav>

        <div className="sidebar-footer">
          {user && (
            <div className="user-badge">
              <div className="user-avatar">
                {user.username.substring(0, 2).toUpperCase()}
              </div>
              <div className="user-info">
                <span className="user-name">{user.username}</span>
                <span className="user-role">{user.role}</span>
              </div>
            </div>
          )}
          <button onClick={handleLogout} className="btn btn-secondary" style={{ width: '100%', padding: '0.5rem 1rem' }}>
            <LogOut size={16} />
            Logout
          </button>
        </div>
      </aside>

      <main className="main-content">
        <Routes>
          <Route path="dashboard" element={<Dashboard />} />
          <Route path="accounts" element={<Accounts />} />
          <Route path="requests" element={<Requests />} />
          <Route path="profile" element={<Profile />} />
          <Route 
            path="admin" 
            element={
              <ProtectedRoute allowedRoles={['Super Admin']}>
                <Admin />
              </ProtectedRoute>
            } 
          />
          <Route path="logs" element={<Logs />} />
          <Route path="" element={<Navigate to="dashboard" replace />} />
        </Routes>
      </main>
    </div>
  )
}

function App() {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const token = localStorage.getItem('token')
    const username = localStorage.getItem('username')
    const role = localStorage.getItem('role')
    const status = localStorage.getItem('status')

    if (token && username && role && status) {
      setUser({ token, username, role, status })
    }
    setLoading(false)
  }, [])

  const login = (userData) => {
    localStorage.setItem('token', userData.access_token)
    localStorage.setItem('username', userData.username)
    localStorage.setItem('role', userData.role)
    localStorage.setItem('status', userData.status)
    setUser({
      token: userData.access_token,
      username: userData.username,
      role: userData.role,
      status: userData.status
    })
  }

  const logout = () => {
    localStorage.removeItem('token')
    localStorage.removeItem('username')
    localStorage.removeItem('role')
    localStorage.removeItem('status')
    setUser(null)
  }

  const updateProfileInStorage = (updatedUsername) => {
    localStorage.setItem('username', updatedUsername)
    setUser(prev => prev ? { ...prev, username: updatedUsername } : null)
  }

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, updateProfileInStorage }}>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/signup" element={<Signup />} />
          <Route path="/verify" element={<OTP />} />
          <Route
            path="/*"
            element={
              <ProtectedRoute>
                <Layout />
              </ProtectedRoute>
            }
          />
        </Routes>
      </BrowserRouter>
    </AuthContext.Provider>
  )
}

export default App
export { AuthContext }
