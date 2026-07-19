import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import axios from 'axios';
import { API_URL } from '../config.ts';
import { motion } from 'framer-motion';
import BrandLogo from '../components/BrandLogo';

export default function Signup() {
  const navigate = useNavigate();
  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [mobileNumber, setMobileNumber] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!fullName || !username || !password || (!email && !mobileNumber)) {
      setError("Please fill in required fields. You must provide an email or mobile number.");
      return;
    }

    setError('');
    setLoading(true);

    try {
      console.log(`[Auth Registration] Initiating POST request to ${API_URL}/signup`, { username, fullName, email, mobileNumber });
      await axios.post(`${API_URL}/signup`, {
        full_name: fullName,
        email: email || null,
        mobile_number: mobileNumber || null,
        username,
        password
      });

      console.log("[Auth Registration] Registration successful.");
      setSuccess(true);
      setTimeout(() => navigate('/login'), 4000);
    } catch (err: any) {
      console.error("[Auth Registration Error] Detailed diagnostic info:", {
        url: `${API_URL}/signup`,
        status: err.response?.status,
        data: err.response?.data,
        message: err.message,
        code: err.code
      });

      let msg = "Failed to sign up. Please try again.";
      const status = err.response?.status;
      const detail = err.response?.data?.detail;

      if (detail) {
        msg = detail;
      } else if (status === 400) {
        msg = "Validation failed. Username, email, or mobile number already exists or is invalid.";
      } else if (status === 404) {
        msg = `Registration endpoint not found at ${API_URL}/signup (404).`;
      } else if (status === 500) {
        msg = "Backend database error during registration (500). Please contact administrator.";
      } else if (!err.response) {
        msg = `Network Connection Error (${err.message || 'Server Unreachable'}). Unable to reach backend API at ${API_URL}. Please check internet connection or server CORS settings.`;
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
        <div className="absolute -top-24 -left-24 w-48 h-48 bg-purple-500/10 rounded-full blur-3xl" />
        <div className="absolute -bottom-24 -right-24 w-48 h-48 bg-pink-500/10 rounded-full blur-3xl" />

        <div className="text-center mb-6 relative">
          <BrandLogo size="hero" className="mx-auto mb-4" />
          <h2 className="text-3xl font-black font-outfit text-slate-100 mb-2">Create Account</h2>
          <p className="text-sm text-slate-400">Join AgentKaruppu publishing network</p>
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

        {success && (
          <motion.div 
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="mb-6 p-4 rounded-xl bg-green-500/10 border border-green-500/20 text-green-400 text-sm font-semibold leading-relaxed"
          >
            Registration successful! Your account is pending Super Admin approval. Redirecting to login page...
          </motion.div>
        )}

        {!success && (
          <form onSubmit={handleSubmit} className="space-y-4 relative">
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-1.5">Full Name *</label>
              <input
                type="text"
                required
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="e.g. John Doe"
                className="w-full px-4 py-2.5 rounded-xl bg-slate-900/50 border border-slate-800 focus:border-purple-500/50 focus:ring-1 focus:ring-purple-500/50 outline-none text-slate-200 text-sm transition-all placeholder:text-slate-600"
              />
            </div>

            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-1.5">Email Address</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="john@example.com"
                className="w-full px-4 py-2.5 rounded-xl bg-slate-900/50 border border-slate-800 focus:border-purple-500/50 focus:ring-1 focus:ring-purple-500/50 outline-none text-slate-200 text-sm transition-all placeholder:text-slate-600"
              />
            </div>

            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-1.5">Mobile Number</label>
              <input
                type="tel"
                value={mobileNumber}
                onChange={(e) => setMobileNumber(e.target.value)}
                placeholder="+1234567890"
                className="w-full px-4 py-2.5 rounded-xl bg-slate-900/50 border border-slate-800 focus:border-purple-500/50 focus:ring-1 focus:ring-purple-500/50 outline-none text-slate-200 text-sm transition-all placeholder:text-slate-600"
              />
            </div>

            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-1.5">Username *</label>
              <input
                type="text"
                required
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="e.g. johndoe"
                className="w-full px-4 py-2.5 rounded-xl bg-slate-900/50 border border-slate-800 focus:border-purple-500/50 focus:ring-1 focus:ring-purple-500/50 outline-none text-slate-200 text-sm transition-all placeholder:text-slate-600"
              />
            </div>

            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-1.5">Password *</label>
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••••••"
                className="w-full px-4 py-2.5 rounded-xl bg-slate-900/50 border border-slate-800 focus:border-purple-500/50 focus:ring-1 focus:ring-purple-500/50 outline-none text-slate-200 text-sm transition-all placeholder:text-slate-600"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3.5 rounded-xl font-bold text-slate-950 gradient-btn shadow-lg shadow-purple-500/20 hover:shadow-purple-500/30 flex items-center justify-center cursor-pointer transition-all duration-300 disabled:opacity-50"
            >
              {loading ? (
                <svg className="animate-spin h-5 w-5 text-slate-950" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
              ) : "Register"}
            </button>
          </form>
        )}

        <div className="mt-6 text-center text-sm text-slate-400 relative">
          <span>Already have an account? </span>
          <Link to="/login" className="text-purple-400 font-bold hover:underline">Sign In</Link>
        </div>
      </motion.div>
    </div>
  );
}
