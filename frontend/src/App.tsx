import React, { useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Link, useNavigate, useLocation, Navigate } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import axios from 'axios';
import { 
  LayoutDashboard, Users, History, FileText, Settings as SettingsIcon, 
  LogOut, Menu, X, User as UserIcon
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import BrandLogo from './components/BrandLogo';
import { API_URL } from './config.ts';

// Axios Interceptor for token expiration handling
// IMPORTANT: Only clears session JWT tokens, NOT Instagram account data or preferences.
// Instagram accounts are stored in the database, NOT in localStorage.
axios.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response && error.response.status === 401) {
      // Only remove the session JWT — never clear all localStorage
      // This preserves the custom_api_url setting and any user preferences
      localStorage.removeItem("token");
      localStorage.removeItem("username");
      localStorage.removeItem("role");
      localStorage.removeItem("status");
      // Note: custom_api_url is intentionally preserved so user doesn't need to reconfigure
      window.location.href = '/login';
    }
    return Promise.reject(error);
  }
);

import Login from './pages/Login';
import Signup from './pages/Signup';
import Dashboard from './pages/Dashboard';
import Accounts from './pages/Accounts';
import PublishingHistory from './pages/History';
import Logs from './pages/Logs';
import Settings from './pages/Settings';
import UserManagement from './pages/UserManagement';

const queryClient = new QueryClient();

// Protected Route Guard
const ProtectedRoute = ({ children }: { children: React.ReactNode }) => {
  const token = localStorage.getItem("token");
  if (!token) {
    return <Navigate to="/login" replace />;
  }
  return <>{children}</>;
};

// 404 Error Page Component
const NotFound = () => (
  <div className="min-h-[70vh] flex flex-col items-center justify-center text-center p-6 space-y-4">
    <div className="p-4 bg-purple-500/10 border border-purple-500/20 text-purple-400 rounded-2xl text-4xl font-black font-outfit">404</div>
    <h2 className="text-2xl font-black text-slate-100 font-outfit">Page Not Found</h2>
    <p className="text-sm text-slate-400 max-w-md">The page you are looking for does not exist or has been moved on The NexRevo platform.</p>
    <Link to="/" className="px-6 py-2.5 bg-purple-500 hover:bg-purple-400 text-slate-950 font-bold rounded-xl text-xs transition-all shadow-lg shadow-purple-500/20">Return to Dashboard</Link>
  </div>
);

// Sidebar Navigation Layout
const DashboardLayout = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const username = localStorage.getItem("username") || "User";
  const role = localStorage.getItem("role") || "User";

  const handleLogout = async () => {
    // Call backend to revoke the JWT token server-side
    // This ONLY invalidates the session JWT — Instagram accounts remain in the database permanently
    const token = localStorage.getItem("token");
    if (token) {
      try {
        await axios.post(`${API_URL}/logout`, {}, {
          headers: { Authorization: `Bearer ${token}` }
        });
      } catch (err) {
        // Even if logout API fails, clear local session
        console.warn("[Logout] Backend logout call failed, clearing local session anyway:", err);
      }
    }
    // Only remove session tokens — never wipe Instagram account data or preferences
    localStorage.removeItem("token");
    localStorage.removeItem("username");
    localStorage.removeItem("role");
    localStorage.removeItem("status");
    navigate("/login");
  };

  const menuItems = [
    { text: 'Publish Post', icon: <LayoutDashboard size={18} />, path: '/' },
    { text: 'IG Accounts', icon: <Users size={18} />, path: '/accounts' },
    { text: 'Publishing History', icon: <History size={18} />, path: '/history' },
    { text: 'Audit Logs', icon: <FileText size={18} />, path: '/logs' },
    { text: 'Settings', icon: <SettingsIcon size={18} />, path: '/settings' },
  ];

  const isAdmin = role === "Super Admin" || role === "Admin";
  const finalMenuItems = isAdmin 
    ? [...menuItems, { text: 'User Management', icon: <Users size={18} />, path: '/admin/users' }]
    : menuItems;

  const sidebarContent = (
    <div className="h-full flex flex-col justify-between bg-slate-950 border-r border-slate-800 p-4">
      <div>
        {/* Brand Header */}
        <div className="flex flex-col items-center text-center px-2 py-4 mb-6 border-b border-slate-900 pb-6">
          <BrandLogo size="medium" className="mb-4" />
          <div>
            <h1 className="text-xl font-black font-outfit gradient-text tracking-wide">The NexRevo</h1>
            <span className="text-[10px] text-slate-400 font-mono tracking-widest uppercase">AI Social Platform</span>
          </div>
        </div>

        {/* Navigation Items */}
        <nav className="space-y-1.5">
          {finalMenuItems.map((item) => {
            const active = location.pathname === item.path;
            return (
              <Link
                key={item.text}
                to={item.path}
                onClick={() => setMobileOpen(false)}
                className={`flex items-center gap-3 px-4 py-3 rounded-xl text-sm font-semibold transition-all duration-300 ${
                  active 
                    ? 'bg-purple-500/10 text-purple-400 shadow-inner' 
                    : 'text-slate-400 hover:bg-slate-900 hover:text-slate-200'
                }`}
              >
                {item.icon}
                <span>{item.text}</span>
              </Link>
            );
          })}
        </nav>
      </div>

      {/* User Actions */}
      <div className="border-t border-slate-900 pt-4">
        <div className="flex items-center gap-3 px-3 py-2 mb-4 bg-slate-900/40 rounded-xl border border-slate-900">
          <div className="w-9 h-9 rounded-full bg-purple-500/20 border border-purple-500/30 flex items-center justify-center text-purple-400">
            <UserIcon size={16} />
          </div>
          <div>
            <p className="text-sm font-bold text-slate-200">{username}</p>
            <span className="text-xs text-green-400 font-medium">Connected</span>
          </div>
        </div>
        <button
          onClick={handleLogout}
          className="w-full flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-bold border border-red-500/20 text-red-400 hover:bg-red-500/10 transition-colors duration-300"
        >
          <LogOut size={16} />
          <span>Logout</span>
        </button>
      </div>
    </div>
  );

  return (
    <div className="flex min-h-screen bg-slate-950 font-sans flex-col justify-between">
      <div className="flex min-h-screen">
        {/* Mobile Top Navbar */}
        <header className="lg:hidden fixed top-0 left-0 w-full h-16 bg-slate-950/80 backdrop-blur-md border-b border-slate-900 px-4 flex items-center justify-between z-40">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setMobileOpen(true)}
              className="p-2 text-slate-400 hover:text-slate-200 transition-colors"
            >
              <Menu size={20} />
            </button>
            <BrandLogo size="small" />
            <h1 className="text-lg font-black font-outfit gradient-text">The NexRevo</h1>
          </div>
        </header>

        {/* Mobile Overlay Menu */}
        <AnimatePresence>
          {mobileOpen && (
            <>
              <motion.div 
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                onClick={() => setMobileOpen(false)}
                className="lg:hidden fixed inset-0 bg-black/60 backdrop-blur-sm z-50"
              />
              <motion.div 
                initial={{ x: '-100%' }}
                animate={{ x: 0 }}
                exit={{ x: '-100%' }}
                transition={{ type: 'spring', damping: 25 }}
                className="lg:hidden fixed top-0 left-0 bottom-0 w-72 z-50"
              >
                <div className="absolute right-4 top-4">
                  <button
                    onClick={() => setMobileOpen(false)}
                    className="p-2 text-slate-400 hover:text-slate-200"
                  >
                    <X size={20} />
                  </button>
                </div>
                {sidebarContent}
              </motion.div>
            </>
          )}
        </AnimatePresence>

        {/* Desktop Sidebar */}
        <aside className="hidden lg:block w-64 fixed top-0 bottom-0 left-0 z-30">
          {sidebarContent}
        </aside>

        {/* Main Panel */}
        <main className="flex-1 lg:ml-64 p-4 lg:p-8 pt-20 lg:pt-8 bg-slate-950 flex flex-col justify-between">
          <div className="flex-1">
            <Routes>
              <Route path="/" element={<Dashboard />} />
              <Route path="/dashboard" element={<Dashboard />} />
              <Route path="/publish" element={<Dashboard />} />
              <Route path="/accounts" element={<Accounts />} />
              <Route path="/groups" element={<Accounts />} />
              <Route path="/history" element={<PublishingHistory />} />
              <Route path="/publishing/history" element={<PublishingHistory />} />
              <Route path="/logs" element={<Logs />} />
              <Route path="/audit-logs" element={<Logs />} />
              <Route path="/settings" element={<Settings />} />
              <Route path="/users" element={isAdmin ? <UserManagement /> : <Navigate to="/" replace />} />
              <Route path="/admin/users" element={isAdmin ? <UserManagement /> : <Navigate to="/" replace />} />
              <Route path="*" element={<NotFound />} />
            </Routes>
          </div>

          {/* Footer */}
          <footer className="text-center text-xs text-slate-500 py-6 border-t border-slate-900/60 mt-12">
            © 2026 The NexRevo. Building the Next Revolution in AI.
          </footer>
        </main>
      </div>
    </div>
  );
};

function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);
  return null;
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <Router>
        <ScrollToTop />
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/signup" element={<Signup />} />
          <Route path="*" element={<ProtectedRoute><DashboardLayout /></ProtectedRoute>} />
        </Routes>
      </Router>
    </QueryClientProvider>
  );
}
