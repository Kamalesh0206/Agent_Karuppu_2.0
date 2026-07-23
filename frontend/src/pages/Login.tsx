import React, { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import axios from 'axios';
import { API_URL, setCustomApiUrl, isFrontendUrl, validateBackendHealth } from '../config.ts';
import { motion } from 'framer-motion';
import BrandLogo from '../components/BrandLogo';

export default function Login() {
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // Mobile & Production API Configuration States
  const [showApiConfig, setShowApiConfig] = useState(isFrontendUrl(API_URL));
  const [customUrlInput, setCustomUrlInput] = useState(isFrontendUrl(API_URL) ? '' : API_URL);
  const [healthTesting, setHealthTesting] = useState(false);
  const [healthResult, setHealthResult] = useState<string | null>(null);

  const handleTestAndSaveApi = async () => {
    setHealthTesting(true);
    setHealthResult(null);
    let target = customUrlInput.trim().replace(/\/$/, '');
    if (target && !target.startsWith('http://') && !target.startsWith('https://')) {
      target = `https://${target}`;
    }

    const check = await validateBackendHealth(target);
    if (check.valid) {
      setHealthResult(`${check.message} Saving & Reloading...`);
      setTimeout(() => {
        setCustomApiUrl(target);
      }, 1200);
    } else {
      setHealthResult(check.error || "❌ Backend server unavailable.");
    }
    setHealthTesting(false);
  };

  React.useEffect(() => {
    // If token exists, auto-navigate to dashboard
    const existingToken = localStorage.getItem("token");
    if (existingToken) {
      navigate("/", { replace: true });
    }
  }, [navigate]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username || !password) {
      setError("Please fill in all fields.");
      return;
    }

    if (isFrontendUrl(API_URL)) {
      setError("Incorrect API Server URL. You are pointing to the Netlify Frontend (https://agentkaruppu.netlify.app) instead of your FastAPI backend server. Please enter your backend server URL below.");
      setShowApiConfig(true);
      return;
    }

    setError('');
    setLoading(true);

    const loginEndpoints = [
      `${API_URL}/login`,
      `${API_URL}/auth/login`,
      `${API_URL}/api/login`
    ];

    let response: any = null;
    let lastErr: any = null;

    for (const endpoint of loginEndpoints) {
      try {
        console.log(`[Auth Login] Initiating POST request to ${endpoint}`, { username });
        const res = await axios.post(endpoint, {
          username: username.trim(),
          password
        }, {
          headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
          timeout: 15000
        });

        if (typeof res.data === 'string' && (res.data.includes('<!DOCTYPE') || res.data.includes('<html'))) {
          throw new Error("HTML_RESPONSE_DETECTED");
        }

        response = res;
        break; // Successfully authenticated!
      } catch (err: any) {
        lastErr = err;
        // If 404, try next fallback endpoint. If 401, 403, 500, break loop to show actual status.
        if (err.response?.status !== 404) {
          break;
        }
      }
    }

    if (response && response.data) {
      console.log("[Auth Login] Login successful:", response.data);
      const { access_token, role, status } = response.data;
      localStorage.setItem("token", access_token);
      localStorage.setItem("username", username.trim());
      localStorage.setItem("role", role);
      localStorage.setItem("status", status);

      navigate("/");
    } else {
      const err = lastErr || {};
      console.error("[Auth Login Error] Detailed diagnostic info:", {
        url: `${API_URL}/login`,
        status: err.response?.status,
        data: err.response?.data,
        message: err.message,
        code: err.code
      });

      let msg = "Failed to log in. Please try again.";
      const status = err.response?.status;
      const detail = err.response?.data?.detail;
      const isHtmlResponse = err.message === "HTML_RESPONSE_DETECTED" || 
        (err.response && typeof err.response.data === 'string' && (err.response.data.includes('<!DOCTYPE') || err.response.data.includes('<html')));

      if (isHtmlResponse) {
        msg = "Incorrect API Server URL. You are pointing to the Netlify Frontend (https://agentkaruppu.netlify.app) instead of your FastAPI backend server. Please enter your actual FastAPI backend server URL below.";
        setShowApiConfig(true);
      } else if (detail) {
        msg = detail;
      } else if (status === 401) {
        msg = "Invalid credentials. Please verify your username and password.";
      } else if (status === 403) {
        msg = "Account pending administrator approval or deactivated.";
      } else if (status === 404) {
        msg = `Authentication endpoint not found at ${API_URL}/login (404). Please verify your backend API URL below.`;
        setShowApiConfig(true);
      } else if (status === 500) {
        msg = "Backend server or database error (500). Please contact administrator.";
      } else if (!err.response) {
        msg = `Backend API server is unavailable (${err.message || 'Server Unreachable'}). Unable to reach API at ${API_URL}. Please check your backend URL below.`;
        setShowApiConfig(true);
      }

      setError(msg);
    }

    setLoading(false);
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

        <div className="text-center mb-6 relative">
          <BrandLogo size="hero" className="mx-auto mb-4" />
          <h2 className="text-3xl font-black font-outfit text-slate-100 mb-2">Welcome Back</h2>
          <p className="text-sm text-slate-400">Sign in to your The NexRevo publishing console</p>
        </div>

        {error && (
          <motion.div 
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="mb-6 p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm font-semibold space-y-2"
          >
            <p>{error}</p>
            <button
              type="button"
              onClick={() => setShowApiConfig(!showApiConfig)}
              className="text-xs text-purple-400 hover:text-purple-300 underline font-bold cursor-pointer block"
            >
              {showApiConfig ? "Hide API Configuration" : "⚙ Configure Backend API Endpoint URL"}
            </button>
          </motion.div>
        )}

        {showApiConfig && (
          <div className="mb-6 p-4 rounded-2xl bg-slate-950/90 border border-purple-500/30 space-y-3 relative shadow-2xl">
            <div className="flex items-center justify-between text-xs font-bold text-slate-300">
              <span>FastAPI Backend Server Target</span>
              <span className="text-[10px] text-purple-400 font-mono">Current: {API_URL}</span>
            </div>
            <p className="text-[11px] text-slate-400">Enter your actual FastAPI backend URL (e.g. Render, Railway, VPS, or Ngrok):</p>
            <div className="flex gap-2">
              <input
                type="text"
                value={customUrlInput}
                onChange={(e) => setCustomUrlInput(e.target.value)}
                placeholder="https://your-backend.onrender.com or http://192.168.x.x:8000"
                className="flex-1 px-3 py-2 text-xs rounded-xl bg-slate-900 border border-slate-800 text-slate-200 outline-none focus:border-purple-500 font-mono"
              />
              <button
                type="button"
                onClick={handleTestAndSaveApi}
                disabled={healthTesting}
                className="px-3 py-2 bg-purple-500 hover:bg-purple-400 text-slate-950 text-xs font-bold rounded-xl cursor-pointer disabled:opacity-50 shrink-0"
              >
                {healthTesting ? "Testing..." : "Test & Save"}
              </button>
            </div>
            {healthResult && (
              <p className={`text-[11px] font-mono leading-relaxed ${healthResult.includes("✅") ? "text-green-400" : "text-red-400"}`}>
                {healthResult}
              </p>
            )}
          </div>
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

        <div className="mt-6 text-center">
          <button
            type="button"
            onClick={() => setShowApiConfig(!showApiConfig)}
            className="text-xs text-slate-500 hover:text-purple-400 font-semibold cursor-pointer transition-colors"
          >
            ⚙ Change/Configure Target Backend API URL
          </button>
        </div>

        <div className="mt-6 text-center text-sm text-slate-400 relative">
          <span>Don't have an account? </span>
          <Link to="/signup" className="text-purple-400 font-bold hover:underline">Sign Up</Link>
        </div>
      </motion.div>
    </div>
  );
}
