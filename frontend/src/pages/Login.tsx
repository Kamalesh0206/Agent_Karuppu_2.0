import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import axios from 'axios';
import { API_URL } from '../config.ts';
import { motion } from 'framer-motion';

export default function Login() {
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username || !password) {
      setError("Please fill in all fields.");
      return;
    }

    setError('');
    setLoading(true);

    try {
      const response = await axios.post(`${API_URL}/login`, {
        username,
        password
      });

      const { access_token, role, status } = response.data;
      localStorage.setItem("token", access_token);
      localStorage.setItem("username", username);
      localStorage.setItem("role", role);
      localStorage.setItem("status", status);

      navigate("/");
    } catch (err: any) {
      console.error("Login failure:", err);
      let msg = "Failed to log in. Please try again.";
      if (err.response?.data?.detail) {
        msg = err.response.data.detail;
      } else if (err.message) {
        msg = `${err.message}. Please verify the API endpoint is active and CORS is configured.`;
      }
      setError(msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-radial from-slate-900 to-slate-950 p-4">
      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
        className="w-full max-w-md glass-panel p-8 rounded-3xl border border-slate-800 shadow-2xl relative overflow-hidden"
      >
        {/* Aesthetic Background Accents */}
        <div className="absolute -top-24 -left-24 w-48 h-48 bg-purple-500/10 rounded-full blur-3xl" />
        <div className="absolute -bottom-24 -right-24 w-48 h-48 bg-pink-500/10 rounded-full blur-3xl" />

        <div className="text-center mb-8 relative">
          <img 
            src="/logo.jpg" 
            alt="Agent Logo" 
            className="w-16 h-16 rounded-2xl mx-auto mb-4 shadow-lg shadow-purple-500/20 object-cover border border-purple-500/20"
          />
          <h2 className="text-3xl font-black font-outfit text-slate-100 mb-2">Welcome Back</h2>
          <p className="text-sm text-slate-400">Sign in to your AgentKaruppu publishing console</p>
        </div>

        {error && (
          <motion.div 
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="mb-6 p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm font-semibold"
          >
            {error}
          </motion.div>
        )}

        <form onSubmit={handleSubmit} className="space-y-5 relative">
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-2">Username, Email or Mobile</label>
            <input
              type="text"
              required
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="e.g. admin"
              className="w-full px-4 py-3 rounded-xl bg-slate-900/50 border border-slate-800 focus:border-purple-500/50 focus:ring-1 focus:ring-purple-500/50 outline-none text-slate-200 text-sm transition-all placeholder:text-slate-600"
            />
          </div>

          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-2">Password</label>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••••••"
              className="w-full px-4 py-3 rounded-xl bg-slate-900/50 border border-slate-800 focus:border-purple-500/50 focus:ring-1 focus:ring-purple-500/50 outline-none text-slate-200 text-sm transition-all placeholder:text-slate-600"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-4 rounded-xl font-bold text-slate-950 gradient-btn shadow-lg shadow-purple-500/20 hover:shadow-purple-500/30 flex items-center justify-center cursor-pointer transition-all duration-300 disabled:opacity-50"
          >
            {loading ? (
              <svg className="animate-spin h-5 w-5 text-slate-950" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
            ) : "Sign In"}
          </button>
        </form>

        <div className="mt-8 text-center text-sm text-slate-400 relative">
          <span>Don't have an account? </span>
          <Link to="/signup" className="text-purple-400 font-bold hover:underline">Sign Up</Link>
        </div>
      </motion.div>
    </div>
  );
}
